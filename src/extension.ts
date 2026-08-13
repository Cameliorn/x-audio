import * as vscode from 'vscode';
import { DoubaoSceneService, speakScenePromptFromEditor } from './doubaoScene';
import { handleUserFacingError } from './errors';
import { AudioPlayerPanel } from './externalAudioPlayer';
import { t } from './i18n';
import { MultiRoleTtsService } from './multiRoleTtsService';
import { doubaoProvider } from './providers/doubao';
import { getActiveProvider } from './providers/registry';
import { configureRoleAnalysis } from './roleAnalysisConfigFlow';
import { speakDocumentWithRoles } from './roleSpeechFlow';
import { ScenePromptTool } from './scenePromptTool';
import { SecretManager } from './secretManager';
import { SpeakExecutor, SpeakTextTool } from './speakTextTool';
import { TtsService } from './ttsService';
import { getSelectedText } from './utils';

let audioPlayer: AudioPlayerPanel | undefined;
let ttsService: TtsService | undefined;
let doubaoSceneService: DoubaoSceneService | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const provider = getActiveProvider();
  const secretManager = new SecretManager(context.secrets, provider);
  const client = provider.createClient();
  const service = new TtsService(context.globalStorageUri, secretManager, client);
  ttsService = service;
  const multiRoleTtsService = new MultiRoleTtsService(service);
  // 延迟清理一次历史缓存，避免旧缓存长期堆积
  service.scheduleCacheCleanup();

  audioPlayer = new AudioPlayerPanel(context);
  // 豆包音频场景：与普通朗读渠道完全隔离，独立服务实例
  const doubaoScene = new DoubaoSceneService(context);
  doubaoSceneService = doubaoScene;

  const speak: SpeakExecutor = async (request, token) => {
    const audioFile = await service.synthesizeToFile(request, token);
    await audioPlayer?.play(audioFile);
    return audioFile;
  };

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  statusBarItem.command = 'audioplugin.playbackControls';
  context.subscriptions.push(
    statusBarItem,
    audioPlayer.onDidChangePlaybackState(state => {
      void vscode.commands.executeCommand('setContext', 'audioplugin.playing', state.active);
      if (state.active) {
        statusBarItem.text = state.paused ? t('extension.statusPaused') : t('extension.statusPlaying');
        statusBarItem.tooltip = t('extension.playbackControlsTitle');
        statusBarItem.show();
      } else {
        statusBarItem.hide();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('audioplugin.speakSelection', () => speakSelection(speak, secretManager)),
    vscode.commands.registerCommand('audioplugin.speakDocumentWithRoles', () => speakDocumentWithRoles(context, secretManager, service, multiRoleTtsService, audioPlayer)),
    vscode.commands.registerCommand('audioplugin.speakScenePrompt', () => {
      if (audioPlayer) {
        void speakScenePromptFromEditor(doubaoScene, audioPlayer);
      }
    }),
    vscode.commands.registerCommand('audioplugin.setApiKey', () => promptSetApiKey(secretManager, doubaoScene)),
    vscode.commands.registerCommand('audioplugin.configureRoleAnalysis', () => configureRoleAnalysis(context.secrets)),
    vscode.commands.registerCommand('audioplugin.pause', () => {
      audioPlayer?.pause();
    }),
    vscode.commands.registerCommand('audioplugin.stop', () => {
      audioPlayer?.stop();
    }),
    vscode.commands.registerCommand('audioplugin.playbackControls', () => showPlaybackControls()),
    vscode.lm.registerTool('audioplugin_speak', new SpeakTextTool(speak)),
    vscode.lm.registerTool('audioplugin_scene', new ScenePromptTool(doubaoScene, audioPlayer))
  );

  promptApiKeyOnFirstRun(context, secretManager);
}

const API_KEY_PROMPT_STATE_KEY = 'audioplugin.apiKeyPromptShown';

/** 设置密钥：先选择服务（普通朗读渠道 / 豆包音频场景），再输入对应密钥 */
async function promptSetApiKey(secretManager: SecretManager, doubaoScene: DoubaoSceneService): Promise<void> {
  const provider = getActiveProvider();
  const picked = await vscode.window.showQuickPick(
    [
      { label: provider.displayName, description: t('extension.setKeyNormalReading'), target: 'main' as const },
      { label: doubaoProvider.displayName, description: t('extension.setKeyDoubaoScene'), target: 'doubao' as const }
    ],
    { title: t('extension.setKeySelectTitle'), ignoreFocusOut: true }
  );

  if (picked?.target === 'doubao') {
    await doubaoScene.promptAndStoreApiKey();
  } else if (picked?.target === 'main') {
    await secretManager.promptAndStoreApiKey();
  }
}

/** 首次激活且无密钥时一次性引导设置，之后不再打扰 */
function promptApiKeyOnFirstRun(context: vscode.ExtensionContext, secretManager: SecretManager): void {
  if (context.globalState.get<boolean>(API_KEY_PROMPT_STATE_KEY)) {
    return;
  }

  void (async () => {
    if (await secretManager.getApiKey()) {
      return;
    }

    const action = await vscode.window.showInformationMessage(t('extension.firstRunNoApiKey'), t('extension.setKey'));
    await context.globalState.update(API_KEY_PROMPT_STATE_KEY, true);
    if (action === t('extension.setKey')) {
      await secretManager.promptAndStoreApiKey();
    }
  })();
}

async function showPlaybackControls(): Promise<void> {
  const player = audioPlayer;
  if (!player) {
    return;
  }

  const picked = await vscode.window.showQuickPick(
    [
      { label: t('extension.pauseResumeItem'), action: 'pause' as const },
      { label: t('extension.stopItem'), action: 'stop' as const }
    ],
    { title: t('extension.playbackControlsTitle') }
  );

  if (picked?.action === 'pause') {
    player.pause();
  } else if (picked?.action === 'stop') {
    player.stop();
  }
}

export function deactivate(): void {
  audioPlayer?.dispose();
  audioPlayer = undefined;
  const service = ttsService;
  ttsService = undefined;
  void service?.dispose();
  const sceneService = doubaoSceneService;
  doubaoSceneService = undefined;
  void sceneService?.dispose();
}

async function speakSelection(speak: SpeakExecutor, secretManager: SecretManager): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage(t('extension.noEditor'));
    return;
  }

  const selectedText = getSelectedText(editor);

  if (selectedText.length === 0) {
    vscode.window.showWarningMessage(t('extension.noSelection'));
    return;
  }

  await runSpeakWithProgress({
    title: t('extension.speakProgress'),
    speak,
    secretManager,
    text: selectedText
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

    const cacheText = result.cacheHit ? t('extension.cacheHit') : t('extension.cacheMiss');
    vscode.window.setStatusBarMessage(t('extension.speakComplete', result.characters, cacheText), 3000);
  } catch (error) {
    await handleError(error, options.secretManager);
  }
}

async function handleError(error: unknown, secretManager: SecretManager): Promise<void> {
  await handleUserFacingError(error, async () => { await secretManager.promptAndStoreApiKey(); });
}
