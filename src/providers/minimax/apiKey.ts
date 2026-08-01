import { normalizeApiKey } from '../../apiKey';
import { ApiKeyInfo } from '../types';

interface MiniMaxJwtPayload {
    readonly iss?: string;
    readonly TokenType?: number;
    readonly GroupID?: string;
}

/**
 * 规范化 API 密钥并检测是否为 MiniMax JWT 订阅密钥。
 * 返回规范化后的密钥与类型信息，供 SecretManager 显示与存储。
 */
export function inspectMiniMaxApiKey(value: string): ApiKeyInfo {
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
