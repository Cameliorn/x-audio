/** 通用的 API 密钥规范化：去除首尾空白、引号与 Bearer 前缀 */
export function normalizeApiKey(value: string): string {
  const trimmed = value.trim().replace(/^["']|["']$/g, '');
  return trimmed.replace(/^Bearer\s+/i, '').trim();
}
