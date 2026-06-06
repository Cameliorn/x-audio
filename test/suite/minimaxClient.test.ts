import * as assert from 'assert';
import * as vscode from 'vscode';
import { DEFAULT_CONFIG, normalizeApiHost } from '../../src/config';
import { MiniMaxApiError, UserVisibleError } from '../../src/errors';
import { MiniMaxClient, buildMiniMaxTtsPayload, decodeHexAudio } from '../../src/minimaxClient';

suite('MiniMaxClient', () => {
  test('builds a T2A request payload with overrides', () => {
    const payload = buildMiniMaxTtsPayload('hello', DEFAULT_CONFIG, {
      model: ' speech-2.8-hd ',
      voiceId: ' custom-voice '
    });

    assert.equal(payload.model, 'speech-2.8-hd');
    assert.equal(payload.text, 'hello');
    assert.equal(payload.stream, false);
    assert.equal(payload.output_format, 'hex');
    assert.deepEqual(payload.voice_setting, {
      voice_id: 'custom-voice',
      speed: 1,
      vol: 1,
      pitch: 0
    });
    assert.deepEqual(payload.audio_setting, {
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
      channel: 1
    });
  });

  test('adds configurable pronunciation, voice effects, subtitles, and channel settings', () => {
    const payload = buildMiniMaxTtsPayload('hello', {
      ...DEFAULT_CONFIG,
      channel: 2,
      pronunciationTone: ['Omg/Oh my god'],
      voiceModifyEnabled: true,
      voiceModifyPitch: 1,
      voiceModifyIntensity: 2,
      voiceModifyTimbre: 3,
      voiceModifySoundEffects: 'spacious_echo',
      subtitleEnable: true,
      subtitleType: 'word'
    });

    assert.deepEqual(payload.audio_setting, {
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
      channel: 2
    });
    assert.deepEqual(payload.pronunciation_dict, {
      tone: ['Omg/Oh my god']
    });
    assert.deepEqual(payload.voice_modify, {
      pitch: 1,
      intensity: 2,
      timbre: 3,
      sound_effects: 'spacious_echo'
    });
    assert.equal(payload.subtitle_enable, true);
    assert.equal(payload.subtitle_type, 'word');
  });

  test('merges advanced request fields without overriding playback-critical fields', () => {
    const payload = buildMiniMaxTtsPayload('hello', {
      ...DEFAULT_CONFIG,
      extraRequestJson: {
        timbre_weights: [
          {
            voice_id: 'voice-a',
            weight: 50
          }
        ],
        output_format: 'url',
        text: 'overridden'
      }
    });

    assert.deepEqual(payload.timbre_weights, [
      {
        voice_id: 'voice-a',
        weight: 50
      }
    ]);
    assert.equal(payload.output_format, 'hex');
    assert.equal(payload.text, 'hello');
  });

  test('decodes hex audio', () => {
    const decoded = decodeHexAudio('68656c6c6f');
    assert.equal(Buffer.from(decoded).toString('utf8'), 'hello');
  });

  test('normalizes secure API host URLs', () => {
    assert.equal(normalizeApiHost(' https://api.minimax.io/ '), 'https://api.minimax.io');
  });

  test('allows loopback HTTP API host URLs for local development', () => {
    assert.equal(normalizeApiHost('http://127.0.0.1:3000/'), 'http://127.0.0.1:3000');
  });

  test('rejects non-HTTPS remote API host URLs', () => {
    assert.throws(() => normalizeApiHost('http://example.com'), UserVisibleError);
  });

  test('rejects invalid hex audio', () => {
    assert.throws(() => decodeHexAudio('not-hex'), UserVisibleError);
  });

  test('surfaces MiniMax API errors with trace id', async () => {
    const client = new MiniMaxClient(async () => new Response(JSON.stringify({
      trace_id: 'trace-123',
      base_resp: {
        status_code: 1001,
        status_msg: 'invalid api key'
      }
    }), {
      status: 200
    }));

    const tokenSource = new vscode.CancellationTokenSource();
    await assert.rejects(
      client.synthesizeSpeech({
        apiKey: 'key',
        text: 'hello',
        config: DEFAULT_CONFIG
      }, tokenSource.token),
      (error: unknown) => error instanceof MiniMaxApiError &&
        error.message.includes('invalid api key') &&
        error.message.includes('trace-123')
    );
    tokenSource.dispose();
  });

  test('returns audio bytes for a successful response', async () => {
    const client = new MiniMaxClient(async () => new Response(JSON.stringify({
      data: {
        audio: '6869',
        status: 2
      },
      trace_id: 'trace-ok',
      base_resp: {
        status_code: 0,
        status_msg: 'success'
      }
    }), {
      status: 200
    }));

    const tokenSource = new vscode.CancellationTokenSource();
    const result = await client.synthesizeSpeech({
      apiKey: 'key',
      text: 'hello',
      config: DEFAULT_CONFIG
    }, tokenSource.token);
    tokenSource.dispose();

    assert.equal(Buffer.from(result.audio).toString('utf8'), 'hi');
    assert.equal(result.traceId, 'trace-ok');
  });
});
