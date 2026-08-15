import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { fileExists } from '../common/fileUtils';
import { cleanupBrowserProfileDirs } from '../player/externalAudioPlayer';

suite('externalAudioPlayer', () => {
  test('cleans up old browser profiles but keeps the current one', async () => {
    const root = vscode.Uri.file(path.join(os.tmpdir(), `xaudio-profile-test-${Date.now()}-${Math.random()}`));
    const current = vscode.Uri.joinPath(root, 'session-current');
    const old = vscode.Uri.joinPath(root, 'session-old');
    await vscode.workspace.fs.createDirectory(current);
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(current, 'state'), Buffer.from('current'));
    await vscode.workspace.fs.createDirectory(old);
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(old, 'state'), Buffer.from('old'));

    await cleanupBrowserProfileDirs(root, current.fsPath);

    assert.equal(await fileExists(current), true);
    assert.equal(await fileExists(old), false);
    try {
      await vscode.workspace.fs.delete(root, {
        recursive: true,
        useTrash: false
      });
    } catch {
      // 清理测试根目录失败不影响断言
    }
  });
});
