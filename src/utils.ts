import * as vscode from 'vscode';

/**
 * 将数值限制在 [min, max] 区间内，若非有限数值则返回 undefined。
 */
export function clampNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(min, Math.min(max, value));
  }
  return undefined;
}

/**
 * 判断 value 是否为非数组的普通对象（Record）。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * JSON.stringify 但保证 key 按字母序排列，包括嵌套对象。
 * 确保相同语义的对象始终产生相同的字符串。
 */
export function sortedStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(sortedStringify).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map(k => `${JSON.stringify(k)}:${sortedStringify((value as Record<string, unknown>)[k])}`);
  return `{${pairs.join(',')}}`;
}

/**
 * 创建 AbortController 并绑定取消令牌和可选超时。
 * 返回 controller 和清理函数。onTimeout 在超时触发 abort 前调用。
 */
export function createAbortController(
  token: vscode.CancellationToken,
  timeoutMs?: number,
  onTimeout?: () => void
): { controller: AbortController; clear: () => void } {
  const controller = new AbortController();
  const disposable = token.onCancellationRequested(() => controller.abort());
  if (token.isCancellationRequested) {
    controller.abort();
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs !== undefined && timeoutMs > 0) {
    timeout = setTimeout(() => {
      onTimeout?.();
      controller.abort();
    }, timeoutMs);
  }

  const clear = (): void => {
    disposable.dispose();
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  };

  return { controller, clear };
}
