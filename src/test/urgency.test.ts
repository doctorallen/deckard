import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';
import { compareUrgency, dueFactor, scoreUrgency, URGENCY_WEIGHTS } from '../domain/tasks/urgency';
import { TASK_SORT_LABELS } from '../domain/model/sortOrders';
import { createAgenda } from '../ui/state/agendaState';
import { sortTasks } from '../ui/state/entryCards';
import { createQueryBlockSnapshot, parseQueryBlockInfo, queryBlockSortOf } from '../ui/state/queryBlockState';
import { ParsedFile, TASK_SORT_MODES, WorkspaceIndex } from '../domain/model';

/** Noon on Wednesday 2026-10-28. */
const now = new Date(2026, 9, 28, 12).getTime();
const day = (month: number, date: number): number => new Date(2026, month - 1, date).getTime();

function workspace(): WorkspaceIndex {
  const content = [
    '# Work',
    '- [ ] Pay rent 📅 2026-10-20',
    '- [ ] Call Ren 📅 2026-10-29',
    '- [ ] Plan the offsite ⏫',
    '- [ ] Book the room 📅 2026-10-29 ⏫ ⛔ venue',
    '- [ ] Pick a venue 🆔 venue',
    '- [ ] Water the plants 🛫 2026-11-04',
    '- [ ] Draft the brief ⏳ 2026-10-27',
    '- [x] Filed it 📅 2026-10-01',
  ].join('\n');
  const files = new Map<string, ParsedFile>([['work.md', parseMarkdown('work.md', content, { createdAt: now, updatedAt: now })]]);
  return buildWorkspaceIndex(files);
}

suite('Urgency', () => {
  test('a due date weighs 1 at a week overdue, falling evenly to 0.2 two weeks ahead', () => {
    assert.strictEqual(dueFactor(undefined, now), 0);
    assert.strictEqual(dueFactor(day(10, 21), now), 1, 'a week overdue');
    assert.strictEqual(dueFactor(day(9, 1), now), 1, 'and more');
    assert.strictEqual(dueFactor(day(11, 11), now), 0.2, 'two weeks ahead');
    assert.strictEqual(dueFactor(day(12, 25), now), 0.2, 'and further off');
    assert.ok(Math.abs(dueFactor(day(10, 28), now) - (14 * 0.8 / 21 + 0.2)) < 1e-9, 'due today, between');
    assert.ok(dueFactor(day(10, 27), now) > dueFactor(day(10, 28), now), 'overdue weighs more than due today');
    assert.ok(dueFactor(day(10, 28), now) > dueFactor(day(10, 29), now), 'and today more than tomorrow');
  });

  test('adds up the due date, scheduled and start dates, priority, and blocked state', () => {
    assert.strictEqual(scoreUrgency({ blocked: false }, now), 0, 'nothing says it is urgent');
    assert.strictEqual(scoreUrgency({ dueAt: day(10, 1), blocked: false }, now), URGENCY_WEIGHTS.due);
    assert.strictEqual(scoreUrgency({ scheduledAt: day(10, 28), blocked: false }, now), 5, 'scheduled today');
    assert.strictEqual(scoreUrgency({ scheduledAt: day(10, 29), blocked: false }, now), 0, 'scheduled tomorrow is not yet');
    assert.strictEqual(scoreUrgency({ startAt: day(10, 29), blocked: false }, now), -3, 'a start date to come lowers it');
    assert.strictEqual(scoreUrgency({ startAt: day(10, 28), blocked: false }, now), 0, 'one that has come does not');
    assert.deepStrictEqual(
      (['highest', 'high', 'medium', undefined, 'low', 'lowest'] as const).map((priority) => scoreUrgency({ priority, blocked: false }, now)),
      [6, 4, 2, 0, -1, -2],
      'no priority sits between medium and low',
    );
    assert.strictEqual(scoreUrgency({ dueAt: day(10, 1), priority: 'high', blocked: true }, now), 12 + 4 - 5);
  });

  test('a tie goes to the sooner due date, then the higher priority', () => {
    assert.ok(compareUrgency({ urgency: 5 }, { urgency: 3 }) < 0, 'the more urgent first');
    assert.ok(compareUrgency({ urgency: 3, dueAt: day(11, 2) }, { urgency: 3, dueAt: day(11, 1) }) > 0);
    assert.ok(compareUrgency({ urgency: 3, dueAt: day(11, 2) }, { urgency: 3 }) < 0, 'an undated task last');
    assert.ok(compareUrgency({ urgency: 3, priority: 'low' }, { urgency: 3 }) > 0);
    assert.strictEqual(compareUrgency({ urgency: 3 }, { urgency: 3 }), 0);
  });

  test('is a sort wherever the task sorts are offered, Most urgent', () => {
    assert.ok(TASK_SORT_MODES.includes('urgency'));
    assert.strictEqual(TASK_SORT_LABELS.urgency, 'Most urgent');
    assert.deepStrictEqual(queryBlockSortOf('urgency', 'tasks'), { sort: 'urgency' });
  });

  test('sorts a list most urgent first, a blocked task lower, and closed tasks last', () => {
    const index = workspace();
    const sorted = sortTasks([...index.tasks.values()], [], 'urgency', { now, index }).map((task) => task.title);
    assert.deepStrictEqual(sorted, [
      'Pay rent',
      'Call Ren',
      'Book the room',
      'Draft the brief',
      'Plan the offsite',
      'Pick a venue',
      'Water the plants',
      'Filed it',
    ], 'Book the room, due when Call Ren is and high, waits on a venue, so it follows');
  });

  test('orders the Tasks view\'s groups by it', () => {
    const index = workspace();
    const groups = createAgenda(index, createQueryContext(now), { upcomingDays: 7, groupBy: 'priority', taskSortMode: 'urgency' });
    assert.deepStrictEqual(
      groups.find((group) => group.id === 'priority:high')?.entries.map((entry) => entry.task.title),
      ['Book the room', 'Plan the offsite'],
      'the one due tomorrow first, though it waits on a venue',
    );
  });

  test('a query block takes sort=urgency, most urgent first, and dir=asc turns it round', () => {
    assert.strictEqual(parseQueryBlockInfo('deckard sort=urgency')?.sort, 'urgency');
    const titles = (info: string) =>
      createQueryBlockSnapshot(workspace(), 'is:task', parseQueryBlockInfo(info)!, { queryContext: createQueryContext(now) }).tasks.map((task) => task.title);
    assert.deepStrictEqual(titles('deckard sort=urgency').slice(0, 4), ['Pay rent', 'Call Ren', 'Book the room', 'Draft the brief']);
    const ascending = titles('deckard sort=urgency dir=asc');
    assert.deepStrictEqual(ascending.slice(0, 2), ['Water the plants', 'Pick a venue']);
    assert.strictEqual(ascending.at(-1), 'Filed it', 'done tasks stay last either way');
  });
});
