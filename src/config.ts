import * as vscode from 'vscode';
import { UserVisibleError } from './errors';

export type AudioFormat = 'mp3' | 'wav' | 'flac';

export interface MiniMaxTtsConfig {
  readonly apiHost: string;
  readonly model: string;
  readonly voiceId: string;
  readonly format: AudioFormat;
  readonly sampleRate: number;
  readonly bitrate: number;
  readonly channel: number;
  readonly speed: number;
  readonly vol: number;
  readonly pitch: number;
  readonly languageBoost: string;
  readonly pronunciationTone: readonly string[];
  readonly voiceModifyEnabled: boolean;
  readonly voiceModifyPitch: number;
  readonly voiceModifyIntensity: number;
  readonly voiceModifyTimbre: number;
  readonly voiceModifySoundEffects: string;
  readonly subtitleEnable: boolean;
  readonly subtitleType: 'sentence' | 'word';
  readonly extraRequestJson: Readonly<Record<string, unknown>>;
  readonly cacheEnabled: boolean;
  readonly maxTextLength: number;
  readonly requestTimeoutMs: number;
}

export const DEFAULT_CONFIG: MiniMaxTtsConfig = {
  apiHost: 'https://api.minimax.io',
  model: 'speech-2.8-turbo',
  voiceId: 'English_expressive_narrator',
  format: 'mp3',
  sampleRate: 32000,
  bitrate: 128000,
  channel: 1,
  speed: 1,
  vol: 1,
  pitch: 0,
  languageBoost: 'auto',
  pronunciationTone: [],
  voiceModifyEnabled: false,
  voiceModifyPitch: 0,
  voiceModifyIntensity: 0,
  voiceModifyTimbre: 0,
  voiceModifySoundEffects: '',
  subtitleEnable: false,
  subtitleType: 'sentence',
  extraRequestJson: {},
  cacheEnabled: true,
  maxTextLength: 10000,
  requestTimeoutMs: 60000
};

export function getMiniMaxConfig(): MiniMaxTtsConfig {
  const settings = vscode.workspace.getConfiguration('minimaxTts');

  return {
    apiHost: readApiHost(settings, DEFAULT_CONFIG.apiHost),
    model: readString(settings, 'model', DEFAULT_CONFIG.model),
    voiceId: readString(settings, 'voiceId', DEFAULT_CONFIG.voiceId),
    format: readAudioFormat(settings.get<string>('format'), DEFAULT_CONFIG.format),
    sampleRate: readNumber(settings, 'sampleRate', DEFAULT_CONFIG.sampleRate),
    bitrate: readNumber(settings, 'bitrate', DEFAULT_CONFIG.bitrate),
    channel: readChannel(settings.get<number>('channel'), DEFAULT_CONFIG.channel),
    speed: readNumber(settings, 'speed', DEFAULT_CONFIG.speed),
    vol: readNumber(settings, 'vol', DEFAULT_CONFIG.vol),
    pitch: readNumber(settings, 'pitch', DEFAULT_CONFIG.pitch),
    languageBoost: readString(settings, 'languageBoost', DEFAULT_CONFIG.languageBoost),
    pronunciationTone: readStringArray(settings.get<unknown>('pronunciationTone')),
    voiceModifyEnabled: settings.get<boolean>('voiceModifyEnabled', DEFAULT_CONFIG.voiceModifyEnabled),
    voiceModifyPitch: readNumber(settings, 'voiceModifyPitch', DEFAULT_CONFIG.voiceModifyPitch),
    voiceModifyIntensity: readNumber(settings, 'voiceModifyIntensity', DEFAULT_CONFIG.voiceModifyIntensity),
    voiceModifyTimbre: readNumber(settings, 'voiceModifyTimbre', DEFAULT_CONFIG.voiceModifyTimbre),
    voiceModifySoundEffects: readString(settings, 'voiceModifySoundEffects', DEFAULT_CONFIG.voiceModifySoundEffects),
    subtitleEnable: settings.get<boolean>('subtitleEnable', DEFAULT_CONFIG.subtitleEnable),
    subtitleType: readSubtitleType(settings.get<string>('subtitleType'), DEFAULT_CONFIG.subtitleType),
    extraRequestJson: readObject(settings.get<unknown>('extraRequestJson')),
    cacheEnabled: settings.get<boolean>('cacheEnabled', DEFAULT_CONFIG.cacheEnabled),
    maxTextLength: DEFAULT_CONFIG.maxTextLength,
    requestTimeoutMs: DEFAULT_CONFIG.requestTimeoutMs
  };
}

export function normalizeApiHost(apiHost: string): string {
  const trimmed = apiHost.trim();
  if (trimmed.length === 0) {
    return DEFAULT_CONFIG.apiHost;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new UserVisibleError('MiniMax API 地址必须是有效的 URL。');
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new UserVisibleError('MiniMax API 地址不能包含用户名、密码、查询参数或片段。');
  }

  if (!isSecureApiHost(url)) {
    throw new UserVisibleError('MiniMax API 地址必须使用 HTTPS；本地回环调试地址可使用 HTTP。');
  }

  return url.toString().replace(/\/+$/, '');
}

function readApiHost(settings: vscode.WorkspaceConfiguration, fallback: string): string {
  const inspected = settings.inspect<string>('apiHost');
  const value = typeof inspected?.globalValue === 'string' ? inspected.globalValue : fallback;
  return normalizeApiHost(value);
}

function readString(settings: vscode.WorkspaceConfiguration, key: string, fallback: string): string {
  const value = settings.get<string>(key, fallback).trim();
  return value.length > 0 ? value : fallback;
}

function readNumber(settings: vscode.WorkspaceConfiguration, key: string, fallback: number): number {
  const value = settings.get<number>(key, fallback);
  return Number.isFinite(value) ? value : fallback;
}

function readAudioFormat(value: string | undefined, fallback: AudioFormat): AudioFormat {
  if (value === 'mp3' || value === 'wav' || value === 'flac') {
    return value;
  }

  return fallback;
}

function readChannel(value: number | undefined, fallback: number): number {
  return value === 1 || value === 2 ? value : fallback;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => item.length > 0);
}

function readSubtitleType(value: string | undefined, fallback: 'sentence' | 'word'): 'sentence' | 'word' {
  if (value === 'sentence' || value === 'word') {
    return value;
  }

  return fallback;
}

function readObject(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Readonly<Record<string, unknown>>;
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
