import * as assert from 'assert';
import * as vscode from 'vscode';
import { DEFAULT_CONFIG } from '../../src/config';
import { UserVisibleError } from '../../src/errors';
import { createRoleAnalysisClient } from '../../src/roleAnalysisClient';

suite('RoleAnalysisClient', () => {
  test('times out OpenAI-compatible requests', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(new Error('aborted'));
        return;
      }
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });

    try {
      const client = createRoleAnalysisClient({
        ...DEFAULT_CONFIG.roleAnalysis,
        requestTimeoutMs: 100
      }, fakeSecrets());
      const tokenSource = new vscode.CancellationTokenSource();

      await assert.rejects(
        client.sendRequest([{ role: 'user', content: '分析这段文本' }], tokenSource.token),
        (error: unknown) => error instanceof UserVisibleError && error.message.includes('0.1')
      );

      tokenSource.dispose();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('rejects with CancellationError when the token is cancelled', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(new Error('aborted'));
        return;
      }
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });

    try {
      const client = createRoleAnalysisClient(DEFAULT_CONFIG.roleAnalysis, fakeSecrets());
      const tokenSource = new vscode.CancellationTokenSource();
      const request = client.sendRequest([{ role: 'user', content: '分析这段文本' }], tokenSource.token);
      const rejection = assert.rejects(
        request,
        (error: unknown) => error instanceof vscode.CancellationError
      );

      tokenSource.cancel();
      await rejection;
      tokenSource.dispose();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('rejects with CancellationError when the token is already cancelled', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async (_input, init) => {
      fetchCalled = true;
      if (init?.signal?.aborted) {
        throw new Error('aborted');
      }
      return new Response('{}', {
        status: 200
      });
    };

    try {
      const client = createRoleAnalysisClient(DEFAULT_CONFIG.roleAnalysis, fakeSecrets());
      const tokenSource = new vscode.CancellationTokenSource();
      tokenSource.cancel();

      await assert.rejects(
        client.sendRequest([{ role: 'user', content: '分析这段文本' }], tokenSource.token),
        (error: unknown) => error instanceof vscode.CancellationError
      );

      assert.equal(fetchCalled, false);
      tokenSource.dispose();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function fakeSecrets(): vscode.SecretStorage {
  return {
    get: async () => 'test-key'
  } as unknown as vscode.SecretStorage;
}
