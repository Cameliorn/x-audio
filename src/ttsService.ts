import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { AudioFormat, MiniMaxTtsConfig, getMiniMaxConfig } from './config';
import { UserVisibleError } from './errors';
import { deleteFileIfExists, fileExists } from './fileUtils';
import { t } from './i18n';
import { ApiKeyProvider } from './secretManager';
import { TtsSynthesisResult, TtsSynthesizer } from './types';

export interface SpeakRequest {
  readonly text: string;
  readonly voiceId?: string;
  readonly model?: string;
  readonly speed?: number;
  readonly pitch?: number;
  readonly vol?: number;
  /** 提供者专属参数（如 MiniMax 的 emotion），由各 TtsSynthesizer 自行解读 */
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

export type ConfigProvider = () => MiniMaxTtsConfig;

export class TtsService {
  private readonly inFlight = new Map<string, Promise<TtsAudioFile>>();
  private cacheAddCount = 0;

  // 每新增 CLEANUP_INTERVAL 个缓存文件才触发一次清理扫描，避免每次都遍历目录
  private static readonly CLEANUP_INTERVAL = 10;

  public constructor(
    private readonly globalStorageUri: vscode.Uri,
    private readonly apiKeyProvider: ApiKeyProvider,
    private readonly client: TtsSynthesizer,
    private readonly configProvider: ConfigProvider = getMiniMaxConfig
  ) { }

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
      this.client.configFingerprint()
    );

    if (config.cacheEnabled) {
      const fileUri = vscode.Uri.joinPath(cacheRoot, `${cacheKey}.${config.format}`);

      if (await fileExists(fileUri)) {
        return {
          uri: fileUri,
          format: config.format,
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

    // 缓存关闭时使用临时文件，避免磁盘堆积
    const tempUri = vscode.Uri.joinPath(cacheRoot, `_temp.${config.format}`);
    await deleteFileIfExists(tempUri);
    return this.synthesizeUncachedToFile(request, text, config, cacheRoot, tempUri, token);
  }

  private async synthesizeUncachedToFile(
    request: SpeakRequest,
    text: string,
    config: MiniMaxTtsConfig,
    cacheRoot: vscode.Uri,
    fileUri: vscode.Uri,
    token: vscode.CancellationToken
  ): Promise<TtsAudioFile> {
    const apiKey = await this.apiKeyProvider.requireApiKey();
    const result: TtsSynthesisResult = await this.client.synthesizeSpeech(
      text,
      request.voiceId || config.voiceId,
      request.speed,
      request.pitch,
      request.vol,
      request.extraParams,
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
      format: config.format,
      cacheHit: false,
      characters: text.length,
      traceId: result.traceId,
      extraInfo: result.extraInfo
    };
  }
}

function createCacheKey(
  text: string,
  voiceId: string | undefined,
  speed: number | undefined,
  pitch: number | undefined,
  vol: number | undefined,
  extraParams: Record<string, unknown> | undefined,
  providerFingerprint: string
): string {
  const identity = {
    text,
    voiceId,
    speed,
    pitch,
    vol,
    extraParams,
    provider: providerFingerprint
  };

  return crypto
    .createHash('sha256')
    .update(sortedStringify(identity))
    .digest('hex');
}

/**
 * JSON.stringify 但保证 key 按字母序排列，包括嵌套对象。
 * 确保相同语义的配置始终产生相同的缓存键。
 */
function sortedStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(sortedStringify).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map(k => `${JSON.stringify(k)}:${sortedStringify((value as Record<string, unknown>)[k])}`);
  return `{${pairs.join(',')}}`;
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

export { cleanupAudioCache, createCacheKey };
