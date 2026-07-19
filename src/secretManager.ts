import * as vscode from 'vscode';
import { inspectApiKey, normalizeApiKey } from './apiKey';
import { MissingApiKeyError } from './errors';
import { t } from './i18n';

const API_KEY_SECRET = 'minimaxTts.apiKey';

export interface ApiKeyProvider {
  requireApiKey(): Promise<string>;
}

export class SecretManager implements ApiKeyProvider {
  public constructor(private readonly secrets: vscode.SecretStorage) { }

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
      title: t('secretManager.setKeyTitle'),
      prompt: t('secretManager.setKeyPrompt'),
      password: true,
      ignoreFocusOut: true,
      validateInput: value => value.trim().length === 0 ? t('secretManager.keyEmpty') : undefined
    });

    if (!apiKey) {
      return false;
    }

    const info = inspectApiKey(apiKey);
    await this.secrets.store(API_KEY_SECRET, info.normalizedApiKey);
    const keyType = info.isJwt ? t('secretManager.jwtKey') : t('secretManager.apiKey');
    vscode.window.showInformationMessage(t('secretManager.keySaved', keyType));
    return true;
  }

}
