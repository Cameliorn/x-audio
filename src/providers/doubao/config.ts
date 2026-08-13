import * as vscode from 'vscode';
import {
  normalizeApiHost as normalizeSharedApiHost,
  readAudioFormat,
  readGlobalApiHost,
  readNumber,
  readObject,
  readPositiveInt,
  readString
} from '../shared';

/** 豆包音频生成（Seed-Audio 1.0）输出格式（渠道不支持 flac） */
export type DoubaoAudioFormat = 'mp3' | 'wav';

const DOUBAO_AUDIO_FORMATS: readonly DoubaoAudioFormat[] = ['mp3', 'wav'];

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
    apiHost: readGlobalApiHost(settings, DEFAULT_DOUBAO_CONFIG.apiHost),
    model: readString(settings, 'model', DEFAULT_DOUBAO_CONFIG.model),
    format: readAudioFormat(settings.get<string>('format'), DOUBAO_AUDIO_FORMATS, DEFAULT_DOUBAO_CONFIG.format),
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
  return normalizeSharedApiHost(apiHost, DEFAULT_DOUBAO_CONFIG.apiHost);
}
