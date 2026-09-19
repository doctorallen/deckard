import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import { WorkspaceIndex } from '../core/types';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import {
  countDueTasks,
  describeDueTasks,
  describeDueTasksAtLength,
  millisecondsUntil,
  parseReminderTime,
} from '../ui/views/taskStatusBar';

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
    assert.deepStrictEqual(countDueTasks(index, now), {
      overdue: 1,
      today: 1,
    });
    assert.deepStrictEqual(countDueTasks(indexOf({}), now), {
      overdue: 0,
      today: 0,
    });
  });

  test('says it in the bar, and at length in the reminder', () => {
    assert.strictEqual(
      describeDueTasks({ overdue: 1, today: 1 }),
      '2 due today, 1 overdue',
    );
    assert.strictEqual(describeDueTasks({ overdue: 0, today: 3 }), '3 due today');
    assert.strictEqual(
      describeDueTasks({ overdue: 0, today: 0 }),
      undefined,
      'nothing due leaves the bar alone',
    );
    assert.strictEqual(
      describeDueTasksAtLength({ overdue: 2, today: 1 }),
      '3 tasks are due today, 2 of them overdue.',
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

  test('waits for the next time that hour comes round', () => {
    const morning = new Date(2026, 8, 19, 8, 30, 0);
    assert.strictEqual(millisecondsUntil(9 * 60, morning), 30 * 60 * 1000);
    // Past the hour today, so it is tomorrow's.
    assert.strictEqual(
      millisecondsUntil(8 * 60, morning),
      (24 * 60 - 30) * 60 * 1000,
    );
  });
});
