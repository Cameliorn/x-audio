import { t } from './i18n';

export class UserVisibleError extends Error {
  public constructor(message: string) {
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

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return t('errors.unknown');
}
