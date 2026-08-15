import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

suite('manifest', () => {
  test('every %key% reference in package.json exists in both nls files', () => {
    const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'x-audio');
    assert.ok(extension, 'x-audio extension should be available in extension tests.');
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

  test('every language model tool registered in code is declared in package.json', () => {
    const extension = findExtension();
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(extension.extensionPath, 'package.json'), 'utf8')
    ) as {
      readonly activationEvents?: readonly string[];
      readonly contributes?: { readonly languageModelTools?: ReadonlyArray<{ readonly name: string }> };
    };

    const declared = new Set((packageJson.contributes?.languageModelTools ?? []).map(tool => tool.name));
    assert.ok(declared.size > 0, 'package.json should declare languageModelTools.');

    // activationEvents 中的 onLanguageModelTool 必须有对应声明，否则工具无法激活
    const toolActivations = (packageJson.activationEvents ?? [])
      .filter(event => event.startsWith('onLanguageModelTool:'))
      .map(event => event.slice('onLanguageModelTool:'.length));
    for (const name of toolActivations) {
      assert.ok(declared.has(name), `activationEvents references tool "${name}" but languageModelTools does not declare it.`);
    }

    // 源码中 vscode.lm.registerTool 的名称必须已声明，否则工具对模型不可见
    const extensionSource = fs.readFileSync(path.join(extension.extensionPath, 'src', 'extension.ts'), 'utf8');
    const registered = [...extensionSource.matchAll(/vscode\.lm\.registerTool\('([^']+)'/g)].map(match => match[1]);
    assert.ok(registered.length > 0, 'extension.ts should register at least one language model tool.');
    for (const name of registered) {
      assert.ok(declared.has(name), `extension.ts registers tool "${name}" but package.json does not declare it in languageModelTools.`);
      assert.ok(toolActivations.includes(name), `extension.ts registers tool "${name}" but package.json has no matching onLanguageModelTool activation event.`);
    }
  });
});

function findExtension(): vscode.Extension<unknown> {
  const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'x-audio');
  assert.ok(extension, 'x-audio extension should be available in extension tests.');
  if (!extension) {
    throw new Error('x-audio extension not found.');
  }
  return extension;
}

function readNls(extensionPath: string, fileName: string): Record<string, string> {
  const filePath = path.join(extensionPath, fileName);
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content) as Record<string, string>;
}
