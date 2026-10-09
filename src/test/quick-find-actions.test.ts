import * as assert from 'assert';

import { Task } from '../domain/model';
import {
  buildRowActions,
  ROW_ACTIONS,
  RowActionHost,
  RowActionId,
  rowKey,
  STAYING_ACTIONS,
} from '../ui/commands/quickFindActions';
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
    assert.strictEqual(
      rowKey({ kind: 'tag', answer: 'person', label: 'Dana Whitfield', tagKey: '@dana' }),
      'answer:@dana:Dana Whitfield',
      'an answer is known apart from the same tag under Tags',
    );
  });

  test('the actions that need the row\'s task, and the ones that stay, are the table\'s', () => {
    const where = (fact: 'needsTask' | 'staysOpen') =>
      (Object.keys(ROW_ACTIONS) as RowActionId[]).filter((id) => ROW_ACTIONS[id][fact]).sort();
    assert.deepStrictEqual(where('needsTask'), [
      'complete', 'dueDate', 'dueToday', 'dueTomorrow', 'editTask', 'moveTo', 'noDue', 'reopen',
    ]);
    assert.deepStrictEqual(where('staysOpen'), [...STAYING_ACTIONS].sort());
    assert.deepStrictEqual([...STAYING_ACTIONS].sort(), [
      'addToSearch', 'complete', 'copyLink', 'dueDate', 'dueToday', 'dueTomorrow', 'favorite',
      'noDue', 'pin', 'putInBox', 'removeRecent', 'reopen', 'unfavorite', 'unpin',
    ]);
  });
});

/** A host that records what each action asked of it, with Find open unless `open` says not. */
function recordingHost(open = true): { host: RowActionHost; calls: string[] } {
  const calls: string[] = [];
  const record = (call: string) => {
    calls.push(call);
  };
  const host: RowActionHost = {
    isOpen: () => open,
    hide: () => record('hide'),
    show: async (query, activeKey) => record(`show ${query}${activeKey ? ` at ${activeKey}` : ''}`),
    openItem: async (item, beside) => record(`open ${item.label}${beside ? ' beside' : ''}`),
    openSavedFilter: async (filterId) => record(`open view ${filterId}`),
    openTag: async (tagKey) => record(`open tag ${tagKey}`),
    insertLink: async (filePath) => record(`insert link ${filePath}`),
    copyLink: async (filePath) => record(`copy link ${filePath}`),
    editTask: async (task) => record(`edit ${task.title}`),
    renameTag: async (tagKey) => record(`rename ${tagKey}`),
    saveSearch: async (query) => record(`save ${query}`),
    pins: {
      pin: async (filePath, line) => {
        record(`pin ${filePath}:${line}`);
        return { kind: 'no-entry' };
      },
      unpin: async (filePath, line) => {
        record(`unpin ${filePath}:${line}`);
        return { kind: 'no-entry' };
      },
    },
    preferences: {
      favorites: { toggleFavorite: async (tagKey) => record(`favorite ${tagKey}`) },
      savedSearches: { removeRecentQuery: async (query) => record(`forget ${query}`) },
    },
    tasks: {
      toggle: async (task, completed) => record(`${completed ? 'complete' : 'reopen'} ${task.title}`),
      setDue: async (task, date) => record(`due ${task.title} ${date ?? 'none'}`),
      askForDueDate: async () => '2026-10-02',
      dueDate: (day) => (day === 'today' ? '2026-09-25' : '2026-09-26'),
    },
  };
  return { host, calls };
}

suite('What a Find row action does', () => {
  const task = { id: 't1', title: 'Call Ren', filePath: 'a.md', lineNumber: 4 } as Task;
  const taskRow: QuickFindItem = { kind: 'task', label: 'Call Ren', filePath: 'a.md', line: 4, taskId: 't1' };
  const noteRow: QuickFindItem = { kind: 'note', label: 'Next', filePath: 'a.md', line: 3, sectionId: 's1' };

  /** Runs `id` on `item` and says what it asked for, a return to Find written as `back`. */
  async function run(id: RowActionId, item: QuickFindItem, open = true): Promise<string[]> {
    const { host, calls } = recordingHost(open);
    await ROW_ACTIONS[id].run(item, {
      host,
      task: item.taskId ? task : undefined,
      returnTo: 'atlas',
      back: async () => {
        calls.push('back');
      },
    });
    return calls;
  }

  test('an action that stays writes, then returns to Find', async () => {
    assert.deepStrictEqual(await run('pin', noteRow), ['pin a.md:3', 'back']);
    assert.deepStrictEqual(await run('unpin', noteRow), ['unpin a.md:3', 'back']);
    assert.deepStrictEqual(await run('copyLink', noteRow), ['copy link a.md', 'back']);
    assert.deepStrictEqual(await run('dueToday', taskRow), ['due Call Ren 2026-09-25', 'back']);
    assert.deepStrictEqual(await run('dueTomorrow', taskRow), ['due Call Ren 2026-09-26', 'back']);
    assert.deepStrictEqual(await run('noDue', taskRow), ['due Call Ren none', 'back']);
    assert.deepStrictEqual(await run('dueDate', taskRow), ['due Call Ren 2026-10-02', 'back']);
    assert.deepStrictEqual(await run('favorite', { kind: 'tag', label: '#a', tagKey: 'a' }), ['favorite a', 'back']);
  });

  test('completing stays in an open Find, which redraws the row, and returns only once it has closed', async () => {
    assert.deepStrictEqual(await run('complete', taskRow), ['complete Call Ren']);
    assert.deepStrictEqual(await run('reopen', taskRow, false), ['reopen Call Ren', 'back']);
  });

  test('an action that goes somewhere hides Find first', async () => {
    assert.deepStrictEqual(await run('open', noteRow), ['hide', 'open Next']);
    assert.deepStrictEqual(await run('open', { kind: 'savedView', label: 'Open work', savedFilterId: 'v1' }), [
      'hide',
      'open view v1',
    ]);
    assert.deepStrictEqual(await run('editTask', taskRow), ['hide', 'edit Call Ren']);
    assert.deepStrictEqual(await run('insertLink', noteRow), ['hide', 'insert link a.md']);
    assert.deepStrictEqual(await run('renameTag', { kind: 'tag', label: '#a', tagKey: 'a' }), ['hide', 'rename a']);
    assert.deepStrictEqual(await run('saveSearch', { kind: 'recent', label: 'x', query: 'is:open' }), [
      'hide',
      'save is:open',
    ]);
    assert.deepStrictEqual(await run('moveTo', taskRow), [], 'no Move to… without its host');
  });

  test('the search actions put a search in the box', async () => {
    const tag: QuickFindItem = { kind: 'tag', label: '#a', tagKey: 'a', completion: '#a ' };
    assert.deepStrictEqual(await run('addToSearch', tag), ['show #a  at tag:a']);
    assert.deepStrictEqual(await run('search', { kind: 'recent', label: 'x', query: 'is:open' }), ['show is:open']);
    assert.deepStrictEqual(await run('removeRecent', { kind: 'recent', label: 'x', query: 'is:open' }), [
      'forget is:open',
      'show atlas',
    ]);
    assert.deepStrictEqual(await run('openBeside', noteRow, false), ['show atlas at note:s1', 'open Next beside']);
    assert.deepStrictEqual(await run('openBeside', noteRow), ['open Next beside']);
  });
});
