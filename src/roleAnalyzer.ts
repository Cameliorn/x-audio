import * as vscode from 'vscode';
import { UserVisibleError } from './errors';
import { t } from './i18n';
import { RoleAnalysisClient } from './roleAnalysisClient';

export type RoleVoiceType = 'narrator' | 'male' | 'female' | 'girl' | 'boy' | 'child' | 'elderly';

export const ROLE_VOICE_TYPES: readonly RoleVoiceType[] = ['narrator', 'male', 'female', 'girl', 'boy', 'child', 'elderly'];

export const ROLE_VOICE_LABELS: Readonly<Record<RoleVoiceType, string>> = {
  narrator: '旁白',
  male: '成年男性',
  female: '成年女性',
  girl: '少女',
  boy: '少年',
  child: '幼童',
  elderly: '老人'
};

export const NARRATOR_NAME = '旁白';
export const UNKNOWN_SPEAKER_NAME = '未知角色';

/** MiniMax API voice_setting.emotion 支持的值（speech-2.8 系列不支持 whisper）。 */
export type StoryEmotion = 'neutral' | 'happy' | 'sad' | 'angry' | 'fearful' | 'disgusted' | 'surprised' | 'calm' | 'fluent';

export const STORY_EMOTIONS: readonly StoryEmotion[] = ['neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm', 'fluent'];

export const STORY_EMOTION_LABELS: Readonly<Record<StoryEmotion, string>> = {
  neutral: '中性',
  happy: '高兴',
  sad: '悲伤',
  angry: '愤怒',
  fearful: '害怕',
  disgusted: '厌恶',
  surprised: '惊讶',
  calm: '平静',
  fluent: '生动'
};

/**
 * MiniMax Speech 2.8 支持的语气词标签（sound tags）。
 * 模型会将文本中的 `(tag)` 渲染为实际音效。
 */
export const TONE_TAGS = [
  'laughs', 'chuckle', 'coughs', 'clear-throat', 'groans', 'breath',
  'pant', 'inhale', 'exhale', 'gasps', 'sniffs', 'sighs',
  'snorts', 'burps', 'lip-smacking', 'humming'
] as const;
export type ToneTag = typeof TONE_TAGS[number];

/**
 * 将 soundTags 和 pauseBefore 应用到文本中，生成发送给 TTS API 的最终文本。
 * - soundTags 会以前缀 `(tag)` 形式插入文本开头
 * - pauseBefore 以 `<#秒数#>` 形式插入文本开头
 */
export function applyTextModifiers(
  text: string,
  soundTags?: readonly ToneTag[],
  pauseBefore?: number,
  transition?: string
): string {
  const parts: string[] = [];
  if (pauseBefore !== undefined && pauseBefore > 0 && pauseBefore <= 99.99) {
    parts.push(`<#${pauseBefore.toFixed(2)}#>`);
  }
  if (transition && transition.trim().length > 0) {
    parts.push(transition.trim());
  }
  if (soundTags && soundTags.length > 0) {
    parts.push(soundTags.map(tag => `(${tag})`).join(''));
  }
  parts.push(text);
  return parts.join('');
}

export interface StorySegment {
  readonly speaker: string;
  readonly voice: RoleVoiceType;
  readonly text: string;
  readonly emotion?: StoryEmotion;
  readonly speed?: number;
  readonly pitch?: number;
  readonly vol?: number;
  readonly soundTags?: readonly ToneTag[];
  readonly pauseBefore?: number;
  readonly transition?: string;
}

export interface RoleAnalysisProgress {
  readonly completedChunks: number;
  readonly totalChunks: number;
}

const MAX_CHUNK_CHARACTERS = 6000;
const MAX_ATTEMPTS_PER_CHUNK = 2;

export async function analyzeStoryRoles(
  text: string,
  client: RoleAnalysisClient,
  token: vscode.CancellationToken,
  onProgress?: (progress: RoleAnalysisProgress) => void
): Promise<StorySegment[]> {
  const chunks = splitTextIntoChunks(text, MAX_CHUNK_CHARACTERS);
  if (chunks.length === 0) {
    throw new UserVisibleError(t('roleAnalysis.noText'));
  }

  const knownCharacters: Record<string, RoleVoiceType> = {};
  const segments: StorySegment[] = [];

  for (let index = 0; index < chunks.length; index++) {
    if (token.isCancellationRequested) {
      throw new vscode.CancellationError();
    }

    const chunkSegments = await analyzeChunk(client, chunks[index], knownCharacters, token);
    for (const segment of chunkSegments) {
      if (segment.voice !== 'narrator' && !(segment.speaker in knownCharacters)) {
        knownCharacters[segment.speaker] = segment.voice;
      }
    }
    segments.push(...chunkSegments);
    onProgress?.({ completedChunks: index + 1, totalChunks: chunks.length });
  }

  return mergeConsecutiveSegments(applyConsistentVoices(segments));
}

async function analyzeChunk(
  client: RoleAnalysisClient,
  chunk: string,
  knownCharacters: Readonly<Record<string, RoleVoiceType>>,
  token: vscode.CancellationToken
): Promise<StorySegment[]> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_CHUNK; attempt++) {
    if (token.isCancellationRequested) {
      throw new vscode.CancellationError();
    }

    const prompt = buildAnalysisPrompt(chunk, knownCharacters, attempt > 0);

    try {
      const raw = await client.sendRequest(prompt, token);
      return parseRoleAnalysisResponse(raw);
    } catch (error) {
      if (error instanceof vscode.CancellationError) {
        throw error;
      }

      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new UserVisibleError(t('roleAnalysis.noValidResult'));
}

function buildAnalysisPrompt(
  chunk: string,
  knownCharacters: Readonly<Record<string, RoleVoiceType>>,
  strictJsonOnly: boolean
): string {
  const knownJson = JSON.stringify(knownCharacters);
  const strictReminder = strictJsonOnly ? '\n再次提醒：只输出 JSON 数组，不要输出任何其他内容。' : '';
  const emotions = (STORY_EMOTIONS as readonly string[]).join('、');
  const toneTags = (TONE_TAGS as readonly string[]).join('、');

  return `你是一名资深有声书导演，兼具作家的文学鉴赏力和导演的表演指导能力。请通读下面的小说文本，从整体上把握叙事节奏、场景氛围和人物性格后，将其拆分为连续的朗读片段。

作为导演，你需要理解：
- 叙事节奏：哪里是平缓的叙述，哪里是紧张的冲突，哪里是情绪的高潮或转折。
- 场景氛围：当前场景的环境基调（宁静、压抑、欢快、肃杀等）决定了旁白的语气。
- 人物性格：每个角色有独特的说话方式——沉稳的人语速偏慢，急躁的人语速偏快，温柔的人语调柔和。
- 对白潜台词：角色说出来的话和真正想表达的情绪可能不同，请按潜台词的真实情绪来标注 emotion。
- 段落归属：某段描写虽然是第三人称，但如果它紧密围绕某个角色的视角展开（心理活动、感官感受、细微动作），应分配给该角色而非旁白。只有真正脱离所有角色视角的客观叙述才交给旁白。
- 有声书适配：原文是书面语，不一定适合直接朗读。作为导演，在少数情况下可以为片段添加简短的过渡衔接语。但此项必须极度克制——宁可少加、不加，也不要画蛇添足。绝大多数情况下留空即可。

要求：
1. 只输出 JSON 数组，不要输出任何解释、注释或 Markdown 代码块。
2. 数组元素格式：{"speaker":"角色名","voice":"类型","text":"原文片段","emotion":"情绪","speed":1.0,"pitch":0,"vol":1.0,"soundTags":[],"pauseBefore":0,"transition":""}。
3. voice 只能是这些值之一：narrator（旁白）、male（成年男性）、female（成年女性）、girl（少女）、boy（少年）、child（幼童）、elderly（老人）。
4. emotion 根据上下文的真实情绪判断（注意潜台词），可选值：${emotions}。旁白根据场景氛围选择。如设 "neutral" 则不传递情绪参数，让模型根据文本自动处理。
5. speed 语速倍率（0.5~2.0）。调整语速要非常慎重，绝大多数片段保持默认 1.0 即可。仅当角色性格或情绪明显需要时才微调（如极度愤怒 1.1~1.2，极度悲伤 0.85~0.9）。例外：如果片段内容为拟声词（如"啊啊啊"、"嘿嘿"、"呜呜"、"嗯嗯"等）或呻吟/叫喊声，这些内容正常语速读出来会非常怪异，必须设为 1.3～1.5 倍速，并调高 Pitch 1～2。一般情况不调整。
6. pitch 语调偏移（-12~12）。调整语调要非常慎重，绝大多数片段保持默认 0 即可。仅当角色特质明显需要时才微调（如老人略低沉 -3~-1，幼童略偏高 2~4），一般情况不调整。
7. vol 音量倍率（0.1~10）。调整音量要非常慎重，绝大多数片段保持默认 1.0 即可。仅当场景明显需要时才调整（如大喊 1.5~2，耳语 0.4~0.6），一般情况不调整。
8. soundTags 是语气音效标签数组，用于在朗读前添加语气效果，可选值：${toneTags}。例如角色叹气时说台词用 ["sighs"]，笑时说 ["laughs"]。仅在语境明确需要时添加，旁白一般为空数组 []。
9. pauseBefore 是该片段前的停顿秒数（0~5），用于控制整体节奏。场景切换或情绪转折时适当延长停顿（0.5~1.0），日常对话中说话人自然切换用较短停顿（0.2~0.4），同一角色连续说话时不加停顿。
10. transition 是导演添加的过渡衔接语。⚠️ 此项必须克制。大多数片段不需要，一律留空字符串 ""。只有当原文存在明显的场景跳跃、时间跨越或视角突变，且停顿（pauseBefore）不足以让听众理解转换时，才可添加一句极简的过渡（不超过 15 字），如"镜头一转……"、"数日后……"。错加、滥加过渡语比不添加更破坏听感。不确认是否该加时，一律不加。
11. 拆分时从整体把握：当一个段落围绕某个特定角色展开（动作、神态、心理、对白），整段分配给该角色。只有纯粹的全局场景描写、环境过渡、与任何角色视角无关的客观叙述才分配给旁白（speaker 为 "旁白"，voice 为 "narrator"）。
12. 对白要根据上下文推断说话人；同一角色必须使用相同的名字和 voice，保持人物性格和说话风格的一致性。已知角色表：${knownJson}（为 {} 表示尚未识别任何角色，已知角色必须沿用表中的名字和 voice）。
13. text 原文片段本身不得改写、增补或删减。transition 和 text 是分开的：text 保持原样，导演的衔接语写在 transition 中。所有 text 按原文顺序拼接后应完整覆盖输入文本。
14. 确实无法确定说话人的对白，speaker 使用 "${UNKNOWN_SPEAKER_NAME}"，并根据语境为其推断最合适的各项参数。${strictReminder}

待拆分文本：
"""
${chunk}
"""`;
}

export function parseRoleAnalysisResponse(raw: string): StorySegment[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) {
    throw new UserVisibleError(t('roleAnalysis.invalidJson'));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new UserVisibleError(t('roleAnalysis.parseError'));
  }

  if (!Array.isArray(parsed)) {
    throw new UserVisibleError(t('roleAnalysis.notArray'));
  }

  const segments: StorySegment[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const record = item as Record<string, unknown>;
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    if (text.length === 0) {
      continue;
    }

    const voice = normalizeVoiceType(record.voice);
    const speakerRaw = typeof record.speaker === 'string' ? record.speaker.trim() : '';
    const speaker = voice === 'narrator'
      ? NARRATOR_NAME
      : speakerRaw.length > 0 ? speakerRaw : UNKNOWN_SPEAKER_NAME;
    const emotion = normalizeEmotion(record.emotion);
    const speed = normalizeSpeed(record.speed);
    const pitch = normalizePitch(record.pitch);
    const vol = normalizeVol(record.vol);
    const soundTags = normalizeSoundTags(record.soundTags);
    const pauseBefore = normalizePauseBefore(record.pauseBefore);
    const transition = normalizeTransition(record.transition);
    segments.push({ speaker, voice, text, emotion, speed, pitch, vol, soundTags, pauseBefore, transition });
  }

  if (segments.length === 0) {
    throw new UserVisibleError(t('roleAnalysis.emptyResult'));
  }

  return mergeConsecutiveSegments(segments);
}

function normalizeVoiceType(value: unknown): RoleVoiceType {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if ((ROLE_VOICE_TYPES as readonly string[]).includes(normalized)) {
      return normalized as RoleVoiceType;
    }
  }

  return 'narrator';
}

function normalizeEmotion(value: unknown): StoryEmotion | undefined {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if ((STORY_EMOTIONS as readonly string[]).includes(normalized)) {
      return normalized as StoryEmotion;
    }
  }
  return undefined;
}

function normalizeSpeed(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0.5, Math.min(2.0, value));
  }
  return undefined;
}

function normalizePitch(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(-12, Math.min(12, value));
  }
  return undefined;
}

function normalizeVol(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 10) {
    return value;
  }
  return undefined;
}

function normalizeSoundTags(value: unknown): ToneTag[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const tags = value
    .filter((v): v is string => typeof v === 'string')
    .map(v => v.trim().toLowerCase())
    .filter((v): v is ToneTag => (TONE_TAGS as readonly string[]).includes(v));
  return tags.length > 0 ? tags : undefined;
}

function normalizePauseBefore(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.max(0, Math.min(5, Math.round(value * 100) / 100));
  }
  return undefined;
}

function normalizeTransition(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // 拒绝过长或过短的过渡语
    if (trimmed.length > 0 && trimmed.length <= 30) {
      return trimmed;
    }
  }
  return undefined;
}

function applyConsistentVoices(segments: readonly StorySegment[]): StorySegment[] {
  const voiceBySpeaker = new Map<string, RoleVoiceType>();

  return segments.map(segment => {
    if (segment.voice === 'narrator') {
      return { ...segment, speaker: NARRATOR_NAME };
    }

    const known = voiceBySpeaker.get(segment.speaker);
    if (known) {
      return { ...segment, voice: known };
    }

    voiceBySpeaker.set(segment.speaker, segment.voice);
    return segment;
  });
}

export function mergeConsecutiveSegments(segments: readonly StorySegment[]): StorySegment[] {
  const merged: StorySegment[] = [];

  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && last.speaker === segment.speaker && last.voice === segment.voice && last.emotion === segment.emotion) {
      merged[merged.length - 1] = {
        ...last,
        text: `${last.text}\n${segment.text}`
      };
      continue;
    }

    merged.push(segment);
  }

  return merged;
}

export function splitTextIntoChunks(text: string, maxCharacters: number): string[] {
  const maxChunk = Math.max(1, Math.floor(maxCharacters));
  const paragraphs = text
    .split(/\n+/)
    .map(paragraph => paragraph.trim())
    .filter(paragraph => paragraph.length > 0);

  const chunks: string[] = [];
  let current = '';

  const flush = (): void => {
    const trimmed = current.trim();
    if (trimmed.length > 0) {
      chunks.push(trimmed);
    }
    current = '';
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChunk) {
      flush();
      chunks.push(...splitLongParagraph(paragraph, maxChunk));
      continue;
    }

    const candidate = current.length === 0 ? paragraph : `${current}\n${paragraph}`;
    if (candidate.length > maxChunk) {
      flush();
      current = paragraph;
    } else {
      current = candidate;
    }
  }

  flush();
  return chunks;
}

function splitLongParagraph(paragraph: string, maxCharacters: number): string[] {
  const pieces: string[] = [];
  let rest = paragraph;

  while (rest.length > maxCharacters) {
    const cut = findSplitPoint(rest, maxCharacters);
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest.length > 0) {
    pieces.push(rest);
  }

  return pieces.filter(piece => piece.length > 0);
}

function findSplitPoint(text: string, maxCharacters: number): number {
  const punctuation = ['。', '！', '？', '；', '，', '、', '.', '!', '?', ';', ',', ' '];

  for (let index = Math.min(maxCharacters, text.length - 1); index >= Math.floor(maxCharacters / 2); index--) {
    if (punctuation.includes(text[index])) {
      return index + 1;
    }
  }

  return maxCharacters;
}
