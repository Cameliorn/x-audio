import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

suite('manifest', () => {
  test('every %key% reference in package.json exists in both nls files', () => {
    const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'audioplugin');
    assert.ok(extension, 'AudioPlugin extension should be available in extension tests.');
    if (!extension) {
      return;
    }

    const packageJson = fs.readFileSync(path.join(extension.extensionPath, 'package.json'), 'utf8');
    const references = new Set([...packageJson.matchAll(/%([\w.]+)%/g)].map(match => match[1]));
    assert.ok(references.size > 0, 'package.json should contain localized %key% references.');

    const enNls = readNls(extension.extensionPath, 'package.nls.json');
    const zhNls = readNls(extension.extensionPath, 'package.nls.zh-cn.json');

    for (const key of references) {
      assert.ok(key in enNls, `package.nls.json is missing key "${key}" referenced by package.json.`);
      assert.ok(key in zhNls, `package.nls.zh-cn.json is missing key "${key}" referenced by package.json.`);
    }

    assert.deepEqual(Object.keys(enNls).sort(), Object.keys(zhNls).sort());
  });
});

function readNls(extensionPath: string, fileName: string): Record<string, string> {
  const filePath = path.join(extensionPath, fileName);
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content) as Record<string, string>;
}
