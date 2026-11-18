import * as assert from 'assert';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { WorkspaceIndex } from '../domain/model';
import { createQueryContext } from '../domain/query/queryContext';
import { createTaskBoard, type TaskBoardOptions } from '../ui/state/taskBoardState';
import { narrowTaskBoardMessage } from '../ui/webview/pages/taskBoard/messages';
import { createPreferences } from './preferenceServices';

/** An index of the notes given, each as its lines. */
function indexOf(notes: Record<string, readonly string[]>): WorkspaceIndex {
  return buildWorkspaceIndex(new Map(Object.entries(notes).map(([file, lines]) => [file, parseMarkdown(file, lines.join('\n'))])));
}

const index = indexOf({
  'work.md': ['# Work #project/atlas', '- [ ] draft', '- [/] review', '- [x] ship', '- [x] announce', '- [-] dropped'],
});

const options: TaskBoardOptions = {
  queryContext: createQueryContext(new Date(2026, 9, 6).getTime()),
  format: 'emoji',
};

/** The stored preferences, as a fresh reader has them, with the layout given. */
function preferencesFor(layout: 'board' | 'table') {
  const store = createPreferences({ get: () => undefined, keys: () => [], update: async () => undefined } as never);
  const preferences = { ...store.reader.value, taskBoardLayout: layout };
  store.repository.dispose();
  return preferences;
}

suite('Task board: Hide done tasks', () => {
  test('the board draws Done and its cards until done tasks are hidden, then neither', () => {
    const preferences = preferencesFor('board');
    const shown = createTaskBoard({ index, preferences, search: { query: '' }, options });
    assert.strictEqual(shown.settings.hideDone, false);
    assert.strictEqual(shown.columns.find((column) => column.id === 'done')?.cards.length, 2);
    assert.strictEqual(shown.taskCount, 5);

    const hidden = createTaskBoard({ index, preferences, search: { query: '' }, options: { ...options, hideDone: true } });
    assert.strictEqual(hidden.settings.hideDone, true);
    assert.strictEqual(hidden.columns.find((column) => column.id === 'done'), undefined, 'no Done column');
    assert.ok(hidden.columns.flatMap((column) => column.cards).every((card) => !card.completed), 'and no done card anywhere');
    assert.strictEqual(hidden.taskCount, 3, 'the count leaves them out too');
  });

  test('the table leaves out done rows while they are hidden', () => {
    const preferences = preferencesFor('table');
    const shown = createTaskBoard({ index, preferences, search: { query: '' }, options });
    assert.strictEqual(shown.table?.rows.filter((row) => row.completed).length, 2);
    const hidden = createTaskBoard({ index, preferences, search: { query: '' }, options: { ...options, hideDone: true } });
    assert.strictEqual(hidden.table?.rows.length, 3);
    assert.ok(hidden.table?.rows.every((row) => !row.completed));
  });

  test('the page may ask to hide or show them, and nothing else', () => {
    assert.deepStrictEqual(narrowTaskBoardMessage({ type: 'setBoardHideDone', hide: true }), { type: 'setBoardHideDone', hide: true });
    assert.strictEqual(narrowTaskBoardMessage({ type: 'setBoardHideDone', hide: 'yes' }), undefined);
  });
});
