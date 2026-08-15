import { normalizeApiKey } from '../../common/apiKey';
import { ApiKeyInfo } from '../types';

/**
 * 规范化并检测火山引擎语音 API Key（控制台「API Key 管理」生成）。
 * 火山语音 API Key 为平台生成的较长随机字符串，无 JWT 结构。
 */
export function inspectDoubaoApiKey(value: string): ApiKeyInfo {
  return {
    normalizedApiKey: normalizeApiKey(value),
    isJwt: false
  };
}
