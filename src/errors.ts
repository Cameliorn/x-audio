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
    public readonly statusCode?: number,
    /** 触发本错误的 HTTP 状态码（业务错误无此字段），用于判断是否可重试 */
    public readonly httpStatus?: number
  ) {
    super(message);
    this.name = 'MiniMaxApiError';
  }
}

export class DoubaoApiError extends UserVisibleError {
  public constructor(
    message: string,
    public readonly traceId?: string,
    public readonly statusCode?: number,
    /** 触发本错误的 HTTP 状态码（业务错误无此字段），用于判断是否可重试 */
    public readonly httpStatus?: number
  ) {
    super(message);
    this.name = 'DoubaoApiError';
  }
}

/** 网络层可重试错误码（连接重置、DNS 瞬时失败等） */
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE'
]);

/**
 * 判断合成请求失败是否值得自动重试：
 * HTTP 429/5xx 与网络层异常可重试；业务错误与取消不可重试。
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof vscode.CancellationError) {
    return false;
  }

  if (error instanceof MiniMaxApiError || error instanceof DoubaoApiError) {
    return error.httpStatus !== undefined && (error.httpStatus === 429 || error.httpStatus >= 500);
  }

  if (error instanceof UserVisibleError) {
    return false;
  }

  if (error instanceof TypeError) {
    // fetch/undici 的网络层失败（连接中断、DNS 等）表现为 TypeError
    return true;
  }

  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return typeof code === 'string' && RETRYABLE_NETWORK_CODES.has(code);
  }

  return false;
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
