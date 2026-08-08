import * as assert from 'assert';
import * as vscode from 'vscode';
import { DoubaoApiError, UserVisibleError } from '../../src/errors';
import { DoubaoClient, buildDoubaoPayload, parseDoubaoResponse } from '../../src/providers/doubao/client';
import { DEFAULT_DOUBAO_CONFIG, normalizeApiHost } from '../../src/providers/doubao/config';

suite('DoubaoClient', () => {
  test('builds an audio generation payload with speaker reference', () => {
    const payload = buildDoubaoPayload('你好，世界', DEFAULT_DOUBAO_CONFIG, {
      voiceId: 'zh_female_xiaohe_uranus_bigtts'
    });

    assert.equal(payload.model, 'seed-audio-1.0');
    assert.equal(payload.text_prompt, '你好，世界');
    assert.deepEqual(payload.references, [{ speaker: 'zh_female_xiaohe_uranus_bigtts' }]);
    assert.deepEqual(payload.audio_config, {
      format: 'mp3',
      sample_rate: 24000,
      speech_rate: 0,
      loudness_rate: 0,
      pitch_rate: 0
    });
  });

  test('omits references when voice id is empty for pure prompt generation', () => {
    const payload = buildDoubaoPayload('雨夜，脚步声由远及近', DEFAULT_DOUBAO_CONFIG, {
      voiceId: '  '
    });

    assert.equal(payload.references, undefined);
  });

  test('maps speed, pitch and vol to rate offsets', () => {
    const payload = buildDoubaoPayload('hello', DEFAULT_DOUBAO_CONFIG, {
      voiceId: 'v',
      speed: 1.5,
      pitch: 3,
      vol: 2
    });

    assert.deepEqual(payload.audio_config, {
      format: 'mp3',
      sample_rate: 24000,
      speech_rate: 50,
      loudness_rate: 20,
      pitch_rate: 3
    });
  });

  test('clamps out-of-range playback parameters', () => {
    const payload = buildDoubaoPayload('hello', DEFAULT_DOUBAO_CONFIG, {
      voiceId: 'v',
      speed: 10,
      pitch: 99,
      vol: -5
    });

    assert.deepEqual(payload.audio_config, {
      format: 'mp3',
      sample_rate: 24000,
      speech_rate: 100,
      loudness_rate: -20,
      pitch_rate: 12
    });
  });

  test('adds subtitle flag when enabled', () => {
    const payload = buildDoubaoPayload('hello', {
      ...DEFAULT_DOUBAO_CONFIG,
      subtitleEnable: true
    }, { voiceId: 'v' });

    assert.equal((payload.audio_config as Record<string, unknown>).enable_subtitle, true);
  });

  test('merges extra request fields without overriding core fields', () => {
    const payload = buildDoubaoPayload('hello', {
      ...DEFAULT_DOUBAO_CONFIG,
      extraRequestJson: {
        watermark: { aigc_watermark: true },
        model: 'overridden',
        text_prompt: 'overridden'
      }
    }, { voiceId: 'v', model: 'seed-audio-1.0' });

    assert.deepEqual(payload.watermark, { aigc_watermark: true });
    assert.equal(payload.model, 'seed-audio-1.0');
    assert.equal(payload.text_prompt, 'hello');
  });

  test('keeps cache fingerprint stable when nested object key order changes', () => {
    const first = new DoubaoClient(() => ({
      ...DEFAULT_DOUBAO_CONFIG,
      extraRequestJson: {
        a: 1,
        b: {
          y: 2,
          x: 1
        }
      }
    }));
    const second = new DoubaoClient(() => ({
      ...DEFAULT_DOUBAO_CONFIG,
      extraRequestJson: {
        b: {
          x: 1,
          y: 2
        },
        a: 1
      }
    }));

    assert.equal(first.configFingerprint(), second.configFingerprint());
  });

  test('normalizes API host and allows loopback for local development', () => {
    assert.equal(normalizeApiHost(' https://openspeech.bytedance.com/ '), 'https://openspeech.bytedance.com');
    assert.equal(normalizeApiHost('http://127.0.0.1:3000/'), 'http://127.0.0.1:3000');
  });

  test('rejects non-HTTPS remote API host URLs', () => {
    assert.throws(() => normalizeApiHost('http://example.com'), UserVisibleError);
  });

  test('parses response JSON and throws on empty or invalid body', () => {
    assert.deepEqual(parseDoubaoResponse('{"code":0,"url":"https://audio.example/a.mp3"}', 200), {
      code: 0,
      url: 'https://audio.example/a.mp3'
    });
    assert.throws(() => parseDoubaoResponse('', 200), DoubaoApiError);
    assert.throws(() => parseDoubaoResponse('not-json', 200), DoubaoApiError);
  });

  test('returns downloaded audio for a successful response', async () => {
    let createCall = true;
    const client = new DoubaoClient(() => DEFAULT_DOUBAO_CONFIG, async (input) => {
      if (createCall) {
        createCall = false;
        return new Response(JSON.stringify({
          code: 0,
          duration: 3.2,
          original_duration: 3.2,
          url: 'https://audio.example/result.mp3'
        }), {
          status: 200,
          headers: { 'X-Tt-Logid': 'logid-123' }
        });
      }

      assert.equal(input.toString(), 'https://audio.example/result.mp3');
      return new Response(new Uint8Array([0x49, 0x44, 0x33]), { status: 200 });
    });

    const tokenSource = new vscode.CancellationTokenSource();
    const result = await client.synthesizeSpeech(
      'hello',
      'zh_female_xiaohe_uranus_bigtts',
      undefined, undefined, undefined, undefined,
      undefined,
      'key',
      tokenSource.token
    );
    tokenSource.dispose();

    assert.deepEqual(Array.from(result.audio), [0x49, 0x44, 0x33]);
    assert.equal(result.traceId, 'logid-123');
    assert.equal(result.extraInfo?.duration, 3.2);
  });

  test('surfaces Doubao API errors with code and message', async () => {
    const client = new DoubaoClient(() => DEFAULT_DOUBAO_CONFIG, async () => new Response(JSON.stringify({
      code: 1001,
      message: 'invalid api key'
    }), { status: 200 }));

    const tokenSource = new vscode.CancellationTokenSource();
    await assert.rejects(
      client.synthesizeSpeech(
        'hello',
        'zh_female_xiaohe_uranus_bigtts',
        undefined, undefined, undefined, undefined,
        undefined,
        'key',
        tokenSource.token
      ),
      (error: unknown) => error instanceof DoubaoApiError &&
        error.message.includes('invalid api key') &&
        error.statusCode === 1001
    );
    tokenSource.dispose();
  });

  test('throws when response has no audio url', async () => {
    const client = new DoubaoClient(() => DEFAULT_DOUBAO_CONFIG, async () => new Response(JSON.stringify({
      code: 0,
      duration: 1
    }), { status: 200 }));

    const tokenSource = new vscode.CancellationTokenSource();
    await assert.rejects(
      client.synthesizeSpeech(
        'hello',
        'zh_female_xiaohe_uranus_bigtts',
        undefined, undefined, undefined, undefined,
        undefined,
        'key',
        tokenSource.token
      ),
      DoubaoApiError
    );
    tokenSource.dispose();
  });

  test('throws when audio download fails', async () => {
    let createCall = true;
    const client = new DoubaoClient(() => DEFAULT_DOUBAO_CONFIG, async () => {
      if (createCall) {
        createCall = false;
        return new Response(JSON.stringify({
          code: 0,
          url: 'https://audio.example/result.mp3'
        }), { status: 200 });
      }

      return new Response('oops', { status: 500 });
    });

    const tokenSource = new vscode.CancellationTokenSource();
    await assert.rejects(
      client.synthesizeSpeech(
        'hello',
        'zh_female_xiaohe_uranus_bigtts',
        undefined, undefined, undefined, undefined,
        undefined,
        'key',
        tokenSource.token
      ),
      (error: unknown) => error instanceof DoubaoApiError && error.message.includes('500')
    );
    tokenSource.dispose();
  });

  test('rejects with CancellationError when the token is cancelled', async () => {
    const client = new DoubaoClient(
      () => DEFAULT_DOUBAO_CONFIG,
      async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })
    );

    const tokenSource = new vscode.CancellationTokenSource();
    const request = client.synthesizeSpeech(
      'hello',
      'zh_female_xiaohe_uranus_bigtts',
      undefined, undefined, undefined, undefined,
      undefined,
      'key',
      tokenSource.token
    );
    const rejection = assert.rejects(
      request,
      (error: unknown) => error instanceof vscode.CancellationError
    );
    tokenSource.cancel();
    await rejection;
    tokenSource.dispose();
  });
});
