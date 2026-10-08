import * as assert from 'assert';

import { narrowTaskBoardMessage } from '../ui/webview/pages/taskBoard/messages';

// The Task Board's narrowing table, with the payloads parseTaskBoardMessage
// was held to before it moved, in task-board, tag-board, and
// task-steps-commands: each accepted message, and each refused one.
suite('Task Board messages', () => {
  test('accepts the table messages, and refuses a column it does not have', () => {
    assert.deepStrictEqual(
      narrowTaskBoardMessage({ type: 'setTaskLayout', layout: 'table' }),
      { type: 'setTaskLayout', layout: 'table' },
    );
    assert.deepStrictEqual(
      narrowTaskBoardMessage({ type: 'setTableSort', column: 'due' }),
      { type: 'setTableSort', column: 'due' },
    );
    assert.deepStrictEqual(narrowTaskBoardMessage({ type: 'setTableSort' }), { type: 'setTableSort' });
    assert.strictEqual(narrowTaskBoardMessage({ type: 'setTableSort', column: 'color' }), undefined);
    assert.deepStrictEqual(
      narrowTaskBoardMessage({ type: 'setTableColumns', columns: ['title', 'due'] }),
      { type: 'setTableColumns', columns: ['title', 'due'] },
    );
    assert.strictEqual(narrowTaskBoardMessage({ type: 'setTableColumns', columns: ['due', 7] }), undefined);
  });

  test('accepts the Task Board’s layout, ranking, and settings messages', () => {
    assert.deepStrictEqual(
      narrowTaskBoardMessage({ type: 'setTaskLayout', layout: 'board' }),
      { type: 'setTaskLayout', layout: 'board' },
    );
    assert.strictEqual(narrowTaskBoardMessage({ type: 'setTaskLayout', layout: 'grid' }), undefined);
    assert.strictEqual(narrowTaskBoardMessage({ type: 'setTaskLayout', layout: 'list' }), undefined, 'the list layout is gone');
    assert.strictEqual(
      narrowTaskBoardMessage({ type: 'setTaskFilter', filter: 'completed' }),
      undefined,
      'the board searches instead of filtering, so it sends no filter',
    );
    assert.deepStrictEqual(
      narrowTaskBoardMessage({ type: 'setTaskSort', mode: 'created' }),
      { type: 'setTaskSort', mode: 'created' },
    );
    assert.deepStrictEqual(
      narrowTaskBoardMessage({ type: 'reorderTasks', taskIds: ['b', 'a'] }),
      { type: 'reorderTasks', taskIds: ['b', 'a'] },
    );
    assert.deepStrictEqual(
      narrowTaskBoardMessage({ type: 'setBoardColumnOrder', names: ['Waiting', 'In progress'] }),
      { type: 'setBoardColumnOrder', names: ['Waiting', 'In progress'] },
    );
    assert.strictEqual(narrowTaskBoardMessage({ type: 'setBoardColumnOrder', names: ['Waiting', ''] }), undefined, 'a status has a name');
    assert.strictEqual(narrowTaskBoardMessage({ type: 'setBoardColumnOrder', names: 'Waiting' }), undefined);
    assert.deepStrictEqual(
      narrowTaskBoardMessage({ type: 'setBoardColumnShown', name: 'Cancelled', shown: true }),
      { type: 'setBoardColumnShown', name: 'Cancelled', shown: true },
    );
    assert.strictEqual(narrowTaskBoardMessage({ type: 'setBoardColumnShown', name: 'Cancelled', shown: 'yes' }), undefined);
    assert.deepStrictEqual(narrowTaskBoardMessage({ type: 'editTaskStatuses', newStatus: true }), { type: 'editTaskStatuses', newStatus: true });
    assert.deepStrictEqual(narrowTaskBoardMessage({ type: 'editTaskStatuses' }), { type: 'editTaskStatuses' });
    assert.deepStrictEqual(narrowTaskBoardMessage({ type: 'moveStatusTags' }), { type: 'moveStatusTags' });
    for (const gone of [{ type: 'setBoardStatuses', statuses: ['todo'] }, { type: 'setBoardShowCancelled', show: true }, { type: 'setBoardStatusNamespace', namespace: 'stage' }]) {
      assert.strictEqual(narrowTaskBoardMessage(gone), undefined, `${gone.type} is gone`);
    }
    assert.deepStrictEqual(
      narrowTaskBoardMessage({ type: 'moveTask', taskId: 'a', column: 'status:doing' }),
      { type: 'moveTask', taskId: 'a', column: 'status:doing' },
    );
    assert.strictEqual(
      narrowTaskBoardMessage({ type: 'moveTask', taskId: 'a', column: '' }),
      undefined,
    );
  });

  test('takes a tag grouping only with a namespace, and a move with where it came from', () => {
    assert.deepStrictEqual(narrowTaskBoardMessage({ type: 'setBoardGroup', groupBy: 'tag', namespace: 'context' }), {
      type: 'setBoardGroup',
      groupBy: 'tag',
      namespace: 'context',
    });
    assert.strictEqual(narrowTaskBoardMessage({ type: 'setBoardGroup', groupBy: 'tag' }), undefined);
    assert.strictEqual(narrowTaskBoardMessage({ type: 'setBoardGroup', groupBy: 'tag', namespace: 'a b' }), undefined);
    assert.deepStrictEqual(
      narrowTaskBoardMessage({ type: 'moveTask', taskId: 't', column: 'tag:context/phone', from: 'tag:context/' }),
      { type: 'moveTask', taskId: 't', column: 'tag:context/phone', from: 'tag:context/' },
    );
    assert.strictEqual(narrowTaskBoardMessage({ type: 'moveTask', taskId: 't', column: 'done', from: 3 }), undefined);
  });

  test('asks for steps with the task id alone', () => {
    assert.deepStrictEqual(narrowTaskBoardMessage({ type: 'breakIntoSteps', taskId: 'task-1' }), {
      type: 'breakIntoSteps',
      taskId: 'task-1',
    });
    assert.strictEqual(narrowTaskBoardMessage({ type: 'breakIntoSteps' }), undefined);
    assert.strictEqual(narrowTaskBoardMessage({ type: 'breakIntoSteps', taskId: 'x', extra: 1 }), undefined);
  });

  test('keeps a move’s number, and makes a move without one, or with one that is not a number', () => {
    assert.deepStrictEqual(
      narrowTaskBoardMessage({ type: 'moveTask', taskId: 'a', column: 'done', from: 'status:', requestId: 3 }),
      { type: 'moveTask', taskId: 'a', column: 'done', from: 'status:', requestId: 3 },
    );
    for (const requestId of ['3', 1.5, null, Number.MAX_SAFE_INTEGER + 1]) {
      assert.deepStrictEqual(
        narrowTaskBoardMessage({ type: 'moveTask', taskId: 'a', column: 'done', requestId }),
        { type: 'moveTask', taskId: 'a', column: 'done' },
        String(requestId),
      );
    }
  });

  test('keeps only the fields the host reads', () => {
    assert.deepStrictEqual(
      narrowTaskBoardMessage({ type: 'openSource', filePath: 'notes/tasks.md', line: 3, beside: false, pin: true, extra: 1 }),
      { type: 'openSource', filePath: 'notes/tasks.md', line: 3, pin: true },
    );
    assert.deepStrictEqual(narrowTaskBoardMessage({ type: 'openTag', tagKey: '#project/atlas', extra: 1 }), { type: 'openTag', tagKey: '#project/atlas' });
    assert.deepStrictEqual(narrowTaskBoardMessage({ type: 'toggleTask', taskId: 'a', completed: true, extra: 1 }), { type: 'toggleTask', taskId: 'a', completed: true });
    assert.deepStrictEqual(narrowTaskBoardMessage({ type: 'ready', extra: 1 }), { type: 'ready' });
    assert.deepStrictEqual(narrowTaskBoardMessage({ type: 'chooseTheme', extra: 1 }), { type: 'chooseTheme' });
    assert.deepStrictEqual(narrowTaskBoardMessage({ type: 'setZenMode', enabled: true, extra: 1 }), { type: 'setZenMode', enabled: true });
    assert.deepStrictEqual(narrowTaskBoardMessage({ type: 'exportResults', kind: 'tasks', extra: 1 }), { type: 'exportResults', kind: 'tasks' });
    assert.deepStrictEqual(narrowTaskBoardMessage({ type: 'showColumnRest', columnId: 'done', extra: 1 }), { type: 'showColumnRest', columnId: 'done' });
    assert.deepStrictEqual(narrowTaskBoardMessage({ type: 'setBoardGroup', groupBy: 'tag', namespace: 'Context', extra: 1 }), { type: 'setBoardGroup', groupBy: 'tag', namespace: 'context' });
    assert.deepStrictEqual(narrowTaskBoardMessage({ type: 'setBoardGroup', groupBy: 'due', namespace: 'context' }), { type: 'setBoardGroup', groupBy: 'due' });
  });

  test('accepts the gear’s, the search box’s, and a card’s other messages', () => {
    for (const message of [
      { type: 'saveBoardSearch' },
      { type: 'saveBoardSearch', query: '#project/atlas' },
      { type: 'saveBoardSearch', query: 'x'.repeat(2000) },
      { type: 'useSearchForAgenda' },
      { type: 'saveToTasksView', query: '' },
      { type: 'saveToTasksView', query: 'is:open AND #project/atlas' },
      { type: 'saveToTasksView', query: 'x'.repeat(2000) },
      { type: 'leaveTasksViewMode' },
      { type: 'openHelp' },
      { type: 'setBoardQuery', query: 'x'.repeat(2000) },
      { type: 'setBoardQuery', query: '' },
      { type: 'pickTaskDate', taskId: 'a' },
      { type: 'moveTaskTo', taskId: 'a' },
      { type: 'editTask', taskId: 'a' },
      { type: 'addTask' },
      { type: 'addTaskToColumn', column: 'status:in-progress' },
      { type: 'setBoardColumnOrder', names: [] },
      { type: 'setBoardColumnOrder', names: Array.from({ length: 100 }, (_, at) => `Status ${at}`) },
    ]) {
      assert.deepStrictEqual(narrowTaskBoardMessage(message), message, JSON.stringify(message).slice(0, 80));
    }
  });

  test('refuses anything the page could not have posted', () => {
    for (const message of [
      undefined,
      'ready',
      { type: 'constructor' },
      { type: 'saveBoardSearch', extra: 1 },
      { type: 'saveBoardSearch', query: 7 },
      { type: 'saveBoardSearch', query: 'x'.repeat(2001) },
      { type: 'saveBoardSearch', query: 'is:open', extra: 1 },
      { type: 'useSearchForAgenda', extra: 1 },
      { type: 'saveToTasksView' },
      { type: 'saveToTasksView', query: 7 },
      { type: 'saveToTasksView', query: 'x'.repeat(2001) },
      { type: 'saveToTasksView', query: '#project/atlas', extra: 1 },
      { type: 'leaveTasksViewMode', extra: 1 },
      { type: 'openHelp', section: 'periodic' },
      { type: 'setBoardQuery', query: 'x'.repeat(2001) },
      { type: 'pickTaskDate', taskId: 7 },
      { type: 'moveTaskTo', taskId: 'a', extra: 1 },
      { type: 'editTask' },
      { type: 'addTask', column: 'status:in-progress' },
      { type: 'addTaskToColumn', column: '' },
      { type: 'addTaskToColumn', column: 'done', extra: 1 },
      { type: 'showColumnRest', columnId: '' },
      { type: 'setBoardGroup', groupBy: 'color' },
      { type: 'setTaskSort', mode: 'title' },
      { type: 'reorderTasks', taskIds: ['a', 1] },
      { type: 'setBoardColumnOrder', names: Array.from({ length: 101 }, (_, at) => `Status ${at}`) },
      { type: 'setBoardColumnShown', name: 'x'.repeat(81), shown: true },
      { type: 'setZenMode', enabled: 'yes' },
      { type: 'exportResults', kind: 'notes-and-tasks' },
      { type: 'openSource', filePath: 'notes/tasks.md', line: 0 },
      { type: 'openTag', tagKey: '' },
      { type: 'toggleTask', taskId: 'a' },
      { type: 'moveTask', column: 'done' },
      { type: 'moveTask', taskId: 'a', column: 'done', from: '' },
      { type: 'pinNote', filePath: 'notes/tasks.md' },
    ]) {
      assert.strictEqual(narrowTaskBoardMessage(message), undefined, JSON.stringify(message)?.slice(0, 80));
    }
  });
});
