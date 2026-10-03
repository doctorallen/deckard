import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { Task, WorkspaceIndex } from '../domain/model';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';
import { refuseMove, resolveTaskMove } from '../domain/tasks/boardMoves';
import { AgendaService, AgendaServiceOptions, GroupMoveStep } from '../services/agendaService';
import { AgendaGroup, createAgenda, selectAgendaTasks, selectOverdueTasks } from '../ui/state/agendaState';
import { TaskService } from '../services/taskService';
import type { ResourceUri } from '../ports/uri';
import { FakeHistory, FakeNotes } from './fakeNotes';
import { FakeSettings } from './fakeWorkspace';

const at = (month: number, day: number): number => new Date(2026, month - 1, day).getTime();
/** Mid-morning on Friday 2026-09-25. */
const now = at(9, 25) + 10 * 60 * 60 * 1000;

const NOTE = [
  '# Plan',
  '- [ ] Late 📅 2026-09-20',
  '- [ ] Now 📅 2026-09-25 #status/doing',
  '- [ ] Soon 📅 2026-09-28',
  '- [x] Done ✅ 2026-09-25',
].join('\n');

/** An agenda service over one note, with settings, and what it wrote. */
function setup(settings: Record<string, unknown> = {}, note = NOTE) {
  const index = buildWorkspaceIndex(new Map([['plan.md', parseMarkdown('plan.md', note)]]));
  const written: [string, unknown][] = [];
  const refreshes: string[] = [];
  const boards: { statuses: readonly string[] }[] = [];
  let ready = false;
  const options: AgendaServiceOptions<AgendaGroup> = {
    configuration: new FakeSettings(settings),
    index: {
      getSnapshot: () => index,
      getTask: (taskId) => index.tasks.get(taskId),
      refresh: async () => {
        refreshes.push('refresh');
        throw new Error('the index is busy');
      },
      get ready() {
        ready = true;
        return Promise.resolve();
      },
    },
    readQueryContext: () => createQueryContext(now),
    model: {
      select: selectAgendaTasks,
      build: createAgenda,
      countDue: (source, context, query) => ({
        today: createAgenda(source, context, { tasks: selectAgendaTasks(source, query, context).tasks, upcomingDays: 1 })
          .find((group) => group.id === 'today')?.entries.length ?? 0,
      }),
      listOverdue: selectOverdueTasks,
      resolveMove: (task, columnId, board) => {
        boards.push(board);
        return resolveTaskMove(task, columnId, board, () => refuseMove('no tags'));
      },
      isNamespaceName: (value) => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value),
    },
    writeSetting: async (key, value) => {
      written.push([key, value]);
      return key !== 'agenda.refused';
    },
  };
  return { index, written, refreshes, boards, service: new AgendaService(options), wasReady: () => ready };
}

/** The task whose words are `title`. */
function taskTitled(index: WorkspaceIndex, title: string): Task {
  const task = [...index.tasks.values()].find((candidate) => candidate.title.startsWith(title));
  assert.ok(task, title);
  return task;
}

suite('Agenda service', () => {
  test('builds the view with its badge, and says when a search narrows it', () => {
    const { index, service } = setup();
    const view = service.buildView(index, []);
    assert.deepStrictEqual(view.groups.map((group) => group.id), ['overdue', 'today', 'upcoming:2026-09-28', 'donetoday']);
    assert.strictEqual(view.groupBy, 'due');
    assert.strictEqual(view.urgent, 2);
    assert.strictEqual(view.status, undefined);
    assert.deepStrictEqual([view.query, view.filtered, view.querySet], ['', false, false]);

    const searched = setup({ 'deckard.agenda.query': 'tag:#status/doing' });
    const narrowed = searched.service.buildView(searched.index, []);
    assert.deepStrictEqual(narrowed.groups.map((group) => group.id), ['today']);
    assert.deepStrictEqual([narrowed.filtered, narrowed.querySet], [true, true]);
  });

  test('says when nothing is open, and when the search cannot be read', () => {
    const empty = setup({}, '- [x] Done ✅ 2026-09-25');
    assert.deepStrictEqual(empty.service.buildView(empty.index, []).status, { kind: 'empty', query: '' });
    const broken = setup({ 'deckard.agenda.query': 'due:(' });
    const view = broken.service.buildView(broken.index, []);
    assert.strictEqual(view.status?.kind, 'unreadable');
    assert.deepStrictEqual([view.filtered, view.querySet], [false, true]);
  });

  test('reads a search that is not text as no search, as the setting\'s default', () => {
    // A hand-edited settings.json can hold a number, null, or a list here.
    for (const query of [42, null, ['tag:#atlas']]) {
      const odd = setup({ 'deckard.agenda.query': query });
      const view = odd.service.buildView(odd.index, []);
      assert.deepStrictEqual(view.groups.map((group) => group.id), ['overdue', 'today', 'upcoming:2026-09-28', 'donetoday'], String(query));
      assert.deepStrictEqual([view.query, view.filtered, view.querySet], ['', false, false], String(query));
    }
  });

  test('reads its grouping from the settings, falling back on what it cannot read', () => {
    assert.deepStrictEqual(setup({ 'deckard.agenda.groupBy': 'sideways' }).service.readGrouping(), {
      groupBy: 'due',
      groupNamespace: 'project',
    });
    assert.deepStrictEqual(
      setup({ 'deckard.agenda.groupBy': 'tag', 'deckard.agenda.groupNamespace': 'Context' }).service.readGrouping(),
      { groupBy: 'tag', groupNamespace: 'context' },
    );
    assert.strictEqual(setup({ 'deckard.board.statusNamespace': '  ' }).service.readStatusNamespace(), 'status');
  });

  test('lists what is overdue once the index is ready, and names a subject', async () => {
    const { index, service, wasReady } = setup();
    const overdue = await service.listOverdue();
    assert.ok(wasReady());
    assert.deepStrictEqual(overdue.map((task) => task.title), ['Late']);
    assert.strictEqual(service.describeSubject(overdue, 'overdue tasks'), '"Late"');
    assert.strictEqual(service.describeSubject([...index.tasks.values()]), '4 tasks');
  });

  test('says how full a day is, and refreshes without failing', async () => {
    const { refreshes, service } = setup();
    const context = service.rescheduleContext();
    assert.deepStrictEqual(context.load('2026-09-28'), { due: 1, scheduled: 0 });
    assert.strictEqual(context.todayCount(), 1);
    await context.refresh();
    assert.deepStrictEqual(refreshes, ['refresh']);
  });

  test('moves dropped tasks into a group one at a time, and counts what it could not move', async () => {
    const { index, service } = setup();
    const late = taskTitled(index, 'Late');
    const now = taskTitled(index, 'Now');
    const steps: GroupMoveStep[] = [];
    const reads: string[] = [];
    const result = await service.moveToGroup(
      [late, now],
      { groupId: 'doing', groupBy: 'status' },
      { from: new Map(), index: () => (reads.push('index'), index) },
      async (step) => {
        steps.push(step);
      },
    );
    assert.deepStrictEqual(result, { kind: 'moved', moved: 2, refused: [] });
    assert.strictEqual(steps.length, 1, 'a task already in the group is not written');
    assert.strictEqual(steps[0].kind === 'edit' ? steps[0].edit(late.sourceLineText) : '', '- [ ] Late 📅 2026-09-20 #status/doing');
    assert.deepStrictEqual(reads, ['index', 'index'], 'the index is read for each task as it comes');

    const done = await service.moveToGroup([late], { groupId: 'donetoday', groupBy: 'due' }, { from: new Map(), index: () => index }, async (step) => {
      steps.push(step);
    });
    assert.deepStrictEqual(done, { kind: 'moved', moved: 1, refused: [] });
    assert.strictEqual(steps[1].kind, 'complete');

    assert.deepStrictEqual(
      await service.moveToGroup([late], { groupId: 'later', groupBy: 'due' }, { from: new Map(), index: () => index }, async () => undefined),
      { kind: 'no-edit' },
    );
    const refused = await service.moveToGroup([late], { groupId: 'tag:project/x', groupBy: 'tag' }, { from: new Map(), index: () => index }, async () => undefined);
    assert.deepStrictEqual(refused, { kind: 'moved', moved: 0, refused: ['no tags'] });
  });

  test('completes every task dropped on Done from one note, below a repeating one too', async () => {
    const note = '# Plan\n- [ ] Water plants 🔁 every week 📅 2026-09-25\n- [ ] Pay rent 📅 2026-09-25\n';
    const { index, service } = setup({}, note);
    const notes = new FakeNotes({ 'plan.md': note });
    const tasks = new TaskService<ResourceUri, number>({
      notes,
      history: new FakeHistory(notes),
      ownWrites: { note: () => undefined },
      keepRank: () => undefined,
      resolveUri: async (filePath) => notes.uri(filePath),
      configuration: new FakeSettings({}),
      clock: { now: () => now },
    });
    const outcomes: string[] = [];
    // The index is not read again between writes, as a drop does not wait
    // for it: the next occurrence written above would move Pay rent down.
    const result = await service.moveToGroup(
      [taskTitled(index, 'Water'), taskTitled(index, 'Pay')],
      { groupId: 'donetoday', groupBy: 'due' },
      { from: new Map(), index: () => index },
      async (step) => {
        outcomes.push(step.kind === 'complete' ? (await tasks.toggle(step.task, true)).kind : step.kind);
      },
    );
    assert.deepStrictEqual(result, { kind: 'moved', moved: 2, refused: [] });
    assert.deepStrictEqual(outcomes, ['updated', 'updated']);
    assert.strictEqual(
      notes.text('plan.md'),
      '# Plan\n- [ ] Water plants 🔁 every week 📅 2026-10-02\n- [x] Water plants 🔁 every week 📅 2026-09-25 ✅ 2026-09-25\n- [x] Pay rent 📅 2026-09-25 ✅ 2026-09-25\n',
    );
  });

  test('a drop reads the board\'s status columns as the Task Board reads them', async () => {
    const cases: [unknown, string[]][] = [
      [undefined, ['todo', 'doing', 'waiting']],
      [['Review', 7, 'not a status', 'doing'], ['review', 'doing']],
      ['doing', ['todo', 'doing', 'waiting']],
    ];
    for (const [statuses, read] of cases) {
      const { index, service, boards } = setup(statuses === undefined ? {} : { 'deckard.board.statuses': statuses });
      await service.moveToGroup([taskTitled(index, 'Late')], { groupId: 'doing', groupBy: 'status' }, { from: new Map(), index: () => index }, async () => undefined);
      assert.deepStrictEqual(boards.at(-1)?.statuses, read, JSON.stringify(statuses));
    }
  });

  test('completes and reopens only the boxes that changed, each read again from the index', async () => {
    const { index, service } = setup();
    const late = taskTitled(index, 'Late');
    const done = taskTitled(index, 'Done');
    const toggled: [string, boolean][] = [];
    const result = await service.setCompleted(
      [
        { task: late, checked: true },
        { task: done, checked: true },
        { task: { ...done, id: 'gone' }, checked: false },
      ],
      async (task, complete) => {
        toggled.push([task.title, complete]);
        return task.id !== 'gone';
      },
    );
    assert.deepStrictEqual(toggled, [['Done', false], ['Late', true]], 'from the bottom of the note up');
    assert.deepStrictEqual(result, { failed: true });
  });

  test('writes a new grouping where it is kept, namespace first for tags', async () => {
    const first = setup();
    assert.deepStrictEqual(await first.service.setGrouping({ chosen: 'tag', current: 'due', namespace: 'context' }), {
      kind: 'grouped',
      groupBy: 'tag',
    });
    assert.deepStrictEqual(first.written, [['agenda.groupNamespace', 'context'], ['agenda.groupBy', 'tag']]);

    const again = setup();
    await again.service.setGrouping({ chosen: 'tag', current: 'tag', namespace: 'project' });
    assert.deepStrictEqual(again.written, [['agenda.groupNamespace', 'project']], 'already by tag, only the namespace');

    const same = setup();
    assert.deepStrictEqual(await same.service.setGrouping({ chosen: 'due', current: 'due' }), { kind: 'unchanged' });
    assert.deepStrictEqual(same.written, []);

    const other = setup();
    assert.deepStrictEqual(await other.service.setGrouping({ chosen: 'priority', current: 'due' }), {
      kind: 'grouped',
      groupBy: 'priority',
    });
  });
});
