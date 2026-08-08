import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension', () => {
  test('registers AudioPlugin commands', async () => {
    const extension = findAudioPluginExtension();
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('audioplugin.speakSelection'));
    assert.ok(commands.includes('audioplugin.setApiKey'));
    assert.ok(commands.includes('audioplugin.stop'));
    assert.ok(!commands.includes('audioplugin.clearApiKey'));
    assert.ok(!commands.includes('audioplugin.setApiHost'));
    assert.ok(!commands.includes('audioplugin.diagnose'));
    assert.ok(!commands.includes('audioplugin.testConnection'));
  });

  test('hides non-setup commands from the command palette until playback starts', async () => {
    const extension = findAudioPluginExtension();
    await extension.activate();

    const commandPaletteMenus = extension.packageJSON.contributes.menus.commandPalette as Array<{
      readonly command: string;
      readonly when: string;
    }>;

    assert.deepEqual(commandPaletteMenus, [
      {
        command: 'audioplugin.speakSelection',
        when: 'false'
      },
      {
        command: 'audioplugin.pause',
        when: 'audioplugin.playing'
      },
      {
        command: 'audioplugin.stop',
        when: 'audioplugin.playing'
      }
    ]);
  });
});

function findAudioPluginExtension(): vscode.Extension<unknown> {
  const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'audioplugin-tts');
  assert.ok(extension, 'AudioPlugin extension should be available in extension tests.');
  return extension;
}
