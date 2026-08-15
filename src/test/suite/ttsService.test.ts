import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { DEFAULT_CONFIG, TtsConfig } from '../../common/config';
import { UserVisibleError } from '../../common/errors';
import { fileExists } from '../../common/fileUtils';
import { TtsSynthesizer } from '../../common/types';
import { ApiKeyProvider } from '../../services/secretManager';
import { TtsAudioFile, TtsService } from '../../services/ttsService';

suite('TtsService', () => {
  test('uses cached audio for identical text and settings', async () => {
    let calls = 0;
    const service = createService({
      client: {
        outputFormat: 'mp3',
        configFingerprint: () => 'test-fingerprint',
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
        outputFormat: 'mp3',
        configFingerprint: () => 'test-fingerprint',
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

  test('cleans up temporary audio and stale sessions when caching is disabled', async () => {
    const root = vscode.Uri.file(path.join(os.tmpdir(), `xaudio-temp-test-${Date.now()}-${Math.random()}`));
    const tempRoot = vscode.Uri.joinPath(root, 'audio-tmp');
    const staleDir = vscode.Uri.joinPath(tempRoot, 'session-stale');
    await vscode.workspace.fs.createDirectory(staleDir);
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(staleDir, 'stale.mp3'), Buffer.from('stale'));

    const service = new TtsService(
      root,
      new StaticApiKeyProvider(),
      {
        outputFormat: 'mp3',
        configFingerprint: () => 'test-fingerprint',
        async synthesizeSpeech() {
          return {
            audio: Buffer.from('audio')
          };
        }
      },
      () => ({ ...DEFAULT_CONFIG, cacheEnabled: false })
    );

    const tokenSource = new vscode.CancellationTokenSource();
    const file = await service.synthesizeToFile({ text: 'hello' }, tokenSource.token);

    assert.equal(await fileExists(file.uri), true);
    assert.equal(await fileExists(vscode.Uri.joinPath(staleDir, 'stale.mp3')), false);
    assert.equal((await vscode.workspace.fs.readDirectory(tempRoot)).length, 1);

    await service.dispose();
    tokenSource.dispose();

    assert.equal(await fileExists(file.uri), false);
    assert.equal((await vscode.workspace.fs.readDirectory(tempRoot)).length, 0);
    try {
      await vscode.workspace.fs.delete(root, {
        recursive: true,
        useTrash: false
      });
    } catch {
      // 清理测试根目录失败不影响断言
    }
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
        outputFormat: 'mp3',
        configFingerprint: () => 'test-fingerprint',
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

  test('limits concurrent synthesis across direct callers', async () => {
    let active = 0;
    let maxActive = 0;
    let releaseAll!: () => void;
    let notifySecond!: () => void;
    const secondStarted = new Promise<void>(resolve => {
      notifySecond = resolve;
    });
    const gate = new Promise<void>(resolve => {
      releaseAll = resolve;
    });

    const service = createService({
      config: {
        ...DEFAULT_CONFIG,
        cacheEnabled: false,
        maxConcurrentRequests: 2
      },
      client: {
        outputFormat: 'mp3',
        configFingerprint: () => 'test-fingerprint',
        async synthesizeSpeech() {
          active++;
          maxActive = Math.max(maxActive, active);
          if (active === 2) {
            notifySecond();
          }
          await gate;
          active--;
          return {
            audio: Buffer.from('audio')
          };
        }
      }
    });

    const tokenSource = new vscode.CancellationTokenSource();
    const requests = Array.from({ length: 4 }, (_unused, index) =>
      service.synthesizeToFile({ text: `text-${index}` }, tokenSource.token)
    );

    await secondStarted;
    assert.equal(active, 2);

    releaseAll();
    await Promise.all(requests);
    assert.equal(maxActive, 2);

    tokenSource.dispose();
    await service.dispose();
  });

  test('removes older cached audio when the cache size limit is exceeded', async () => {
    let calls = 0;
    const service = createService({
      config: {
        ...DEFAULT_CONFIG,
        cacheMaxSizeMb: 0.0001
      },
      client: {
        outputFormat: 'mp3',
        configFingerprint: () => 'test-fingerprint',
        async synthesizeSpeech() {
          calls += 1;
          return {
            audio: Buffer.alloc(32, calls)
          };
        }
      }
    });

    // 清理每新增 CLEANUP_INTERVAL 个缓存文件才执行一次，因此需要足够多的新文件触发
    const texts = Array.from({ length: 10 }, (_unused, index) => `segment-${index}`);
    const tokenSource = new vscode.CancellationTokenSource();
    const files: TtsAudioFile[] = [];
    for (const text of texts) {
      files.push(await service.synthesizeToFile({ text }, tokenSource.token));
    }
    tokenSource.dispose();

    assert.equal(await fileExists(files[0].uri), false);
    assert.equal(await fileExists(files[files.length - 1].uri), true);
  });

  test('rejects text longer than the TTS sync limit', async () => {
    const service = createService();
    const tokenSource = new vscode.CancellationTokenSource();

    await assert.rejects(
      service.synthesizeToFile({ text: 'x'.repeat(DEFAULT_CONFIG.maxTextLength + 1) }, tokenSource.token),
      (error: unknown) => error instanceof UserVisibleError && error.message.includes('10000')
    );
    tokenSource.dispose();
  });

  test('passes per-call overrides to the synthesizer', async () => {
    let observedVoiceId: string | undefined;
    let observedSpeed: number | undefined;
    let observedExtraParams: Record<string, unknown> | undefined;
    let observedModel: string | undefined;
    const service = createService({
      client: {
        outputFormat: 'mp3',
        configFingerprint: () => 'test-fingerprint',
        async synthesizeSpeech(_text, voiceId, speed, _pitch, _vol, extraParams, model) {
          observedVoiceId = voiceId;
          observedSpeed = speed;
          observedExtraParams = extraParams as Record<string, unknown> | undefined;
          observedModel = model;
          return {
            audio: Buffer.from('audio')
          };
        }
      }
    });

    const tokenSource = new vscode.CancellationTokenSource();
    await service.synthesizeToFile({
      text: 'hello',
      voiceId: 'voice-a',
      speed: 1.5,
      model: 'speech-2.8-hd',
      extraParams: { emotion: 'happy' }
    }, tokenSource.token);
    tokenSource.dispose();

    assert.equal(observedVoiceId, 'voice-a');
    assert.equal(observedSpeed, 1.5);
    assert.equal(observedModel, 'speech-2.8-hd');
    assert.deepEqual(observedExtraParams, { emotion: 'happy' });
  });

  test('keeps separate cache entries for different request models', async () => {
    let calls = 0;
    const service = createService({
      client: {
        outputFormat: 'mp3',
        configFingerprint: () => 'test-fingerprint',
        async synthesizeSpeech() {
          calls += 1;
          return {
            audio: Buffer.from('audio')
          };
        }
      }
    });

    const tokenSource = new vscode.CancellationTokenSource();
    const first = await service.synthesizeToFile({ text: 'hello', model: 'speech-2.8-turbo' }, tokenSource.token);
    const second = await service.synthesizeToFile({ text: 'hello', model: 'speech-2.8-hd' }, tokenSource.token);
    tokenSource.dispose();

    assert.equal(calls, 2);
    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, false);
    assert.notEqual(first.uri.toString(), second.uri.toString());
  });
});

interface CreateServiceOptions {
  readonly config?: TtsConfig;
  readonly client?: TtsSynthesizer;
}

function createService(options: CreateServiceOptions = {}): TtsService {
  return new TtsService(
    vscode.Uri.file(path.join(os.tmpdir(), `xaudio-test-${Date.now()}-${Math.random()}`)),
    new StaticApiKeyProvider(),
    options.client ?? {
      outputFormat: 'mp3',
      configFingerprint: () => 'test-fingerprint',
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
