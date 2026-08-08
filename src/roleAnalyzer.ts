import * as vscode from 'vscode';
import { UserVisibleError, getErrorMessage } from './errors';
import { t } from './i18n';
import { RoleAnalysisClient } from './roleAnalysisClient';
import {
  NARRATOR_NAME,
  ROLE_VOICE_TYPES,
  RoleVoiceType,
  STORY_EMOTIONS,
  StoryEmotion,
  TONE_TAGS,
  ToneTag,
  UNKNOWN_SPEAKER_NAME,
  buildRoleAnalysisMessages
} from './roleAnalyzerPrompts';
import { clampNumber } from './utils';

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
  let retryFeedback: string | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_CHUNK; attempt++) {
    if (token.isCancellationRequested) {
      throw new vscode.CancellationError();
    }

    const messages = buildRoleAnalysisMessages(customPrompt, {
      chunk,
      knownCharacters,
      strictJsonOnly: attempt > 0,
      retryFeedback
    });

    try {
      const raw = await client.sendRequest(messages, token);
      return parseRoleAnalysisResponse(raw);
    } catch (error) {
      if (error instanceof vscode.CancellationError) {
        throw error;
      }

      // 仅解析类失败注入反馈，让模型自行修正；网络类错误重试即可
      if (isRoleAnalysisParseError(error)) {
        retryFeedback = t('roleAnalysis.retryFeedback', getErrorMessage(error));
      }
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new UserVisibleError(t('roleAnalysis.noValidResult'));
}

const PARSE_ERROR_CODE = 'role-analysis-parse';

function isRoleAnalysisParseError(error: unknown): boolean {
  return error instanceof UserVisibleError && error.code === PARSE_ERROR_CODE;
}

function raiseParseError(message: string): never {
  throw new UserVisibleError(message, PARSE_ERROR_CODE);
}

export function parseRoleAnalysisResponse(raw: string): StorySegment[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) {
    raiseParseError(t('roleAnalysis.invalidJson'));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    raiseParseError(t('roleAnalysis.parseError'));
  }

  if (!Array.isArray(parsed)) {
    raiseParseError(t('roleAnalysis.notArray'));
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
    segments.push({
      speaker,
      voice,
      text,
      ...(emotion !== undefined ? { emotion } : {}),
      ...(speed !== undefined ? { speed } : {}),
      ...(pitch !== undefined ? { pitch } : {}),
      ...(vol !== undefined ? { vol } : {}),
      ...(soundTags !== undefined ? { soundTags } : {}),
      ...(pauseBefore !== undefined ? { pauseBefore } : {}),
      ...(transition !== undefined ? { transition } : {})
    });
  }

  if (segments.length === 0) {
    raiseParseError(t('roleAnalysis.emptyResult'));
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
    // 上限 30 字符，比提示词要求的 15 字宽松，给模型轻微超长留容错
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
