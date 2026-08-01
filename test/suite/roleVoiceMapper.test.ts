import * as assert from 'assert';
import { DEFAULT_MINI_MAX_ROLE_VOICES } from '../../src/providers/minimax/config';
import { StorySegment } from '../../src/roleAnalyzer';
import { assignVoices } from '../../src/roleVoiceMapper';

const FALLBACK_VOICE = 'fallback_voice';

function segmentsOf(...speakers: readonly string[]): StorySegment[] {
  return speakers.map(speaker => ({
    speaker,
    voice: speaker === '旁白' ? 'narrator' : 'female',
    text: `${speaker}的台词。`
  }));
}

suite('roleVoiceMapper.assignVoices', () => {
  test('assigns the narrator voice to narration', () => {
    const assignments = assignVoices(segmentsOf('旁白'), DEFAULT_MINI_MAX_ROLE_VOICES, {}, FALLBACK_VOICE);

    assert.equal(assignments.length, 1);
    assert.equal(assignments[0].voiceId, DEFAULT_MINI_MAX_ROLE_VOICES.narrator);
  });

  test('assigns voices by voice type and keeps one entry per speaker', () => {
    const assignments = assignVoices(
      segmentsOf('旁白', '小红', '小红'),
      DEFAULT_MINI_MAX_ROLE_VOICES,
      {},
      FALLBACK_VOICE
    );

    assert.equal(assignments.length, 2);
    assert.equal(assignments[1].speaker, '小红');
    assert.equal(assignments[1].voiceId, DEFAULT_MINI_MAX_ROLE_VOICES.female);
  });

  test('prefers stored character overrides over voice type defaults', () => {
    const assignments = assignVoices(
      segmentsOf('小红'),
      DEFAULT_MINI_MAX_ROLE_VOICES,
      { 小红: 'my_cloned_voice' },
      FALLBACK_VOICE
    );

    assert.equal(assignments[0].voiceId, 'my_cloned_voice');
  });

  test('falls back to the narrator voice and then the global default voice', () => {
    const assignments = assignVoices(
      segmentsOf('张三'),
      { ...DEFAULT_MINI_MAX_ROLE_VOICES, female: '' },
      {},
      FALLBACK_VOICE
    );
    assert.equal(assignments[0].voiceId, DEFAULT_MINI_MAX_ROLE_VOICES.narrator);

    const noNarrator = assignVoices(
      segmentsOf('张三'),
      { ...DEFAULT_MINI_MAX_ROLE_VOICES, female: '', narrator: '' },
      {},
      FALLBACK_VOICE
    );
    assert.equal(noNarrator[0].voiceId, FALLBACK_VOICE);
  });
});
