import * as vscode from 'vscode';
import { MiniMaxTtsConfig, normalizeApiHost } from './config';
import { MiniMaxApiError, UserVisibleError } from './errors';

export interface TtsRequestOverrides {
  readonly model?: string;
  readonly voiceId?: string;
}

export interface MiniMaxSynthesizeOptions {
  readonly apiKey: string;
  readonly text: string;
  readonly config: MiniMaxTtsConfig;
  readonly overrides?: TtsRequestOverrides;
}

export interface MiniMaxSynthesisResult {
  readonly audio: Uint8Array;
  readonly traceId?: string;
  readonly extraInfo?: Record<string, unknown>;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface MiniMaxBaseResponse {
  readonly status_code?: number;
  readonly status_msg?: string;
}

interface MiniMaxTtsResponse {
  readonly data?: {
    readonly audio?: string;
    readonly status?: number;
  } | null;
  readonly extra_info?: Record<string, unknown>;
  readonly trace_id?: string;
  readonly base_resp?: MiniMaxBaseResponse;
}

export function buildMiniMaxTtsPayload(
  text: string,
  config: MiniMaxTtsConfig,
  overrides: TtsRequestOverrides = {}
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ...config.extraRequestJson,
    model: readOverride(overrides.model, config.model),
    text,
    stream: false,
    language_boost: config.languageBoost,
    output_format: 'hex',
    voice_setting: {
      voice_id: readOverride(overrides.voiceId, config.voiceId),
      speed: config.speed,
      vol: config.vol,
      pitch: config.pitch
    },
    audio_setting: {
      sample_rate: config.sampleRate,
      bitrate: config.bitrate,
      format: config.format,
      channel: config.channel
    }
  };

  if (config.pronunciationTone.length > 0) {
    payload.pronunciation_dict = {
      tone: config.pronunciationTone
    };
  }

  if (config.voiceModifyEnabled) {
    const voiceModify: Record<string, unknown> = {
      pitch: config.voiceModifyPitch,
      intensity: config.voiceModifyIntensity,
      timbre: config.voiceModifyTimbre
    };

    if (config.voiceModifySoundEffects.trim().length > 0) {
      voiceModify.sound_effects = config.voiceModifySoundEffects.trim();
    }

    payload.voice_modify = voiceModify;
  }

  if (config.subtitleEnable) {
    payload.subtitle_enable = true;
    payload.subtitle_type = config.subtitleType;
  }

  return payload;
}

export function decodeHexAudio(hexAudio: string): Uint8Array {
  const normalized = hexAudio.trim();

  if (normalized.length === 0) {
    throw new UserVisibleError('MiniMax 返回了空音频数据。');
  }

  if (normalized.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new UserVisibleError('MiniMax 返回了无效的十六进制音频数据。');
  }

  return Buffer.from(normalized, 'hex');
}

export class MiniMaxClient {
  public constructor(private readonly fetchImpl: FetchLike = fetch) {}

  public async synthesizeSpeech(
    options: MiniMaxSynthesizeOptions,
    token: vscode.CancellationToken
  ): Promise<MiniMaxSynthesisResult> {
    if (token.isCancellationRequested) {
      throw new UserVisibleError('MiniMax 文字转语音请求已取消。');
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.config.requestTimeoutMs);
    const cancellationSubscription = token.onCancellationRequested(() => controller.abort());

    try {
      const response = await this.fetchImpl(`${normalizeApiHost(options.config.apiHost)}/v1/t2a_v2`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(buildMiniMaxTtsPayload(options.text, options.config, options.overrides)),
        signal: controller.signal
      });

      const bodyText = await response.text();
      const body = parseMiniMaxResponse(bodyText, response.status);

      if (!response.ok) {
        throw toMiniMaxApiError(body, `MiniMax 文字转语音请求失败，HTTP 状态码 ${response.status}。`);
      }

      const statusCode = body.base_resp?.status_code ?? 0;
      if (statusCode !== 0) {
        throw toMiniMaxApiError(body, 'MiniMax 文字转语音请求失败。');
      }

      if (!body.data?.audio) {
        throw toMiniMaxApiError(body, 'MiniMax 文字转语音响应中没有音频数据。');
      }

      return {
        audio: decodeHexAudio(body.data.audio),
        traceId: body.trace_id,
        extraInfo: body.extra_info
      };
    } catch (error) {
      if (timedOut) {
        throw new UserVisibleError(`MiniMax 文字转语音请求在 ${options.config.requestTimeoutMs / 1000} 秒后超时。`);
      }

      if (token.isCancellationRequested) {
        throw new UserVisibleError('MiniMax 文字转语音请求已取消。');
      }

      throw error;
    } finally {
      clearTimeout(timeout);
      cancellationSubscription.dispose();
    }
  }
}

function readOverride(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function parseMiniMaxResponse(bodyText: string, httpStatus: number): MiniMaxTtsResponse {
  if (bodyText.trim().length === 0) {
    return {
      base_resp: {
        status_code: httpStatus,
        status_msg: '响应体为空'
      }
    };
  }

  try {
    return JSON.parse(bodyText) as MiniMaxTtsResponse;
  } catch {
    return {
      base_resp: {
        status_code: httpStatus,
        status_msg: bodyText.slice(0, 300)
      }
    };
  }
}

function toMiniMaxApiError(response: MiniMaxTtsResponse, fallback: string): MiniMaxApiError {
  const statusCode = response.base_resp?.status_code;
  const statusMessage = response.base_resp?.status_msg;
  const parts = [fallback];

  if (statusMessage) {
    parts.push(statusMessage);
  }

  if (response.trace_id) {
    parts.push(`追踪 ID: ${response.trace_id}`);
  }

  return new MiniMaxApiError(parts.join(' '), response.trace_id, statusCode);
}
