import * as vscode from 'vscode';
import { inspectApiKey, normalizeApiKey } from './apiKey';
import { MissingApiKeyError } from './errors';

const API_KEY_SECRET = 'minimaxTts.apiKey';

export interface ApiKeyProvider {
  requireApiKey(): Promise<string>;
}

export class SecretManager implements ApiKeyProvider {
  public constructor(private readonly secrets: vscode.SecretStorage) {}

  public async getApiKey(): Promise<string | undefined> {
    const value = await this.secrets.get(API_KEY_SECRET);
    return value ? normalizeApiKey(value) || undefined : undefined;
  }

  public async requireApiKey(): Promise<string> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new MissingApiKeyError();
    }

    return apiKey;
  }

  public async promptAndStoreApiKey(): Promise<boolean> {
    const apiKey = await vscode.window.showInputBox({
      title: '设置 MiniMax 密钥',
      prompt: '粘贴用于 MiniMax 语音合成的密钥。语音订阅（Audio Subscription）请使用“账户 > API 密钥”（Account > API Keys）中的 API Platform key；Token Plan/Credits 请使用“计费 > Token Plan”（Billing > Token Plan）中的 Subscription Key。',
      password: true,
      ignoreFocusOut: true,
      validateInput: value => value.trim().length === 0 ? 'MiniMax 密钥不能为空。' : undefined
    });

    if (!apiKey) {
      return false;
    }

    const info = inspectApiKey(apiKey);
    await this.secrets.store(API_KEY_SECRET, info.normalizedApiKey);
    const keyType = info.isJwt ? '订阅密钥' : '密钥';
    vscode.window.showInformationMessage(`MiniMax ${keyType}已保存。`);
    return true;
  }

}
