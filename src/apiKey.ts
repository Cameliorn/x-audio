export interface MiniMaxApiKeyInfo {
  readonly normalizedApiKey: string;
  readonly isJwt: boolean;
  readonly issuer?: string;
  readonly tokenType?: number;
  readonly groupId?: string;
}

interface MiniMaxJwtPayload {
  readonly iss?: string;
  readonly TokenType?: number;
  readonly GroupID?: string;
}

export function normalizeApiKey(value: string): string {
  const trimmed = value.trim().replace(/^["']|["']$/g, '');
  return trimmed.replace(/^Bearer\s+/i, '').trim();
}

export function inspectApiKey(value: string): MiniMaxApiKeyInfo {
  const normalizedApiKey = normalizeApiKey(value);
  const payload = decodeJwtPayload(normalizedApiKey);

  return {
    normalizedApiKey,
    isJwt: Boolean(payload),
    issuer: payload?.iss,
    tokenType: payload?.TokenType,
    groupId: payload?.GroupID
  };
}

function decodeJwtPayload(value: string): MiniMaxJwtPayload | undefined {
  const parts = value.split('.');
  if (parts.length !== 3 || parts.some(part => part.length === 0)) {
    return undefined;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as MiniMaxJwtPayload;
    return payload && typeof payload === 'object' ? payload : undefined;
  } catch {
    return undefined;
  }
}
