import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { setTaskPolicy } from '../core/taskPolicy';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { parseLocalDate } from '../ui/commands/dailyNote';
import { createCalendar, shiftMonth } from '../ui/state/calendarState';
import { getCalendarHtml } from '../ui/webview/calendarHtml';
import { parseCalendarMessage } from '../ui/webview/messages';
import { openWebviewPage } from './webviewPage';

suite('Calendar', () => {
  const note = (filePath: string, content: string) =>
    parseMarkdown(filePath, content, { createdAt: 1, updatedAt: 2 }, {});
  const files = [
    note(
      'notes/2026-09-10.md',
      '# 2026-09-10\n- [ ] Call Ren 📅 2026-09-12\n- [x] Send the notes 📅 2026-09-12 ✅ 2026-09-11\n- [ ] Book the room 📅 2026-09-15',
    ),
    note('notes/2026-W37.md', '# 2026-W37'),
    note('notes/2026-09.md', '# 2026-09'),
  ];
  const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
  const calendar = createCalendar(index, '2026-09', new Date(2026, 8, 13, 10));
  const days = new Map(
    calendar.weeks.flatMap((week) => week.days).map((day) => [day.date, day]),
  );

  test('lays out whole weeks, Sunday first', () => {
    assert.strictEqual(calendar.title, 'September 2026');
    assert.deepStrictEqual(
      calendar.weeks.map((week) => week.days[0].date),
      ['2026-08-30', '2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27'],
      'every row opens on a Sunday',
    );
    assert.deepStrictEqual(
      calendar.weeks.map((week) => week.days[6].date.slice(8)),
      ['05', '12', '19', '26', '03'],
      'and closes on a Saturday',
    );
    // A row is a week in its own right, named for the days it holds.
    assert.deepStrictEqual(
      calendar.weeks.map((week) => [week.week, week.date]),
      [
        ['week-2026-08-30-2026-09-05', '2026-08-30'],
        ['week-2026-09-06-2026-09-12', '2026-09-06'],
        ['week-2026-09-13-2026-09-19', '2026-09-13'],
        ['week-2026-09-20-2026-09-26', '2026-09-20'],
        ['week-2026-09-27-2026-10-03', '2026-09-27'],
      ],
    );
    assert.strictEqual(days.get('2026-08-31')?.inMonth, false);
    assert.strictEqual(days.get('2026-09-01')?.inMonth, true);
    assert.strictEqual(calendar.weeks[4].days[6].date, '2026-10-03');
    assert.deepStrictEqual(
      [calendar.previousMonth, calendar.nextMonth, calendar.currentMonth],
      ['2026-08', '2026-10', '2026-09'],
    );
  });

  test('starts each row on the week start, and finds a week note written under another', () => {
    const monday = createCalendar(
      buildWorkspaceIndex(
        new Map(
          [note('notes/week-2026-09-20-2026-09-26.md', '# Week'), note('notes/2026-W37.md', '# 2026-W37')].map(
            (file) => [file.filePath, file],
          ),
        ),
      ),
      '2026-09',
      new Date(2026, 8, 13, 10),
      1,
    );
    assert.deepStrictEqual(monday.weekdays, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    assert.ok(
      monday.weeks.every((week) => parseLocalDate(week.days[0].date)?.getDay() === 1),
      'every row opens on a Monday',
    );
    const row = monday.weeks.find((week) => week.date === '2026-09-21');
    assert.strictEqual(row?.week, 'week-2026-09-21-2026-09-27');
    assert.strictEqual(row?.notePath, 'notes/week-2026-09-20-2026-09-26.md', 'the Sunday note it mostly shares');
    assert.strictEqual(
      monday.weeks.find((week) => week.date === '2026-09-07')?.notePath,
      'notes/2026-W37.md',
      'an ISO week note under either start',
    );
    assert.deepStrictEqual(calendar.weekdays, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    assert.strictEqual(
      calendar.weeks.find((week) => week.date === '2026-09-06')?.notePath,
      'notes/2026-W37.md',
    );
  });

  test('marks the days past needsNewDateAfterDays, and leaves them out at 0', () => {
    assert.strictEqual(calendar.needsNewDateBefore, '2026-08-14', 'thirty days before 2026-09-13');
    setTaskPolicy({ needsNewDateAfterDays: 0 });
    try {
      assert.strictEqual(
        createCalendar(index, '2026-09', new Date(2026, 8, 13, 10)).needsNewDateBefore,
        undefined,
      );
    } finally {
      setTaskPolicy();
    }
  });

  test("marks each day's daily note and open tasks, and today", () => {
    assert.strictEqual(days.get('2026-09-10')?.notePath, 'notes/2026-09-10.md');
    assert.strictEqual(days.get('2026-09-12')?.dueCount, 1, 'a done task is not counted');
    assert.strictEqual(days.get('2026-09-15')?.dueCount, 1);
    assert.strictEqual(days.get('2026-09-14')?.dueCount, 0);
    assert.strictEqual(days.get('2026-09-14')?.notePath, undefined);
    assert.strictEqual(days.get('2026-09-13')?.isToday, true);
    assert.strictEqual(days.get('2026-09-12')?.isToday, false);
    assert.strictEqual(calendar.weeks[1].notePath, 'notes/2026-W37.md');
    assert.strictEqual(calendar.weeks[0].notePath, undefined);
    assert.strictEqual(calendar.notePath, 'notes/2026-09.md');
  });

  test('moves between months across the turn of a year', () => {
    assert.strictEqual(shiftMonth('2026-12', 1), '2027-01');
    assert.strictEqual(shiftMonth('2026-01', -1), '2025-12');
    assert.strictEqual(
      createCalendar(index, '2027-02', new Date(2026, 8, 13)).weeks.length,
      5,
      'February 2027 starts on a Monday, so its first row opens the day before',
    );
  });

  test('reads only real days', () => {
    assert.strictEqual(parseLocalDate('2026-09-13')?.getDate(), 13);
    assert.strictEqual(parseLocalDate('2026-02-30'), undefined);
    assert.strictEqual(parseLocalDate('2026-9-13'), undefined);
  });

  test('accepts only the messages its page posts', () => {
    assert.deepStrictEqual(parseCalendarMessage({ type: 'openDay', date: '2026-09-13' }), {
      type: 'openDay',
      date: '2026-09-13',
    });
    assert.deepStrictEqual(parseCalendarMessage({ type: 'openWeek', date: '2026-09-07' }), {
      type: 'openWeek',
      date: '2026-09-07',
    });
    assert.deepStrictEqual(parseCalendarMessage({ type: 'showMonth', month: '2026-10' }), {
      type: 'showMonth',
      month: '2026-10',
    });
    assert.deepStrictEqual(parseCalendarMessage({ type: 'openMonth', path: '/etc' }), {
      type: 'openMonth',
    });
    assert.strictEqual(parseCalendarMessage({ type: 'showMonth', month: '2026-13' }), undefined);
    assert.strictEqual(parseCalendarMessage({ type: 'openWeek', date: '../notes' }), undefined);
    assert.strictEqual(parseCalendarMessage({ type: 'deleteNote' }), undefined);
    assert.strictEqual(parseCalendarMessage('openDay'), undefined);
  });

  test('a day past the line keeps its count, muted, and says its tasks need a new date', () => {
    const old = buildWorkspaceIndex(
      new Map(
        [note('notes/old.md', '- [ ] Renew the lease 📅 2026-08-03\n- [ ] Chase it 📅 2026-08-20')].map(
          (file) => [file.filePath, file],
        ),
      ),
    );
    const page = openWebviewPage(
      getCalendarHtml({ cspSource: 'vscode-webview://deckard' } as vscode.Webview),
      createCalendar(old, '2026-08', new Date(2026, 8, 13, 10)),
    );
    try {
      const day = (date: string) =>
        page.find(`.calendar-grid .day[data-date="${date}"]`) as HTMLElement;
      assert.ok(day('2026-08-03').querySelector('.due.stale'), 'muted, not orange');
      assert.match(day('2026-08-03').getAttribute('aria-label') ?? '', /, 1 needs a new date$/);
      assert.ok(day('2026-08-20').querySelector('.due.overdue'), 'within 30 days it is overdue');
    } finally {
      page.dispose();
    }
  });

  test('keeps keyboard focus on its day through a redraw, and after a month step', () => {
    const page = openWebviewPage(
      getCalendarHtml({ cspSource: 'vscode-webview://deckard' } as vscode.Webview),
      calendar,
    );
    try {
      const day = (date: string) =>
        page.find(`.calendar-grid .day[data-date="${date}"]`) as HTMLElement;
      const key = (target: HTMLElement, name: string) =>
        target.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: name, bubbles: true }));

      day('2026-09-13').focus();
      key(day('2026-09-13'), 'ArrowRight');
      assert.strictEqual(page.document.activeElement, day('2026-09-14'));

      // A save anywhere sends the month again.
      page.send(calendar);
      assert.strictEqual(page.document.activeElement, day('2026-09-14'), 'focus survives the redraw');
      assert.strictEqual(day('2026-09-14').getAttribute('tabindex'), '0');

      key(day('2026-09-14'), 'PageDown');
      assert.deepStrictEqual(page.lastPosted('showMonth'), { type: 'showMonth', month: '2026-10' });
      page.send(createCalendar(index, '2026-10', new Date(2026, 8, 13, 10)));
      assert.strictEqual(
        (page.document.activeElement as HTMLElement).dataset.date,
        '2026-10-14',
        'the same day of the next month',
      );
    } finally {
      page.dispose();
    }
  });
});
