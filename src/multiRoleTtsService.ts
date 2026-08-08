import * as vscode from 'vscode';
import { getTtsConfig } from './config';
import { UserVisibleError } from './errors';
import { t } from './i18n';
import { StorySegment, applyTextModifiers, splitTextIntoChunks } from './roleAnalyzer';
import { ConfigProvider, TtsAudioFile, TtsService } from './ttsService';
import { clampConcurrency } from './utils';
import { VoiceParams, applyVoiceConfig } from './voiceConfigFile';

export interface RoleSpeechSegment extends StorySegment {
  readonly voiceId: string;
}

export type SegmentProgressCallback = (completed: number, total: number, segment: RoleSpeechSegment) => void;

export class MultiRoleTtsService {
  public constructor(
    private readonly ttsService: Pick<TtsService, 'synthesizeToFile'>,
    private readonly configProvider: ConfigProvider = getTtsConfig
  ) { }

  public async synthesizeSegments(
    segments: readonly RoleSpeechSegment[],
    token: vscode.CancellationToken,
    onProgress?: SegmentProgressCallback,
    voiceParams?: Readonly<Record<string, VoiceParams>>
  ): Promise<TtsAudioFile[]> {
    if (segments.length === 0) {
      throw new UserVisibleError(t('multiRoleTts.noSegments'));
    }

    const maxTextLength = this.configProvider().maxTextLength;
    const pieces: RoleSpeechSegment[] = [];
    for (const segment of segments) {
      const chunks = splitTextIntoChunks(segment.text, maxTextLength);
      for (let i = 0; i < chunks.length; i++) {
        pieces.push({
          ...segment,
          text: chunks[i],
          pauseBefore: i === 0 ? segment.pauseBefore : undefined,
          transition: i === 0 ? segment.transition : undefined,
          soundTags: i === 0 ? segment.soundTags : undefined,
        });
      }
    }

    if (pieces.length === 0) {
      throw new UserVisibleError(t('multiRoleTts.noSegments'));
    }

    const files: TtsAudioFile[] = new Array<TtsAudioFile>(pieces.length);
    let completed = 0;

    // 内部令牌：转发外部取消，同时在任一片段失败时快速取消其余在途请求
    const cts = new vscode.CancellationTokenSource();
    const onExternalCancel = token.onCancellationRequested(() => cts.cancel());
    if (token.isCancellationRequested) {
      cts.cancel();
    }

    try {
      const concurrency = clampConcurrency(this.configProvider().maxConcurrentRequests);
      await runConcurrent(pieces.length, concurrency, async (index) => {
        const piece = pieces[index];
        const { speed, pitch, vol, emotion, finalText } = resolveVoiceParams(piece, voiceParams);
        const file = await this.ttsService.synthesizeToFile({
          text: finalText,
          voiceId: piece.voiceId,
          speed,
          pitch,
          vol,
          extraParams: emotion ? { emotion } : undefined
        }, cts.token);
        files[index] = file;
        completed++;
        onProgress?.(completed, pieces.length, piece);
      }, () => cts.cancel());
    } finally {
      onExternalCancel.dispose();
      cts.dispose();
    }

    return files;
  }
}

/**
 * 固定并发数的任务池：最多同时运行 limit 个 worker，结果按传入顺序写入调用方。
 * 任一 worker 失败时触发 onFirstError（用于取消在途请求），其余 worker 的取消
 * 异常会被吞掉，最终只抛出第一个错误，避免未处理的 Promise 拒绝。
 */
async function runConcurrent(
  total: number,
  concurrency: number,
  worker: (index: number) => Promise<void>,
  onFirstError: () => void
): Promise<void> {
  let nextIndex = 0;
  let failed = false;
  let firstError: unknown;

  async function run(): Promise<void> {
    while (!failed && nextIndex < total) {
      const index = nextIndex;
      nextIndex++;
      try {
        await worker(index);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
          onFirstError();
        }
        return;
      }
    }
  }

  const workers: Promise<void>[] = [];
  const workerCount = Math.min(concurrency, total);
  for (let i = 0; i < workerCount; i++) {
    workers.push(run());
  }
  await Promise.all(workers);

  if (failed) {
    throw firstError;
  }
}

interface ResolvedVoiceParams {
  speed: number | undefined;
  pitch: number | undefined;
  vol: number | undefined;
  emotion: string | undefined;
  finalText: string;
}

function resolveVoiceParams(segment: StorySegment, voiceParams?: Readonly<Record<string, VoiceParams>>): ResolvedVoiceParams {
  const emotion = segment.emotion === 'neutral' ? undefined : segment.emotion;
  const finalText = applyTextModifiers(segment.text, segment.soundTags, segment.pauseBefore, segment.transition);
  const { speed, pitch, vol } = applyVoiceConfig(segment, voiceParams);
  return { speed, pitch, vol, emotion, finalText };
}
