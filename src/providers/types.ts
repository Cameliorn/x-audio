import { RoleVoiceType } from '../roleAnalyzerPrompts';
import { TtsSynthesizer } from '../types';

/** 渠道共用的配置字段（分角色朗读、缓存等通用逻辑依赖） */
export interface TtsProviderConfig {
    readonly voiceId: string;
    readonly roleVoices: Readonly<Record<RoleVoiceType, string>>;
}

/** API 密钥检测结果 */
export interface ApiKeyInfo {
    readonly normalizedApiKey: string;
    readonly isJwt: boolean;
    readonly issuer?: string;
    readonly tokenType?: number;
    readonly groupId?: string;
}

/**
 * TTS 渠道（提供者）抽象。新增渠道时实现此接口并注册到 registry。
 */
export interface TtsProvider {
    readonly id: string;
    readonly displayName: string;
    /** 该渠道 API 密钥在 SecretStorage 中的键名 */
    readonly apiKeySecret: string;
    /** 读取渠道专属配置（每次调用重新读取最新值） */
    readConfig(): TtsProviderConfig;
    /** 创建该渠道的合成客户端 */
    createClient(): TtsSynthesizer;
    /** 规范化并检测 API 密钥（渠道专属逻辑） */
    inspectApiKey(key: string): ApiKeyInfo;
}
