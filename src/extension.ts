import * as vscode from 'vscode';
import { AudioPlayerPanel } from './externalAudioPlayer';
import { MiniMaxClient } from './minimaxClient';
import { SecretManager } from './secretManager';
import { SpeakExecutor, SpeakTextTool } from './speakTextTool';
import { TtsService } from './ttsService';
import { MissingApiKeyError, UserVisibleError, getErrorMessage } from './errors';

let audioPlayer: AudioPlayerPanel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const secretManager = new SecretManager(context.secrets);
  const miniMaxClient = new MiniMaxClient();
  const ttsService = new TtsService(context, secretManager, miniMaxClient);
  const audioCacheRoot = vscode.Uri.joinPath(context.globalStorageUri, 'audio-cache');

  audioPlayer = new AudioPlayerPanel(context, audioCacheRoot);

  const speak: SpeakExecutor = async (request, token) => {
    const audioFile = await ttsService.synthesizeToFile(request, token);
    await audioPlayer?.play(audioFile, request.text);
    return audioFile;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('minimaxTts.speakSelection', () => speakSelection(speak, secretManager)),
    vscode.commands.registerCommand('minimaxTts.speakInput', () => speakInput(speak, secretManager)),
    vscode.commands.registerCommand('minimaxTts.setApiKey', () => secretManager.promptAndStoreApiKey()),
    vscode.commands.registerCommand('minimaxTts.pause', () => {
      audioPlayer?.pause();
    }),
    vscode.commands.registerCommand('minimaxTts.stop', () => {
      audioPlayer?.stop();
    }),
    vscode.lm.registerTool('minimax_tts_speak', new SpeakTextTool(speak))
  );
}

export function deactivate(): void {
  audioPlayer?.dispose();
  audioPlayer = undefined;
}

async function speakSelection(speak: SpeakExecutor, secretManager: SecretManager): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('请先打开编辑器并选中要朗读的文本。');
    return;
  }

  const selectedText = editor.selections
    .filter(selection => !selection.isEmpty)
    .map(selection => editor.document.getText(selection))
    .join('\n')
    .trim();

  if (selectedText.length === 0) {
    vscode.window.showWarningMessage('请先选中要朗读的文本。');
    return;
  }

  await runSpeakWithProgress({
    title: '正在生成 MiniMax 语音',
    speak,
    secretManager,
    text: selectedText
  });
}

async function speakInput(speak: SpeakExecutor, secretManager: SecretManager): Promise<void> {
  const text = await vscode.window.showInputBox({
    title: 'MiniMax 文字转语音：朗读输入文本',
    prompt: '输入要转换为语音的文本。',
    ignoreFocusOut: true,
    validateInput: value => value.trim().length === 0 ? '文本不能为空。' : undefined
  });

  if (!text) {
    return;
  }

  await runSpeakWithProgress({
    title: '正在生成 MiniMax 语音',
    speak,
    secretManager,
    text
  });
}

interface SpeakWithProgressOptions {
  readonly title: string;
  readonly speak: SpeakExecutor;
  readonly secretManager: SecretManager;
  readonly text: string;
}

async function runSpeakWithProgress(options: SpeakWithProgressOptions): Promise<void> {
  try {
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: options.title,
      cancellable: true
    }, async (_progress, token) => options.speak({ text: options.text }, token));

    const cacheText = result.cacheHit ? '缓存' : '新生成';
    vscode.window.setStatusBarMessage(`MiniMax 文字转语音：已在外部播放器打开 ${result.characters} 个字符（${cacheText}）`, 3000);
  } catch (error) {
    await handleError(error, options.secretManager);
  }
}

async function handleError(error: unknown, secretManager: SecretManager): Promise<void> {
  if (error instanceof MissingApiKeyError) {
    const action = await vscode.window.showErrorMessage(error.message, '设置密钥');
    if (action === '设置密钥') {
      await secretManager.promptAndStoreApiKey();
    }
    return;
  }

  if (error instanceof UserVisibleError) {
    vscode.window.showErrorMessage(error.message);
    return;
  }

  vscode.window.showErrorMessage(getErrorMessage(error));
}
