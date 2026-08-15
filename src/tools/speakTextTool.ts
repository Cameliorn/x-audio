import * as vscode from 'vscode';
import { t } from '../common/i18n';
import { SpeakRequest, TtsAudioFile } from '../services/ttsService';

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
  public constructor(private readonly speak: SpeakExecutor) { }

  public async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<SpeakTextToolInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    const characterCount = typeof options.input.text === 'string' ? options.input.text.trim().length : 0;
    const voice = options.input.voice_id?.trim();
    const model = options.input.model?.trim();
    const details = [
      t('speakTextTool.characters', characterCount),
      voice ? t('speakTextTool.voiceLabel', voice) : undefined,
      model ? t('speakTextTool.modelLabel', model) : undefined
    ].filter(Boolean).join(', ');

    return {
      invocationMessage: t('speakTextTool.invocationMessage'),
      confirmationMessages: {
        title: t('speakTextTool.confirmationTitle'),
        message: new vscode.MarkdownString(t('speakTextTool.confirmationMessage', details || t('speakTextTool.providedText')))
      }
    };
  }

  public async invoke(
    options: vscode.LanguageModelToolInvocationOptions<SpeakTextToolInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const text = options.input.text;

    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error(t('speakTextTool.emptyText'));
    }

    const result = await this.speak({
      text,
      voiceId: options.input.voice_id,
      model: options.input.model
    }, token);

    const cacheText = result.cacheHit ? t('speakTextTool.cacheHit') : '';
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(t('speakTextTool.result', result.characters, cacheText))
    ]);
  }
}
