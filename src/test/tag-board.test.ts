import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { createPreferences } from './preferenceServices';
import { PersistedPreferences, WorkspaceIndex } from '../core/types';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createTaskBoard, TaskBoardOptions } from '../ui/state/taskBoardState';
import { openWebviewPage, WebviewPage } from './webviewPage';
import { renderPage } from './pages';
import { createQueryContext } from '../domain/query/queryContext';

const options: TaskBoardOptions = {
  queryContext: createQueryContext(Date.parse('2026-09-21T12:00:00Z')),
  statusNamespace: 'status',
  statuses: ['todo'],
  format: 'emoji',
};

const NOTE = [
  '# Atlas #project/atlas',
  '- [ ] Call Ren #context/phone',
  '- [ ] Draft #context/computer #context/phone',
  '- [ ] Loose',
  '- [ ] Waits #status/waiting @dana',
  '',
].join('\n');

function indexOf(): WorkspaceIndex {
  return buildWorkspaceIndex(new Map([['a.md', parseMarkdown('a.md', NOTE)]]));
}

function preferences(values: Partial<PersistedPreferences>): PersistedPreferences {
  const store = createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
  const value = { ...store.reader.value, taskBoardLayout: 'board' as const, ...values };
  store.repository.dispose();
  return value;
}

function board(values: Partial<PersistedPreferences>) {
  return createTaskBoard({ index: indexOf(), preferences: preferences(values), search: { query: 'is:open' }, options, tagTitleDisplayMode: 'inline' });
}

suite('The Task board grouped by a tag namespace', () => {
  test('a column per tag, by name, No context last before Done, a task in each of its columns', () => {
    const snapshot = board({ taskBoardGroup: 'tag', taskBoardGroupNamespace: 'context' });
    assert.deepStrictEqual(
      snapshot.columns.map((column) => [column.id, column.label, column.cards.length]),
      [
        ['tag:context/computer', 'Computer', 1],
        ['tag:context/phone', 'Phone', 2],
        ['tag:context/', 'No context', 2],
        ['done', 'Done', 0],
      ],
    );
    assert.strictEqual(snapshot.taskCount, 4, 'tasks are counted once');
    const draft = snapshot.columns[0].cards[0];
    assert.strictEqual(draft.details[draft.details.length - 1], 'also in Phone');
    assert.ok(draft.current.includes('tag:context/computer') && draft.current.includes('tag:context/phone'));
    assert.strictEqual(snapshot.groupNamespace, 'context');
    assert.deepStrictEqual(snapshot.tagNamespaces, [
      { name: 'project', openTasks: 4 },
      { name: 'context', openTasks: 2 },
    ]);
  });

  test('a tag grouping without a namespace lays out by status', () => {
    assert.strictEqual(board({ taskBoardGroup: 'tag' }).groupBy, 'status');
  });

  test('keeps tag and its namespace in preferences, and nothing else under that name', () => {
    const read = (value: unknown) => {
      const store = createPreferences({
        get: (key: string, fallback?: unknown) => (key === 'deckard.preferences' ? value : fallback),
        keys: () => [],
        update: async () => undefined,
      } as never);
      const { taskBoardGroup, taskBoardGroupNamespace } = store.reader.value;
      store.repository.dispose();
      return [taskBoardGroup, taskBoardGroupNamespace];
    };
    assert.deepStrictEqual(read({ version: 1, taskBoardGroup: 'tag', taskBoardGroupNamespace: 'Context' }), ['tag', 'context']);
    assert.deepStrictEqual(read({ version: 1, taskBoardGroup: 'tag' }), ['status', undefined]);
    assert.deepStrictEqual(read({ version: 1, taskBoardGroup: 'tag', taskBoardGroupNamespace: '1 bad' }), ['status', undefined]);
  });

  suite('on the page', () => {
    let page: WebviewPage | undefined;
    teardown(() => {
      page?.dispose();
      page = undefined;
    });
    const open = (values: Partial<PersistedPreferences>): WebviewPage => {
      page = openWebviewPage(renderPage('taskBoard'), board(values));
      return page;
    };

    test('Tag… opens a menu of namespaces, and a choice groups by it', () => {
      const view = open({ taskBoardGroup: 'status' });
      const button = view.find('[data-action="pick-board-namespace"]');
      assert.strictEqual(button.textContent, 'Tag…');
      assert.strictEqual(button.getAttribute('aria-pressed'), 'false');
      view.click('[data-action="pick-board-namespace"]');
      assert.deepStrictEqual(view.findAll('#action-menu .menu-heading').map((heading) => heading.textContent), ['Group by tag namespace']);
      assert.deepStrictEqual(
        view.findAll('#action-menu [data-menu-value] .menu-label').map((item) => item.textContent),
        ['#project · 4 open tasks', '#context · 2 open tasks'],
      );
      view.click('#action-menu [data-menu-value="context"]');
      assert.deepStrictEqual(view.lastPosted('setBoardGroup'), { type: 'setBoardGroup', groupBy: 'tag', namespace: 'context' });
    });

    test('grouped by a namespace, the switch names it, and pressed', () => {
      const view = open({ taskBoardGroup: 'tag', taskBoardGroupNamespace: 'context' });
      const button = view.find('[data-action="pick-board-namespace"]');
      assert.strictEqual(button.textContent, '#context');
      assert.strictEqual(button.getAttribute('aria-pressed'), 'true');
    });

    test('a task in two columns is two cards, each moved from its own column, and one Tab stop', () => {
      const view = open({ taskBoardGroup: 'tag', taskBoardGroupNamespace: 'context' });
      const copies = view.findAll('.board-card').filter((card) => (card.textContent ?? '').includes('Draft'));
      assert.deepStrictEqual(copies.map((card) => card.getAttribute('data-card-column')), ['tag:context/computer', 'tag:context/phone']);
      assert.strictEqual(view.findAll('.board-card[tabindex="0"]').length, 1);
      view.click('.board-card[data-card-column="tag:context/computer"] [data-action="board-menu"]');
      view.click('#action-menu [data-menu-value="tag:context/"]');
      assert.deepStrictEqual(view.lastPosted('moveTask'), {
        type: 'moveTask',
        taskId: copies[1].getAttribute('data-task-id'),
        column: 'tag:context/',
        from: 'tag:context/computer',
        requestId: 1,
      });
    });
  });
});
