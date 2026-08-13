import * as vscode from 'vscode';
import { getTtsConfig } from './config';
import { UserVisibleError } from './errors';
import { t } from './i18n';
import { StorySegment, applyTextModifiers, splitTextIntoChunks } from './roleAnalyzer';
import { ConfigProvider, TtsAudioFile, TtsService } from './ttsService';
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
    let failed = false;
    let firstError: unknown;

    // 内部令牌：转发外部取消，同时在任一片段失败时快速取消其余在途请求。
    // 并发限制由 TtsService 单层控制，这里全部并行提交。
    const cts = new vscode.CancellationTokenSource();
    const onExternalCancel = token.onCancellationRequested(() => cts.cancel());
    if (token.isCancellationRequested) {
      cts.cancel();
    }

    try {
      await Promise.all(pieces.map(async (piece, index) => {
        try {
          if (cts.token.isCancellationRequested) {
            throw new vscode.CancellationError();
          }
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
        } catch (error) {
          // 只传播第一个错误；其余片段因取消产生的异常直接吞掉
          if (!failed) {
            failed = true;
            firstError = error;
            cts.cancel();
          }
        }
      }));
    } finally {
      onExternalCancel.dispose();
      cts.dispose();
    }

    if (failed) {
      throw firstError;
    }

    return files;
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
