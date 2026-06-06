import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { DEFAULT_CONFIG, MiniMaxTtsConfig } from '../../src/config';
import { UserVisibleError } from '../../src/errors';
import { ApiKeyProvider } from '../../src/secretManager';
import { TtsService, fileExists } from '../../src/ttsService';
import { MiniMaxSynthesizer } from '../../src/types';

suite('TtsService', () => {
  test('uses cached audio for identical text and settings', async () => {
    let calls = 0;
    const service = createService({
      client: {
        async synthesizeSpeech() {
          calls += 1;
          return {
            audio: Buffer.from('audio')
          };
        }
      }
    });

    const tokenSource = new vscode.CancellationTokenSource();
    const first = await service.synthesizeToFile({ text: 'hello' }, tokenSource.token);
    const second = await service.synthesizeToFile({ text: 'hello' }, tokenSource.token);
    tokenSource.dispose();

    assert.equal(calls, 1);
    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, true);
    assert.equal(first.uri.toString(), second.uri.toString());
  });

  test('does not use cache when cache is disabled', async () => {
    let calls = 0;
    const service = createService({
      config: {
        ...DEFAULT_CONFIG,
        cacheEnabled: false
      },
      client: {
        async synthesizeSpeech() {
          calls += 1;
          return {
            audio: Buffer.from(`audio-${calls}`)
          };
        }
      }
    });

    const tokenSource = new vscode.CancellationTokenSource();
    await service.synthesizeToFile({ text: 'hello' }, tokenSource.token);
    await service.synthesizeToFile({ text: 'hello' }, tokenSource.token);
    tokenSource.dispose();

    assert.equal(calls, 2);
  });

  test('shares concurrent synthesis for identical text and settings', async () => {
    let calls = 0;
    let releaseSynthesis!: () => void;
    let notifyStarted!: () => void;
    const synthesisStarted = new Promise<void>(resolve => {
      notifyStarted = resolve;
    });
    const release = new Promise<void>(resolve => {
      releaseSynthesis = resolve;
    });
    const service = createService({
      client: {
        async synthesizeSpeech() {
          calls += 1;
          notifyStarted();
          await release;
          return {
            audio: Buffer.from('audio')
          };
        }
      }
    });

    const tokenSource = new vscode.CancellationTokenSource();
    const first = service.synthesizeToFile({ text: 'hello' }, tokenSource.token);
    const second = service.synthesizeToFile({ text: 'hello' }, tokenSource.token);

    await synthesisStarted;
    releaseSynthesis();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    tokenSource.dispose();

    assert.equal(calls, 1);
    assert.equal(firstResult.uri.toString(), secondResult.uri.toString());
  });

  test('removes older cached audio when the cache size limit is exceeded', async () => {
    let calls = 0;
    const service = createService({
      config: {
        ...DEFAULT_CONFIG,
        cacheMaxSizeMb: 0.00001
      },
      client: {
        async synthesizeSpeech() {
          calls += 1;
          return {
            audio: Buffer.alloc(32, calls)
          };
        }
      }
    });

    const tokenSource = new vscode.CancellationTokenSource();
    const first = await service.synthesizeToFile({ text: 'first' }, tokenSource.token);
    const second = await service.synthesizeToFile({ text: 'second' }, tokenSource.token);
    tokenSource.dispose();

    assert.equal(await fileExists(first.uri), false);
    assert.equal(await fileExists(second.uri), true);
  });

  test('rejects text longer than the MiniMax sync limit', async () => {
    const service = createService();
    const tokenSource = new vscode.CancellationTokenSource();

    await assert.rejects(
      service.synthesizeToFile({ text: 'x'.repeat(DEFAULT_CONFIG.maxTextLength + 1) }, tokenSource.token),
      (error: unknown) => error instanceof UserVisibleError && error.message.includes('10000')
    );
    tokenSource.dispose();
  });

  test('passes per-call model and voice overrides to the client', async () => {
    let observedModel: string | undefined;
    let observedVoiceId: string | undefined;
    const service = createService({
      client: {
        async synthesizeSpeech(options) {
          observedModel = options.overrides?.model;
          observedVoiceId = options.overrides?.voiceId;
          return {
            audio: Buffer.from('audio')
          };
        }
      }
    });

    const tokenSource = new vscode.CancellationTokenSource();
    await service.synthesizeToFile({
      text: 'hello',
      model: 'speech-2.8-hd',
      voiceId: 'voice-a'
    }, tokenSource.token);
    tokenSource.dispose();

    assert.equal(observedModel, 'speech-2.8-hd');
    assert.equal(observedVoiceId, 'voice-a');
  });
});

interface CreateServiceOptions {
  readonly config?: MiniMaxTtsConfig;
  readonly client?: MiniMaxSynthesizer;
}

function createService(options: CreateServiceOptions = {}): TtsService {
  return new TtsService(
    {
      globalStorageUri: vscode.Uri.file(path.join(os.tmpdir(), `minimax-tts-test-${Date.now()}-${Math.random()}`))
    },
    new StaticApiKeyProvider(),
    options.client ?? {
      async synthesizeSpeech() {
        return {
          audio: Buffer.from('audio')
        };
      }
    },
    () => options.config ?? DEFAULT_CONFIG
  );
}

class StaticApiKeyProvider implements ApiKeyProvider {
  public async requireApiKey(): Promise<string> {
    return 'test-api-key';
  }
}
