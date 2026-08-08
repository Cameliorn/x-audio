import * as vscode from 'vscode';
import { MissingApiKeyError } from './errors';
import { t } from './i18n';
import { TtsProvider } from './providers/types';

export interface ApiKeyProvider {
  requireApiKey(): Promise<string>;
}

export class SecretManager implements ApiKeyProvider {
  public constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly provider: TtsProvider
  ) { }

  public async getApiKey(): Promise<string | undefined> {
    const value = await this.secrets.get(this.provider.apiKeySecret);
    return value ? this.provider.inspectApiKey(value).normalizedApiKey || undefined : undefined;
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
      title: t('secretManager.setKeyTitle', this.provider.displayName),
      prompt: this.provider.apiKeyHint?.() ?? t('secretManager.setKeyPrompt', this.provider.displayName),
      password: true,
      ignoreFocusOut: true,
      validateInput: value => value.trim().length === 0 ? t('secretManager.keyEmpty') : undefined
    });

    if (!apiKey) {
      return false;
    }

    const info = this.provider.inspectApiKey(apiKey);
    await this.secrets.store(this.provider.apiKeySecret, info.normalizedApiKey);
    const keyType = info.isJwt ? t('secretManager.jwtKey') : t('secretManager.apiKey');
    vscode.window.showInformationMessage(t('secretManager.keySaved', keyType));
    return true;
  }

}
