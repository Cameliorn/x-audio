import * as vscode from 'vscode';
import { t } from '../common/i18n';
import { NARRATOR_NAME, ROLE_VOICE_LABELS } from './roleAnalyzerPrompts';
import { RoleAssignment } from './roleVoiceMapper';

interface RoleQuickPickItem extends vscode.QuickPickItem {
  readonly itemKind: 'action' | 'role';
  readonly assignment?: RoleAssignment;
}

export async function confirmRoleAssignments(
  assignments: readonly RoleAssignment[],
  totalCharacters: number,
  dirOverrides: Readonly<Record<string, string>>,
  persistCharacterVoice: (speaker: string, voiceId: string) => Promise<void>,
  previewVoice?: (voiceId: string) => Promise<void>
): Promise<readonly RoleAssignment[] | undefined> {
  let current = [...assignments];

  return new Promise<readonly RoleAssignment[] | undefined>((resolve) => {
    const quickPick = vscode.window.createQuickPick();
    let isProcessing = false;

    function buildItems(): RoleQuickPickItem[] {
      return [
        {
          itemKind: 'action',
          label: t('extension.startSynthesis'),
          description: t('extension.roleSummary', current.length, totalCharacters),
          alwaysShow: true
        },
        ...current.map(assignment => ({
          itemKind: 'role' as const,
          assignment,
          label: assignment.speaker,
          description: t('extension.voiceIdLabel', assignment.voiceId, assignment.speaker in dirOverrides ? t('extension.dirConfigLabel') : ''),
          detail: t('extension.voiceTypeLabel', ROLE_VOICE_LABELS[assignment.voice])
        }))
      ];
    }

    function updateAndShow(): void {
      quickPick.items = buildItems();
      quickPick.show();
    }

    quickPick.title = t('extension.confirmRolesTitle');
    quickPick.placeholder = t('extension.confirmRolesPlaceholder');
    quickPick.ignoreFocusOut = true;
    quickPick.canSelectMany = false;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;

    quickPick.onDidAccept(async () => {
      if (isProcessing) {
        return;
      }

      const selected = quickPick.selectedItems[0] as RoleQuickPickItem | undefined;
      if (!selected) {
        return;
      }

      if (selected.itemKind === 'action') {
        isProcessing = true;
        quickPick.hide();
        quickPick.dispose();
        resolve(current);
        return;
      }

      const target = selected.assignment;
      if (!target) {
        isProcessing = false;
        updateAndShow();
        return;
      }
      isProcessing = true;

      const voiceId = await vscode.window.showInputBox({
        title: t('extension.modifyVoiceTitle', target.speaker),
        prompt: t('extension.modifyVoicePrompt'),
        value: target.voiceId,
        ignoreFocusOut: true,
        validateInput: value => value.trim().length === 0 ? t('extension.voiceIdEmpty') : undefined
      });

      if (!voiceId) {
        isProcessing = false;
        updateAndShow();
        return;
      }

      const trimmed = voiceId.trim();
      current = current.map(assignment =>
        assignment.speaker === target.speaker ? { ...assignment, voiceId: trimmed } : assignment
      );
      if (target.speaker !== NARRATOR_NAME) {
        await persistCharacterVoice(target.speaker, trimmed);
      }

      // 音色试听
      if (previewVoice) {
        const previewChoice = await vscode.window.showQuickPick(
          [
            { label: t('extension.previewVoiceConfirm'), alwaysShow: true },
            { label: t('extension.previewVoiceTest'), alwaysShow: true }
          ],
          { title: t('extension.previewVoiceTitle', trimmed), ignoreFocusOut: true }
        );

        if (previewChoice?.label === t('extension.previewVoiceTest')) {
          await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: t('extension.previewVoiceProgress')
          }, async () => {
            try {
              await previewVoice(trimmed);
            } catch {
              // 预览失败不阻塞流程
            }
          });
        }
      }

      isProcessing = false;
      updateAndShow();
    });

    quickPick.onDidHide(() => {
      if (!isProcessing) {
        quickPick.dispose();
        resolve(undefined);
      }
    });

    updateAndShow();
  });
}
