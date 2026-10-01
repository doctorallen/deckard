import * as assert from 'assert';

import { createPreferences } from './preferenceServices';
import { DashboardWidgetConfig, PersistedPreferences } from '../core/types';
import { planRollover } from '../ui/commands/rollover';
import { selectAgendaTasks } from '../ui/state/agendaState';
import { createCalendar } from '../ui/state/calendarState';
import { createDashboardWidgets } from '../ui/state/dashboardWidgets';
import { listPeopleRecency, listQuietTags } from '../ui/state/peopleRecency';
import { summarizeReview } from '../ui/state/reviewState';
import { createTaskBoard } from '../ui/state/taskBoardState';
import { countDueTasks } from '../ui/views/taskStatusBar';
import { indexWithParking } from './parkedFixture';
import { createQueryContext } from '../domain/query/queryContext';

const DAY = 24 * 60 * 60 * 1000;
/** Noon on Wednesday 2026-09-16. */
const now = new Date(2026, 8, 16, 12).getTime();
const old = new Date(2026, 5, 1).getTime();

function defaults(values: Partial<PersistedPreferences> = {}): PersistedPreferences {
  const store = createPreferences({
    get: () => undefined,
    keys: () => [],
    update: async () => undefined,
  } as never);
  const value = { ...store.reader.value, ...values };
  store.repository.dispose();
  return value;
}

/** Bare titles, without tags. */
const titles = (tasks: readonly { title: string }[]): string[] =>
  tasks.map((task) => task.title.replace(/\s+[#@][^\s]+/g, '').trim()).sort();

function workspace() {
  return indexWithParking(
    {
      'notes/live.md': '# Live\n- [ ] Pay rent 📅 2026-09-14\n- [ ] Call @ren 📅 2026-09-16\n',
      'archive/old.md': '# Old\n- [ ] Old overdue 📅 2026-09-14\n- [ ] Ask @vic 📅 2026-09-16\n',
      '2026-09-15.md': '# 2026-09-15\n- [ ] Carry me\n- [ ] Leave me #parked\n',
    },
    { folders: ['archive'], now: old },
  );
}

suite('Parked tasks leave the lists of things to do', () => {
  test('the Tasks view leaves them out unless its search says is:parked', () => {
    const index = workspace();
    assert.deepStrictEqual(titles(selectAgendaTasks(index, '', createQueryContext(Date.now())).tasks), [
      'Call',
      'Carry me',
      'Pay rent',
    ]);
    assert.deepStrictEqual(titles(selectAgendaTasks(index, 'is:open', createQueryContext(Date.now())).tasks), [
      'Call',
      'Carry me',
      'Pay rent',
    ]);
    assert.deepStrictEqual(titles(selectAgendaTasks(index, 'is:parked', createQueryContext(Date.now())).tasks), [
      'Ask',
      'Leave me',
      'Old overdue',
    ]);
  });

  test('the status bar does not count a parked overdue task', () => {
    const counts = countDueTasks(workspace(), createQueryContext(now));
    assert.strictEqual(counts.overdue, 1);
    assert.strictEqual(counts.today, 1);
  });

  test('the board leaves them out, and offers Parked with how many it left out', () => {
    const index = workspace();
    const options = { queryContext: createQueryContext(now), statusNamespace: 'status', statuses: [], format: 'emoji' as const };
    const board = createTaskBoard(index, defaults({ taskBoardLayout: 'list' }), { query: 'is:open' }, options);
    assert.deepStrictEqual(titles((board.tasks ?? []).map((item) => item.task)), ['Call', 'Carry me', 'Pay rent']);
    const parked = board.query.facets.find((facet) => facet.id === 'parked');
    assert.deepStrictEqual(parked?.values, [{ label: 'Parked', clause: 'is:parked', count: 3 }]);
    const asked = createTaskBoard(
      index,
      defaults({ taskBoardLayout: 'list' }),
      { query: 'is:open is:parked' },
      options,
    );
    assert.deepStrictEqual(titles((asked.tasks ?? []).map((item) => item.task)), ['Ask', 'Leave me', 'Old overdue']);
    assert.ok(!asked.query.facets.some((facet) => facet.id === 'parked'));
  });

  test('Home leaves them out of Tasks and Stale tasks', () => {
    const index = workspace();
    const configs: DashboardWidgetConfig[] = [
      { id: 't', kind: 'tasks', width: 'half', query: 'is:open' },
      { id: 's', kind: 'staleTasks', width: 'half', days: 30 },
      { id: 'p', kind: 'tasks', width: 'half', query: 'is:parked' },
    ];
    const [tasks, stale, parked] = createDashboardWidgets(index, defaults({ dashboardWidgets: configs }), {
      queryContext: createQueryContext(now),
      upcomingDays: 7,
      tagTitleDisplayMode: 'inline',
    });
    assert.strictEqual(tasks.total, 3);
    assert.strictEqual(stale.total, 3);
    assert.strictEqual(parked.total, 3);
  });

  test('the calendar does not count them', () => {
    const calendar = createCalendar(workspace(), '2026-09', createQueryContext(now));
    const day = (date: string) => calendar.weeks.flatMap((week) => week.days).find((entry) => entry.date === date);
    assert.strictEqual(day('2026-09-14')?.dueCount, 1);
    assert.strictEqual(day('2026-09-16')?.dueCount, 1);
  });

  test('rollover leaves a parked task where it is', () => {
    const plan = planRollover(workspace(), '2026-09-16');
    assert.deepStrictEqual(titles(plan?.tasks ?? []), ['Carry me']);
  });

  test('a review does not say a parked task slipped', () => {
    const summary = summarizeReview(workspace(), { start: now - 7 * DAY, end: now + DAY, label: 'week' } as never, { queryContext: createQueryContext(Date.now()) });
    assert.deepStrictEqual(summary.slipped.map((item) => item.title.replace(/\s+@\S+/, '')).sort(), ['Call', 'Pay rent']);
  });

  test('a person written about only in parked notes is not listed as gone quiet', () => {
    const index = workspace();
    const people = listPeopleRecency(index).map((person) => person.tag.key);
    assert.ok(people.includes('@ren'));
    assert.ok(!people.includes('@vic'));
    const quiet = listQuietTags(index, now + 400 * DAY, 90).map((person) => person.tag.key);
    assert.deepStrictEqual(quiet, ['@ren']);
  });
});
