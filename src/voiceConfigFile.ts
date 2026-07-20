import * as vscode from 'vscode';
import { t } from './i18n';
import { ROLE_VOICE_TYPES, RoleVoiceType } from './roleAnalyzer';

const VOICE_CONFIG_FILE_NAME = '.ttsvoices.json';
const ROLE_VOICES_KEY = '@roleVoices';

export interface VoiceParams {
    readonly speed?: number;
    readonly pitch?: number;
    readonly vol?: number;
}

export interface DirectoryVoiceConfig {
    /** 角色名 → 音色 ID 映射（如 “张三” → “female-yujie”） */
    readonly characterVoices: Record<string, string>;
    /** 角色类型 → 音色 ID 映射（如 “male” → “female-yujie”） */
    readonly roleTypeVoices: Partial<Record<RoleVoiceType, string>>;
    /** 角色名/角色类型 → 语速/声调/音量覆盖（优先级高于 LLM 分析结果） */
    readonly voiceParams: Record<string, VoiceParams>;
}

function emptyConfig(): DirectoryVoiceConfig {
    return { characterVoices: {}, roleTypeVoices: {}, voiceParams: {} };
}

/**
 * 从给定文件所在目录开始向上查找 `.ttsvoices.json`，
 * 返回最近的一个配置文件；未找到则返回 `undefined`。
 */
export async function findDirectoryVoiceConfig(fileUri: vscode.Uri): Promise<DirectoryVoiceConfig | undefined> {
    const directory = vscode.Uri.joinPath(fileUri, '..');

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
    const rootUri = workspaceFolder?.uri ?? vscode.Uri.joinPath(fileUri, '../..');

    let current: vscode.Uri | undefined = directory;
    while (current) {
        const candidate = vscode.Uri.joinPath(current, VOICE_CONFIG_FILE_NAME);
        const parsed = await tryReadVoiceConfig(candidate);
        if (parsed) {
            return parsed;
        }

        if (current.toString() === rootUri.toString()) {
            current = undefined;
        } else {
            const parent = vscode.Uri.joinPath(current, '..');
            current = parent.toString() === current.toString() ? undefined : parent;
        }
    }

    return undefined;
}

async function tryReadVoiceConfig(fileUri: vscode.Uri): Promise<DirectoryVoiceConfig | undefined> {
    let raw: Uint8Array;
    try {
        raw = await vscode.workspace.fs.readFile(fileUri);
    } catch {
        return undefined;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.from(raw).toString('utf8'));
    } catch {
        vscode.window.showWarningMessage(t('voiceConfig.invalidJson', VOICE_CONFIG_FILE_NAME, fileUri.fsPath));
        return undefined;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        vscode.window.showWarningMessage(t('voiceConfig.invalidFormat', VOICE_CONFIG_FILE_NAME, fileUri.fsPath));
        return undefined;
    }

    const record = parsed as Record<string, unknown>;
    const config = emptyConfig();

    for (const [key, value] of Object.entries(record)) {
        if (key === ROLE_VOICES_KEY) {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                for (const [roleKey, roleValue] of Object.entries(value as Record<string, unknown>)) {
                    if (!isRoleVoiceType(roleKey)) {
                        continue;
                    }
                    const parsed = parseConfigValue(roleValue);
                    if (parsed.voiceId) {
                        config.roleTypeVoices[roleKey] = parsed.voiceId;
                    }
                    if (parsed.params) {
                        config.voiceParams[roleKey] = parsed.params;
                    }
                }
            }
            continue;
        }

        const parsed = parseConfigValue(value);
        if (parsed.voiceId) {
            config.characterVoices[key] = parsed.voiceId;
        }
        if (parsed.params) {
            config.voiceParams[key] = parsed.params;
        }
    }

    const hasCharacters = Object.keys(config.characterVoices).length > 0;
    const hasRoleTypes = Object.keys(config.roleTypeVoices).length > 0;
    const hasVoiceParams = Object.keys(config.voiceParams).length > 0;
    return hasCharacters || hasRoleTypes || hasVoiceParams ? config : undefined;
}

interface ParsedConfigValue {
    readonly voiceId?: string;
    readonly params?: VoiceParams;
}

function parseConfigValue(value: unknown): ParsedConfigValue {
    if (typeof value === 'string' && value.trim().length > 0) {
        return { voiceId: value.trim() };
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;
        const voiceId = typeof obj.voiceId === 'string' && obj.voiceId.trim().length > 0 ? obj.voiceId.trim() : undefined;
        const speed = typeof obj.speed === 'number' && Number.isFinite(obj.speed) ? Math.max(0.5, Math.min(2.0, obj.speed)) : undefined;
        const pitch = typeof obj.pitch === 'number' && Number.isFinite(obj.pitch) ? Math.max(-12, Math.min(12, obj.pitch)) : undefined;
        const vol = typeof obj.vol === 'number' && Number.isFinite(obj.vol) && obj.vol > 0 && obj.vol <= 10 ? obj.vol : undefined;
        const hasParams = speed !== undefined || pitch !== undefined || vol !== undefined;
        return {
            voiceId,
            params: hasParams ? { speed, pitch, vol } : undefined
        };
    }

    return {};
}

function isRoleVoiceType(key: string): key is RoleVoiceType {
    return (ROLE_VOICE_TYPES as readonly string[]).includes(key);
}

export function applyVoiceConfig(
    segment: { speaker: string; voice: string; speed?: number; pitch?: number; vol?: number },
    voiceParams?: Readonly<Record<string, VoiceParams>>
): { speed?: number; pitch?: number; vol?: number } {
    let speed = segment.speed;
    let pitch = segment.pitch;
    let vol = segment.vol;

    if (voiceParams) {
        const override = voiceParams[segment.speaker] ?? voiceParams[segment.voice];
        if (override) {
            if (override.speed !== undefined) { speed = override.speed; }
            if (override.pitch !== undefined) { pitch = override.pitch; }
            if (override.vol !== undefined) { vol = override.vol; }
        }
    }

    return { speed, pitch, vol };
}
