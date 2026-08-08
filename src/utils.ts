import * as vscode from 'vscode';

/** 合并所有非空选区的文本 */
export function getSelectedText(editor: vscode.TextEditor): string {
  return editor.selections
    .filter(selection => !selection.isEmpty)
    .map(selection => editor.document.getText(selection))
    .join('\n')
    .trim();
}

/** 清理 tempRoot 下除 keepDir 外的旧子目录 */
export async function cleanupStaleTempDirs(tempRoot: vscode.Uri, keepDir: vscode.Uri): Promise<void> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(tempRoot);
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.Directory) {
        continue;
      }

      const dir = vscode.Uri.joinPath(tempRoot, name);
      if (dir.toString() === keepDir.toString()) {
        continue;
      }

      try {
        await vscode.workspace.fs.delete(dir, {
          recursive: true,
          useTrash: false
        });
      } catch {
        // 单个旧目录清理失败不阻塞
      }
    }
  } catch {
    // temp root 可能不存在
  }
}

/**
 * 将数值限制在 [min, max] 区间内，若非有限数值则返回 undefined。
 */
export function clampNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(min, Math.min(max, value));
  }
  return undefined;
}

/** 并发请求数上限，防止用户把配置调得过高后压垮 TTS 服务 */
export const MAX_CONCURRENT_REQUESTS = 8;

/** 将并发数限制在 [1, max] 的整数 */
export function clampConcurrency(value: number, max: number = MAX_CONCURRENT_REQUESTS): number {
  return Math.min(max, Math.max(1, Math.floor(value)));
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
