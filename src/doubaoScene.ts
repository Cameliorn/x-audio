import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { handleUserFacingError, isRetryableError } from './errors';
import { AudioPlayerPanel } from './externalAudioPlayer';
import { t } from './i18n';
import { doubaoProvider } from './providers/doubao';
import { DoubaoClient } from './providers/doubao/client';
import { getDoubaoTtsConfig } from './providers/doubao/config';
import { SecretManager } from './secretManager';
import { TtsAudioFile } from './ttsService';
import { cleanupStaleTempDirs, getSelectedText, withRetries } from './utils';

/** Seed-Audio 1.0 text_prompt 上限（字符） */
export const DOUBAO_PROMPT_MAX_LENGTH = 2048;

const SCENE_TMP_ROOT = 'audio-scene-tmp';

/** 校验音频场景 Prompt，合法返回 undefined，否则返回用户可见错误信息 */
export function validateScenePrompt(prompt: string): string | undefined {
  if (prompt.trim().length === 0) {
    return t('scene.noText');
  }

  if (prompt.length > DOUBAO_PROMPT_MAX_LENGTH) {
    return t('scene.promptTooLong', DOUBAO_PROMPT_MAX_LENGTH, prompt.length);
  }

  return undefined;
}

/**
 * 豆包音频场景生成服务：与普通朗读（TtsService/当前渠道）完全隔离。
 * 选中文本作为完整 Prompt，单次请求生成一个综合语音场景（对白/音效/音乐）。
 */
export class DoubaoSceneService {
  private readonly client = new DoubaoClient(getDoubaoTtsConfig);
  private readonly secretManager: SecretManager;
  private readonly tempRoot: vscode.Uri;
  private readonly sessionDir: vscode.Uri;
  private cleanupStarted = false;

  public constructor(context: vscode.ExtensionContext) {
    this.secretManager = new SecretManager(context.secrets, doubaoProvider);
    this.tempRoot = vscode.Uri.joinPath(context.globalStorageUri, SCENE_TMP_ROOT);
    this.sessionDir = vscode.Uri.joinPath(
      this.tempRoot,
      `session-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
    );
  }

  /** 单条 Prompt 合成音频场景并返回音频文件（纯 Prompt 生成模式，不指定音色） */
  public async generateScene(prompt: string, token: vscode.CancellationToken): Promise<TtsAudioFile> {
    const apiKey = await this.secretManager.requireApiKey();
    const result = await withRetries(
      () => this.client.synthesizeSpeech(
        prompt,
        '',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        apiKey,
        token
      ),
      isRetryableError,
      token
    );

    const fileUri = await this.saveAudio(result.audio);
    return {
      uri: fileUri,
      format: this.client.outputFormat,
      cacheHit: false,
      characters: prompt.trim().length,
      traceId: result.traceId,
      extraInfo: result.extraInfo
    };
  }

  public async dispose(): Promise<void> {
    try {
      await vscode.workspace.fs.delete(this.sessionDir, {
        recursive: true,
        useTrash: false
      });
    } catch {
      // 会话目录可能不存在，忽略
    }
  }

  public async promptAndStoreApiKey(): Promise<boolean> {
    return this.secretManager.promptAndStoreApiKey();
  }

  private async saveAudio(audio: Uint8Array): Promise<vscode.Uri> {
    await this.ensureTempReady();
    const fileUri = vscode.Uri.joinPath(this.sessionDir, `scene-${Date.now()}.${this.client.outputFormat}`);
    await vscode.workspace.fs.writeFile(fileUri, audio);
    return fileUri;
  }

  private async ensureTempReady(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.sessionDir);
    if (this.cleanupStarted) {
      return;
    }
    this.cleanupStarted = true;
    await cleanupStaleTempDirs(this.tempRoot, this.sessionDir);
  }
}

/** 编辑器右键命令入口：选中文本作为完整 Prompt，生成并播放音频场景 */
export async function speakScenePromptFromEditor(
  sceneService: DoubaoSceneService,
  audioPlayer: AudioPlayerPanel
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage(t('scene.noEditor'));
    return;
  }

  const prompt = getSelectedText(editor);
  const validationError = validateScenePrompt(prompt);
  if (validationError) {
    vscode.window.showWarningMessage(validationError);
    return;
  }

  try {
    const file = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: t('scene.progress'),
      cancellable: true
    }, (_progress, token) => sceneService.generateScene(prompt, token));

    await audioPlayer.play(file);
    vscode.window.setStatusBarMessage(t('scene.complete'), 5000);
  } catch (error) {
    await handleUserFacingError(error, async () => { await sceneService.promptAndStoreApiKey(); });
  }
}
