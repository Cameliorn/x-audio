import * as vscode from 'vscode';
import { RoleAnalysisProvider, getRoleAnalysisConfig } from './config';
import { DoubaoSceneService, speakScenePromptFromEditor } from './doubaoScene';
import { handleUserFacingError } from './errors';
import { AudioPlayerPanel } from './externalAudioPlayer';
import { t } from './i18n';
import { MultiRoleTtsService, RoleSpeechSegment } from './multiRoleTtsService';
import { doubaoProvider } from './providers/doubao';
import { getActiveProvider } from './providers/registry';
import { createRoleAnalysisClient } from './roleAnalysisClient';
import { StorySegment, analyzeStoryRoles } from './roleAnalyzer';
import { confirmRoleAssignments } from './roleConfirmation';
import { CHARACTER_VOICE_STATE_KEY, assignVoices } from './roleVoiceMapper';
import { ScenePromptTool } from './scenePromptTool';
import { SecretManager } from './secretManager';
import { SpeakExecutor, SpeakTextTool } from './speakTextTool';
import { TtsService } from './ttsService';
import { getSelectedText } from './utils';
import { findDirectoryVoiceConfig } from './voiceConfigFile';

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
    vscode.commands.registerCommand('audioplugin.speakDocumentWithRoles', () => speakDocumentWithRoles(context, secretManager, service, multiRoleTtsService)),
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

async function speakDocumentWithRoles(
  context: vscode.ExtensionContext,
  secretManager: SecretManager,
  ttsService: TtsService,
  multiRoleTtsService: MultiRoleTtsService
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage(t('extension.noEditorForRoles'));
    return;
  }

  const selectedText = getSelectedText(editor);
  const text = selectedText.length > 0 ? selectedText : editor.document.getText().trim();
  if (text.length === 0) {
    vscode.window.showWarningMessage(t('extension.noText'));
    return;
  }

  let segments: StorySegment[];
  try {
    const roleAnalysisConfig = getRoleAnalysisConfig(vscode.workspace.getConfiguration('audioplugin'));
    const roleAnalysisClient = createRoleAnalysisClient(roleAnalysisConfig, context.secrets);
    const modelDisplay = roleAnalysisConfig.provider === 'copilot'
      ? roleAnalysisConfig.copilotModelId || t('extension.roleAnalysisProviderCopilot')
      : roleAnalysisConfig.openaiModel;
    segments = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: t('extension.roleAnalysisProgress', modelDisplay),
      cancellable: true
    }, async (progress, token) => analyzeStoryRoles(
      text,
      roleAnalysisClient,
      token,
      roleProgress => progress.report({
        message: t('extension.roleAnalysisChunk', roleProgress.completedChunks, roleProgress.totalChunks)
      }),
      roleAnalysisConfig.customPrompt
    ));
  } catch (error) {
    await handleError(error, secretManager);
    return;
  }

  const providerConfig = getActiveProvider().readConfig();
  const wsOverrides = context.workspaceState.get<Record<string, string>>(CHARACTER_VOICE_STATE_KEY, {});
  const dirConfig = await findDirectoryVoiceConfig(editor.document.uri);
  const dirCharOverrides = dirConfig?.characterVoices ?? {};
  const dirRoleOverrides = dirConfig?.roleTypeVoices ?? {};
  const overrides = { ...wsOverrides, ...dirCharOverrides };
  const mergedRoleVoices = { ...providerConfig.roleVoices, ...dirRoleOverrides };
  const assignments = assignVoices(segments, mergedRoleVoices, overrides, providerConfig.voiceId);
  const totalCharacters = segments.reduce((sum, segment) => sum + segment.text.length, 0);

  const confirmed = await confirmRoleAssignments(assignments, totalCharacters, dirCharOverrides, async (speaker, voiceId) => {
    const latest = context.workspaceState.get<Record<string, string>>(CHARACTER_VOICE_STATE_KEY, {});
    await context.workspaceState.update(CHARACTER_VOICE_STATE_KEY, { ...latest, [speaker]: voiceId });
  }, async (voiceId) => {
    const previewRequest = {
      text: '试听片段，测试当前所选音色的朗读效果。',
      voiceId
    };
    const previewToken = new vscode.CancellationTokenSource();
    try {
      const file = await ttsService.synthesizeToFile(previewRequest, previewToken.token);
      await audioPlayer?.play(file);
    } finally {
      previewToken.dispose();
    }
  });
  if (!confirmed) {
    return;
  }

  const voiceBySpeaker = new Map(confirmed.map(assignment => [assignment.speaker, assignment.voiceId]));
  const speechSegments: RoleSpeechSegment[] = segments.map(segment => ({
    ...segment,
    voiceId: voiceBySpeaker.get(segment.speaker) ?? providerConfig.voiceId
  }));

  try {
    const files = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: t('extension.synthesizeProgress'),
      cancellable: true
    }, async (progress, token) => multiRoleTtsService.synthesizeSegments(
      speechSegments,
      token,
      (completed, total, segment) => {
        progress.report({ message: `${completed}/${total} ${segment.speaker}` });
      },
      dirConfig?.voiceParams));

    await audioPlayer?.playQueue(files);
    vscode.window.setStatusBarMessage(t('extension.synthesizeComplete', files.length, totalCharacters), 5000);
  } catch (error) {
    if (error instanceof vscode.CancellationError) {
      return;
    }
    await handleError(error, secretManager);
  }
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

async function configureRoleAnalysis(secrets: vscode.SecretStorage): Promise<void> {
  const settings = vscode.workspace.getConfiguration('audioplugin');
  const currentProvider = settings.get<string>('roleAnalysis.provider', 'openai');

  // Step 1: 选择提供商
  const providerPick = await vscode.window.showQuickPick(
    [
      {
        label: t('extension.roleAnalysisProviderCopilot'),
        description: t('extension.roleAnalysisProviderCopilotDesc'),
        provider: 'copilot' as RoleAnalysisProvider
      },
      {
        label: t('extension.roleAnalysisProviderOpenai'),
        description: t('extension.roleAnalysisProviderOpenaiDesc'),
        provider: 'openai' as RoleAnalysisProvider
      }
    ],
    {
      title: t('extension.roleAnalysisProviderTitle'),
      placeHolder: currentProvider === 'copilot'
        ? t('extension.roleAnalysisProviderCopilot')
        : t('extension.roleAnalysisProviderOpenai'),
      ignoreFocusOut: true
    }
  );
  if (!providerPick) {
    return;
  }

  const provider = providerPick.provider;

  if (provider === 'copilot') {
    await configureCopilotProvider(settings);
  } else {
    await configureOpenaiProvider(settings, secrets);
  }
}

async function configureCopilotProvider(settings: vscode.WorkspaceConfiguration): Promise<void> {
  const allModels = await vscode.lm.selectChatModels({});
  if (allModels.length === 0) {
    vscode.window.showWarningMessage(t('extension.roleAnalysisNoCopilotModels'));
    return;
  }

  const currentId = settings.get<string>('roleAnalysis.copilotModelId', '');

  // 将模型按 vendor 分组，让列表中显示 vendor/family/name
  const items = allModels.map(m => ({
    label: m.name,
    description: `${m.vendor}/${m.family}`,
    detail: `id: ${m.id} · maxInput: ${m.maxInputTokens}`,
    modelId: m.id
  }));

  const selected = await vscode.window.showQuickPick(items, {
    title: t('extension.roleAnalysisCopilotModelTitle'),
    placeHolder: currentId
      ? items.find(i => i.modelId === currentId)?.label ?? currentId
      : t('extension.roleAnalysisCopilotModelPlaceholder'),
    ignoreFocusOut: true,
    matchOnDescription: true,
    matchOnDetail: true
  });
  if (!selected) {
    return;
  }

  await settings.update('roleAnalysis.provider', 'copilot', vscode.ConfigurationTarget.Global);
  await settings.update('roleAnalysis.copilotModelId', selected.modelId, vscode.ConfigurationTarget.Global);

  vscode.window.showInformationMessage(
    t('extension.roleAnalysisCopilotConfigured', selected.label, selected.description)
  );
}

async function configureOpenaiProvider(
  settings: vscode.WorkspaceConfiguration,
  secrets: vscode.SecretStorage
): Promise<void> {
  const currentEndpoint = settings.get<string>('roleAnalysis.openaiEndpoint', 'https://api.deepseek.com');
  const endpoint = await vscode.window.showInputBox({
    title: t('extension.apiEndpointTitle'),
    value: currentEndpoint,
    ignoreFocusOut: true,
    validateInput: value => value.trim().length === 0 ? t('extension.cannotBeEmpty') : undefined
  });
  if (!endpoint) {
    return;
  }

  const currentModel = settings.get<string>('roleAnalysis.openaiModel', 'deepseek-chat');
  const model = await vscode.window.showInputBox({
    title: t('extension.modelNameTitle'),
    value: currentModel,
    ignoreFocusOut: true,
    validateInput: value => value.trim().length === 0 ? t('extension.cannotBeEmpty') : undefined
  });
  if (!model) {
    return;
  }

  const apiKey = await vscode.window.showInputBox({
    title: 'API Key',
    prompt: t('extension.keepExistingKey'),
    password: true,
    ignoreFocusOut: true
  });
  if (apiKey === undefined) {
    return;
  }

  await settings.update('roleAnalysis.provider', 'openai', vscode.ConfigurationTarget.Global);
  await settings.update('roleAnalysis.openaiEndpoint', endpoint.trim(), vscode.ConfigurationTarget.Global);
  await settings.update('roleAnalysis.openaiModel', model.trim(), vscode.ConfigurationTarget.Global);

  if (apiKey.trim().length > 0) {
    await secrets.store('audioplugin.roleAnalysisApiKey', apiKey.trim());
  }

  vscode.window.showInformationMessage(t('extension.roleAnalysisConfigured', model, endpoint.trim()));
}
