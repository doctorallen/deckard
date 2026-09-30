import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { PreferencesStore } from '../core/storage/preferences';
import { PersistedPreferences, WorkspaceIndex } from '../core/types';
import { buildWorkspaceIndex } from '../core/workspace/indexState';
import { createAgenda } from '../ui/state/agendaState';
import { createDashboardTask, createSearchPageSnapshot } from '../ui/state/dashboardState';
import { createTaskBoard, TaskBoardOptions } from '../ui/state/taskBoardState';
import { AgendaNode, AgendaTreeProvider } from '../ui/views/agendaTree';
import { WorkspaceWriteHistory } from '../ui/commands/workspaceWrites';
import { getSearchPageHtml } from '../ui/webview/searchPageHtml';
import { openWebviewPage } from './webviewPage';
import { createQueryContext } from '../core/query/queryContext';

const NOTE = [
  '# Offsite',
  '- [ ] Plan the offsite 📅 2026-10-09',
  '  - [x] Book the venue',
  '  - [ ] Draft the email #project/atlas',
  '  - [ ] Send the invite',
  '  - [ ] Call the caterer 📅 2026-10-01',
  '- [x] Old plan',
  '  - [ ] Left over',
].join('\n');

function createIndex(): WorkspaceIndex {
  return buildWorkspaceIndex(new Map([['notes/offsite.md', parseMarkdown('notes/offsite.md', NOTE)]]));
}

function titleOf(index: WorkspaceIndex, id: string): string {
  return index.tasks.get(id)?.title ?? id;
}

const options: TaskBoardOptions = {
  queryContext: createQueryContext(new Date(2026, 8, 13, 9).getTime()),
  statusNamespace: 'status',
  statuses: ['todo', 'doing'],
  format: 'emoji',
};

function preferencesWith(values: Partial<PersistedPreferences>): PersistedPreferences {
  const store = new PreferencesStore({
    get: () => undefined,
    keys: () => [],
    update: async () => undefined,
  } as never);
  const value = { ...store.value, ...values };
  store.dispose();
  return value;
}

suite('Steps in the views', () => {
  test('the Tasks view folds plain steps into their task and lists the rest', () => {
    const index = createIndex();
    const groups = createAgenda(index, createQueryContext(options.queryContext.now), { upcomingDays: 7 });
    const titles = groups.flatMap((group) => group.entries.map((entry) => entry.title)).sort();
    assert.deepStrictEqual(titles, [
      'Call the caterer',
      'Draft the email',
      'Left over',
      'Plan the offsite',
    ]);
    const plan = groups.flatMap((group) => group.entries).find((entry) => entry.title === 'Plan the offsite');
    assert.ok(plan);
    assert.strictEqual(plan.stepsLabel, '1 of 4 steps · next: Draft the email');
    assert.ok(plan.details.includes('1 of 4 steps · next: Draft the email'));
    assert.deepStrictEqual(plan.steps?.map((step) => step.title), [
      'Book the venue',
      'Draft the email #project/atlas',
      'Send the invite',
      'Call the caterer',
    ]);
  });

  test('the board folds plain steps too, in every layout, and says how far along a card is', () => {
    const index = createIndex();
    const cards = createTaskBoard(index, preferencesWith({ taskBoardGroup: 'status' }), { query: 'is:open' }, options)
      .columns.flatMap((column) => column.cards);
    assert.deepStrictEqual(cards.map((card) => card.title).sort(), [
      'Call the caterer',
      'Draft the email',
      'Left over',
      'Plan the offsite',
    ]);
    const plan = cards.find((card) => card.title === 'Plan the offsite');
    assert.deepStrictEqual(plan?.steps, { label: '1 of 4 steps', next: 'Draft the email' });
    const list = createTaskBoard(index, preferencesWith({ taskBoardLayout: 'list' }), { query: 'is:open' }, options);
    assert.strictEqual(list.tasks?.length, 4);
    assert.strictEqual(list.taskCounts.all, 4);
    const table = createTaskBoard(index, preferencesWith({ taskBoardLayout: 'table' }), { query: 'is:open' }, options);
    assert.strictEqual(table.table?.rows.length, 4);
  });

  test('a search page does not fold: it lists what it found, and rows say how far along', () => {
    const index = createIndex();
    const plan = [...index.tasks.values()].find((task) => task.title === 'Plan the offsite');
    assert.ok(plan);
    assert.strictEqual(
      createDashboardTask(plan, index.sections, createQueryContext(Date.now())).stepsLabel,
      '1 of 4 steps · next: Draft the email',
    );
    assert.strictEqual(plan.steps?.ids.map((id) => titleOf(index, id)).length, 4);
  });

  test('a search page lists steps as it finds them, and a task row says how far along', () => {
    const index = createIndex();
    const snapshot = createSearchPageSnapshot(index, preferencesWith({}), 'is:open', { queryContext: createQueryContext(Date.now()) });
    const page = openWebviewPage(getSearchPageHtml({ cspSource: 'vscode-webview://deckard' }), snapshot);
    try {
      const rows = page.findAll('.task-row');
      assert.strictEqual(rows.length, 5, 'every open task and step the search found');
      assert.deepStrictEqual(
        page.findAll('.task-row .task-steps').map((span) => span.textContent),
        ['1 of 4 steps · next: Draft the email'],
      );
    } finally {
      page.dispose();
    }
  });

  test('a task with steps opens to them in the Tasks view, each a task of its own', async () => {
    const index = createIndex();
    const updates = new vscode.EventEmitter<WorkspaceIndex>();
    const provider = new AgendaTreeProvider(
      {
        onDidUpdate: updates.event,
        getTask: (taskId) => index.tasks.get(taskId),
      },
      { history: new WorkspaceWriteHistory(), keepRank: () => undefined },
    );
    try {
      updates.fire(index);
      const groups = await provider.getChildren();
      const rows = (await Promise.all(groups.map((group) => provider.getChildren(group)))).flat();
      const plan = rows.find(
        (row): row is Extract<AgendaNode, { kind: 'task' }> =>
          row.kind === 'task' && row.entry.title === 'Plan the offsite',
      );
      assert.ok(plan);
      const item = provider.getTreeItem(plan);
      assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
      assert.match(String(item.description), /1 of 4 steps · next: Draft the email/);
      const steps = await provider.getChildren(plan);
      assert.deepStrictEqual(
        steps.map((step) => provider.getTreeItem(step).label),
        ['Book the venue', 'Draft the email', 'Send the invite', 'Call the caterer'],
      );
      const first = provider.getTreeItem(steps[0]);
      assert.strictEqual(
        (first.checkboxState as { state: vscode.TreeItemCheckboxState }).state,
        vscode.TreeItemCheckboxState.Checked,
      );
      assert.strictEqual(first.contextValue, 'deckardAgendaDoneTask');
      assert.strictEqual(provider.getTreeItem(steps[1]).contextValue, 'deckardAgendaTask');
      assert.deepStrictEqual(provider.tasksFor(steps[1]).map((task) => task.title), ['Draft the email #project/atlas']);
      const lone = rows.find((row) => row.kind === 'task' && row.entry.title === 'Left over');
      assert.ok(lone);
      assert.strictEqual(provider.getTreeItem(lone).collapsibleState, vscode.TreeItemCollapsibleState.None);
    } finally {
      provider.dispose();
      updates.dispose();
    }
  });
});
