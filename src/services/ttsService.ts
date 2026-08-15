import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { TtsConfig, getTtsConfig } from '../common/config';
import { UserVisibleError, isRetryableError } from '../common/errors';
import { fileExists } from '../common/fileUtils';
import { t } from '../common/i18n';
import { AudioFormat, TtsSynthesisResult, TtsSynthesizer } from '../common/types';
import { clampConcurrency, cleanupStaleTempDirs, sortedStringify, withRetries } from '../common/utils';
import { ApiKeyProvider } from './secretManager';

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
  private readonly pendingTasks = new Set<Promise<unknown>>();
  private readonly tempDir: vscode.Uri;
  private readonly waiters: Waiter[] = [];
  private tempCleanupStarted = false;
  private tempCounter = 0;
  private cacheAddCount = 0;
  private activeRequests = 0;
  private cacheRootReady = false;
  private startupCleanupTimer: ReturnType<typeof setTimeout> | undefined;

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
    await this.ensureCacheRootReady(cacheRoot);

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

    // 无论缓存开关，同内容的在途请求都共享同一次合成
    const inFlight = this.inFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const synthesis = this.startSynthesis(request, text, config, cacheRoot, cacheKey, token);
    this.inFlight.set(cacheKey, synthesis);

    try {
      return await synthesis;
    } finally {
      if (this.inFlight.get(cacheKey) === synthesis) {
        this.inFlight.delete(cacheKey);
      }
    }
  }

  private async startSynthesis(
    request: SpeakRequest,
    text: string,
    config: TtsConfig,
    cacheRoot: vscode.Uri,
    cacheKey: string,
    token: vscode.CancellationToken
  ): Promise<TtsAudioFile> {
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

      return this.synthesizeUncachedToFile(request, text, config, cacheRoot, fileUri, token);
    }

    // 缓存关闭时使用独立会话临时目录，避免在音频缓存里永久堆积
    await this.ensureTempDirReady();
    const tempUri = vscode.Uri.joinPath(this.tempDir, `_temp-${cacheKey}-${this.tempCounter++}.${this.client.outputFormat}`);
    return this.synthesizeUncachedToFile(request, text, config, this.tempDir, tempUri, token);
  }

  /** 激活后延迟执行一次缓存清理扫描，避免旧缓存无限堆积；失败不影响使用 */
  public scheduleCacheCleanup(delayMs = 15000): void {
    this.startupCleanupTimer = setTimeout(() => {
      this.startupCleanupTimer = undefined;
      void (async () => {
        const config = this.configProvider();
        if (!config.cacheEnabled) {
          return;
        }

        const cacheRoot = vscode.Uri.joinPath(this.globalStorageUri, 'audio-cache');
        try {
          await cleanupAudioCache(cacheRoot, config.cacheMaxSizeMb, cacheRoot);
        } catch {
          // 启动清理失败不阻塞
        }
      })();
    }, delayMs);
  }

  public async dispose(): Promise<void> {
    if (this.startupCleanupTimer !== undefined) {
      clearTimeout(this.startupCleanupTimer);
      this.startupCleanupTimer = undefined;
    }

    // 等待在途合成写入结束，避免删掉仍在写入的临时目录
    if (this.pendingTasks.size > 0) {
      await Promise.allSettled([...this.pendingTasks]);
    }

    try {
      await vscode.workspace.fs.delete(this.tempDir, {
        recursive: true,
        useTrash: false
      });
    } catch {
      // 临时目录可能不存在，忽略
    }
  }

  private async ensureCacheRootReady(cacheRoot: vscode.Uri): Promise<void> {
    if (this.cacheRootReady) {
      return;
    }
    await vscode.workspace.fs.createDirectory(cacheRoot);
    this.cacheRootReady = true;
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
    const task = this.runWithConcurrencyLimit(clampConcurrency(config.maxConcurrentRequests), token, async () => {
      const apiKey = await this.apiKeyProvider.requireApiKey();
      const result: TtsSynthesisResult = await withRetries(
        () => this.client.synthesizeSpeech(
          text,
          request.voiceId ?? '',
          request.speed,
          request.pitch,
          request.vol,
          request.extraParams,
          request.model,
          apiKey,
          token
        ),
        isRetryableError,
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
    this.pendingTasks.add(task);
    try {
      return await task;
    } finally {
      this.pendingTasks.delete(task);
    }
  }

  private async runWithConcurrencyLimit<T>(
    limit: number,
    token: vscode.CancellationToken,
    task: () => Promise<T>
  ): Promise<T> {
    await this.acquireConcurrencySlot(limit, token);
    try {
      return await task();
    } finally {
      this.releaseConcurrencySlot();
    }
  }

  private async acquireConcurrencySlot(limit: number, token: vscode.CancellationToken): Promise<void> {
    for (; ;) {
      // 唤醒后必须重新检查取消：槽位释放与取消传播之间存在竞态
      if (token.isCancellationRequested) {
        throw new vscode.CancellationError();
      }

      if (this.activeRequests < limit) {
        this.activeRequests++;
        return;
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
  const audioUris = entries
    .filter(([name, type]) => type === vscode.FileType.File && /\.(?:mp3|wav|flac)$/i.test(name))
    .map(([name]) => vscode.Uri.joinPath(cacheRoot, name));

  // 并行 stat，避免逐个 IPC 往返
  const audioEntries: AudioCacheEntry[] = await Promise.all(audioUris.map(async uri => {
    const stat = await vscode.workspace.fs.stat(uri);
    return {
      uri,
      size: stat.size,
      mtime: stat.mtime
    };
  }));
  let totalBytes = audioEntries.reduce((sum, entry) => sum + entry.size, 0);

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
