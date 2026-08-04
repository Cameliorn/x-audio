import * as vscode from 'vscode';
import { UserVisibleError } from '../../errors';
import { t } from '../../i18n';
import { ROLE_VOICE_TYPES, RoleVoiceType } from '../../roleAnalyzerPrompts';
import { AudioFormat } from '../../types';
import { isRecord } from '../../utils';
import { TtsProviderConfig } from '../types';

export interface MiniMaxTtsConfig extends TtsProviderConfig {
  readonly apiHost: string;
  readonly model: string;
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
  readonly requestTimeoutMs: number;
}

export const DEFAULT_MINI_MAX_ROLE_VOICES: Readonly<Record<RoleVoiceType, string>> = {
  narrator: 'audiobook_female_1',
  male: 'female-yujie',
  female: 'female-tianmei',
  girl: 'female-shaonv',
  boy: 'female-shaonv',
  child: 'female-shaonv',
  elderly: 'audiobook_female_2'
};

export const DEFAULT_MINI_MAX_CONFIG: MiniMaxTtsConfig = {
  apiHost: 'https://api.minimax.io',
  model: 'speech-2.8-turbo',
  voiceId: 'English_expressive_narrator',
  roleVoices: DEFAULT_MINI_MAX_ROLE_VOICES,
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
  requestTimeoutMs: 60000
};

export function getMiniMaxConfig(): MiniMaxTtsConfig {
  const settings = vscode.workspace.getConfiguration('audioplugin.minimax');
  const common = vscode.workspace.getConfiguration('audioplugin');

  return {
    apiHost: readApiHost(settings, DEFAULT_MINI_MAX_CONFIG.apiHost),
    model: readString(settings, 'model', DEFAULT_MINI_MAX_CONFIG.model),
    voiceId: readString(settings, 'voiceId', DEFAULT_MINI_MAX_CONFIG.voiceId),
    roleVoices: readRoleVoices(settings.get<unknown>('roleVoices')),
    format: readAudioFormat(settings.get<string>('format'), DEFAULT_MINI_MAX_CONFIG.format),
    sampleRate: readNumber(settings, 'sampleRate', DEFAULT_MINI_MAX_CONFIG.sampleRate),
    bitrate: readNumber(settings, 'bitrate', DEFAULT_MINI_MAX_CONFIG.bitrate),
    channel: readChannel(settings.get<number>('channel'), DEFAULT_MINI_MAX_CONFIG.channel),
    speed: readNumber(settings, 'speed', DEFAULT_MINI_MAX_CONFIG.speed),
    vol: readNumber(settings, 'vol', DEFAULT_MINI_MAX_CONFIG.vol),
    pitch: readNumber(settings, 'pitch', DEFAULT_MINI_MAX_CONFIG.pitch),
    languageBoost: readString(settings, 'languageBoost', DEFAULT_MINI_MAX_CONFIG.languageBoost),
    pronunciationTone: readStringArray(settings.get<unknown>('pronunciationTone')),
    voiceModifyEnabled: settings.get<boolean>('voiceModifyEnabled', DEFAULT_MINI_MAX_CONFIG.voiceModifyEnabled),
    voiceModifyPitch: readNumber(settings, 'voiceModifyPitch', DEFAULT_MINI_MAX_CONFIG.voiceModifyPitch),
    voiceModifyIntensity: readNumber(settings, 'voiceModifyIntensity', DEFAULT_MINI_MAX_CONFIG.voiceModifyIntensity),
    voiceModifyTimbre: readNumber(settings, 'voiceModifyTimbre', DEFAULT_MINI_MAX_CONFIG.voiceModifyTimbre),
    voiceModifySoundEffects: readString(settings, 'voiceModifySoundEffects', DEFAULT_MINI_MAX_CONFIG.voiceModifySoundEffects),
    subtitleEnable: settings.get<boolean>('subtitleEnable', DEFAULT_MINI_MAX_CONFIG.subtitleEnable),
    subtitleType: readSubtitleType(settings.get<string>('subtitleType'), DEFAULT_MINI_MAX_CONFIG.subtitleType),
    extraRequestJson: readObject(settings.get<unknown>('extraRequestJson')),
    requestTimeoutMs: readPositiveInt(common, 'requestTimeoutMs', DEFAULT_MINI_MAX_CONFIG.requestTimeoutMs)
  };
}

export function normalizeApiHost(apiHost: string): string {
  const trimmed = apiHost.trim();
  if (trimmed.length === 0) {
    return DEFAULT_MINI_MAX_CONFIG.apiHost;
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

function readPositiveInt(settings: vscode.WorkspaceConfiguration, key: string, fallback: number): number {
  const value = readNumber(settings, key, fallback);
  return Number.isInteger(value) && value >= 1 ? value : fallback;
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
  return isRecord(value) ? value : {};
}

function readRoleVoices(value: unknown): Readonly<Record<RoleVoiceType, string>> {
  const source = isRecord(value) ? value as Record<string, unknown> : {};
  const result = {} as Record<RoleVoiceType, string>;

  for (const type of ROLE_VOICE_TYPES) {
    const raw = source[type];
    result[type] = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : DEFAULT_MINI_MAX_ROLE_VOICES[type];
  }

  return result;
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
