import * as vscode from 'vscode';
import { UserVisibleError } from './errors';
import { t } from './i18n';
import { RoleAnalysisClient } from './roleAnalysisClient';
import { clampNumber } from './utils';

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
  onProgress: ((progress: RoleAnalysisProgress) => void) | undefined,
  customPrompt: string
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

    const chunkSegments = await analyzeChunk(client, chunks[index], knownCharacters, token, customPrompt);
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
  token: vscode.CancellationToken,
  customPrompt: string
): Promise<StorySegment[]> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_CHUNK; attempt++) {
    if (token.isCancellationRequested) {
      throw new vscode.CancellationError();
    }

    const prompt = buildAnalysisPrompt(chunk, knownCharacters, attempt > 0, customPrompt);

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
  strictJsonOnly: boolean,
  customPrompt: string
): string {
  const knownJson = JSON.stringify(knownCharacters);
  const strictReminder = strictJsonOnly ? '\n再次提醒：只输出 JSON 数组，不要输出任何其他内容。' : '';
  const emotions = (STORY_EMOTIONS as readonly string[]).join('、');
  const toneTags = (TONE_TAGS as readonly string[]).join('、');
  const unknownSpeaker = UNKNOWN_SPEAKER_NAME;

  return replacePlaceholders(customPrompt, { chunk, knownJson, strictReminder, emotions, toneTags, unknownSpeaker });
}

interface PromptPlaceholders {
  readonly chunk: string;
  readonly knownJson: string;
  readonly strictReminder: string;
  readonly emotions: string;
  readonly toneTags: string;
  readonly unknownSpeaker: string;
}

function replacePlaceholders(template: string, p: PromptPlaceholders): string {
  // escape any {{…}} in user-supplied text to prevent placeholder injection
  const escapeBraces = (s: string) => s.replace(/\{\{/g, '\\{\\{').replace(/\}\}/g, '\\}\\}');
  return template
    .replace(/\{\{text\}\}/g, escapeBraces(p.chunk))
    .replace(/\{\{knownCharacters\}\}/g, p.knownJson)
    .replace(/\{\{strictReminder\}\}/g, p.strictReminder)
    .replace(/\{\{emotions\}\}/g, p.emotions)
    .replace(/\{\{toneTags\}\}/g, p.toneTags)
    .replace(/\{\{unknownSpeaker\}\}/g, p.unknownSpeaker);
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
    // eslint-disable-next-line no-console
    console.warn(`角色分析返回了未知的 voice 类型 "${value}"，已回退为 narrator。`);
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
  return clampNumber(value, 0.5, 2.0);
}

function normalizePitch(value: unknown): number | undefined {
  return clampNumber(value, -12, 12);
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

export type SceneType = 'intimate' | 'action' | 'ambience' | 'horror' | 'daily' | 'none';

const SCENE_TYPES: readonly SceneType[] = ['intimate', 'action', 'ambience', 'horror', 'daily', 'none'];

const SCENE_TYPE_PROMPT = `分析以下文本的整体场景氛围，从以下分类中选择最匹配的一个（只输出分类名，不要其他任何内容）：
- intimate（亲密/情欲场景：床戏、暧昧、肢体接触、呻吟等）
- action（动作/战斗/冲突/追逐等）
- ambience（环境氛围：雨景、夜景、自然描写、旅途等）
- horror（恐怖/悬疑/紧张/惊悚场景）
- daily（日常对话/生活场景/普通叙事）
- none（以上均不匹配，不需要背景音效）

待分析文本：
"""
{text}
"""`;

export async function analyzeSceneType(
  text: string,
  client: RoleAnalysisClient,
  token: vscode.CancellationToken
): Promise<SceneType> {
  // 截取前 4000 字用于场景分析，足够判断整体氛围
  const truncated = text.slice(0, 4000);
  const prompt = SCENE_TYPE_PROMPT.replace('{text}', truncated);

  const raw = await client.sendRequest(prompt, token);
  const category = raw.trim().toLowerCase();

  if ((SCENE_TYPES as readonly string[]).includes(category)) {
    return category as SceneType;
  }

  return 'none';
}
