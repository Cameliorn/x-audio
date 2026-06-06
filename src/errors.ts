export class UserVisibleError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'UserVisibleError';
  }
}

export class MissingApiKeyError extends UserVisibleError {
  public constructor() {
    super('尚未设置 MiniMax 密钥。请先运行“MiniMax 文字转语音：设置密钥”。');
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

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return '发生未知的 MiniMax 文字转语音错误。';
}
