import * as vscode from 'vscode';
import { t } from './i18n';
import { NARRATOR_NAME, ROLE_VOICE_LABELS } from './roleAnalyzer';
import { RoleAssignment } from './roleVoiceMapper';

export async function confirmRoleAssignments(
    assignments: readonly RoleAssignment[],
    totalCharacters: number,
    dirOverrides: Readonly<Record<string, string>>,
    persistCharacterVoice: (speaker: string, voiceId: string) => Promise<void>
): Promise<readonly RoleAssignment[] | undefined> {
    let current = [...assignments];

    for (; ;) {
        const items: vscode.QuickPickItem[] = [
            {
                label: t('extension.startSynthesis'),
                description: t('extension.roleSummary', current.length, totalCharacters),
                alwaysShow: true
            },
            ...current.map(assignment => ({
                label: assignment.speaker,
                description: t('extension.voiceIdLabel', assignment.voiceId, assignment.speaker in dirOverrides ? t('extension.dirConfigLabel') : ''),
                detail: t('extension.voiceTypeLabel', ROLE_VOICE_LABELS[assignment.voice])
            }))
        ];

        const picked = await vscode.window.showQuickPick(items, {
            title: t('extension.confirmRolesTitle'),
            placeHolder: t('extension.confirmRolesPlaceholder'),
            ignoreFocusOut: true
        });
        if (!picked) {
            return undefined;
        }

        const index = items.indexOf(picked);
        if (index <= 0) {
            return current;
        }

        const target = current[index - 1];
        const voiceId = await vscode.window.showInputBox({
            title: t('extension.modifyVoiceTitle', target.speaker),
            prompt: t('extension.modifyVoicePrompt'),
            value: target.voiceId,
            ignoreFocusOut: true,
            validateInput: value => value.trim().length === 0 ? t('extension.voiceIdEmpty') : undefined
        });
        if (!voiceId) {
            continue;
        }

        const trimmed = voiceId.trim();
        current = current.map((assignment, assignmentIndex) =>
            assignmentIndex === index - 1 ? { ...assignment, voiceId: trimmed } : assignment
        );
        if (target.speaker !== NARRATOR_NAME) {
            await persistCharacterVoice(target.speaker, trimmed);
        }
    }
}
