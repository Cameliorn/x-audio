import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension', () => {
  test('registers x-audio commands', async () => {
    const extension = findXAudioExtension();
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('xaudio.speakSelection'));
    assert.ok(commands.includes('xaudio.setApiKey'));
    assert.ok(commands.includes('xaudio.stop'));
    assert.ok(!commands.includes('xaudio.clearApiKey'));
    assert.ok(!commands.includes('xaudio.setApiHost'));
    assert.ok(!commands.includes('xaudio.diagnose'));
    assert.ok(!commands.includes('xaudio.testConnection'));
  });

  test('hides non-setup commands from the command palette until playback starts', async () => {
    const extension = findXAudioExtension();
    await extension.activate();

    const commandPaletteMenus = extension.packageJSON.contributes.menus.commandPalette as Array<{
      readonly command: string;
      readonly when: string;
    }>;

    assert.deepEqual(commandPaletteMenus, [
      {
        command: 'xaudio.speakSelection',
        when: 'false'
      },
      {
        command: 'xaudio.pause',
        when: 'xaudio.playing'
      },
      {
        command: 'xaudio.stop',
        when: 'xaudio.playing'
      }
    ]);
  });
});

function findXAudioExtension(): vscode.Extension<unknown> {
  const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'x-audio');
  assert.ok(extension, 'x-audio extension should be available in extension tests.');
  return extension;
}
