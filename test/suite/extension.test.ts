import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension', () => {
  test('registers MiniMax TTS commands', async () => {
    const extension = findMiniMaxTtsExtension();
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('minimaxTts.speakSelection'));
    assert.ok(commands.includes('minimaxTts.speakInput'));
    assert.ok(commands.includes('minimaxTts.setApiKey'));
    assert.ok(commands.includes('minimaxTts.stop'));
    assert.ok(!commands.includes('minimaxTts.clearApiKey'));
    assert.ok(!commands.includes('minimaxTts.setApiHost'));
    assert.ok(!commands.includes('minimaxTts.diagnose'));
    assert.ok(!commands.includes('minimaxTts.testConnection'));
  });

  test('hides non-setup commands from the command palette', async () => {
    const extension = findMiniMaxTtsExtension();
    await extension.activate();

    const commandPaletteMenus = extension.packageJSON.contributes.menus.commandPalette as Array<{
      readonly command: string;
      readonly when: string;
    }>;

    assert.deepEqual(commandPaletteMenus, [
      {
        command: 'minimaxTts.speakSelection',
        when: 'false'
      },
      {
        command: 'minimaxTts.speakInput',
        when: 'false'
      },
      {
        command: 'minimaxTts.pause',
        when: 'false'
      },
      {
        command: 'minimaxTts.stop',
        when: 'false'
      }
    ]);
  });
});

function findMiniMaxTtsExtension(): vscode.Extension<unknown> {
  const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'minimax-tts');
  assert.ok(extension, 'MiniMax TTS extension should be available in extension tests.');
  return extension;
}
