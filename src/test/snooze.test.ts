import * as assert from 'assert';

import { createPreferences } from './preferenceServices';
import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { setTaskDate } from '../domain/markdown/taskLineEdits';
import { parseQuery } from '../domain/query/queryParser';
import { createQueryContext } from '../domain/query/queryContext';
import { isNotStarted, mentionsStart } from '../domain/tasks/notStarted';
import { snoozeDateFor } from '../domain/tasks/reschedule';
import { selectAgendaTasks } from '../ui/state/agendaState';
import { searchBoardTasks } from '../ui/state/taskBoardState';
import { ParsedFile, PersistedPreferences, Task, WorkspaceIndex } from '../domain/model';

/** Noon on Wednesday 2026-10-28. */
const now = new Date(2026, 9, 28, 12).getTime();

function index(notes: Record<string, string>): WorkspaceIndex {
  const files = new Map<string, ParsedFile>();
  Object.entries(notes).forEach(([filePath, content]) => files.set(filePath, parseMarkdown(filePath, content, { createdAt: now, updatedAt: now })));
  return buildWorkspaceIndex(files);
}

function defaults(): PersistedPreferences {
  const store = createPreferences({ get: () => undefined, keys: () => [], update: async () => undefined } as never);
  const value = store.reader.value;
  store.repository.dispose();
  return value;
}

const titles = (tasks: readonly Task[]): string[] => tasks.map((task) => task.title).sort();

const NOTE = [
  '# Work',
  '- [ ] Call Ren',
  '- [ ] Draft the brief 🛫 2026-11-02',
  '- [ ] Book the room 🛫 2026-10-28',
  '- [ ] Pay the invoice 📅 2026-10-28 🛫 2026-10-30',
  '- [x] Filed it 🛫 2026-11-09',
].join('\n');

suite('Snooze until…', () => {
  test('names tomorrow, and next week as a date box reads it', () => {
    assert.strictEqual(snoozeDateFor('tomorrow', now), '2026-10-29');
    assert.strictEqual(snoozeDateFor('nextWeek', now), '2026-11-02', 'next week is its Monday, with Sunday weeks');
    assert.strictEqual(snoozeDateFor('nextWeek', now, 1), '2026-11-02', 'and with Monday weeks');
    const saturday = new Date(2026, 9, 31, 9).getTime();
    assert.strictEqual(snoozeDateFor('nextWeek', saturday, 0), '2026-11-02', 'a Sunday week starts tomorrow; its Monday follows');
    const sunday = new Date(2026, 10, 1, 9).getTime();
    assert.strictEqual(snoozeDateFor('nextWeek', sunday, 0), '2026-11-09', 'on a Sunday, next week is the one after');
    assert.strictEqual(snoozeDateFor('nextWeek', sunday, 1), '2026-11-02', 'with Monday weeks, it is tomorrow');
  });

  test('writes the start date in the format the line uses', () => {
    assert.strictEqual(
      setTaskDate('- [ ] Call Ren 📅 2026-10-30', 3, { field: 'start', date: '2026-11-02' }),
      '- [ ] Call Ren 📅 2026-10-30 🛫 2026-11-02',
    );
    assert.strictEqual(
      setTaskDate('- [ ] Call Ren [due:: 2026-10-30]', 3, { field: 'start', date: '2026-11-02' }),
      '- [ ] Call Ren [due:: 2026-10-30] [start:: 2026-11-02]',
    );
    assert.strictEqual(
      setTaskDate('- [ ] Call Ren 🛫 2026-10-29 ^call', 3, { field: 'start', date: '2026-11-02' }),
      '- [ ] Call Ren 🛫 2026-11-02 ^call',
      'a snoozed task is snoozed again in place',
    );
    assert.strictEqual(
      setTaskDate('- [ ] Call Ren', 3, { field: 'start', date: '2026-11-02', preferredFormat: 'dataview' }),
      '- [ ] Call Ren [start:: 2026-11-02]',
      'a line with no metadata takes the format setting',
    );
  });

  test('a task is not started while its start date is to come, and only while open', () => {
    const tasks = [...index({ 'work.md': NOTE }).tasks.values()];
    assert.deepStrictEqual(
      titles(tasks.filter((task) => isNotStarted(task, now))),
      ['Draft the brief', 'Pay the invoice'],
      'one starting today has started; a done one is not waiting',
    );
  });

  test('a search names start dates with start and has:start', () => {
    assert.strictEqual(mentionsStart(parseQuery('start > today').node), true);
    assert.strictEqual(mentionsStart(parseQuery('is:open AND (has:start OR #x)').node), true);
    assert.strictEqual(mentionsStart(parseQuery('no:start').node), true);
    assert.strictEqual(mentionsStart(parseQuery('-has:start').node), true);
    assert.strictEqual(mentionsStart(parseQuery('is:open due < 7d').node), false);
    assert.strictEqual(mentionsStart(undefined), false);
  });

  test('the Tasks view and the board leave tasks not started out only when the setting says so', () => {
    const workspace = index({ 'work.md': NOTE });
    const shown = createQueryContext(now);
    const hidden = createQueryContext(now, { taskPolicy: { hideNotStarted: true } });
    assert.deepStrictEqual(titles(selectAgendaTasks(workspace, '', shown).tasks), [
      'Book the room',
      'Call Ren',
      'Draft the brief',
      'Filed it',
      'Pay the invoice',
    ]);
    assert.deepStrictEqual(titles(selectAgendaTasks(workspace, '', hidden).tasks), ['Book the room', 'Call Ren', 'Filed it']);
    assert.deepStrictEqual(
      titles(selectAgendaTasks(workspace, 'has:start', hidden).tasks),
      ['Book the room', 'Draft the brief', 'Filed it', 'Pay the invoice'],
      'a search that names start dates still finds them',
    );
    assert.deepStrictEqual(
      titles(selectAgendaTasks(workspace, 'not a (query', hidden).tasks),
      ['Book the room', 'Call Ren', 'Filed it'],
      'a search that does not parse lists every task the setting leaves',
    );
    const board = (query: string, queryContext = hidden) =>
      titles(searchBoardTasks({ index: workspace, preferences: defaults(), search: { query }, options: { queryContext, format: 'emoji' } }));
    assert.deepStrictEqual(board('is:open'), ['Book the room', 'Call Ren']);
    assert.deepStrictEqual(board('is:open', shown), ['Book the room', 'Call Ren', 'Draft the brief', 'Pay the invoice']);
    assert.deepStrictEqual(board('is:open start > today'), ['Draft the brief', 'Pay the invoice']);
  });
});
