import * as vscode from 'vscode';
import { MiniMaxSynthesizeOptions, MiniMaxSynthesisResult } from './minimaxClient';

export type { MiniMaxSynthesizeOptions, MiniMaxSynthesisResult, TtsRequestOverrides } from './minimaxClient';

export interface MiniMaxSynthesizer {
  synthesizeSpeech(
    options: MiniMaxSynthesizeOptions,
    token: vscode.CancellationToken
  ): Promise<MiniMaxSynthesisResult>;
}
