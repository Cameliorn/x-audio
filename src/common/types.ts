import * as vscode from 'vscode';

export type AudioFormat = 'mp3' | 'wav' | 'flac';

/**
 * TTS 合成器抽象接口。各渠道（MiniMax、豆包等）各自实现。
 * TtsService 只依赖此接口，不感知具体渠道。
 */
export interface TtsSynthesizer {
  synthesizeSpeech(
    text: string,
    voiceId: string,
    speed: number | undefined,
    pitch: number | undefined,
    vol: number | undefined,
    extraParams: Readonly<Record<string, unknown>> | undefined,
    model: string | undefined,
    apiKey: string,
    token: vscode.CancellationToken
  ): Promise<TtsSynthesisResult>;

  /** 提供者专属配置的指纹，供 TtsService 计算缓存键。不含 text、voiceId 等请求级参数。 */
  configFingerprint(): string;

  /** 输出音频格式（缓存文件扩展名等使用） */
  readonly outputFormat: AudioFormat;
}

export interface TtsSynthesisResult {
  readonly audio: Uint8Array;
  readonly traceId?: string;
  readonly extraInfo?: Record<string, unknown>;
}
