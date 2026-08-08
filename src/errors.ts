import * as vscode from 'vscode';
import { t } from './i18n';

export class UserVisibleError extends Error {
  public constructor(
    message: string,
    /** 程序可识别的错误分类（如用于区分解析失败与网络错误） */
    public readonly code?: string
  ) {
    super(message);
    this.name = 'UserVisibleError';
  }
}

export class MissingApiKeyError extends UserVisibleError {
  public constructor() {
    super(t('errors.missingApiKey'));
    this.name = 'MissingApiKeyError';
  }
}

export class MiniMaxApiError extends UserVisibleError {
  public constructor(
    message: string,
    public readonly traceId?: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'MiniMaxApiError';
  }
}

export class DoubaoApiError extends UserVisibleError {
  public constructor(
    message: string,
    public readonly traceId?: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'DoubaoApiError';
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return t('errors.unknown');
}

/**
 * 向用户展示错误；缺少 API 密钥时引导用户设置密钥。
 * onMissingApiKey：用户点击「设置密钥」后的处理（如打开密钥输入）。
 */
export async function handleUserFacingError(
  error: unknown,
  onMissingApiKey: () => Promise<void>
): Promise<void> {
  if (error instanceof vscode.CancellationError) {
    return;
  }

  if (error instanceof MissingApiKeyError) {
    const action = await vscode.window.showErrorMessage(error.message, t('extension.setKey'));
    if (action === t('extension.setKey')) {
      await onMissingApiKey();
    }
    return;
  }

  if (error instanceof UserVisibleError) {
    vscode.window.showErrorMessage(error.message);
    return;
  }

  vscode.window.showErrorMessage(getErrorMessage(error));
}
