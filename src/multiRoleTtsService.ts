import * as vscode from 'vscode';
import { getMiniMaxConfig } from './config';
import { UserVisibleError } from './errors';
import { t } from './i18n';
import { StorySegment, splitTextIntoChunks } from './roleAnalyzer';
import { ConfigProvider, TtsAudioFile, TtsService } from './ttsService';

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
    onProgress?: SegmentProgressCallback
  ): Promise<TtsAudioFile[]> {
    if (segments.length === 0) {
      throw new UserVisibleError(t('multiRoleTts.noSegments'));
    }

    const maxTextLength = this.configProvider().maxTextLength;
    const pieces: RoleSpeechSegment[] = [];
    for (const segment of segments) {
      for (const text of splitTextIntoChunks(segment.text, maxTextLength)) {
        pieces.push({ ...segment, text });
      }
    }

    const files: TtsAudioFile[] = [];
    for (let index = 0; index < pieces.length; index++) {
      if (token.isCancellationRequested) {
        throw new vscode.CancellationError();
      }

      const piece = pieces[index];
      const file = await this.ttsService.synthesizeToFile({
        text: piece.text,
        voiceId: piece.voiceId
      }, token);
      files.push(file);
      onProgress?.(index + 1, pieces.length, piece);
    }

    return files;
  }
}
