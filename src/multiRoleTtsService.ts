import * as vscode from 'vscode';
import { getMiniMaxConfig } from './config';
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
    private readonly configProvider: ConfigProvider = getMiniMaxConfig
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

    const files: TtsAudioFile[] = [];
    for (let index = 0; index < pieces.length; index++) {
      if (token.isCancellationRequested) {
        throw new vscode.CancellationError();
      }

      const piece = pieces[index];
      const { speed, pitch, vol, emotion, finalText } = resolveVoiceParams(piece, voiceParams);
      const file = await this.ttsService.synthesizeToFile({
        text: finalText,
        voiceId: piece.voiceId,
        speed,
        pitch,
        vol,
        extraParams: emotion ? { emotion } : undefined
      }, token);
      files.push(file);
      onProgress?.(index + 1, pieces.length, piece);
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
