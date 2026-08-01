import { NARRATOR_NAME, RoleVoiceType, StorySegment } from './roleAnalyzer';

export const CHARACTER_VOICE_STATE_KEY = 'audioplugin.characterVoices';

export interface RoleAssignment {
  readonly speaker: string;
  readonly voice: RoleVoiceType;
  readonly voiceId: string;
}

export function assignVoices(
  segments: readonly StorySegment[],
  roleVoices: Readonly<Record<RoleVoiceType, string>>,
  overrides: Readonly<Record<string, string>>,
  fallbackVoiceId: string
): RoleAssignment[] {
  const narratorVoiceId = roleVoices.narrator.trim().length > 0 ? roleVoices.narrator : fallbackVoiceId;
  const assignments: RoleAssignment[] = [];
  const seen = new Set<string>();

  for (const segment of segments) {
    if (seen.has(segment.speaker)) {
      continue;
    }
    seen.add(segment.speaker);

    if (segment.speaker === NARRATOR_NAME || segment.voice === 'narrator') {
      assignments.push({
        speaker: NARRATOR_NAME,
        voice: 'narrator',
        voiceId: narratorVoiceId
      });
      continue;
    }

    const override = overrides[segment.speaker]?.trim();
    const typeVoice = roleVoices[segment.voice]?.trim() ?? '';
    assignments.push({
      speaker: segment.speaker,
      voice: segment.voice,
      voiceId: override && override.length > 0
        ? override
        : typeVoice.length > 0 ? typeVoice : narratorVoiceId
    });
  }

  return assignments;
}
