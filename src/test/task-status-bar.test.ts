import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { WorkspaceIndex } from '../core/types';
import { buildWorkspaceIndex } from '../core/workspace/indexState';
import {
  countDueTasks,
  describeDueTasks,
  describeDueTasksAtLength,
  describeNeedsNewDate,
  isReminderDue,
  parseReminderTime,
  REMINDER_DATE_KEY,
  TaskStatusBar,
} from '../ui/views/taskStatusBar';
import { createQueryContext } from '../core/query/queryContext';

function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(
      Object.entries(notes).map(([filePath, content]) => [
        filePath,
        parseMarkdown(filePath, content),
      ]),
    ),
  );
}

suite('Task status bar', () => {
  const now = new Date(2026, 8, 19, 10, 0, 0).getTime();
  const index = indexOf({
    'notes/Atlas.md': [
      '# Atlas',
      '',
      '- [ ] Chase the contractor 📅 2026-09-17',
      '- [ ] Send the proposal 📅 2026-09-19',
      '- [ ] Read the survey 📅 2026-09-25',
      '- [x] Filed the report 📅 2026-09-18',
      '- [ ] Someday, with no date',
    ].join('\n'),
  });

  test('counts what is overdue and what is due today', () => {
    assert.deepStrictEqual(countDueTasks(index, createQueryContext(now)), {
      overdue: 1,
      today: 1,
      needsNewDate: 0,
      doneToday: 0,
    });
    assert.deepStrictEqual(countDueTasks(indexOf({}), createQueryContext(now)), {
      overdue: 0,
      today: 0,
      needsNewDate: 0,
      doneToday: 0,
    });
    assert.strictEqual(
      countDueTasks(indexOf({ 'notes/Done.md': '- [x] Filed it ✅ 2026-09-19' }), createQueryContext(now)).doneToday,
      1,
      'what was finished today',
    );
  });

  test('leaves a task more than 30 days overdue out of the count, and names it apart', () => {
    const old = indexOf({
      'notes/Old.md': [
        '- [ ] Chase the contractor 📅 2026-09-17',
        '- [ ] File the July report 📅 2026-07-01',
        '- [ ] Renew the lease 📅 2026-06-12',
      ].join('\n'),
    });
    assert.deepStrictEqual(countDueTasks(old, createQueryContext(now)), { overdue: 1, today: 0, needsNewDate: 2, doneToday: 0 });
    assert.strictEqual(describeDueTasks(countDueTasks(old, createQueryContext(now))), '1 overdue');
    assert.strictEqual(describeNeedsNewDate(2), '2 tasks need a new date.');
    assert.strictEqual(describeNeedsNewDate(1), '1 task needs a new date.');
    assert.strictEqual(describeNeedsNewDate(0), undefined);
    const onlyOld = indexOf({ 'notes/Old.md': '- [ ] Renew the lease 📅 2026-06-12' });
    assert.strictEqual(describeDueTasks(countDueTasks(onlyOld, createQueryContext(now))), undefined, 'the bar stays hidden');
  });

  test('says it in the bar, and at length in the reminder', () => {
    assert.strictEqual(
      describeDueTasks({ overdue: 1, today: 1 }),
      '1 overdue, 1 due today',
      'each number names its own group, never their sum',
    );
    assert.strictEqual(describeDueTasks({ overdue: 0, today: 3 }), '3 due today');
    assert.strictEqual(describeDueTasks({ overdue: 2, today: 0 }), '2 overdue');
    assert.strictEqual(
      describeDueTasks({ overdue: 0, today: 0 }),
      undefined,
      'nothing due leaves the bar alone',
    );
    assert.strictEqual(
      describeDueTasksAtLength({ overdue: 2, today: 1 }),
      '2 tasks are overdue and 1 is due today.',
    );
    assert.strictEqual(
      describeDueTasksAtLength({ overdue: 1, today: 0 }),
      '1 task is overdue.',
    );
    assert.strictEqual(
      describeDueTasksAtLength({ overdue: 0, today: 1 }),
      '1 task is due today.',
    );
    assert.strictEqual(
      describeDueTasksAtLength({ overdue: 0, today: 0 }),
      'Nothing is due today.',
    );
  });

  test('reads a reminder time, and refuses anything else', () => {
    assert.strictEqual(parseReminderTime('09:00'), 9 * 60);
    assert.strictEqual(parseReminderTime(' 23:59 '), 23 * 60 + 59);
    assert.strictEqual(parseReminderTime('7:05'), 7 * 60 + 5);
    for (const value of ['', 'morning', '24:00', '09:60', '09', '9:5']) {
      assert.strictEqual(parseReminderTime(value), undefined, value);
    }
  });

  test('is owed once a day, from the hour on, and never for a day gone by', () => {
    const at = (hour: number, minute = 0) => new Date(2026, 8, 19, hour, minute);
    assert.strictEqual(isReminderDue(at(8, 59), 9 * 60, undefined), false, 'before the hour');
    assert.strictEqual(isReminderDue(at(9, 0), 9 * 60, undefined), true, 'at the hour');
    assert.strictEqual(isReminderDue(at(15, 30), 9 * 60, '2026-09-18'), true, 'late, after sleep');
    assert.strictEqual(isReminderDue(at(9, 5), 9 * 60, '2026-09-19'), false, 'said today already');
    assert.strictEqual(
      isReminderDue(at(23, 0), 9 * 60, '2026-09-18'),
      true,
      'yesterday said, today owed',
    );
  });

  test('writes the day down before it says the reminder', async () => {
    const stored = new Map<string, unknown>();
    const memory = {
      get: <T>(key: string) => stored.get(key) as T | undefined,
      update: async (key: string, value: unknown) => void stored.set(key, value),
    } as unknown as vscode.Memento;
    const configuration = vscode.workspace.getConfiguration('deckard');
    await configuration.update('taskReminderTime', '09:00', vscode.ConfigurationTarget.Global);
    const window = vscode.window as unknown as { showInformationMessage: unknown };
    const original = window.showInformationMessage;
    const said: string[] = [];
    // The reader has not answered yet.
    const stub = (text: string) => {
      said.push(text);
      return new Promise(() => undefined);
    };
    window.showInformationMessage = stub;
    assert.strictEqual(window.showInformationMessage, stub, 'the message can be stood in for');
    const bar = new TaskStatusBar(
      {
        ready: new Promise(() => undefined),
        onDidUpdate: new vscode.EventEmitter<WorkspaceIndex>().event,
        getSnapshot: () => index,
      },
      memory,
      () => new Date(2026, 8, 19, 9, 5),
    );
    try {
      void bar.check();
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.strictEqual(stored.get(REMINDER_DATE_KEY), '2026-09-19');
      assert.strictEqual(said.length, 1);
      assert.match(said[0], /1 task is overdue and 1 is due today/);

      void bar.check();
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.strictEqual(said.length, 1, 'once a day');
    } finally {
      bar.dispose();
      window.showInformationMessage = original;
      await configuration.update('taskReminderTime', undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
