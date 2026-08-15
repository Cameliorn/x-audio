import * as vscode from 'vscode';

export type RoleAnalysisProvider = 'copilot' | 'openai';

export interface RoleAnalysisConfig {
  readonly provider: RoleAnalysisProvider;
  readonly copilotModelId: string;
  readonly openaiEndpoint: string;
  readonly openaiModel: string;
  readonly customPrompt: string;
  readonly requestTimeoutMs: number;
}

/** 通用配置（xaudio.*），与具体 TTS 渠道无关 */
export interface TtsConfig {
  readonly cacheEnabled: boolean;
  readonly cacheMaxSizeMb: number;
  readonly maxTextLength: number;
  readonly requestTimeoutMs: number;
  readonly maxConcurrentRequests: number;
  readonly browserPath: string;
  readonly roleAnalysis: RoleAnalysisConfig;
}

export const DEFAULT_CONFIG: TtsConfig = {
  cacheEnabled: true,
  cacheMaxSizeMb: 512,
  maxTextLength: 10000,
  requestTimeoutMs: 60000,
  maxConcurrentRequests: 3,
  browserPath: '',
  roleAnalysis: {
    provider: 'openai' as RoleAnalysisProvider,
    copilotModelId: '',
    openaiEndpoint: 'https://api.deepseek.com',
    openaiModel: 'deepseek-chat',
    requestTimeoutMs: 60000,
    // 空字符串表示使用内置提示词（见 roleAnalyzerPrompts.ts）
    customPrompt: ''
  }
};

export function getTtsConfig(): TtsConfig {
  const settings = vscode.workspace.getConfiguration('xaudio');

  return {
    cacheEnabled: settings.get<boolean>('cacheEnabled', DEFAULT_CONFIG.cacheEnabled),
    cacheMaxSizeMb: readNonNegativeNumber(settings, 'cacheMaxSizeMb', DEFAULT_CONFIG.cacheMaxSizeMb),
    maxTextLength: readPositiveInt(settings, 'maxTextLength', DEFAULT_CONFIG.maxTextLength),
    requestTimeoutMs: readPositiveInt(settings, 'requestTimeoutMs', DEFAULT_CONFIG.requestTimeoutMs),
    maxConcurrentRequests: readPositiveInt(settings, 'maxConcurrentRequests', DEFAULT_CONFIG.maxConcurrentRequests),
    browserPath: readString(settings, 'browserPath', DEFAULT_CONFIG.browserPath),
    roleAnalysis: getRoleAnalysisConfig(settings)
  };
}

export function getRoleAnalysisConfig(settings: vscode.WorkspaceConfiguration): RoleAnalysisConfig {
  return {
    provider: readRoleAnalysisProvider(
      settings.get<string>('roleAnalysis.provider'),
      DEFAULT_CONFIG.roleAnalysis.provider
    ),
    copilotModelId: readString(
      settings,
      'roleAnalysis.copilotModelId',
      DEFAULT_CONFIG.roleAnalysis.copilotModelId
    ),
    openaiEndpoint: readNonEmptyString(
      settings.get<string>('roleAnalysis.openaiEndpoint'),
      DEFAULT_CONFIG.roleAnalysis.openaiEndpoint
    ),
    openaiModel: readNonEmptyString(
      settings.get<string>('roleAnalysis.openaiModel'),
      DEFAULT_CONFIG.roleAnalysis.openaiModel
    ),
    requestTimeoutMs: readPositiveInt(
      settings,
      'requestTimeoutMs',
      DEFAULT_CONFIG.requestTimeoutMs
    ),
    customPrompt: readNonEmptyString(
      settings.get<string>('roleAnalysis.customPrompt'),
      DEFAULT_CONFIG.roleAnalysis.customPrompt
    )
  };
}

function readRoleAnalysisProvider(value: string | undefined, fallback: RoleAnalysisProvider): RoleAnalysisProvider {
  if (value === 'copilot' || value === 'openai') {
    return value;
  }
  return fallback;
}

function readNonEmptyString(value: string | undefined, fallback: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return fallback;
}

function readString(settings: vscode.WorkspaceConfiguration, key: string, fallback: string): string {
  const value = settings.get<string>(key, fallback).trim();
  return value.length > 0 ? value : fallback;
}

function readNonNegativeNumber(settings: vscode.WorkspaceConfiguration, key: string, fallback: number): number {
  const value = settings.get<number>(key, fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function readPositiveInt(settings: vscode.WorkspaceConfiguration, key: string, fallback: number): number {
  const value = settings.get<number>(key, fallback);
  return Number.isInteger(value) && value >= 1 ? value : fallback;
}
