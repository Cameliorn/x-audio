import * as assert from 'assert';
import * as vscode from 'vscode';
import { DEFAULT_CONFIG } from '../../src/config';
import { MultiRoleTtsService, RoleSpeechSegment } from '../../src/multiRoleTtsService';

suite('MultiRoleTtsService', () => {
  test('synthesizes segments concurrently up to the configured limit and preserves order', async () => {
    let active = 0;
    let maxActive = 0;
    const startOrder: string[] = [];
    let releaseAll!: () => void;
    const gate = new Promise<void>(resolve => {
      releaseAll = resolve;
    });

    const service = new MultiRoleTtsService({
      async synthesizeToFile(request) {
        active++;
        maxActive = Math.max(maxActive, active);
        startOrder.push(request.text);
        await gate;
        active--;
        return {
          uri: vscode.Uri.file(`/tmp/${request.text}.mp3`),
          format: 'mp3' as const,
          cacheHit: false,
          characters: request.text.length
        };
      }
    }, () => ({ ...DEFAULT_CONFIG, maxConcurrentRequests: 3 }));

    const segments = makeSegments(6);
    const tokenSource = new vscode.CancellationTokenSource();
    const resultPromise = service.synthesizeSegments(segments, tokenSource.token);

    await waitUntil(() => active === 3);

    assert.equal(maxActive, 3);
    assert.deepEqual(startOrder.slice(0, 3), ['segment-0', 'segment-1', 'segment-2']);

    releaseAll();

    const files = await resultPromise;
    tokenSource.dispose();

    assert.equal(files.length, 6);
    assert.deepEqual(startOrder, segments.map((_unused, index) => `segment-${index}`));
    assert.deepEqual(
      files.map(file => file.uri.fsPath),
      segments.map((_unused, index) => `/tmp/segment-${index}.mp3`)
    );
  });

  test('stops starting new requests and cancels in-flight ones when a segment fails', async () => {
    let active = 0;
    let maxActive = 0;
    const startOrder: string[] = [];
    let cancelled = 0;

    const service = new MultiRoleTtsService({
      async synthesizeToFile(request, token) {
        active++;
        maxActive = Math.max(maxActive, active);
        startOrder.push(request.text);
        if (request.text === 'segment-0') {
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
        return createAudioFile(request.text);
      }
    }, () => ({ ...DEFAULT_CONFIG, maxConcurrentRequests: 3 }));

    const tokenSource = new vscode.CancellationTokenSource();
    await assert.rejects(
      service.synthesizeSegments(makeSegments(6), tokenSource.token),
      /boom/
    );
    tokenSource.dispose();

    assert.equal(maxActive, 3);
    assert.equal(startOrder.length, 3);
    assert.equal(cancelled, 2);
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

function createAudioFile(text: string): { uri: vscode.Uri; format: 'mp3'; cacheHit: boolean; characters: number } {
  return {
    uri: vscode.Uri.file(`/tmp/${text}.mp3`),
    format: 'mp3',
    cacheHit: false,
    characters: text.length
  };
}
