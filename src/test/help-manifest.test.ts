import * as assert from 'assert';

import {
  describeHelpCommands,
  HelpManifest,
  isRunnableFromHelp,
  linkCommandNames,
} from '../ui/webview/pages/help/helpManifest';

/** Four Deckard commands and one of another extension's, as a manifest lists them. */
const manifest: HelpManifest = {
  commands: [
    { command: 'deckard.searchWorkspace', title: 'Find in Notes', category: 'Deckard' },
    { command: 'deckard.editTask', title: 'Edit Task', category: 'Deckard' },
    { command: 'deckard.agenda.moveTo', title: 'Move To…', category: 'Deckard' },
    { command: 'deckard.renameTag', title: 'Rename Tag', category: 'Deckard' },
    { command: 'deckard.renameTagAgain', title: 'Rename Tag', category: 'Deckard' },
    { command: 'other.thing', title: 'Thing', category: 'Other' },
  ],
  menus: {
    commandPalette: [
      { command: 'deckard.editTask', when: 'editorLangId == markdown' },
      { command: 'deckard.agenda.moveTo', when: 'false' },
    ],
  },
};

suite('Help manifest', () => {
  test('names each Deckard command once, by its title, with whether Help may run it', () => {
    const commands = describeHelpCommands(manifest);
    assert.deepStrictEqual([...commands.keys()], ['Find in Notes', 'Edit Task', 'Move To…', 'Rename Tag']);
    assert.deepStrictEqual(commands.get('Find in Notes'), { command: 'deckard.searchWorkspace', runnable: true });
    assert.strictEqual(commands.get('Edit Task')?.runnable, false, 'it needs a note in the editor');
    assert.strictEqual(commands.get('Move To…')?.runnable, false, 'the palette hides it');
    assert.deepStrictEqual(commands.get('Rename Tag'), { command: 'deckard.renameTag', runnable: true }, 'the first of a title');
  });

  test('runs from Help only a command it names and may run', () => {
    assert.strictEqual(isRunnableFromHelp(manifest, 'deckard.searchWorkspace'), true);
    assert.strictEqual(isRunnableFromHelp(manifest, 'deckard.editTask'), false);
    assert.strictEqual(isRunnableFromHelp(manifest, 'deckard.agenda.moveTo'), false);
    assert.strictEqual(isRunnableFromHelp(manifest, 'deckard.renameTagAgain'), false, 'a title already taken is not named');
    assert.strictEqual(isRunnableFromHelp(manifest, 'other.thing'), false);
    assert.strictEqual(isRunnableFromHelp({}, 'deckard.searchWorkspace'), false);
  });

  test('turns a command a guide page names into its button, or leaves it as written', () => {
    const html = linkCommandNames(
      '<p><code>Deckard: Find in Notes</code>, <strong>Deckard: Rename Tag</strong>, <code>Deckard: Edit Task</code>, and <code>Deckard: Not a Command</code>.</p>',
      describeHelpCommands(manifest),
    );
    assert.strictEqual(
      html,
      '<p><button type="button" class="command-link" data-command="deckard.searchWorkspace">Deckard: Find in Notes</button>, ' +
        '<button type="button" class="command-link" data-command="deckard.renameTag">Deckard: Rename Tag</button>, ' +
        '<code>Deckard: Edit Task</code>, and <code>Deckard: Not a Command</code>.</p>',
    );
  });
});
