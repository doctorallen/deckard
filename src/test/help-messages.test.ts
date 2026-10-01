import * as assert from 'assert';

import { narrowHelpMessage } from '../ui/webview/pages/help/messages';
import { narrowRelatedNotesDebugMessage } from '../ui/webview/pages/relatedNotesDebug/messages';

// The Help page's narrowing table, with the payloads parseHelpMessage was
// held to before it moved, and the debug page's, which refuses everything.
suite('Help messages', () => {
  test('Help asks only for a page by name', () => {
    assert.deepStrictEqual(narrowHelpMessage({ type: 'openGuide', page: 'tasks', anchor: 'task-metadata' }), {
      type: 'openGuide',
      page: 'tasks',
      anchor: 'task-metadata',
    });
    assert.strictEqual(narrowHelpMessage({ type: 'openGuide', page: '../../package' }), undefined);
    assert.strictEqual(narrowHelpMessage({ type: 'openGuide', page: 'tasks', anchor: 'a"b' }), undefined);
  });

  test('accepts what its buttons and links post, keeping only what the host reads', () => {
    assert.deepStrictEqual(
      narrowHelpMessage({ type: 'runCommand', command: 'deckard.searchWorkspace', args: [1] }),
      { type: 'runCommand', command: 'deckard.searchWorkspace' },
    );
    assert.deepStrictEqual(narrowHelpMessage({ type: 'openChangelog', extra: true }), { type: 'openChangelog' });
    assert.deepStrictEqual(
      narrowHelpMessage({ type: 'openGuide', page: 'task-board', extra: 1 }),
      { type: 'openGuide', page: 'task-board' },
    );
  });

  test('refuses anything its buttons and links could not have posted', () => {
    for (const message of [
      undefined,
      'openChangelog',
      { type: 1 },
      { type: 'constructor' },
      { type: 'openHelp' },
      { type: 'runCommand' },
      { type: 'runCommand', command: 'workbench.action.quit' },
      { type: 'runCommand', command: 'deckard.' },
      { type: 'runCommand', command: 'deckard.show Stats' },
      { type: 'openGuide' },
      { type: 'openGuide', page: '' },
      { type: 'openGuide', page: 'tasks.md' },
      { type: 'openGuide', page: 'tasks', anchor: 7 },
      { type: 'openGuide', page: 'tasks', anchor: '' },
    ]) {
      assert.strictEqual(narrowHelpMessage(message), undefined, JSON.stringify(message));
    }
  });

  test('the debug page sends nothing, so nothing is accepted from it', () => {
    for (const message of [{ type: 'openSource', filePath: 'notes/first.md', line: 1 }, { type: 'constructor' }, {}]) {
      assert.strictEqual(narrowRelatedNotesDebugMessage(message), undefined, JSON.stringify(message));
    }
  });
});
