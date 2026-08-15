import * as vscode from 'vscode';
import { UserVisibleError } from '../common/errors';
import { t } from '../common/i18n';
import { AudioFormat } from '../common/types';
import { isRecord } from '../common/utils';

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * 校验并规范化 API 地址：必须是合法 URL、不含凭据/查询参数，
 * 且仅允许 HTTPS（本地回环调试地址允许 HTTP）。
 */
export function normalizeApiHost(apiHost: string, defaultHost: string): string {
  const trimmed = apiHost.trim();
  if (trimmed.length === 0) {
    return defaultHost;
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

/**
 * 读取 API 地址：只接受全局（用户）设置，忽略工作区设置，
 * 防止恶意工作区把 API 地址重定向到第三方服务器窃取密钥。
 */
export function readGlobalApiHost(settings: vscode.WorkspaceConfiguration, defaultHost: string): string {
  const inspected = settings.inspect<string>('apiHost');
  const value = typeof inspected?.globalValue === 'string' ? inspected.globalValue : defaultHost;
  return normalizeApiHost(value, defaultHost);
}

export function readString(settings: vscode.WorkspaceConfiguration, key: string, fallback: string): string {
  const value = settings.get<string>(key, fallback).trim();
  return value.length > 0 ? value : fallback;
}

export function readNumber(settings: vscode.WorkspaceConfiguration, key: string, fallback: number): number {
  const value = settings.get<number>(key, fallback);
  return Number.isFinite(value) ? value : fallback;
}

export function readPositiveInt(settings: vscode.WorkspaceConfiguration, key: string, fallback: number): number {
  const value = readNumber(settings, key, fallback);
  return Number.isInteger(value) && value >= 1 ? value : fallback;
}

export function readAudioFormat<T extends AudioFormat>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.find(format => format === value) ?? fallback;
}

export function readObject(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : {};
}

/** fetch 调用统一异常转换：超时 → 用户可见错误；取消 → CancellationError；其余原样抛出 */
export function translateFetchError(
  error: unknown,
  timedOut: boolean,
  token: vscode.CancellationToken,
  timeoutMessage: string
): never {
  if (timedOut) {
    throw new UserVisibleError(timeoutMessage);
  }

  if (token.isCancellationRequested) {
    throw new vscode.CancellationError();
  }

  throw error;
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
