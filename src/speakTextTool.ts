import * as vscode from 'vscode';
import { SpeakRequest, TtsAudioFile } from './ttsService';

export interface SpeakTextToolInput {
  readonly text: string;
  readonly voice_id?: string;
  readonly model?: string;
}

export type SpeakExecutor = (
  request: SpeakRequest,
  token: vscode.CancellationToken
) => Promise<TtsAudioFile>;

export class SpeakTextTool implements vscode.LanguageModelTool<SpeakTextToolInput> {
  public constructor(private readonly speak: SpeakExecutor) {}

  public async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<SpeakTextToolInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    const characterCount = typeof options.input.text === 'string' ? options.input.text.trim().length : 0;
    const voice = options.input.voice_id?.trim();
    const model = options.input.model?.trim();
    const details = [
      `${characterCount} 个字符`,
      voice ? `音色 \`${voice}\`` : undefined,
      model ? `模型 \`${model}\`` : undefined
    ].filter(Boolean).join(', ');

    return {
      invocationMessage: '正在生成 MiniMax 语音',
      confirmationMessages: {
        title: '使用 MiniMax 文字转语音播放文本',
        message: new vscode.MarkdownString(`要为${details || '提供的文本'}生成并播放 MiniMax 语音吗？这会消耗 MiniMax 额度或账户余额。`)
      }
    };
  }

  public async invoke(
    options: vscode.LanguageModelToolInvocationOptions<SpeakTextToolInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const text = options.input.text;

    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('text 参数必须是非空字符串。');
    }

    const result = await this.speak({
      text,
      voiceId: options.input.voice_id,
      model: options.input.model
    }, token);

    const cacheText = result.cacheHit ? ' 已复用缓存音频。' : '';
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(`正在使用 MiniMax 文字转语音播放 ${result.characters} 个字符。${cacheText}`)
    ]);
  }
}
