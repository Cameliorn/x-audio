import * as assert from 'assert';
import * as os from 'os';
import * as vscode from 'vscode';
import { findDirectoryVoiceConfig } from '../../src/voiceConfigFile';

function tempUri(...segments: string[]): vscode.Uri {
  return vscode.Uri.joinPath(vscode.Uri.file(os.tmpdir()), 'audioplugin-test', ...segments);
}

suite('voiceConfigFile', () => {
  test('finds .ttsvoices.json in the same directory', async () => {
    const dir = tempUri('test-voice-config-same');
    await vscode.workspace.fs.createDirectory(dir);
    const configFile = vscode.Uri.joinPath(dir, '.ttsvoices.json');
    await vscode.workspace.fs.writeFile(configFile, Buffer.from(JSON.stringify({ 张三: 'male-voice', 小红: 'female-voice' })));
    const file = vscode.Uri.joinPath(dir, 'story.txt');
    await vscode.workspace.fs.writeFile(file, Buffer.from('test'));

    const config = await findDirectoryVoiceConfig(file);
    assert.ok(config);
    if (!config) { return; }
    assert.equal(config.characterVoices['张三'], 'male-voice');
    assert.equal(config.characterVoices['小红'], 'female-voice');

    await vscode.workspace.fs.delete(dir, { recursive: true, useTrash: false });
  });

  test('walks up to find .ttsvoices.json in an ancestor directory', async () => {
    const parent = tempUri('test-voice-config-ancestor');
    const child = vscode.Uri.joinPath(parent, 'chapter');
    await vscode.workspace.fs.createDirectory(child);
    const configFile = vscode.Uri.joinPath(parent, '.ttsvoices.json');
    await vscode.workspace.fs.writeFile(configFile, Buffer.from(JSON.stringify({ 旁白: 'narrator-voice' })));
    const file = vscode.Uri.joinPath(child, 'story.txt');
    await vscode.workspace.fs.writeFile(file, Buffer.from('test'));

    const config = await findDirectoryVoiceConfig(file);
    assert.ok(config);
    if (!config) { return; }
    assert.equal(config.characterVoices['旁白'], 'narrator-voice');

    await vscode.workspace.fs.delete(parent, { recursive: true, useTrash: false });
  });

  test('returns undefined when no .ttsvoices.json exists', async () => {
    const dir = tempUri('test-voice-config-none');
    await vscode.workspace.fs.createDirectory(dir);
    const file = vscode.Uri.joinPath(dir, 'story.txt');
    await vscode.workspace.fs.writeFile(file, Buffer.from('test'));

    const config = await findDirectoryVoiceConfig(file);
    assert.equal(config, undefined);

    await vscode.workspace.fs.delete(dir, { recursive: true, useTrash: false });
  });

  test('ignores non-string values, empty strings, and extracts @roleVoices', async () => {
    const dir = tempUri('test-voice-config-filter');
    await vscode.workspace.fs.createDirectory(dir);
    const configFile = vscode.Uri.joinPath(dir, '.ttsvoices.json');
    await vscode.workspace.fs.writeFile(configFile, Buffer.from(JSON.stringify({
      a: 'valid',
      b: 123,
      c: '',
      e: 'also-valid',
      '@roleVoices': {
        narrator: 'audiobook_female_1',
        male: 'female-yujie',
        invalid_key: 'ignored',
        female: '  '
      }
    })));
    const file = vscode.Uri.joinPath(dir, 'story.txt');
    await vscode.workspace.fs.writeFile(file, Buffer.from('test'));

    const config = await findDirectoryVoiceConfig(file);
    assert.ok(config);
    if (!config) { return; }
    // character-level
    assert.equal(Object.keys(config.characterVoices).length, 2);
    assert.equal(config.characterVoices['a'], 'valid');
    assert.equal(config.characterVoices['e'], 'also-valid');
    // role-type-level
    assert.equal(Object.keys(config.roleTypeVoices).length, 2);
    assert.equal(config.roleTypeVoices.narrator, 'audiobook_female_1');
    assert.equal(config.roleTypeVoices.male, 'female-yujie');

    await vscode.workspace.fs.delete(dir, { recursive: true, useTrash: false });
  });

  test('reads role type overrides from @roleVoices key', async () => {
    const dir = tempUri('test-voice-config-roles');
    await vscode.workspace.fs.createDirectory(dir);
    const configFile = vscode.Uri.joinPath(dir, '.ttsvoices.json');
    await vscode.workspace.fs.writeFile(configFile, Buffer.from(JSON.stringify({
      '@roleVoices': { girl: 'female-shaonv', boy: 'female-shaonv' }
    })));
    const file = vscode.Uri.joinPath(dir, 'story.txt');
    await vscode.workspace.fs.writeFile(file, Buffer.from('test'));

    const config = await findDirectoryVoiceConfig(file);
    assert.ok(config);
    if (!config) { return; }
    assert.equal(Object.keys(config.characterVoices).length, 0);
    assert.equal(config.roleTypeVoices.girl, 'female-shaonv');
    assert.equal(config.roleTypeVoices.boy, 'female-shaonv');

    await vscode.workspace.fs.delete(dir, { recursive: true, useTrash: false });
  });
});
