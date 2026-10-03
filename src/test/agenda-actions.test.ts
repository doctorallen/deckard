import * as assert from 'assert';

import * as vscode from 'vscode';

import { describeLoad, describeLoadAfter, planSpread, planThreeToday } from '../ui/commands/agendaActions';
import { validateDateInput } from '../ui/commands/datePrompt';
import { countLoad, dueDateFor } from '../domain/tasks/reschedule';
import { Task } from '../domain/model';

suite('Dating tasks from the Tasks view', () => {
  test('names a date the way the menu does', () => {
    // Friday 2026-09-25, noon.
    const friday = new Date(2026, 8, 25, 12).getTime();
    assert.strictEqual(dueDateFor('today', friday), '2026-09-25');
    assert.strictEqual(dueDateFor('tomorrow', friday), '2026-09-26');
    assert.strictEqual(dueDateFor('nextWeek', friday), '2026-09-28', 'next week is its Monday');
    const monday = new Date(2026, 8, 28, 9).getTime();
    assert.strictEqual(dueDateFor('nextWeek', monday), '2026-10-05', 'on a Monday, the one after');
  });

  test('a date box says back the day it read, or the one error', () => {
    const friday = new Date(2026, 8, 25, 12).getTime();
    assert.deepStrictEqual(validateDateInput('monday', friday), {
      message: 'Monday 2026-09-28 · in 3 days',
      severity: vscode.InputBoxValidationSeverity.Info,
    });
    assert.strictEqual(
      validateDateInput('blah', friday),
      'Enter a date such as friday, in 3 days, or 2026-10-02.',
    );
  });

  const task = (id: string, values: Partial<Task> = {}): Task => ({
    id,
    filePath: 'notes/tasks.md',
    title: id,
    completed: false,
    tags: [],
    tagLabels: {},
    lineNumber: Number(id.replace(/\D/g, '')) || 1,
    checkboxColumn: 3,
    checkboxValue: ' ',
    sourceLineText: `- [ ] ${id}`,
    ...values,
  });

  test('spreads tasks over the next five weekdays, oldest due first, earlier days taking the rest', () => {
    const friday = new Date(2026, 8, 25, 12).getTime();
    const tasks = Array.from({ length: 17 }, (_, n) =>
      task(`t${n + 1}`, { dueAt: new Date(2026, 7, 1 + n).getTime() }),
    );
    const plan = planSpread(tasks, friday);
    const perDay = new Map<string, number>();
    plan.forEach((date) => perDay.set(date, (perDay.get(date) ?? 0) + 1));
    assert.deepStrictEqual([...perDay.entries()], [
      ['2026-09-25', 4],
      ['2026-09-28', 4],
      ['2026-09-29', 3],
      ['2026-09-30', 3],
      ['2026-10-01', 3],
    ], 'Friday, then the weekdays after the weekend');
    assert.strictEqual(plan.get('t1'), '2026-09-25', 'the oldest go first');
    const saturday = new Date(2026, 8, 26, 12).getTime();
    assert.strictEqual(planSpread([task('a1')], saturday).get('a1'), '2026-09-28', 'a weekend starts on Monday');
  });

  test('keeps three for today by priority, then oldest, and moves the rest to next Monday', () => {
    const friday = new Date(2026, 8, 25, 12).getTime();
    const plan = planThreeToday(
      [
        task('a1', { priority: 'low', dueAt: new Date(2026, 8, 1).getTime() }),
        task('a2', { priority: 'high', dueAt: new Date(2026, 8, 20).getTime() }),
        task('a3', { dueAt: new Date(2026, 8, 2).getTime() }),
        task('a4', { dueAt: new Date(2026, 8, 3).getTime() }),
        task('a5', { priority: 'highest' }),
      ],
      friday,
    );
    assert.deepStrictEqual(Object.fromEntries(plan), {
      a5: '2026-09-25',
      a2: '2026-09-25',
      a3: '2026-09-25',
      a4: '2026-09-28',
      a1: '2026-09-28',
    });
  });

  test('says how full a day is, before and after', () => {
    const friday = new Date(2026, 8, 25, 12).getTime();
    assert.strictEqual(describeLoad({ due: 3, scheduled: 1 }), '3 due · 1 scheduled');
    assert.strictEqual(describeLoad({ due: 0, scheduled: 0 }), 'nothing due');
    assert.deepStrictEqual(
      countLoad(
        [
          task('b1', { dueAt: new Date(2026, 8, 25).getTime() }),
          task('b2', { scheduledAt: new Date(2026, 8, 25).getTime() }),
          task('b3', { dueAt: new Date(2026, 8, 25).getTime(), completed: true }),
        ],
        '2026-09-25',
      ),
      { due: 1, scheduled: 1 },
    );
    assert.strictEqual(
      describeLoadAfter('2026-09-25', friday, { today: 22, due: 0 }),
      'Today now has 22 tasks.',
    );
    assert.strictEqual(
      describeLoadAfter('2026-09-28', friday, { today: 22, due: 9 }),
      'Mon 2026-09-28 now has 9 tasks due.',
    );
  });
});
