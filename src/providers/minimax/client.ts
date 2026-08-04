import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { MiniMaxApiError, UserVisibleError } from '../../errors';
import { t } from '../../i18n';
import { TtsSynthesisResult, TtsSynthesizer } from '../../types';
import { createAbortController, sortedStringify } from '../../utils';
import { MiniMaxTtsConfig, normalizeApiHost } from './config';

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class MiniMaxClient implements TtsSynthesizer {
  public constructor(
        private readonly configProvider: () => MiniMaxTtsConfig,
        private readonly fetchImpl: FetchLike = fetch
  ) { }

  public get outputFormat(): MiniMaxTtsConfig['format'] {
    return this.configProvider().format;
  }

  public configFingerprint(): string {
    return createMiniMaxFingerprint(this.configProvider());
  }

  public async synthesizeSpeech(
    text: string,
    voiceId: string,
    speed: number | undefined,
    pitch: number | undefined,
    vol: number | undefined,
    extraParams: Readonly<Record<string, unknown>> | undefined,
    model: string | undefined,
    apiKey: string,
    token: vscode.CancellationToken
  ): Promise<TtsSynthesisResult> {
    if (token.isCancellationRequested) {
      throw new vscode.CancellationError();
    }

    const config = this.configProvider();
    const emotion = typeof extraParams?.emotion === 'string' ? extraParams.emotion : undefined;
    const payload = buildMiniMaxTtsPayload(text, config, { voiceId, speed, pitch, vol, emotion, model });

    let timedOut = false;
    const { controller, clear } = createAbortController(token, config.requestTimeoutMs, () => { timedOut = true; });

    try {
      const response = await this.fetchImpl(`${normalizeApiHost(config.apiHost)}/v1/t2a_v2`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const bodyText = await response.text();
      const body = parseMiniMaxResponse(bodyText, response.status);

      if (!response.ok) {
        throw toMiniMaxApiError(body, t('minimax.httpError', response.status));
      }

      const statusCode = body.base_resp?.status_code ?? 0;
      if (statusCode !== 0) {
        throw toMiniMaxApiError(body, t('minimax.requestFailed'));
      }

      if (!body.data?.audio) {
        throw toMiniMaxApiError(body, t('minimax.noAudioData'));
      }

      return {
        audio: decodeHexAudio(body.data.audio),
        traceId: body.trace_id,
        extraInfo: body.extra_info
      };
    } catch (error) {
      if (timedOut) {
        throw new UserVisibleError(t('minimax.timeout', config.requestTimeoutMs / 1000));
      }

      if (token.isCancellationRequested) {
        throw new vscode.CancellationError();
      }

      throw error;
    } finally {
      clear();
    }
  }
}

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
  params: {
        voiceId?: string;
        speed?: number;
        pitch?: number;
        vol?: number;
        emotion?: string;
        model?: string;
    } = {}
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ...config.extraRequestJson,
    model: coalesceString(params.model, config.model),
    text,
    stream: false,
    language_boost: config.languageBoost,
    output_format: 'hex',
    voice_setting: {
      voice_id: coalesceString(params.voiceId, config.voiceId),
      speed: coalesceNumber(params.speed, config.speed),
      vol: coalesceNumber(params.vol, config.vol),
      pitch: coalesceNumber(params.pitch, config.pitch),
      ...(params.emotion ? { emotion: params.emotion } : {})
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
    throw new UserVisibleError(t('minimax.emptyAudio'));
  }

  if (normalized.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new UserVisibleError(t('minimax.invalidAudioHex'));
  }

  return Buffer.from(normalized, 'hex');
}

function coalesceString(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function coalesceNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function createMiniMaxFingerprint(config: MiniMaxTtsConfig): string {
  const identity = {
    apiHost: config.apiHost,
    model: config.model,
    voiceId: config.voiceId,
    roleVoices: config.roleVoices,
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
    .update(sortedStringify(identity))
    .digest('hex');
}

function parseMiniMaxResponse(bodyText: string, httpStatus: number): MiniMaxTtsResponse {
  if (bodyText.trim().length === 0) {
    return {
      base_resp: {
        status_code: httpStatus,
        status_msg: t('minimax.emptyResponseBody')
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
    parts.push(t('minimax.traceId', response.trace_id));
  }

  return new MiniMaxApiError(parts.join(' '), response.trace_id, statusCode);
}
