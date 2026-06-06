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
      return {
        uri: fileUri,
        format: config.format,
        cacheHit: true,
        characters: text.length
      };
    }

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

export { createCacheKey, fileExists };
