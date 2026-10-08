import * as assert from 'assert';

import {
  describeFailure,
  describeRejectedEdit,
  describeStale,
  settingLabel,
} from '../ui/commands/notify';

suite('Messages', () => {
  test('a failure puts the fix after the outcome, and Open Log last only with an error', () => {
    const action = { title: 'Open Note', run: () => undefined };
    assert.deepStrictEqual(
      describeFailure({ outcome: 'Deckard could not save a.md.', fix: 'Save it.', action }),
      { text: 'Deckard could not save a.md. Save it.', buttons: ['Open Note'] },
    );
    const failure = describeFailure({
      outcome: 'Deckard could not open b.md.',
      error: new Error('EACCES: permission denied'),
      action,
    });
    assert.deepStrictEqual(failure.buttons, ['Open Note', 'Open Log']);
    assert.ok(!failure.text.includes('EACCES'), 'the raw error goes to the log, not the message');
  });

  test('a refused edit names the note and says what to check', () => {
    const { outcome, fix } = describeRejectedEdit('a.md');
    assert.strictEqual(outcome, 'VS Code did not accept the change to a.md, so nothing was written.');
    assert.match(fix ?? '', /read-only/);
  });

  test('a note that changed underneath is said one way', () => {
    assert.strictEqual(
      describeStale(['a.md']),
      'a.md changed after Deckard last read it, so nothing was written.',
    );
    assert.strictEqual(
      describeStale(['a.md', 'b.md', 'c.md']),
      '3 notes changed after Deckard last read them, so nothing was written.',
    );
  });

  test('a setting is named as the Settings editor labels it', () => {
    assert.strictEqual(settingLabel('exclude'), 'Exclude');
    assert.strictEqual(settingLabel('tasks.viewQuery'), 'Tasks: View Query');
    assert.strictEqual(settingLabel('deckard.tasks.viewQuery'), 'Tasks: View Query');
    assert.strictEqual(settingLabel('mcpServer.port'), 'MCP Server: Port');
    assert.strictEqual(settingLabel('templatesFolder'), 'Templates Folder');
    assert.strictEqual(settingLabel('me'), 'Me');
  });
});
