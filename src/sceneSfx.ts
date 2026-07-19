import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getMiniMaxConfig } from './config';
import { t } from './i18n';

const SFX_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.ogg', '.m4a']);

export async function pickSoundEffectForScene(sceneType: string): Promise<string | undefined> {
    const config = getMiniMaxConfig();
    const sfxDir = config.soundEffectsDir;
    if (!sfxDir) {
        return undefined;
    }

    const categoryDir = path.join(sfxDir, sceneType);
    try {
        const entries = await fs.promises.readdir(categoryDir);
        const audioFiles = entries.filter(f => SFX_EXTENSIONS.has(path.extname(f).toLowerCase()));
        if (audioFiles.length === 0) {
            return undefined;
        }
        const picked = audioFiles[Math.floor(Math.random() * audioFiles.length)];
        return path.join(categoryDir, picked);
    } catch {
        return undefined;
    }
}

export async function setSoundEffectsDir(): Promise<void> {
    const folders = await vscode.window.showOpenDialog({
        title: t('extension.setSoundEffectsDirTitle'),
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false
    });

    if (!folders || folders.length === 0) {
        return;
    }

    const dirPath = folders[0].fsPath;
    await vscode.workspace.getConfiguration('minimaxTts').update('soundEffectsDir', dirPath, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(t('extension.soundEffectsDirSet', dirPath));
}
