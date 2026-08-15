import * as vscode from 'vscode';
import { t } from '../common/i18n';
import { AudioPlayerPanel } from '../player/externalAudioPlayer';
import { DoubaoSceneService, validateScenePrompt } from '../services/doubaoScene';

export interface ScenePromptToolInput {
  /** 完整的音频场景 Prompt：描述角色对白、语气情绪、音效、背景音乐等，模型将端到端生成综合语音场景 */
  readonly prompt: string;
}

/** 确认消息中展示的 Prompt 预览长度 */
const PROMPT_PREVIEW_LENGTH = 200;

/**
 * 豆包音频场景生成工具：供 Copilot 智能体调用。
 * 输入为单条完整 Prompt，调用豆包音频生成模型（Seed-Audio 1.0）生成综合语音场景并播放。
 */
export class ScenePromptTool implements vscode.LanguageModelTool<ScenePromptToolInput> {
  public constructor(
    private readonly sceneService: DoubaoSceneService,
    private readonly audioPlayer: AudioPlayerPanel
  ) { }

  public async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ScenePromptToolInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    const prompt = typeof options.input.prompt === 'string' ? options.input.prompt.trim() : '';
    const characterCount = prompt.length;
    const preview = prompt.length > PROMPT_PREVIEW_LENGTH ? `${prompt.slice(0, PROMPT_PREVIEW_LENGTH)}…` : prompt;

    return {
      invocationMessage: t('sceneTool.invocationMessage'),
      confirmationMessages: {
        title: t('sceneTool.confirmationTitle'),
        message: new vscode.MarkdownString(
          t('sceneTool.confirmationMessage', t('sceneTool.characters', characterCount), preview || t('sceneTool.providedPrompt'))
        )
      }
    };
  }

  public async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ScenePromptToolInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const prompt = typeof options.input.prompt === 'string' ? options.input.prompt.trim() : '';

    const validationError = validateScenePrompt(prompt);
    if (validationError) {
      throw new Error(validationError);
    }

    const file = await this.sceneService.generateScene(prompt, token);
    await this.audioPlayer.play(file);
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(t('sceneTool.result'))
    ]);
  }
}
