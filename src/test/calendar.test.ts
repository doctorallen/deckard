import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createCalendar, shiftMonth } from '../ui/state/calendarState';
import { openWebviewPage } from './webviewPage';
import { renderPage } from './pages';
import { createQueryContext } from '../domain/query/queryContext';
import { parseLocalDate } from '../domain/notes/periodicNotes';

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
  const calendar = createCalendar(index, '2026-09', createQueryContext(new Date(2026, 8, 13, 10).getTime()));
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
      createQueryContext(new Date(2026, 8, 13, 10).getTime(), { weekStart: 1 }),
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
    const off = createQueryContext(new Date(2026, 8, 13, 10).getTime(), {
      taskPolicy: { needsNewDateAfterDays: 0 },
    });
    assert.strictEqual(createCalendar(index, '2026-09', off).needsNewDateBefore, undefined);
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
      createCalendar(index, '2027-02', createQueryContext(new Date(2026, 8, 13).getTime())).weeks.length,
      5,
      'February 2027 starts on a Monday, so its first row opens the day before',
    );
  });

  test('reads only real days', () => {
    assert.strictEqual(parseLocalDate('2026-09-13')?.getDate(), 13);
    assert.strictEqual(parseLocalDate('2026-02-30'), undefined);
    assert.strictEqual(parseLocalDate('2026-9-13'), undefined);
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
      renderPage('calendar'),
      createCalendar(old, '2026-08', createQueryContext(new Date(2026, 8, 13, 10).getTime())),
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
      renderPage('calendar'),
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
      page.send(createCalendar(index, '2026-10', createQueryContext(new Date(2026, 8, 13, 10).getTime())));
      assert.strictEqual(
        (page.document.activeElement as HTMLElement).dataset.date,
        '2026-10-14',
        'the same day of the next month',
      );
    } finally {
      page.dispose();
    }
  });

  test('with the weekends hidden, Page Down lands on a weekday the next month draws', () => {
    const now = new Date(2026, 8, 13, 10).getTime();
    const key = (page: ReturnType<typeof openWebviewPage>, date: string, name: string) => {
      const day = page.find(`.calendar-grid .day[data-date="${date}"]`) as HTMLElement;
      day.focus();
      day.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: name, bubbles: true }));
    };
    // October 10th, 2026 is a Saturday, and October 31st another.
    const sidebar = openWebviewPage(renderPage('calendar'), createCalendar(index, '2026-09', createQueryContext(now), { showWeekends: false }));
    try {
      key(sidebar, '2026-09-10', 'PageDown');
      assert.deepStrictEqual(sidebar.lastPosted('showMonth'), { type: 'showMonth', month: '2026-10' });
      sidebar.send(createCalendar(index, '2026-10', createQueryContext(now), { showWeekends: false }));
      assert.strictEqual((sidebar.document.activeElement as HTMLElement).dataset.date, '2026-10-12', 'on to Monday, which is drawn');
    } finally {
      sidebar.dispose();
    }
    const panel = openWebviewPage(
      renderPage('calendar'),
      createCalendar(index, '2026-09', createQueryContext(now), { showWeekends: false, dayPanel: true }),
    );
    try {
      key(panel, '2026-09-10', 'PageDown');
      assert.deepStrictEqual(panel.lastPosted('showMonth'), { type: 'showMonth', month: '2026-10', date: '2026-10-12' }, 'the day chosen is one the grid draws');
      key(panel, '2026-09-30', 'PageDown');
      assert.deepStrictEqual(panel.lastPosted('showMonth'), { type: 'showMonth', month: '2026-10', date: '2026-10-30' });
    } finally {
      panel.dispose();
    }
  });

  test('End past the grid asks for the next month with no day, not with one an earlier step left waiting', () => {
    const now = new Date(2026, 8, 13, 10).getTime();
    const september = createCalendar(index, '2026-09', createQueryContext(now), { dayPanel: true });
    const page = openWebviewPage(renderPage('calendar'), september);
    try {
      const day = (date: string) => page.find(`.calendar-grid .day[data-date="${date}"]`) as HTMLElement;
      const key = (date: string, name: string) => {
        day(date).focus();
        day(date).dispatchEvent(new page.window.KeyboardEvent('keydown', { key: name, bubbles: true }));
      };
      // A step down past the last row waits for October 7th, but a save
      // sends September again before October is drawn.
      key('2026-09-30', 'ArrowDown');
      assert.deepStrictEqual(page.lastPosted('showMonth'), { type: 'showMonth', month: '2026-10', date: '2026-10-07' });
      page.send(september);
      // No grid draws a short row today, so one is made here by taking the
      // row's last two days out, and End from its first falls past the edge.
      day('2026-10-02').remove();
      day('2026-10-03').remove();
      key('2026-09-27', 'End');
      assert.deepStrictEqual(page.lastPosted('showMonth'), { type: 'showMonth', month: '2026-10' }, 'the host keeps the chosen day\'s place');
      page.send(createCalendar(index, '2026-10', createQueryContext(now), { dayPanel: true }));
      assert.notStrictEqual((page.document.activeElement as HTMLElement | null)?.dataset.date, '2026-10-07', 'and the old step is not focused');
    } finally {
      page.dispose();
    }
  });

  test('draws a repeating task on each later date its rule lands on, quieter than a due date', () => {
    const repeating = buildWorkspaceIndex(new Map([
      ['notes/home.md', note('notes/home.md', '# Home\n- [ ] Water the plants 📅 2026-09-15 🔁 every week\n- [ ] Pay rent 📅 2026-09-14 🔁 every month when done\n- [x] Old chore 📅 2026-09-01 🔁 every day ✅ 2026-09-01')],
    ]));
    const now = new Date(2026, 8, 13, 10);
    const shown = createCalendar(repeating, '2026-09', createQueryContext(now.getTime()), { showRepeats: true, dayPanel: true, selectedDate: '2026-09-22' });
    const day = (date: string) => shown.weeks.flatMap((week) => week.days).find((entry) => entry.date === date);
    assert.strictEqual(day('2026-09-15')?.dueCount, 1, 'its own date is due');
    assert.strictEqual(day('2026-09-15')?.repeatCount, undefined, 'and not a repeat as well');
    assert.deepStrictEqual(
      ['2026-09-22', '2026-09-29', '2026-10-06'].map((date) => day(date)?.repeatCount),
      [1, 1, undefined],
      'every week after it, into the next month as far as the grid draws',
    );
    assert.deepStrictEqual(day('2026-09-22')?.repeatTitles, ['Water the plants']);
    assert.strictEqual(day('2026-10-14'), undefined);
    assert.strictEqual(day('2026-10-03')?.repeatCount, undefined, 'a when done rule is not projected');
    assert.deepStrictEqual(shown.selected?.repeats?.map((item) => item.task.title), ['Water the plants']);
    assert.deepStrictEqual(shown.selected?.due, [], 'a repeat is not due');

    const off = createCalendar(repeating, '2026-09', createQueryContext(now.getTime()), { dayPanel: true, selectedDate: '2026-09-22' });
    assert.strictEqual(off.weeks.flatMap((week) => week.days).find((entry) => entry.date === '2026-09-22')?.repeatCount, undefined);
    assert.strictEqual(off.selected?.repeats, undefined, 'the setting off draws none');

    const page = openWebviewPage(renderPage('calendar'), shown);
    try {
      const cell = page.find('.calendar-grid .day[data-date="2026-09-22"]');
      assert.strictEqual(cell.querySelector('.repeat-count')?.textContent, '↻');
      assert.match(cell.getAttribute('aria-label') ?? '', /1 repeat$/);
      assert.match(cell.getAttribute('data-tip') ?? '', /↻ Water the plants/);
      const row = page.find('.day-panel [aria-label="Repeats"] .task-row');
      assert.strictEqual(row.querySelector('input[type="checkbox"]'), null, 'a later date is not completed from here');
      (row.querySelector('.task-title') as HTMLElement).click();
      assert.deepStrictEqual(page.lastPosted('openTask'), { type: 'openTask', taskId: row.getAttribute('data-task-id') });
    } finally {
      page.dispose();
    }
  });

  test('leaves the weekends out when they are hidden, in the sidebar and on the page', () => {
    const now = new Date(2026, 8, 13, 10);
    const hidden = createCalendar(index, '2026-09', createQueryContext(now.getTime()), { showWeekends: false });
    assert.strictEqual(hidden.hideWeekends, true);
    assert.strictEqual(createCalendar(index, '2026-09', createQueryContext(now.getTime())).hideWeekends, undefined, 'drawn unless turned off');
    const sidebar = openWebviewPage(renderPage('calendar'), hidden);
    try {
      assert.deepStrictEqual(sidebar.findAll('.weekday').map((cell) => cell.textContent).filter(Boolean), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
      assert.ok(sidebar.find('.calendar-grid').classList.contains('no-weekends'));
      assert.strictEqual(sidebar.findAll('.calendar-grid .day[data-date="2026-09-12"]').length, 0, 'no Saturday');
      assert.strictEqual(sidebar.findAll('.calendar-grid .day[data-date="2026-09-13"]').length, 0, 'no Sunday');
      assert.strictEqual(sidebar.findAll('.calendar-grid .day').length, 25, 'five weeks of five days');
    } finally {
      sidebar.dispose();
    }
    const page = openWebviewPage(
      renderPage('calendarPage'),
      createCalendar(index, '2026-09', createQueryContext(now.getTime()), { showWeekends: false, dayPanel: true, layout: 'page' }),
    );
    try {
      assert.strictEqual(page.findAll('.day-cell[data-drop-date="2026-09-12"]').length, 0);
      page.click('.view-options [data-action="set-show-weekends"][data-value="on"]');
      assert.deepStrictEqual(page.lastPosted('setShowWeekends'), { type: 'setShowWeekends', show: true });
    } finally {
      page.dispose();
    }
  });

  test('the page draws again as its template did: a layout chosen in the gear closes it, and a snapshot folds Done and drops a drag\'s marks', () => {
    const now = new Date(2026, 8, 13, 10);
    const done = buildWorkspaceIndex(new Map([
      ['notes/a.md', note('notes/a.md', '- [ ] Call Ren 📅 2026-09-13\n- [x] Filed 📅 2026-09-12 ✅ 2026-09-13\n')],
    ]));
    const snapshot = createCalendar(done, '2026-09', createQueryContext(now.getTime()), { dayPanel: true, layout: 'page' });
    const page = openWebviewPage(renderPage('calendarPage'), snapshot);
    try {
      const gear = page.find('.view-options') as HTMLDetailsElement;
      gear.open = true;
      page.click('.view-options [data-action="set-calendar-layout"][data-value="week"]');
      assert.ok(page.find('.calendar-page-body').classList.contains('is-week'));
      assert.strictEqual((page.find('.view-options') as HTMLDetailsElement).open, false, 'the gear the layout was chosen in closes');

      (page.find('.day-panel details.day-group') as HTMLDetailsElement).open = true;
      const chip = page.find('.cal-chip[data-kind="due"]');
      chip.dispatchEvent(new page.window.Event('dragstart', { bubbles: true }));
      page.find('.day-cell[data-drop-date="2026-09-14"]').dispatchEvent(new page.window.Event('dragover', { bubbles: true, cancelable: true }));
      assert.ok(chip.classList.contains('dragging'));
      assert.ok(page.find('.day-cell[data-drop-date="2026-09-14"]').classList.contains('drop-target'));
      page.send(snapshot);
      assert.strictEqual((page.find('.day-panel details.day-group') as HTMLDetailsElement).open, false, 'Done folds again');
      assert.strictEqual(page.findAll('.dragging, .drop-target, .is-pending').length, 0, 'a drag\'s marks go');
      page.find('.day-cell[data-drop-date="2026-09-15"]').dispatchEvent(new page.window.Event('drop', { bubbles: true, cancelable: true }));
      assert.deepStrictEqual(page.lastPosted('moveTask'), { type: 'moveTask', taskId: chip.getAttribute('data-task-id'), field: 'due', date: '2026-09-15' });
      assert.strictEqual(page.findAll('.is-pending').length, 0, 'a chip drawn again since the drag began is not marked');
    } finally {
      page.dispose();
    }
  });

  test('the page keeps its layout and where it was scrolled, and draws with them when VS Code loads it again', async () => {
    const now = new Date(2026, 8, 13, 10);
    const snapshot = createCalendar(index, '2026-09', createQueryContext(now.getTime()), { dayPanel: true, layout: 'page' });
    const page = openWebviewPage(renderPage('calendarPage'), snapshot);
    try {
      assert.strictEqual(page.savedState(), undefined, 'nothing is kept until the reader chooses');
      page.click('.calendar-page-actions [data-action="set-calendar-layout"][data-value="week"]');
      assert.deepStrictEqual(page.savedState(), { layout: 'week' });
      page.window.dispatchEvent(new page.window.Event('scroll'));
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.deepStrictEqual(page.savedState(), { layout: 'week', scrollY: 0 });
    } finally {
      page.dispose();
    }
    // Drawn from its shell, as a hidden page is when it is shown again.
    const kept = openWebviewPage(renderPage('calendarPage', { state: snapshot }), undefined, { savedState: { layout: 'week', scrollY: 120 } });
    try {
      assert.ok(kept.find('.calendar-page-body').classList.contains('is-week'), 'the week it was left on');
      assert.deepStrictEqual(kept.savedState(), { layout: 'week', scrollY: 120 }, 'and nothing it kept is lost');
    } finally {
      kept.dispose();
    }
  });
});
