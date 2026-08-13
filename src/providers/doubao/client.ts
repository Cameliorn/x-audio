import * as vscode from 'vscode';
import { DoubaoApiError } from '../../errors';
import { t } from '../../i18n';
import { TtsSynthesisResult, TtsSynthesizer } from '../../types';
import { clampNumber, createAbortController, sortedStringify } from '../../utils';
import { FetchLike, translateFetchError } from '../shared';
import { DoubaoTtsConfig, normalizeApiHost } from './config';

export type { FetchLike };

/** 请求级参数 → 豆包 audio_config 偏移值的换算（speed 倍速 → speech_rate 偏移） */
const SPEED_TO_RATE = 100;
/** MiniMax 风格 vol（0~10，1 为正常）→ loudness_rate 偏移的换算系数 */
const VOL_TO_RATE = 20;

export class DoubaoClient implements TtsSynthesizer {
  public constructor(
    private readonly configProvider: () => DoubaoTtsConfig,
    private readonly fetchImpl: FetchLike = fetch
  ) { }

  public get outputFormat(): DoubaoTtsConfig['format'] {
    return this.configProvider().format;
  }

  public configFingerprint(): string {
    return createDoubaoFingerprint(this.configProvider());
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
    const payload = buildDoubaoPayload(text, config, { voiceId, speed, pitch, vol, model, extraParams });

    let timedOut = false;
    const { controller, clear } = createAbortController(token, config.requestTimeoutMs, () => { timedOut = true; });

    try {
      const response = await this.fetchImpl(`${normalizeApiHost(config.apiHost)}/api/v3/tts/create`, {
        method: 'POST',
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const logid = response.headers.get('X-Tt-Logid') ?? undefined;
      const bodyText = await response.text();
      const body = parseDoubaoResponse(bodyText, response.status);

      if (!response.ok) {
        throw toDoubaoApiError(body, logid, t('doubao.httpError', response.status), response.status);
      }

      if (body.code !== undefined && body.code !== 0) {
        throw toDoubaoApiError(body, logid, t('doubao.requestFailed'));
      }

      const audioUrl = body.url;
      if (typeof audioUrl !== 'string' || audioUrl.length === 0) {
        throw toDoubaoApiError(body, logid, t('doubao.noAudioUrl'));
      }

      const audio = await this.downloadAudio(audioUrl, controller.signal);
      if (audio.length === 0) {
        throw new DoubaoApiError(t('doubao.emptyAudio'), logid);
      }

      return {
        audio,
        traceId: logid,
        extraInfo: {
          duration: body.duration,
          original_duration: body.original_duration,
          url: audioUrl
        }
      };
    } catch (error) {
      translateFetchError(error, timedOut, token, t('doubao.timeout', config.requestTimeoutMs / 1000));
    } finally {
      clear();
    }
  }

  private async downloadAudio(
    url: string,
    signal: AbortSignal
  ): Promise<Uint8Array> {
    const response = await this.fetchImpl(url, { signal });
    if (!response.ok) {
      throw new DoubaoApiError(t('doubao.audioDownloadFailed', response.status), undefined, undefined, response.status);
    }

    return new Uint8Array(await response.arrayBuffer());
  }
}

interface DoubaoResponse {
  readonly code?: number;
  readonly message?: string;
  readonly duration?: number;
  readonly original_duration?: number;
  readonly url?: string;
  [key: string]: unknown;
}

export function buildDoubaoPayload(
  text: string,
  config: DoubaoTtsConfig,
  params: {
    voiceId?: string;
    speed?: number;
    pitch?: number;
    vol?: number;
    model?: string;
    extraParams?: Readonly<Record<string, unknown>>;
  } = {}
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ...config.extraRequestJson,
    model: coalesceString(params.model, config.model),
    text_prompt: text,
    audio_config: {
      format: config.format,
      sample_rate: config.sampleRate,
      speech_rate: toSpeechRate(params.speed, config.speechRate),
      loudness_rate: toLoudnessRate(params.vol, config.loudnessRate),
      pitch_rate: toPitchRate(params.pitch, config.pitchRate)
    }
  };

  if (config.subtitleEnable) {
    (payload.audio_config as Record<string, unknown>).enable_subtitle = true;
  }

  // voiceId 为空（或不传）时走纯 Prompt 生成模式（不传 references）
  const speaker = params.voiceId?.trim() ?? '';
  if (speaker.length > 0) {
    payload.references = [{ speaker }];
  }

  return payload;
}

export function createDoubaoFingerprint(config: DoubaoTtsConfig): string {
  return sortedStringify({
    apiHost: normalizeApiHost(config.apiHost),
    model: config.model,
    format: config.format,
    sampleRate: config.sampleRate,
    speechRate: config.speechRate,
    loudnessRate: config.loudnessRate,
    pitchRate: config.pitchRate,
    subtitleEnable: config.subtitleEnable,
    extraRequestJson: config.extraRequestJson
  });
}

function toSpeechRate(speed: number | undefined, fallback: number): number {
  if (speed === undefined) {
    return fallback;
  }
  const clamped = clampNumber(speed, 0.5, 2);
  return clamped === undefined ? fallback : Math.round((clamped - 1) * SPEED_TO_RATE);
}

function toLoudnessRate(vol: number | undefined, fallback: number): number {
  if (vol === undefined) {
    return fallback;
  }
  const clamped = clampNumber(vol, 0, 10);
  return clamped === undefined ? fallback : Math.round((clamped - 1) * VOL_TO_RATE);
}

function toPitchRate(pitch: number | undefined, fallback: number): number {
  if (pitch === undefined) {
    return fallback;
  }
  const clamped = clampNumber(pitch, -12, 12);
  return clamped === undefined ? fallback : Math.round(clamped);
}

function coalesceString(value: string | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

export function parseDoubaoResponse(bodyText: string, _status: number): DoubaoResponse {
  if (bodyText.trim().length === 0) {
    throw new DoubaoApiError(t('doubao.emptyResponseBody'));
  }

  try {
    const parsed: unknown = JSON.parse(bodyText);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as DoubaoResponse : {};
  } catch {
    throw new DoubaoApiError(t('doubao.invalidJson'));
  }
}

export function toDoubaoApiError(body: DoubaoResponse, logid: string | undefined, fallback: string, httpStatus?: number): DoubaoApiError {
  const hint = body.code !== undefined ? doubaoErrorHint(body.code) : undefined;
  const message = hint ?? (typeof body.message === 'string' && body.message.length > 0 ? body.message : fallback);
  return new DoubaoApiError(message, logid, body.code, httpStatus);
}

/** 常见错误码 → 用户可操作的提示文案（其余错误保留原始 message） */
function doubaoErrorHint(code: number): string | undefined {
  switch (code) {
    case 45001125:
      // demo text audit failed：文本审核未通过
      return t('doubao.textAuditFailed');
    default:
      return undefined;
  }
}
