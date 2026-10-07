import * as assert from 'assert';

import type { TaskStatusesSnapshot } from '../ui/protocol/taskStatuses';
import { openWebviewPage, type WebviewPage } from './webviewPage';
import { renderPage } from './pages';

/**
 * Edit Task Statuses: the statuses as rows to edit, Todo's and Done's
 * characters fixed, checked as they are typed, and saved together.
 */
suite('Edit Task Statuses page', () => {
  let page: WebviewPage | undefined;

  teardown(() => {
    page?.dispose();
    page = undefined;
  });

  const SNAPSHOT: TaskStatusesSnapshot = {
    statuses: [
      { symbol: ' ', name: 'Todo', type: 'todo', next: 'x' },
      { symbol: '/', name: 'In progress', type: 'inProgress', next: 'x' },
      { symbol: 'x', name: 'Done', type: 'done', next: ' ' },
    ],
    checkboxClick: 'done',
    found: [{ symbol: '?', count: 3 }],
    canImport: true,
    target: 'user',
  };

  const open = (snapshot: TaskStatusesSnapshot = SNAPSHOT): WebviewPage => {
    page = openWebviewPage(renderPage('taskStatuses'), snapshot);
    return page;
  };

  /** Types into a row's field, as the reader does. */
  const type = (shown: WebviewPage, row: number, field: string, value: string): void => {
    const input = shown.find(`[data-row="${row}"][data-field="${field}"]`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new shown.window.Event('input', { bubbles: true }));
  };

  test('each status is a row; Todo and Done keep their characters and types', () => {
    const shown = open();
    const rows = shown.findAll('.status-table tbody tr');
    assert.strictEqual(rows.length, 3);
    assert.strictEqual(rows[0].querySelector('.status-symbol')?.textContent, '[ ]', 'Todo\'s character is written, not a field');
    assert.ok(rows[1].querySelector('[data-field="symbol"]'), 'In progress\'s character can be changed');
    assert.strictEqual(rows[2].querySelector('.status-remove'), null, 'Done cannot be removed');
    assert.strictEqual(shown.findAll('th').some((cell) => cell.textContent === 'Next'), false, 'Next shows only in the workflow');
    assert.ok((shown.find('[data-action="save"]') as HTMLButtonElement).disabled, 'nothing to save yet');
  });

  test('a problem shows as it is typed, and keeps Save off until it is put right', () => {
    const shown = open();
    type(shown, 1, 'symbol', 'x');
    // The first status with a character keeps it, as Obsidian reads a list.
    assert.strictEqual(shown.text('.status-problems'), "Done: [x] is already In progress's character.");
    assert.ok((shown.find('[data-action="save"]') as HTMLButtonElement).disabled);
    type(shown, 1, 'symbol', '/');
    assert.strictEqual(shown.findAll('.status-problems').length, 0);
    assert.strictEqual((shown.find('[data-action="save"]') as HTMLButtonElement).disabled, false);
  });

  test('the characters found in notes are added as rows to name, and Save sends the list', () => {
    const shown = open();
    shown.click('[data-action="add-found"]');
    assert.strictEqual(shown.findAll('.status-table tbody tr').length, 4);
    type(shown, 3, 'name', 'Question');
    shown.click('[data-action="save"]');
    assert.deepStrictEqual(shown.lastPosted('saveTaskStatuses'), {
      type: 'saveTaskStatuses',
      statuses: [...SNAPSHOT.statuses, { symbol: '?', name: 'Question', type: 'todo' }],
    });
  });

  test('asked for a new row, the page adds it once, keeps it as the host redraws, and asks for its character', () => {
    const asked = { ...SNAPSHOT, newRow: { id: 1, name: 'Review', type: 'onHold' as const } };
    const shown = open(asked);
    const names = () => shown.findAll('.status-table tbody tr').map((row) => (row.querySelector('[data-field="name"]') as HTMLInputElement).value);
    assert.deepStrictEqual(names(), ['Todo', 'In progress', 'Done', 'Review']);
    assert.match(shown.text('.status-problems') ?? '', /Review: Give it a character\./);
    type(shown, 3, 'symbol', 'r');
    shown.send(asked);
    assert.deepStrictEqual(names(), ['Todo', 'In progress', 'Done', 'Review'], 'the same request is not added twice');
    assert.strictEqual((shown.find('[data-row="3"][data-field="symbol"]') as HTMLInputElement).value, 'r', 'and what was typed is kept');
    shown.click('[data-action="save"]');
    const saved = shown.lastPosted('saveTaskStatuses') as { statuses: unknown[] } | undefined;
    assert.deepStrictEqual(saved?.statuses.at(-1), { name: 'Review', type: 'onHold', symbol: 'r' });
  });

  test('in the workflow, each row has its next character, and the page draws where a click leads', () => {
    const shown = open({ ...SNAPSHOT, checkboxClick: 'workflow' });
    assert.ok(shown.findAll('th').some((cell) => cell.textContent === 'Next'));
    assert.deepStrictEqual(shown.findAll('.status-workflow li').map((item) => item.textContent), [
      '[ ] Todo → [x] Done',
      '[/] In progress → [x] Done',
      '[x] Done → [ ] Todo',
    ]);
  });
});
