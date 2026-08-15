import * as assert from 'assert';
import { normalizeApiKey } from '../common/apiKey';
import { inspectMiniMaxApiKey } from '../providers/minimax/apiKey';

suite('apiKey', () => {
  test('does not require OpenAI-style sk prefixes', () => {
    assert.equal(normalizeApiKey('plain-minimax-token'), 'plain-minimax-token');
  });

  test('strips an optional Bearer prefix', () => {
    assert.equal(normalizeApiKey(' Bearer plain-minimax-token '), 'plain-minimax-token');
  });

  test('detects MiniMax JWT metadata without exposing the secret', () => {
    const payload = Buffer.from(JSON.stringify({
      iss: 'minimax',
      TokenType: 2,
      GroupID: '1234567890'
    })).toString('base64url');
    const info = inspectMiniMaxApiKey(`header.${payload}.signature`);

    assert.equal(info.isJwt, true);
    assert.equal(info.issuer, 'minimax');
    assert.equal(info.tokenType, 2);
    assert.equal(info.groupId, '1234567890');
  });
});
