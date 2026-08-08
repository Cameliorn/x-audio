import * as vscode from 'vscode';
import { UserVisibleError } from '../../errors';
import { t } from '../../i18n';
import { isRecord } from '../../utils';

/** 豆包音频生成（Seed-Audio 1.0）输出格式（渠道不支持 flac） */
export type DoubaoAudioFormat = 'mp3' | 'wav';

export interface DoubaoTtsConfig {
  readonly apiHost: string;
  readonly model: string;
  readonly format: DoubaoAudioFormat;
  readonly sampleRate: number;
  /** 语速偏移值，范围 [-50,100]，100 代表 2.0 倍速，-50 代表 0.5 倍速 */
  readonly speechRate: number;
  /** 音量偏移值，同 speechRate 格式 */
  readonly loudnessRate: number;
  /** 音调偏移值，范围 [-12,12] */
  readonly pitchRate: number;
  readonly subtitleEnable: boolean;
  readonly extraRequestJson: Readonly<Record<string, unknown>>;
  readonly requestTimeoutMs: number;
}

export const DEFAULT_DOUBAO_CONFIG: DoubaoTtsConfig = {
  apiHost: 'https://openspeech.bytedance.com',
  model: 'seed-audio-1.0',
  format: 'mp3',
  sampleRate: 24000,
  speechRate: 0,
  loudnessRate: 0,
  pitchRate: 0,
  subtitleEnable: false,
  extraRequestJson: {},
  requestTimeoutMs: 60000
};

export function getDoubaoTtsConfig(): DoubaoTtsConfig {
  const settings = vscode.workspace.getConfiguration('audioplugin.doubao');
  const common = vscode.workspace.getConfiguration('audioplugin');

  return {
    apiHost: readApiHost(settings, DEFAULT_DOUBAO_CONFIG.apiHost),
    model: readString(settings, 'model', DEFAULT_DOUBAO_CONFIG.model),
    format: readAudioFormat(settings.get<string>('format'), DEFAULT_DOUBAO_CONFIG.format),
    sampleRate: readNumber(settings, 'sampleRate', DEFAULT_DOUBAO_CONFIG.sampleRate),
    speechRate: readNumber(settings, 'speechRate', DEFAULT_DOUBAO_CONFIG.speechRate),
    loudnessRate: readNumber(settings, 'loudnessRate', DEFAULT_DOUBAO_CONFIG.loudnessRate),
    pitchRate: readNumber(settings, 'pitchRate', DEFAULT_DOUBAO_CONFIG.pitchRate),
    subtitleEnable: settings.get<boolean>('subtitleEnable', DEFAULT_DOUBAO_CONFIG.subtitleEnable),
    extraRequestJson: readObject(settings.get<unknown>('extraRequestJson')),
    requestTimeoutMs: readPositiveInt(common, 'requestTimeoutMs', DEFAULT_DOUBAO_CONFIG.requestTimeoutMs)
  };
}

export function normalizeApiHost(apiHost: string): string {
  const trimmed = apiHost.trim();
  if (trimmed.length === 0) {
    return DEFAULT_DOUBAO_CONFIG.apiHost;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new UserVisibleError(t('config.invalidApiHost'));
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new UserVisibleError(t('config.apiHostExtraComponents'));
  }

  if (!isSecureApiHost(url)) {
    throw new UserVisibleError(t('config.apiHostNotSecure'));
  }

  return url.toString().replace(/\/+$/, '');
}

function isSecureApiHost(url: URL): boolean {
  if (url.protocol === 'https:') {
    return true;
  }

  return url.protocol === 'http:' && isLoopbackHost(url.hostname);
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function readApiHost(settings: vscode.WorkspaceConfiguration, defaultValue: string): string {
  return normalizeApiHost(readString(settings, 'apiHost', defaultValue));
}

function readString(settings: vscode.WorkspaceConfiguration, key: string, defaultValue: string): string {
  const value = settings.get<string>(key);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : defaultValue;
}

function readNumber(settings: vscode.WorkspaceConfiguration, key: string, defaultValue: number): number {
  const value = settings.get<number>(key);
  return typeof value === 'number' && Number.isFinite(value) ? value : defaultValue;
}

function readPositiveInt(settings: vscode.WorkspaceConfiguration, key: string, defaultValue: number): number {
  const value = readNumber(settings, key, defaultValue);
  return value > 0 ? Math.round(value) : defaultValue;
}

function readAudioFormat(value: string | undefined, defaultValue: DoubaoAudioFormat): DoubaoAudioFormat {
  return value === 'wav' ? 'wav' : value === 'mp3' ? 'mp3' : defaultValue;
}

function readObject(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : {};
}
