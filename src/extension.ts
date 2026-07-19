import * as vscode from 'vscode';
import { getMiniMaxConfig, getRoleAnalysisConfig } from './config';
import { MissingApiKeyError, UserVisibleError, getErrorMessage } from './errors';
import { AudioPlayerPanel } from './externalAudioPlayer';
import { t } from './i18n';
import { MiniMaxClient } from './minimaxClient';
import { MultiRoleTtsService, RoleSpeechSegment } from './multiRoleTtsService';
import { RoleAnalysisClient, createRoleAnalysisClient } from './roleAnalysisClient';
import { StorySegment, analyzeSceneType, analyzeStoryRoles } from './roleAnalyzer';
import { confirmRoleAssignments } from './roleConfirmation';
import { CHARACTER_VOICE_STATE_KEY, assignVoices } from './roleVoiceMapper';
import { pickSoundEffectForScene, setSoundEffectsDir } from './sceneSfx';
import { SecretManager } from './secretManager';
import { SpeakExecutor, SpeakTextTool } from './speakTextTool';
import { TtsService } from './ttsService';
import { findDirectoryVoiceConfig } from './voiceConfigFile';

let audioPlayer: AudioPlayerPanel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const secretManager = new SecretManager(context.secrets);
  const miniMaxClient = new MiniMaxClient();
  const ttsService = new TtsService(context, secretManager, miniMaxClient);
  const multiRoleTtsService = new MultiRoleTtsService(ttsService);
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
    vscode.commands.registerCommand('minimaxTts.speakDocumentWithRoles', () => speakDocumentWithRoles(context, secretManager, multiRoleTtsService)),
    vscode.commands.registerCommand('minimaxTts.setApiKey', () => secretManager.promptAndStoreApiKey()),
    vscode.commands.registerCommand('minimaxTts.configureRoleAnalysis', () => configureRoleAnalysis(context.secrets)),
    vscode.commands.registerCommand('minimaxTts.pause', () => {
      audioPlayer?.pause();
    }),
    vscode.commands.registerCommand('minimaxTts.stop', () => {
      audioPlayer?.stop();
    }),
    vscode.commands.registerCommand('minimaxTts.setSoundEffectsDir', () => setSoundEffectsDir()),
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
    vscode.window.showWarningMessage(t('extension.noEditor'));
    return;
  }

  const selectedText = editor.selections
    .filter(selection => !selection.isEmpty)
    .map(selection => editor.document.getText(selection))
    .join('\n')
    .trim();

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

async function speakInput(speak: SpeakExecutor, secretManager: SecretManager): Promise<void> {
  const text = await vscode.window.showInputBox({
    title: t('extension.speakInputTitle'),
    prompt: t('extension.speakInputPrompt'),
    ignoreFocusOut: true,
    validateInput: value => value.trim().length === 0 ? t('extension.textEmpty') : undefined
  });

  if (!text) {
    return;
  }

  await runSpeakWithProgress({
    title: t('extension.speakProgress'),
    speak,
    secretManager,
    text
  });
}

async function speakDocumentWithRoles(
  context: vscode.ExtensionContext,
  secretManager: SecretManager,
  multiRoleTtsService: MultiRoleTtsService
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage(t('extension.noEditorForRoles'));
    return;
  }

  const selectedText = editor.selections
    .filter(selection => !selection.isEmpty)
    .map(selection => editor.document.getText(selection))
    .join('\n')
    .trim();
  const text = selectedText.length > 0 ? selectedText : editor.document.getText().trim();
  if (text.length === 0) {
    vscode.window.showWarningMessage(t('extension.noText'));
    return;
  }

  let segments: StorySegment[];
  let roleAnalysisClientForScene: RoleAnalysisClient | undefined;
  try {
    const roleAnalysisConfig = getRoleAnalysisConfig(vscode.workspace.getConfiguration('minimaxTts'));
    const roleAnalysisClient = createRoleAnalysisClient(roleAnalysisConfig, context.secrets);
    roleAnalysisClientForScene = roleAnalysisClient;
    segments = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: t('extension.roleAnalysisProgress', roleAnalysisConfig.openaiModel),
      cancellable: true
    }, async (progress, token) => analyzeStoryRoles(text, roleAnalysisClient, token, roleProgress =>
      progress.report({ message: t('extension.roleAnalysisChunk', roleProgress.completedChunks, roleProgress.totalChunks) })
    ));
  } catch (error) {
    await handleError(error, secretManager);
    return;
  }

  // 场景分析：用 DeepSeek 判断文本氛围，自动匹配背景音效
  let sceneSfxFile: string | undefined;
  if (roleAnalysisClientForScene) {
    try {
      const sceneType = await analyzeSceneType(text, roleAnalysisClientForScene, new vscode.CancellationTokenSource().token);
      if (sceneType !== 'none') {
        const picked = await pickSoundEffectForScene(sceneType);
        if (picked) {
          sceneSfxFile = picked;
        }
      }
    } catch {
      // 场景分析失败不影响主流程，沿用已有的音效设置
    }
  }

  const config = getMiniMaxConfig();
  const wsOverrides = context.workspaceState.get<Record<string, string>>(CHARACTER_VOICE_STATE_KEY, {});
  const dirConfig = await findDirectoryVoiceConfig(editor.document.uri);
  const dirCharOverrides = dirConfig?.characterVoices ?? {};
  const dirRoleOverrides = dirConfig?.roleTypeVoices ?? {};
  const overrides = { ...wsOverrides, ...dirCharOverrides };
  const mergedRoleVoices = { ...config.roleVoices, ...dirRoleOverrides };
  const assignments = assignVoices(segments, mergedRoleVoices, overrides, config.voiceId);
  const totalCharacters = segments.reduce((sum, segment) => sum + segment.text.length, 0);

  const confirmed = await confirmRoleAssignments(assignments, totalCharacters, dirCharOverrides, async (speaker, voiceId) => {
    const latest = context.workspaceState.get<Record<string, string>>(CHARACTER_VOICE_STATE_KEY, {});
    await context.workspaceState.update(CHARACTER_VOICE_STATE_KEY, { ...latest, [speaker]: voiceId });
  });
  if (!confirmed) {
    return;
  }

  const voiceBySpeaker = new Map(confirmed.map(assignment => [assignment.speaker, assignment.voiceId]));
  const speechSegments: RoleSpeechSegment[] = segments.map(segment => ({
    ...segment,
    voiceId: voiceBySpeaker.get(segment.speaker) ?? config.voiceId
  }));

  try {
    const files = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: t('extension.synthesizeProgress'),
      cancellable: true
    }, async (progress, token) => multiRoleTtsService.synthesizeSegments(speechSegments, token, (completed, total, segment) =>
      progress.report({ message: `${completed}/${total} ${segment.speaker}` })
      , dirConfig?.voiceParams));

    await audioPlayer?.playQueue(files, sceneSfxFile);
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
  if (error instanceof vscode.CancellationError) {
    return;
  }

  if (error instanceof MissingApiKeyError) {
    const action = await vscode.window.showErrorMessage(error.message, t('extension.setKey'));
    if (action === t('extension.setKey')) {
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

async function configureRoleAnalysis(secrets: vscode.SecretStorage): Promise<void> {
  const settings = vscode.workspace.getConfiguration('minimaxTts');

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

  await settings.update('roleAnalysis.openaiEndpoint', endpoint.trim(), vscode.ConfigurationTarget.Global);
  await settings.update('roleAnalysis.openaiModel', model.trim(), vscode.ConfigurationTarget.Global);

  if (apiKey.trim().length > 0) {
    await secrets.store('minimaxTts.roleAnalysisApiKey', apiKey.trim());
  }

  vscode.window.showInformationMessage(t('extension.roleAnalysisConfigured', model, endpoint.trim()));
}
