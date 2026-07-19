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

export interface StorySegment {
  readonly speaker: string;
  readonly voice: RoleVoiceType;
  readonly text: string;
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

  return `你是一名有声书制作助手。请把下面的小说文本拆分为连续的朗读片段，并为每个片段指定朗读者。

要求：
1. 只输出 JSON 数组，不要输出任何解释、注释或 Markdown 代码块。
2. 数组元素格式：{"speaker":"角色名或\\"旁白\\"","voice":"类型","text":"原文片段"}。
3. voice 只能是这些值之一：narrator（旁白）、male（成年男性）、female（成年女性）、girl（少女）、boy（少年）、child（幼童）、elderly（老人）。
4. 叙述、描写等非对白内容的 speaker 固定为 "旁白"，voice 固定为 "narrator"。
5. 对白要根据上下文推断说话人；同一角色必须使用相同的名字和 voice。已知角色表：${knownJson}（为 {} 表示尚未识别任何角色，已知角色必须沿用表中的名字和 voice）。
6. text 必须忠实于原文，不得改写、增补或删减；所有片段按原文顺序拼接后应完整覆盖输入文本。
7. 确实无法确定说话人的对白，speaker 使用 "${UNKNOWN_SPEAKER_NAME}"，并根据语境为其推断最合适的 voice。${strictReminder}

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
    segments.push({ speaker, voice, text });
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
    if (last && last.speaker === segment.speaker && last.voice === segment.voice) {
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
