import * as assert from 'assert';

import { buildRowActions, STAYING_ACTIONS } from '../ui/commands/quickFindActions';
import { rowKey } from '../ui/commands/quickFind';
import { QuickFindItem } from '../ui/state/quickFindState';

const ids = (item: QuickFindItem, context = {}) =>
  buildRowActions(item, { platform: 'darwin', ...context }).map((group) => [
    group.label,
    group.actions.map((action) => `${action.label}${action.description ? ` (${action.description})` : ''}`),
  ]);

suite('What a Find row can do', () => {
  test('a note opens, links, and pins', () => {
    const note: QuickFindItem = { kind: 'note', label: 'Next', filePath: 'a.md', line: 3, sectionId: 's1' };
    assert.deepStrictEqual(ids(note), [
      ['Open', ['Open (Enter)', 'Open to the side (⌘Enter)']],
      ['Link', ['Insert a link at the cursor (⌥Enter)', 'Copy a link']],
      ['Home', ['Pin to Home']],
    ]);
    assert.deepStrictEqual(ids(note, { pinned: true })[2], ['Home', ['Unpin from Home']]);
  });

  test('an open task completes and takes a date; a done one reopens', () => {
    const task: QuickFindItem = { kind: 'task', label: 'Call Ren', filePath: 'a.md', line: 4, taskId: 't1' };
    assert.deepStrictEqual(ids(task), [
      ['Open', ['Open (Enter)', 'Open to the side (⌘Enter)', 'Edit task…']],
      ['Task', ['Complete', 'Due today', 'Due tomorrow', 'Due on a date…', 'No due date']],
      ['Link', ['Insert a link to its heading (⌥Enter)']],
    ]);
    assert.deepStrictEqual(ids({ ...task, completed: true })[1], ['Task', ['Reopen']]);
    assert.deepStrictEqual(ids(task, { canMove: true })[2], ['Move', ['Move to…']]);
  });

  test('a tag, a recent search, and a saved search', () => {
    assert.deepStrictEqual(ids({ kind: 'tag', label: '#a', tagKey: '#a' }, { favorite: true }), [
      ['Tag', ['Open its page (Enter)', 'Add to the search (Tab)', 'Remove from favorites', 'Rename tag…']],
    ]);
    assert.deepStrictEqual(ids({ kind: 'recent', label: 'is:open', query: 'is:open' }), [
      ['Search', ['Search for it (Enter)', 'Save search', 'Remove from recent searches']],
    ]);
    assert.deepStrictEqual(ids({ kind: 'savedView', label: 'Open work', savedFilterId: 'v1' }), [
      ['Saved search', ['Open (Enter)', 'Put its search in the box (Tab)']],
    ]);
  });

  test('an action that changes nothing on screen returns to Find, and a row is known again by what it opens', () => {
    assert.ok(STAYING_ACTIONS.has('complete'));
    assert.ok(!STAYING_ACTIONS.has('open'));
    assert.strictEqual(rowKey({ kind: 'task', label: 'x', taskId: 't1', line: 9 }), 'task:t1');
    assert.strictEqual(rowKey({ kind: 'note', label: 'x', sectionId: 's1' }), 'note:s1');
  });
});
