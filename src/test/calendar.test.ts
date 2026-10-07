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

  test('the Week layout keeps a day of the week it draws in the Tab order', () => {
    const now = new Date(2026, 8, 13, 10).getTime();
    const snapshot = (selectedDate: string) =>
      createCalendar(index, '2026-09', createQueryContext(now), { dayPanel: true, layout: 'page', selectedDate });
    const page = openWebviewPage(renderPage('calendarPage', { state: snapshot('2026-09-08') }), undefined, { savedState: { layout: 'week' } });
    try {
      const tabStops = () => page.findAll('.calendar-grid .day[tabindex="0"]').map((day) => (day as HTMLElement).dataset.date);
      assert.deepStrictEqual(tabStops(), ['2026-09-08']);
      page.click('.calendar-grid .day[data-date="2026-09-09"]');
      // The host chooses a day in another week, as the Related Notes day does.
      page.send(snapshot('2026-09-22'));
      assert.deepStrictEqual(
        page.findAll('.calendar-grid .day').map((day) => (day as HTMLElement).dataset.date),
        ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26'],
        'the chosen day\'s week is drawn',
      );
      assert.deepStrictEqual(tabStops(), ['2026-09-22'], 'the chosen day takes Tab, not the day focused in a week not drawn');
    } finally {
      page.dispose();
    }
  });

  test('draws a repeating task on each later date its rule lands on, quieter than a due date', () => {
    const repeating = buildWorkspaceIndex(new Map([
      ['notes/home.md', note('notes/home.md', '# Home\n- [ ] Water the plants 📅 2026-09-15 🔁 every week\n- [ ] Pay rent 📅 2026-09-14 🔁 every month when done\n- [x] Old chore 📅 2026-09-01 🔁 every day ✅ 2026-09-01')],
    ]));
    const now = new Date(2026, 8, 13, 10);
    const shown = createCalendar(repeating, '2026-09', createQueryContext(now.getTime()), { dayPanel: true, selectedDate: '2026-09-22' });
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
      assert.deepStrictEqual(page.lastPosted('moveTask'), { type: 'moveTask', taskId: chip.getAttribute('data-task-id'), field: 'due', date: '2026-09-15', requestId: 1 });
      assert.strictEqual(page.findAll('.is-pending').length, 0, 'a chip drawn again since the drag began is not marked');
    } finally {
      page.dispose();
    }
  });

  test('the page numbers each move, and a refusal names and puts back the move it refuses', () => {
    const now = new Date(2026, 8, 13, 10);
    const moving = buildWorkspaceIndex(new Map([['notes/a.md', note('notes/a.md', '- [ ] Call Ren 📅 2026-09-13\n')]]));
    const page = openWebviewPage(renderPage('calendarPage'), createCalendar(moving, '2026-09', createQueryContext(now.getTime()), { dayPanel: true, layout: 'page' }));
    try {
      const chip = page.find('.cal-chip[data-kind="due"]');
      const taskId = chip.getAttribute('data-task-id');
      const drag = (date: string) => {
        chip.dispatchEvent(new page.window.Event('dragstart', { bubbles: true }));
        page.find(`.day-cell[data-drop-date="${date}"]`).dispatchEvent(new page.window.Event('drop', { bubbles: true, cancelable: true }));
      };
      const refuse = (requestId: number) =>
        page.window.dispatchEvent(new page.window.MessageEvent('message', { data: { type: 'moveRefused', taskId, requestId } }));
      // Dragged twice before the host answers either move.
      drag('2026-09-15');
      assert.deepStrictEqual(page.lastPosted('moveTask'), { type: 'moveTask', taskId, field: 'due', date: '2026-09-15', requestId: 1 });
      drag('2026-09-16');
      assert.deepStrictEqual(page.lastPosted('moveTask'), { type: 'moveTask', taskId, field: 'due', date: '2026-09-16', requestId: 2 });
      assert.ok(chip.classList.contains('is-pending'));

      refuse(1);
      assert.strictEqual(page.text('#live-status'), '"Call Ren" was not moved to 2026-09-15.');
      assert.ok(chip.classList.contains('is-pending'), 'the later move still waits');
      refuse(2);
      assert.strictEqual(page.text('#live-status'), '"Call Ren" was not moved to 2026-09-16.');
      assert.ok(!chip.classList.contains('is-pending'), 'and the chip is put back once no move of it waits');
    } finally {
      page.dispose();
    }
  });

  test('the page keeps its layout and where it was scrolled, and draws with them when VS Code loads it again', () => {
    const now = new Date(2026, 8, 13, 10);
    const snapshot = createCalendar(index, '2026-09', createQueryContext(now.getTime()), { dayPanel: true, layout: 'page' });
    // On a clock moved by hand: webview-saved-state.test.ts waits the same
    // scroll timer (shared/scroll.ts) out on the real one.
    const page = openWebviewPage(renderPage('calendarPage'), snapshot, { clock: true });
    try {
      assert.strictEqual(page.savedState(), undefined, 'nothing is kept until the reader chooses');
      page.click('.calendar-page-actions [data-action="set-calendar-layout"][data-value="week"]');
      assert.deepStrictEqual(page.savedState(), { layout: 'week' });
      page.window.dispatchEvent(new page.window.Event('scroll'));
      page.clock!.advance(250);
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

  test('a day chosen just before a step never takes the calendar back to the month it left', () => {
    const now = new Date(2026, 8, 13, 10).getTime();
    const steps = (page: ReturnType<typeof openWebviewPage>) =>
      page.posted.filter((message) => message.type === 'selectDay' || message.type === 'showMonth');
    // On clocks moved by hand, past the 120 ms a chosen day waits to be
    // sent: calendar-day.test.ts waits it out on the real one.
    const pause = (page: ReturnType<typeof openWebviewPage>) => page.clock!.advance(200);
    const page = openWebviewPage(renderPage('calendarPage'), createCalendar(index, '2026-09', createQueryContext(now), { dayPanel: true, layout: 'page' }), { clock: true });
    try {
      page.click('.day-cell[data-drop-date="2026-09-15"]');
      page.document.body.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: ']', bubbles: true, cancelable: true }));
      pause(page);
      assert.deepStrictEqual(steps(page), [{ type: 'showMonth', month: '2026-10', date: '2026-10-15' }], 'the step names its day, so the one waiting is let go');
    } finally {
      page.dispose();
    }
    const sidebar = openWebviewPage(renderPage('calendar'), createCalendar(index, '2026-09', createQueryContext(now), { dayPanel: true }), { clock: true });
    try {
      sidebar.click('.calendar-grid .day[data-date="2026-09-15"]');
      sidebar.click('[data-action="show-month"][data-month="2026-10"]');
      pause(sidebar);
      assert.deepStrictEqual(
        steps(sidebar),
        [{ type: 'selectDay', date: '2026-09-15' }, { type: 'showMonth', month: '2026-10' }],
        'the step names no day, so the host is told the chosen one first, and steps from it',
      );
    } finally {
      sidebar.dispose();
    }
  });

  test('the Week layout steps on from the week it draws, and offers Today, when the chosen day is in another month', () => {
    // Just after midnight turns today into the next month, the host still
    // shows the month before, with today chosen.
    const now = new Date(2026, 8, 13, 10).getTime();
    const snapshot = createCalendar(index, '2026-11', createQueryContext(now), { dayPanel: true, layout: 'page' });
    assert.strictEqual(snapshot.selectedDate, '2026-09-13');
    const page = openWebviewPage(renderPage('calendarPage'), snapshot, { savedState: { layout: 'week' } });
    try {
      assert.strictEqual(page.text('.calendar-title'), '2026-11-01 to 2026-11-07');
      assert.ok(page.find('[data-action="go-today"]'), 'the week drawn is not today\'s, so Today is offered');
      page.click('[data-action="step-calendar"][data-by="1"]');
      assert.deepStrictEqual(page.lastPosted('selectDay'), { type: 'selectDay', date: '2026-11-08' }, 'the week after the one drawn');
    } finally {
      page.dispose();
    }
  });

  test('a tag in a day panel task opens the tag, in the sidebar and on the page', () => {
    const now = new Date(2026, 8, 13, 10).getTime();
    const tagged = note('notes/a.md', '# A\n- [ ] Call Ren #project/atlas 📅 2026-09-13\n');
    const taggedIndex = buildWorkspaceIndex(new Map([[tagged.filePath, tagged]]));
    for (const [id, layout] of [['calendar', 'sidebar'], ['calendarPage', 'page']] as const) {
      const page = openWebviewPage(renderPage(id), createCalendar(taggedIndex, '2026-09', createQueryContext(now), { dayPanel: true, layout }));
      try {
        const before = page.posted.length;
        page.click('.day-panel .task-row [data-action="open-tag"]');
        assert.deepStrictEqual(page.posted.slice(before), [{ type: 'openTag', tagKey: '#project/atlas' }], `${id}: the tag opens, not the task`);
      } finally {
        page.dispose();
      }
    }
  });

  test('without the day panel, a double-click on a day opens its note once', () => {
    const page = openWebviewPage(renderPage('calendar'), calendar);
    try {
      const day = page.find('.calendar-grid .day[data-date="2026-09-14"]');
      for (const detail of [1, 2]) {
        day.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, detail }));
      }
      day.dispatchEvent(new page.window.MouseEvent('dblclick', { bubbles: true, detail: 2 }));
      assert.deepStrictEqual(page.posted.filter((message) => message.type === 'openDay'), [{ type: 'openDay', date: '2026-09-14' }]);
    } finally {
      page.dispose();
    }
  });

  test('on the page, Next month keeps the focus on the button, and ] on a day takes it to the day stepped to', () => {
    const now = new Date(2026, 8, 13, 10).getTime();
    const month = (name: string, selectedDate: string) =>
      createCalendar(index, name, createQueryContext(now), { dayPanel: true, layout: 'page', selectedDate });
    const page = openWebviewPage(renderPage('calendarPage'), month('2026-09', '2026-09-14'));
    try {
      const next = () => page.find('[data-action="step-calendar"][data-by="1"]') as HTMLElement;
      next().focus();
      next().click();
      assert.deepStrictEqual(page.lastPosted('showMonth'), { type: 'showMonth', month: '2026-10', date: '2026-10-14' });
      page.send(month('2026-10', '2026-10-14'));
      assert.strictEqual(page.document.activeElement, next(), 'Enter steps again');
      const tabStop = page.find('.calendar-grid .day[tabindex="0"]') as HTMLElement;
      assert.strictEqual(tabStop.dataset.date, '2026-10-14', 'the day stepped to takes Tab');
      tabStop.focus();
      tabStop.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: ']', bubbles: true, cancelable: true }));
      page.send(month('2026-11', '2026-11-14'));
      assert.strictEqual((page.document.activeElement as HTMLElement).dataset.date, '2026-11-14', 'the focus follows a step from the grid');
    } finally {
      page.dispose();
    }
  });

  test('the sidebar\'s Today hands the focus to today when it goes', () => {
    const now = new Date(2026, 8, 13, 10).getTime();
    for (const dayPanel of [false, true]) {
      const page = openWebviewPage(renderPage('calendar'), createCalendar(index, '2026-12', createQueryContext(now), { dayPanel }));
      try {
        const today = page.findAll('[data-action="show-month"]').find((button) => button.textContent === 'Today') as HTMLElement;
        today.focus();
        today.click();
        assert.deepStrictEqual(page.lastPosted('showMonth'), dayPanel ? { type: 'showMonth', month: '2026-09', date: '2026-09-13' } : { type: 'showMonth', month: '2026-09' });
        page.send(createCalendar(index, '2026-09', createQueryContext(now), { dayPanel }));
        assert.strictEqual((page.document.activeElement as HTMLElement).dataset.date, '2026-09-13', `panel ${dayPanel ? 'on' : 'off'}: on today, not dropped to the page`);
      } finally {
        page.dispose();
      }
    }
  });

  test('Show more in the day panel hands the focus to the first row it shows', () => {
    const now = new Date(2026, 8, 13, 10).getTime();
    const busy = note('notes/busy.md', Array.from({ length: 8 }, (_, number) => `- [ ] Task ${number} 📅 2026-09-13`).join('\n'));
    const busyIndex = buildWorkspaceIndex(new Map([[busy.filePath, busy]]));
    for (const [id, layout] of [['calendar', 'sidebar'], ['calendarPage', 'page']] as const) {
      const page = openWebviewPage(renderPage(id), createCalendar(busyIndex, '2026-09', createQueryContext(now), { dayPanel: true, layout }));
      try {
        const more = page.find('.day-panel [data-action="show-group"][data-group="due"]') as HTMLElement;
        assert.strictEqual(more.textContent, 'Show 3 more');
        more.focus();
        more.click();
        const rows = page.findAll('.day-panel [aria-label="Due"] .task-row');
        assert.strictEqual(rows.length, 8);
        assert.strictEqual(page.document.activeElement, rows[5], `${id}: on the sixth row, not dropped to the page`);
      } finally {
        page.dispose();
      }
    }
  });

  test('in the Week layout, the page\'s title is named for the week it shows and the month it opens', () => {
    const now = new Date(2026, 8, 13, 10).getTime();
    const page = openWebviewPage(renderPage('calendarPage'), createCalendar(index, '2026-09', createQueryContext(now), { dayPanel: true, layout: 'page' }), { savedState: { layout: 'week' } });
    try {
      const title = page.find('.calendar-title');
      assert.strictEqual(title.textContent, '2026-09-13 to 2026-09-19');
      assert.strictEqual(title.getAttribute('aria-label'), '2026-09-13 to 2026-09-19, September 2026, monthly note', 'its name begins with what it shows');
      page.click('.calendar-page-actions [data-action="set-calendar-layout"][data-value="month"]');
      assert.strictEqual(page.find('.calendar-title').getAttribute('aria-label'), 'September 2026, monthly note');
    } finally {
      page.dispose();
    }
  });

  test('Create in the day panel hands the focus to Open when the daily note appears', () => {
    const now = new Date(2026, 8, 13, 10).getTime();
    const page = openWebviewPage(renderPage('calendar'), createCalendar(index, '2026-09', createQueryContext(now), { dayPanel: true }));
    try {
      const create = page.find('.day-panel [data-action="create-day"]') as HTMLElement;
      create.focus();
      create.click();
      assert.deepStrictEqual(page.lastPosted('createDay'), { type: 'createDay', date: '2026-09-13' });
      // A save elsewhere draws the panel again before the note is written.
      page.send(createCalendar(index, '2026-09', createQueryContext(now), { dayPanel: true }));
      assert.strictEqual(page.document.activeElement, page.find('.day-panel [data-action="create-day"]'), 'Create keeps the focus until the note appears');
      const daily = note('notes/2026-09-13.md', '# 2026-09-13');
      const withNote = buildWorkspaceIndex(new Map([...files, daily].map((file) => [file.filePath, file])));
      page.send(createCalendar(withNote, '2026-09', createQueryContext(now), { dayPanel: true }));
      assert.strictEqual(page.document.activeElement, page.find('.day-panel .day-note'), 'on Open, not dropped to the page');
    } finally {
      page.dispose();
    }
  });

  test('the sidebar says a move from its day panel was not made, naming the task', () => {
    const now = new Date(2026, 8, 13, 10).getTime();
    const page = openWebviewPage(renderPage('calendar'), createCalendar(index, '2026-09', createQueryContext(now), { dayPanel: true, selectedDate: '2026-09-12' }));
    try {
      const move = page.find('.day-panel [data-action="move-task"]') as HTMLElement;
      const refuse = (taskId: string) =>
        page.window.dispatchEvent(new page.window.MessageEvent('message', { data: { type: 'moveRefused', taskId } }));
      refuse(String(move.dataset.taskId));
      assert.strictEqual(page.text('#live-status'), `"Call Ren" was not moved to ${String(move.dataset.date)}.`);
      refuse('gone');
      assert.strictEqual(page.text('#live-status'), 'The task was not moved.');
    } finally {
      page.dispose();
    }
  });
});
