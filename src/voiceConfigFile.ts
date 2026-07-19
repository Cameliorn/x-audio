import * as vscode from 'vscode';
import { t } from './i18n';
import { ROLE_VOICE_TYPES, RoleVoiceType } from './roleAnalyzer';

const VOICE_CONFIG_FILE_NAME = '.ttsvoices.json';
const ROLE_VOICES_KEY = '@roleVoices';

export interface DirectoryVoiceConfig {
    /** 角色名 → 音色 ID 映射（如 “张三” → “female-yujie”） */
    readonly characterVoices: Record<string, string>;
    /** 角色类型 → 音色 ID 映射（如 “male” → “female-yujie”） */
    readonly roleTypeVoices: Partial<Record<RoleVoiceType, string>>;
}

function emptyConfig(): DirectoryVoiceConfig {
    return { characterVoices: {}, roleTypeVoices: {} };
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
        vscode.window.showWarningMessage(t('voiceConfig.invalidJson', VOICE_CONFIG_FILE_NAME));
        return undefined;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        vscode.window.showWarningMessage(t('voiceConfig.invalidFormat', VOICE_CONFIG_FILE_NAME));
        return undefined;
    }

    const record = parsed as Record<string, unknown>;
    const config = emptyConfig();

    for (const [key, value] of Object.entries(record)) {
        if (key === ROLE_VOICES_KEY) {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                for (const [roleKey, roleValue] of Object.entries(value as Record<string, unknown>)) {
                    if (isRoleVoiceType(roleKey) && typeof roleValue === 'string' && roleValue.trim().length > 0) {
                        config.roleTypeVoices[roleKey] = roleValue.trim();
                    }
                }
            }
            continue;
        }

        if (typeof value === 'string' && value.trim().length > 0) {
            config.characterVoices[key] = value.trim();
        }
    }

    const hasCharacters = Object.keys(config.characterVoices).length > 0;
    const hasRoleTypes = Object.keys(config.roleTypeVoices).length > 0;
    return hasCharacters || hasRoleTypes ? config : undefined;
}

function isRoleVoiceType(key: string): key is RoleVoiceType {
    return (ROLE_VOICE_TYPES as readonly string[]).includes(key);
}
