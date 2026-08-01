import * as vscode from 'vscode';
import { minimaxProvider } from './minimax';
import { TtsProvider } from './types';

const PROVIDERS: ReadonlyArray<TtsProvider> = [
  minimaxProvider
];

const PROVIDER_BY_ID = new Map(PROVIDERS.map(provider => [provider.id, provider]));

export function getProvider(id: string): TtsProvider | undefined {
  return PROVIDER_BY_ID.get(id);
}

/** 返回配置指定的当前渠道；未配置或未知时回退到默认渠道（minimax） */
export function getActiveProvider(): TtsProvider {
  const configured = vscode.workspace.getConfiguration('audioplugin').get<string>('provider');
  return getProvider(configured ?? '') ?? minimaxProvider;
}
