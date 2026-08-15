import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { DEFAULT_CONFIG, TtsConfig } from '../common/config';
import { TtsSynthesizer } from '../common/types';
import { MultiRoleTtsService, RoleSpeechSegment } from '../services/multiRoleTtsService';
import { ApiKeyProvider } from '../services/secretManager';
import { TtsService } from '../services/ttsService';

suite('MultiRoleTtsService', () => {
  test('synthesizes segments concurrently up to the configured limit and preserves order', async () => {
    let active = 0;
    let maxActive = 0;
    const startOrder: string[] = [];
    let releaseAll!: () => void;
    const gate = new Promise<void>(resolve => {
      releaseAll = resolve;
    });

    const service = createService({
      config: { ...DEFAULT_CONFIG, maxConcurrentRequests: 3 },
      client: {
        outputFormat: 'mp3',
        configFingerprint: () => 'test-fingerprint',
        async synthesizeSpeech(text) {
          active++;
          maxActive = Math.max(maxActive, active);
          startOrder.push(text);
          await gate;
          active--;
          return {
            audio: Buffer.from('audio')
          };
        }
      }
    });

    const segments = makeSegments(6);
    const tokenSource = new vscode.CancellationTokenSource();
    const resultPromise = service.synthesizeSegments(segments, tokenSource.token);

    await waitUntil(() => active === 3);

    assert.equal(maxActive, 3);

    releaseAll();

    const files = await resultPromise;
    tokenSource.dispose();

    assert.equal(files.length, 6);
    // 并发限制在 TtsService 单层，启动顺序不再与提交顺序一致，但结果必须按原顺序返回
    assert.deepEqual([...startOrder].sort(), segments.map((_unused, index) => `segment-${index}`).sort());
    assert.deepEqual(
      files.map(file => file.characters),
      segments.map(segment => segment.text.length)
    );
  });

  test('stops starting new requests and cancels in-flight ones when a segment fails', async () => {
    let active = 0;
    let maxActive = 0;
    const startOrder: string[] = [];
    let cancelled = 0;

    const service = createService({
      config: { ...DEFAULT_CONFIG, maxConcurrentRequests: 3 },
      client: {
        outputFormat: 'mp3',
        configFingerprint: () => 'test-fingerprint',
        async synthesizeSpeech(text, _voiceId, _speed, _pitch, _vol, _extraParams, _model, _apiKey, token) {
          active++;
          maxActive = Math.max(maxActive, active);
          // 单层并发下各片段启动顺序不确定，让第一个启动的请求失败即可
          const shouldFail = startOrder.length === 0;
          startOrder.push(text);
          if (shouldFail) {
            // 先进入"请求中"状态再失败，确保与其余在途请求重叠
            await new Promise(resolve => setTimeout(resolve, 20));
            active--;
            throw new Error('boom');
          }
          await new Promise<void>(resolve => {
            const subscription = token.onCancellationRequested(() => {
              subscription.dispose();
              cancelled++;
              resolve();
            });
          });
          active--;
          return {
            audio: Buffer.from('audio')
          };
        }
      }
    });

    const tokenSource = new vscode.CancellationTokenSource();
    await assert.rejects(
      service.synthesizeSegments(makeSegments(6), tokenSource.token),
      /boom/
    );
    tokenSource.dispose();

    assert.equal(maxActive, 3);
    // 失败传播与槽位唤醒之间存在竞态，允许多启动一个请求，但它必须立即被取消
    assert.ok(startOrder.length <= 4, `expected at most 4 started requests, got ${startOrder.length}`);
    assert.equal(cancelled, startOrder.length - 1);
  });
});

function makeSegments(count: number): RoleSpeechSegment[] {
  return Array.from({ length: count }, (_unused, index) => ({
    speaker: `角色${index}`,
    voice: index % 2 === 0 ? 'male' : 'female',
    text: `segment-${index}`,
    voiceId: `voice-${index}`
  }));
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitUntil timed out');
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

interface CreateServiceOptions {
  readonly config?: TtsConfig;
  readonly client: TtsSynthesizer;
}

// 并发限制已收敛到 TtsService，测试中使用真实 TtsService + mock 合成器验证端到端行为
function createService(options: CreateServiceOptions): MultiRoleTtsService {
  const configProvider = (): TtsConfig => options.config ?? DEFAULT_CONFIG;
  const ttsService = new TtsService(
    vscode.Uri.file(path.join(os.tmpdir(), `xaudio-multirole-test-${Date.now()}-${Math.random()}`)),
    new StaticApiKeyProvider(),
    options.client,
    configProvider
  );
  return new MultiRoleTtsService(ttsService, configProvider);
}

class StaticApiKeyProvider implements ApiKeyProvider {
  public async requireApiKey(): Promise<string> {
    return 'test-api-key';
  }
}
