import * as assert from 'assert';
import * as vscode from 'vscode';
import { MissingApiKeyError } from '../../src/errors';
import { SecretManager } from '../../src/secretManager';

suite('SecretManager', () => {
  test('throws a user-facing error when the API key is missing', async () => {
    const secrets = new MemorySecretStorage();
    const manager = new SecretManager(secrets);

    await assert.rejects(
      manager.requireApiKey(),
      (error: unknown) => error instanceof MissingApiKeyError
    );
  });

  test('returns a stored API key', async () => {
    const secrets = new MemorySecretStorage();
    await secrets.store('minimaxTts.apiKey', ' key-value ');
    const manager = new SecretManager(secrets);

    assert.equal(await manager.requireApiKey(), 'key-value');
  });

  test('normalizes a Bearer-prefixed API key', async () => {
    const secrets = new MemorySecretStorage();
    await secrets.store('minimaxTts.apiKey', ' Bearer key-value ');
    const manager = new SecretManager(secrets);

    assert.equal(await manager.requireApiKey(), 'key-value');
  });
});

class MemorySecretStorage implements vscode.SecretStorage {
  private readonly values = new Map<string, string>();
  public readonly onDidChange = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event;

  public async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  public async store(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  public async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  public async keys(): Promise<string[]> {
    return [...this.values.keys()];
  }
}
