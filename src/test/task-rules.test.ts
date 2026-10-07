import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { createQueryContext } from '../domain/query/queryContext';
import { NO_DATE, placeTask } from '../domain/tasks/agendaPlacement';
import {
  getDueBand,
  refuseMove,
  resolveColumnCapture,
  resolveTaskMove,
  setTaskNamespaceTags,
  TaskMove,
} from '../domain/tasks/boardMoves';
import { DEFAULT_TASK_POLICY } from '../domain/tasks/taskPolicy';
import { formatIsoDate } from '../domain/markdown/calendar';
import { Task } from '../domain/model';

const at = (month: number, day: number): number => new Date(2026, month - 1, day).getTime();
/** Mid-morning on Friday 2026-09-25. */
const now = at(9, 25) + 10 * 60 * 60 * 1000;
const days = { today: at(9, 25), tomorrow: at(9, 26), horizon: at(10, 3) };

/** The one task a line reads as, as the index would read it. */
function task(line: string): Task {
  const [parsed] = parseMarkdown('plan.md', line).tasks;
  assert.ok(parsed, `a task: ${line}`);
  return parsed;
}

/** A move's edit applied to the task's own line, or the move's kind. */
function apply(move: TaskMove, line: string): string {
  return move.kind === 'edit' ? move.edit(line) : move.kind;
}

const options = {
  queryContext: createQueryContext(now),
  format: 'emoji' as const,
};
const noTags = (): TaskMove => refuseMove('no tags here');

suite('Task rules', () => {
  test('places a task by its dates, the way every task view does', () => {
    const place = (line: string) => placeTask(task(line), days, DEFAULT_TASK_POLICY);
    assert.deepStrictEqual(place('- [ ] Nothing dated'), { group: 'nodate', at: NO_DATE, reason: '' });
    assert.deepStrictEqual(place('- [ ] Late 📅 2026-09-20'), {
      group: 'overdue',
      at: at(9, 20),
      reason: 'due Sun 2026-09-20',
    });
    assert.deepStrictEqual(place('- [ ] Long gone 📅 2026-08-01'), {
      group: 'needsdate',
      at: at(8, 1),
      reason: 'was due Sat 2026-08-01',
    });
    assert.deepStrictEqual(place('- [ ] Now 📅 2026-09-25'), { group: 'today', at: at(9, 25), reason: 'due today' });
    assert.deepStrictEqual(place('- [ ] Planned ⏳ 2026-09-23'), {
      group: 'today',
      at: at(9, 23),
      reason: 'scheduled Wed 2026-09-23',
    });
    assert.deepStrictEqual(place('- [ ] Planned ⏳ 2026-09-25').reason, 'scheduled today');
    assert.deepStrictEqual(place('- [ ] Soon 📅 2026-09-28'), {
      group: 'upcoming',
      at: at(9, 28),
      reason: 'due Mon 2026-09-28',
    });
    assert.deepStrictEqual(place('- [ ] Far 📅 2026-11-02').group, 'later');
  });

  test('a start date still to come holds a scheduled task back from Today', () => {
    const placed = placeTask(task('- [ ] Wait ⏳ 2026-09-20 🛫 2026-10-20'), days, DEFAULT_TASK_POLICY);
    assert.deepStrictEqual(placed, { group: 'later', at: at(10, 20), reason: 'starts Tue 2026-10-20' });
  });

  test('a task whose only date is a start already come is not upcoming, since nothing dates it ahead', () => {
    const place = (line: string) => placeTask(task(line), days, DEFAULT_TASK_POLICY);
    const undated = { group: 'nodate', at: NO_DATE, reason: '' };
    assert.deepStrictEqual(place('- [ ] Started last week 🛫 2026-09-18'), undated);
    assert.deepStrictEqual(place('- [ ] Starts today 🛫 2026-09-25'), undated);
    assert.deepStrictEqual(place('- [ ] Starts tomorrow 🛫 2026-09-26'), {
      group: 'upcoming',
      at: at(9, 26),
      reason: 'starts Sat 2026-09-26',
    });
  });

  test('turns a drop on a column into an edit of the line', () => {
    const line = '- [ ] Draft notes #status/todo';
    const draft = task(line);
    assert.strictEqual(apply(resolveTaskMove(draft, 'done', options, noTags), line), 'complete');
    assert.strictEqual(apply(resolveTaskMove(draft, 'status:todo', options, noTags), line), 'unchanged');
    assert.strictEqual(apply(resolveTaskMove(draft, 'status:in-progress', options, noTags), line), '- [/] Draft notes #status/todo');
    assert.strictEqual(apply(resolveTaskMove(draft, 'status:waiting', options, noTags), line), '- [w] Draft notes #status/todo');
    assert.strictEqual(apply(resolveTaskMove(draft, 'priority:high', options, noTags), line), '- [ ] Draft notes #status/todo ⏫');
    assert.strictEqual(apply(resolveTaskMove(draft, 'due:tomorrow', options, noTags), line), '- [ ] Draft notes #status/todo 📅 2026-09-26');
    assert.strictEqual(apply(resolveTaskMove(draft, 'due:2026-09-30', options, noTags), line), '- [ ] Draft notes #status/todo 📅 2026-09-30');
    const labeled = resolveTaskMove(draft, 'due:2026-09-30', options, noTags);
    assert.strictEqual(labeled.kind === 'edit' ? labeled.label : labeled.kind, 'Due Wed 2026-09-30');
    assert.strictEqual(apply(resolveTaskMove(draft, 'assignee:@ren', options, noTags), line), '- [ ] Draft notes #status/todo 👤 @ren');
  });

  test('says why a column names no edit, and hands tag columns to their resolver', () => {
    const draft = task('- [ ] Draft notes');
    assert.deepStrictEqual(resolveTaskMove(draft, 'due:later', options, noTags), {
      kind: 'refused',
      reason: 'Drop a task on Today, Tomorrow, or No due date to change its due date.',
    });
    assert.deepStrictEqual(resolveTaskMove(draft, 'priority:urgent', options, noTags), {
      kind: 'refused',
      reason: '"urgent" is not a priority.',
    });
    assert.deepStrictEqual(resolveTaskMove(draft, 'constructor:x', options, noTags), {
      kind: 'refused',
      reason: 'That column no longer exists on the board. Refresh the board and try again.',
    });
    const asked: string[] = [];
    resolveTaskMove(draft, 'tag:project/atlas', options, (value) => {
      asked.push(value);
      return { kind: 'unchanged' };
    });
    assert.deepStrictEqual(asked, ['project/atlas']);
  });

  test('moving a finished task out of Done reopens it in the same edit, as its status\'s character', () => {
    const line = '- [x] Ship it ✅ 2026-09-20';
    assert.strictEqual(apply(resolveTaskMove(task(line), 'status:in-progress', options, noTags), line), '- [/] Ship it');
    // A status tag on the line is a tag like any other, and stays.
    const tagged = '- [x] Ship it #status/todo ✅ 2026-09-20';
    assert.strictEqual(apply(resolveTaskMove(task(tagged), 'status:in-progress', options, noTags), tagged), '- [/] Ship it #status/todo');
    assert.strictEqual(apply(resolveTaskMove(task('- [/] Ship it'), 'status:todo', options, noTags), '- [/] Ship it'), '- [ ] Ship it');
    assert.strictEqual(apply(resolveTaskMove(task('- [/] Ship it'), 'status:blocked', options, noTags), '- [/] Ship it'), '- [=] Ship it');
    assert.deepStrictEqual(resolveTaskMove(task('- [/] Ship it'), 'status:review', options, noTags), {
      kind: 'refused',
      reason: 'No status in the "Tasks: Statuses" setting is called Review. Refresh the board and try again.',
    });
    assert.strictEqual(apply(resolveTaskMove(task('- [/] Ship it'), 'cancelled', options, noTags), '- [/] Ship it'), `- [-] Ship it ❌ ${formatIsoDate(now)}`);
  });

  test('writes namespace tags where they are', () => {
    assert.strictEqual(
      setTaskNamespaceTags('- [ ] Plan #project/x ^id', 3, { remove: ['#project/x'], add: '#project/y' }),
      '- [ ] Plan #project/y ^id',
    );
    assert.strictEqual(
      setTaskNamespaceTags('- [ ] Plan ^id', 3, { remove: [], add: '#project/y' }),
      '- [ ] Plan #project/y ^id',
    );
  });

  test('drops on a status in any script, and writes a namespace tag in any script, as tags are', () => {
    const statuses = [...DEFAULT_TASK_POLICY.statuses, { symbol: 'à', name: 'À faire', type: 'todo' as const }];
    const accented = { ...options, queryContext: { ...options.queryContext, taskPolicy: { ...DEFAULT_TASK_POLICY, statuses } } };
    assert.strictEqual(apply(resolveTaskMove(task('- [ ] Plan'), 'status:à-faire', accented, noTags), '- [ ] Plan'), '- [à] Plan');
    // A label that is the start of a longer tag leaves that tag alone.
    assert.strictEqual(
      setTaskNamespaceTags('- [ ] Plan #project/caf #project/café', 3, { remove: ['#project/caf'], add: '#project/x' }),
      '- [ ] Plan #project/x #project/café',
    );
  });

  test('bands a due date the way the board draws it', () => {
    const context = createQueryContext(now);
    assert.strictEqual(getDueBand(undefined, context), '');
    assert.strictEqual(getDueBand(at(9, 24), context), 'overdue');
    assert.strictEqual(getDueBand(at(9, 25), context), 'today');
    assert.strictEqual(getDueBand(at(9, 26), context), 'tomorrow');
    assert.strictEqual(getDueBand(at(10, 2), context), 'week');
    assert.strictEqual(getDueBand(at(10, 3), context), 'later');
    assert.strictEqual(getDueBand(at(8, 1), context), 'needsdate');
  });

  test('captures into a column with the column’s edit made, or says why not', () => {
    const intoDoing = (task: Task) => resolveTaskMove(task, 'status:in-progress', options, noTags);
    assert.deepStrictEqual(resolveColumnCapture('- [ ] Call Ren', intoDoing), {
      kind: 'capture',
      line: '- [/] Call Ren',
    });
    assert.deepStrictEqual(resolveColumnCapture('Just words', intoDoing), { kind: 'capture', line: 'Just words' });
    assert.deepStrictEqual(resolveColumnCapture('- [ ] Call Ren', (task) => resolveTaskMove(task, 'due:later', options, noTags)), {
      kind: 'refused',
      reason: 'Drop a task on Today, Tomorrow, or No due date to change its due date.',
    });
    assert.deepStrictEqual(resolveColumnCapture('- [ ] Call Ren', (task) => resolveTaskMove(task, 'done', options, noTags)), {
      kind: 'capture',
      line: '- [ ] Call Ren',
    });
  });

  test('a column starts Add Task on an empty task with its edit made', () => {
    const start = (column: string) => resolveColumnCapture('- [ ] ', (task) => resolveTaskMove(task, column, options, noTags));
    assert.deepStrictEqual(start('status:in-progress'), { kind: 'capture', line: '- [/] ' });
    assert.deepStrictEqual(start('priority:high'), { kind: 'capture', line: '- [ ] ⏫' });
    assert.deepStrictEqual(start('due:today'), { kind: 'capture', line: '- [ ] 📅 2026-09-25' });
    assert.deepStrictEqual(start('assignee:@dana'), { kind: 'capture', line: '- [ ] 👤 @dana' });
    assert.deepStrictEqual(start('due:later'), {
      kind: 'refused',
      reason: 'Drop a task on Today, Tomorrow, or No due date to change its due date.',
    });
  });
});
