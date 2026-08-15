import * as vscode from 'vscode';
import { getRoleAnalysisConfig } from '../common/config';
import { handleUserFacingError } from '../common/errors';
import { t } from '../common/i18n';
import { getSelectedText } from '../common/utils';
import { AudioPlayerPanel } from '../player/externalAudioPlayer';
import { getActiveProvider } from '../providers/registry';
import { createRoleAnalysisClient } from '../roles/roleAnalysisClient';
import { StorySegment, analyzeStoryRoles } from '../roles/roleAnalyzer';
import { confirmRoleAssignments } from '../roles/roleConfirmation';
import { CHARACTER_VOICE_STATE_KEY, assignVoices } from '../roles/roleVoiceMapper';
import { MultiRoleTtsService, RoleSpeechSegment } from '../services/multiRoleTtsService';
import { SecretManager } from '../services/secretManager';
import { TtsService } from '../services/ttsService';
import { findDirectoryVoiceConfig } from '../services/voiceConfigFile';

/** 分角色朗读流程：角色分析 → 音色确认 → 多段合成 → 播放 */
export async function speakDocumentWithRoles(
  context: vscode.ExtensionContext,
  secretManager: SecretManager,
  ttsService: TtsService,
  multiRoleTtsService: MultiRoleTtsService,
  audioPlayer: AudioPlayerPanel | undefined
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
    const roleAnalysisConfig = getRoleAnalysisConfig(vscode.workspace.getConfiguration('xaudio'));
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
    await handleUserFacingError(error, async () => { await secretManager.promptAndStoreApiKey(); });
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
    await handleUserFacingError(error, async () => { await secretManager.promptAndStoreApiKey(); });
  }
}
