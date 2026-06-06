import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { AudioFormat, MiniMaxTtsConfig, getMiniMaxConfig } from './config';
import { UserVisibleError } from './errors';
import { ApiKeyProvider } from './secretManager';
import { MiniMaxSynthesizer, TtsRequestOverrides } from './types';

export interface ExtensionStorageContext {
  readonly globalStorageUri: vscode.Uri;
}

export interface SpeakRequest {
  readonly text: string;
  readonly voiceId?: string;
  readonly model?: string;
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

  public constructor(
    private readonly context: ExtensionStorageContext,
    private readonly apiKeyProvider: ApiKeyProvider,
    private readonly client: MiniMaxSynthesizer,
    private readonly configProvider: ConfigProvider = getMiniMaxConfig
  ) { }

  public async synthesizeToFile(
    request: SpeakRequest,
    token: vscode.CancellationToken
  ): Promise<TtsAudioFile> {
    const text = request.text.trim();
    if (text.length === 0) {
      throw new UserVisibleError('没有可朗读的文本。');
    }

    const config = this.configProvider();
    if (text.length > config.maxTextLength) {
      throw new UserVisibleError(`MiniMax 文字转语音单次请求最多支持 ${config.maxTextLength} 个字符。请选择更短的文本。`);
    }

    const cacheRoot = vscode.Uri.joinPath(this.context.globalStorageUri, 'audio-cache');
    await vscode.workspace.fs.createDirectory(cacheRoot);

    const cacheKey = createCacheKey(text, config, {
      voiceId: request.voiceId,
      model: request.model
    });
    const fileUri = vscode.Uri.joinPath(cacheRoot, `${cacheKey}.${config.format}`);

    if (config.cacheEnabled && await fileExists(fileUri)) {
      await tryCleanupAudioCache(cacheRoot, config.cacheMaxSizeMb, fileUri);
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

  private async synthesizeUncachedToFile(
    request: SpeakRequest,
    text: string,
    config: MiniMaxTtsConfig,
    cacheRoot: vscode.Uri,
    fileUri: vscode.Uri,
    token: vscode.CancellationToken
  ): Promise<TtsAudioFile> {
    const apiKey = await this.apiKeyProvider.requireApiKey();
    const result = await this.client.synthesizeSpeech({
      apiKey,
      text,
      config,
      overrides: {
        voiceId: request.voiceId,
        model: request.model
      }
    }, token);

    await vscode.workspace.fs.writeFile(fileUri, result.audio);
    await tryCleanupAudioCache(cacheRoot, config.cacheMaxSizeMb, fileUri);

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
  config: MiniMaxTtsConfig,
  overrides: TtsRequestOverrides
): string {
  const cacheIdentity = {
    text,
    apiHost: config.apiHost,
    model: overrides.model?.trim() || config.model,
    voiceId: overrides.voiceId?.trim() || config.voiceId,
    format: config.format,
    sampleRate: config.sampleRate,
    bitrate: config.bitrate,
    channel: config.channel,
    speed: config.speed,
    vol: config.vol,
    pitch: config.pitch,
    languageBoost: config.languageBoost,
    pronunciationTone: config.pronunciationTone,
    voiceModifyEnabled: config.voiceModifyEnabled,
    voiceModifyPitch: config.voiceModifyPitch,
    voiceModifyIntensity: config.voiceModifyIntensity,
    voiceModifyTimbre: config.voiceModifyTimbre,
    voiceModifySoundEffects: config.voiceModifySoundEffects,
    subtitleEnable: config.subtitleEnable,
    subtitleType: config.subtitleType,
    extraRequestJson: config.extraRequestJson
  };

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(cacheIdentity))
    .digest('hex');
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

interface AudioCacheEntry {
  readonly uri: vscode.Uri;
  readonly size: number;
  readonly mtime: number;
}

async function tryCleanupAudioCache(cacheRoot: vscode.Uri, maxSizeMb: number, keepUri: vscode.Uri): Promise<void> {
  try {
    await cleanupAudioCache(cacheRoot, maxSizeMb, keepUri);
  } catch {
    return;
  }
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

  if (totalBytes <= maxBytes) {
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

export { cleanupAudioCache, createCacheKey, fileExists };
