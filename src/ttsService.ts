import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { TtsConfig, getTtsConfig } from './config';
import { UserVisibleError } from './errors';
import { fileExists } from './fileUtils';
import { t } from './i18n';
import { ApiKeyProvider } from './secretManager';
import { AudioFormat, TtsSynthesisResult, TtsSynthesizer } from './types';
import { sortedStringify } from './utils';

export interface SpeakRequest {
  readonly text: string;
  readonly voiceId?: string;
  readonly model?: string;
  readonly speed?: number;
  readonly pitch?: number;
  readonly vol?: number;
  /** 渠道专属参数（如 MiniMax 的 emotion），由各 TtsSynthesizer 自行解读 */
  readonly extraParams?: Record<string, unknown>;
}

export interface TtsAudioFile {
  readonly uri: vscode.Uri;
  readonly format: AudioFormat;
  readonly cacheHit: boolean;
  readonly characters: number;
  readonly traceId?: string;
  readonly extraInfo?: Record<string, unknown>;
}

interface Waiter {
  readonly resolve: () => void;
  disposable?: vscode.Disposable;
}

export type ConfigProvider = () => TtsConfig;

export class TtsService {
  private readonly inFlight = new Map<string, Promise<TtsAudioFile>>();
  private readonly tempDir: vscode.Uri;
  private readonly waiters: Waiter[] = [];
  private tempCleanupStarted = false;
  private tempCounter = 0;
  private cacheAddCount = 0;
  private activeRequests = 0;

  // 每新增 CLEANUP_INTERVAL 个缓存文件才触发一次清理扫描，避免每次都遍历目录
  private static readonly CLEANUP_INTERVAL = 10;

  public constructor(
    private readonly globalStorageUri: vscode.Uri,
    private readonly apiKeyProvider: ApiKeyProvider,
    private readonly client: TtsSynthesizer,
    private readonly configProvider: ConfigProvider = getTtsConfig
  ) {
    this.tempDir = vscode.Uri.joinPath(
      this.globalStorageUri,
      'audio-tmp',
      `session-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
    );
  }

  public async synthesizeToFile(
    request: SpeakRequest,
    token: vscode.CancellationToken
  ): Promise<TtsAudioFile> {
    const text = request.text.trim();
    if (text.length === 0) {
      throw new UserVisibleError(t('tts.emptyText'));
    }

    const config = this.configProvider();
    if (text.length > config.maxTextLength) {
      throw new UserVisibleError(t('tts.textTooLong', config.maxTextLength));
    }

    const cacheRoot = vscode.Uri.joinPath(this.globalStorageUri, 'audio-cache');
    await vscode.workspace.fs.createDirectory(cacheRoot);

    const cacheKey = createCacheKey(
      text,
      request.voiceId,
      request.speed,
      request.pitch,
      request.vol,
      request.extraParams,
      request.model,
      this.client.configFingerprint()
    );

    if (config.cacheEnabled) {
      const fileUri = vscode.Uri.joinPath(cacheRoot, `${cacheKey}.${this.client.outputFormat}`);

      if (await fileExists(fileUri)) {
        return {
          uri: fileUri,
          format: this.client.outputFormat,
          cacheHit: true,
          characters: text.length
        };
      }

      const inFlight = this.inFlight.get(cacheKey);
      if (inFlight) {
        return inFlight;
      }

      const synthesis = this.synthesizeUncachedToFile(request, text, config, cacheRoot, fileUri, token);
      this.inFlight.set(cacheKey, synthesis);

      try {
        return await synthesis;
      } finally {
        if (this.inFlight.get(cacheKey) === synthesis) {
          this.inFlight.delete(cacheKey);
        }
      }
    }

    // 缓存关闭时使用独立会话临时目录，避免在音频缓存里永久堆积
    await this.ensureTempDirReady();
    const tempUri = vscode.Uri.joinPath(this.tempDir, `_temp-${cacheKey}-${this.tempCounter++}.${this.client.outputFormat}`);
    return this.synthesizeUncachedToFile(request, text, config, this.tempDir, tempUri, token);
  }

  public async dispose(): Promise<void> {
    try {
      await vscode.workspace.fs.delete(this.tempDir, {
        recursive: true,
        useTrash: false
      });
    } catch {
      // 临时目录可能不存在，忽略
    }
  }

  private async ensureTempDirReady(): Promise<void> {
    if (!this.tempCleanupStarted) {
      this.tempCleanupStarted = true;
      await cleanupStaleTempDirs(vscode.Uri.joinPath(this.globalStorageUri, 'audio-tmp'), this.tempDir);
    }
    await vscode.workspace.fs.createDirectory(this.tempDir);
  }

  private async synthesizeUncachedToFile(
    request: SpeakRequest,
    text: string,
    config: TtsConfig,
    cacheRoot: vscode.Uri,
    fileUri: vscode.Uri,
    token: vscode.CancellationToken
  ): Promise<TtsAudioFile> {
    return this.runWithConcurrencyLimit(token, async () => {
      const apiKey = await this.apiKeyProvider.requireApiKey();
      const result: TtsSynthesisResult = await this.client.synthesizeSpeech(
        text,
        request.voiceId ?? '',
        request.speed,
        request.pitch,
        request.vol,
        request.extraParams,
        request.model,
        apiKey,
        token
      );

      await vscode.workspace.fs.writeFile(fileUri, result.audio);
      if (config.cacheEnabled) {
        this.cacheAddCount++;
        if (this.cacheAddCount % TtsService.CLEANUP_INTERVAL === 0) {
          try { await cleanupAudioCache(cacheRoot, config.cacheMaxSizeMb, fileUri); } catch { /* 清理失败不阻塞 */ }
        }
      }

      return {
        uri: fileUri,
        format: this.client.outputFormat,
        cacheHit: false,
        characters: text.length,
        traceId: result.traceId,
        extraInfo: result.extraInfo
      };
    });
  }

  private async runWithConcurrencyLimit<T>(
    token: vscode.CancellationToken,
    task: () => Promise<T>
  ): Promise<T> {
    await this.acquireConcurrencySlot(token);
    try {
      return await task();
    } finally {
      this.releaseConcurrencySlot();
    }
  }

  private async acquireConcurrencySlot(token: vscode.CancellationToken): Promise<void> {
    const limit = clampConcurrency(this.configProvider().maxConcurrentRequests);

    while (this.activeRequests >= limit) {
      if (token.isCancellationRequested) {
        throw new vscode.CancellationError();
      }

      await new Promise<void>(resolve => {
        const waiter: Waiter = {
          resolve: () => resolve()
        };
        const onCancel = (): void => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) {
            this.waiters.splice(index, 1);
          }
          waiter.disposable?.dispose();
          resolve();
        };
        waiter.disposable = token.onCancellationRequested(onCancel);
        if (token.isCancellationRequested) {
          onCancel();
          return;
        }
        this.waiters.push(waiter);
      });
    }

    this.activeRequests++;
  }

  private releaseConcurrencySlot(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.disposable?.dispose();
      waiter.resolve();
    }
  }
}

async function cleanupStaleTempDirs(tempRoot: vscode.Uri, keepDir: vscode.Uri): Promise<void> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(tempRoot);
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.Directory) {
        continue;
      }

      const dir = vscode.Uri.joinPath(tempRoot, name);
      if (dir.toString() === keepDir.toString()) {
        continue;
      }

      try {
        await vscode.workspace.fs.delete(dir, {
          recursive: true,
          useTrash: false
        });
      } catch {
        // 单个旧目录清理失败不阻塞
      }
    }
  } catch {
    // temp root 可能不存在
  }
}

function clampConcurrency(value: number): number {
  return Math.min(8, Math.max(1, Math.floor(value)));
}

function createCacheKey(
  text: string,
  voiceId: string | undefined,
  speed: number | undefined,
  pitch: number | undefined,
  vol: number | undefined,
  extraParams: Record<string, unknown> | undefined,
  model: string | undefined,
  providerFingerprint: string
): string {
  const identity = {
    text,
    voiceId,
    speed,
    pitch,
    vol,
    extraParams,
    model,
    provider: providerFingerprint
  };

  return crypto
    .createHash('sha256')
    .update(sortedStringify(identity))
    .digest('hex');
}

interface AudioCacheEntry {
  readonly uri: vscode.Uri;
  readonly size: number;
  readonly mtime: number;
}

async function cleanupAudioCache(cacheRoot: vscode.Uri, maxSizeMb: number, keepUri: vscode.Uri): Promise<void> {
  const maxBytes = Math.floor(maxSizeMb * 1024 * 1024);
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    return;
  }

  const entries = await vscode.workspace.fs.readDirectory(cacheRoot);
  const audioEntries: AudioCacheEntry[] = [];
  let totalBytes = 0;

  for (const [name, type] of entries) {
    if (type !== vscode.FileType.File || !/\.(?:mp3|wav|flac)$/i.test(name)) {
      continue;
    }

    const uri = vscode.Uri.joinPath(cacheRoot, name);
    const stat = await vscode.workspace.fs.stat(uri);
    audioEntries.push({
      uri,
      size: stat.size,
      mtime: stat.mtime
    });
    totalBytes += stat.size;
  }

  // 滞后阈值：超过 120% 才清理，避免频繁扫描后立即清理
  if (totalBytes <= maxBytes * 1.2) {
    return;
  }

  const keepUriString = keepUri.toString();
  audioEntries.sort((a, b) => a.mtime - b.mtime);

  for (const entry of audioEntries) {
    if (totalBytes <= maxBytes) {
      return;
    }

    if (entry.uri.toString() === keepUriString) {
      continue;
    }

    await vscode.workspace.fs.delete(entry.uri, {
      useTrash: false
    });
    totalBytes -= entry.size;
  }
}
