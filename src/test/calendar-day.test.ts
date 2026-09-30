import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../domain/markdown/parser';
import { WorkspaceIndex } from '../core/types';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { clampToMonth, createCalendar, createCalendarDay } from '../ui/state/calendarState';
import { parseCalendarMessage } from '../ui/webview/messages';
import { describeDateChange } from '../ui/commands/agendaActions';
import { getCalendarHtml } from '../ui/webview/calendarHtml';
import { indexWithParking } from './parkedFixture';
import { openWebviewPage, WebviewPage } from './webviewPage';
import { createQueryContext } from '../domain/query/queryContext';

export function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(
      Object.entries(notes).map(([filePath, content]) => [
        filePath,
        parseMarkdown(filePath, content, { createdAt: new Date(2026, 8, 25, 9).getTime(), updatedAt: 2 }, {}),
      ]),
    ),
  );
}

/** Friday 2026-09-25, mid-morning. */
export const NOW = new Date(2026, 8, 25, 10);

const SCHEDULED = [
  '# Tasks',
  '- [ ] Call Ren 📅 2026-09-25',
  '- [ ] Pay rent 📅 2026-09-25',
  '- [ ] Draft the brief ⏳ 2026-09-25',
  '- [ ] Both on one day ⏳ 2026-09-26 📅 2026-09-26',
  '- [x] Done already ⏳ 2026-09-27 ✅ 2026-09-20',
  ...Array.from({ length: 12 }, (_, at) => `- [ ] Busy ${at} 📅 2026-09-28`),
  ...Array.from({ length: 11 }, (_, at) => `- [ ] Planned ${at} ⏳ 2026-09-28`),
  ...Array.from({ length: 6 }, (_, at) => `- [ ] Later ${at} ⏳ 2026-09-29`),
  '',
].join('\n');

function openCalendar(index: WorkspaceIndex): WebviewPage {
  return openWebviewPage(
    getCalendarHtml({ cspSource: 'vscode-webview://deckard' } as vscode.Webview),
    createCalendar(index, '2026-09', createQueryContext(NOW.getTime())),
  );
}

suite('The calendar counts what is scheduled', () => {
  const index = indexOf({ 'notes/tasks.md': SCHEDULED });
  const calendar = createCalendar(index, '2026-09', createQueryContext(NOW.getTime()));
  const days = new Map(calendar.weeks.flatMap((week) => week.days).map((day) => [day.date, day]));

  test('counts open scheduled tasks beside the due ones, a task due the same day once', () => {
    assert.strictEqual(days.get('2026-09-25')?.dueCount, 2);
    assert.strictEqual(days.get('2026-09-25')?.scheduledCount, 1);
    assert.strictEqual(days.get('2026-09-26')?.dueCount, 1);
    assert.strictEqual(days.get('2026-09-26')?.scheduledCount, 0, 'counted once, as due');
    assert.strictEqual(days.get('2026-09-27')?.scheduledCount, 0, 'a done task is not counted');
    assert.deepStrictEqual(days.get('2026-09-25')?.scheduledTitles, ['Draft the brief']);
    assert.strictEqual(days.get('2026-09-29')?.scheduledTitles?.length, 5, 'five named at most');
  });

  test('draws the scheduled count outlined, says both, and a ring when both run to two digits', () => {
    const page = openCalendar(index);
    try {
      const day = (date: string) => page.find(`.calendar-grid .day[data-date="${date}"]`) as HTMLElement;
      assert.strictEqual(day('2026-09-25').querySelector('.scheduled-count')?.textContent, '1');
      assert.strictEqual(day('2026-09-25').getAttribute('aria-label'), '2026-09-25, today, 2 due, 1 scheduled');
      assert.match(day('2026-09-25').getAttribute('data-tip') ?? '', /⏳ Draft the brief/);
      assert.strictEqual(day('2026-09-29').getAttribute('aria-label'), '2026-09-29, 6 scheduled');
      assert.ok(day('2026-09-28').querySelector('.scheduled-ring'), '12 due and 11 scheduled');
      assert.strictEqual(day('2026-09-28').getAttribute('aria-label'), '2026-09-28, 12 due, 11 scheduled');
      const shapes = page
        .findAll('.calendar-grid .day')
        .map((cell) => cell.querySelectorAll('span').length);
      assert.ok(
        shapes.filter((count) => count !== shapes[0]).length <= 1,
        'every cell has the same rows, the ring aside',
      );
    } finally {
      page.dispose();
    }
  });

  test('says a past day is overdue in words', () => {
    const past = indexOf({ 'notes/a.md': '- [ ] Late 📅 2026-09-18\n' });
    const page = openCalendar(past);
    try {
      assert.strictEqual(
        page.find('.calendar-grid .day[data-date="2026-09-18"]').getAttribute('aria-label'),
        '2026-09-18, 1 overdue',
      );
    } finally {
      page.dispose();
    }
  });
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

suite('The calendar day panel', () => {
  const index = indexOf({
    'notes/2026-09-25.md': '# 2026-09-25\n',
    'notes/tasks.md': '- [ ] Call Ren 📅 2026-09-25\n',
  });

  test('names the chosen day, with Today, Yesterday, or Tomorrow, and the year only when it is another', () => {
    const { date, title, relative, notePath } = createCalendarDay(index, '2026-09-25', createQueryContext(NOW.getTime()));
    assert.deepStrictEqual(
      { date, title, relative, notePath },
      { date: '2026-09-25', title: 'Friday, September 25', relative: 'Today', notePath: 'notes/2026-09-25.md' },
    );
    assert.strictEqual(createCalendarDay(index, '2026-09-24', createQueryContext(NOW.getTime())).relative, 'Yesterday');
    assert.strictEqual(createCalendarDay(index, '2026-09-26', createQueryContext(NOW.getTime())).relative, 'Tomorrow');
    assert.strictEqual(createCalendarDay(index, '2027-10-01', createQueryContext(NOW.getTime())).title, 'Friday, October 1, 2027');
    assert.strictEqual(createCalendarDay(index, '2026-10-02', createQueryContext(NOW.getTime())).notePath, undefined);
  });

  test('a new month keeps the day, or its last day', () => {
    assert.strictEqual(clampToMonth('2026-01-31', '2026-02'), '2026-02-28');
    assert.strictEqual(clampToMonth('2026-09-25', '2026-10'), '2026-10-25');
  });

  test('accepts the messages of the panel and nothing more', () => {
    assert.deepStrictEqual(parseCalendarMessage({ type: 'selectDay', date: '2026-09-25' }), { type: 'selectDay', date: '2026-09-25' });
    assert.deepStrictEqual(parseCalendarMessage({ type: 'createDay', date: '2026-09-25' }), { type: 'createDay', date: '2026-09-25' });
    assert.deepStrictEqual(parseCalendarMessage({ type: 'openNote', filePath: 'notes/a.md' }), { type: 'openNote', filePath: 'notes/a.md' });
    assert.deepStrictEqual(parseCalendarMessage({ type: 'showMonth', month: '2026-10', date: '2026-10-25' }), {
      type: 'showMonth',
      month: '2026-10',
      date: '2026-10-25',
    });
    assert.strictEqual(parseCalendarMessage({ type: 'showMonth', month: '2026-10', date: 'soon' }), undefined);
    assert.strictEqual(parseCalendarMessage({ type: 'selectDay', date: '2026-9-5' }), undefined);
    assert.strictEqual(parseCalendarMessage({ type: 'selectDay', date: '2026-09-25', extra: 1 }), undefined);
    assert.strictEqual(parseCalendarMessage({ type: 'openNote', filePath: '' }), undefined);
  });

  const open = (dayPanel: boolean, selectedDate?: string): WebviewPage =>
    openWebviewPage(
      getCalendarHtml({ cspSource: 'vscode-webview://deckard' } as vscode.Webview),
      createCalendar(index, '2026-09', createQueryContext(NOW.getTime()), { dayPanel, selectedDate }),
    );
  const day = (page: WebviewPage, date: string) =>
    page.find(`.calendar-grid .day[data-date="${date}"]`) as HTMLElement;

  test('off, a click opens the day and nothing is drawn below the month', () => {
    const page = open(false);
    try {
      assert.strictEqual(page.findAll('.day-panel').length, 0);
      day(page, '2026-09-22').click();
      assert.deepStrictEqual(page.lastPosted('openDay'), { type: 'openDay', date: '2026-09-22' });
    } finally {
      page.dispose();
    }
  });

  test('on, a click chooses the day and opens nothing; a double-click or Enter opens it', async () => {
    const page = open(true);
    try {
      assert.strictEqual(page.text('#day-title'), 'Friday, September 25 · Today');
      assert.strictEqual(day(page, '2026-09-25').parentElement?.getAttribute('aria-selected'), 'true');
      day(page, '2026-09-22').click();
      assert.strictEqual(day(page, '2026-09-22').parentElement?.getAttribute('aria-selected'), 'true');
      assert.ok(day(page, '2026-09-22').classList.contains('selected'));
      assert.strictEqual(page.lastPosted('openDay'), undefined);
      await wait(160);
      assert.deepStrictEqual(page.lastPosted('selectDay'), { type: 'selectDay', date: '2026-09-22' });
      day(page, '2026-09-22').dispatchEvent(new page.window.MouseEvent('dblclick', { bubbles: true }));
      assert.deepStrictEqual(page.lastPosted('openDay'), { type: 'openDay', date: '2026-09-22' });
      day(page, '2026-09-23').dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      assert.deepStrictEqual(page.lastPosted('openDay'), { type: 'openDay', date: '2026-09-23' });
    } finally {
      page.dispose();
    }
  });

  test('on, the arrows move the choice with the focus', () => {
    const page = open(true);
    try {
      day(page, '2026-09-25').focus();
      day(page, '2026-09-25').dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      assert.strictEqual(page.document.activeElement, day(page, '2026-09-26'));
      assert.strictEqual(day(page, '2026-09-26').parentElement?.getAttribute('aria-selected'), 'true');
      assert.strictEqual(day(page, '2026-09-25').parentElement?.getAttribute('aria-selected'), 'false');
    } finally {
      page.dispose();
    }
  });

  test('Today comes back when another day is chosen, and chooses today', () => {
    const today = open(true);
    try {
      assert.ok(!today.findAll('[data-action="show-month"]').some((button) => button.textContent === 'Today'));
    } finally {
      today.dispose();
    }
    const page = open(true, '2026-09-22');
    try {
      assert.strictEqual(page.text('#day-title'), 'Tuesday, September 22');
      const button = page.findAll('[data-action="show-month"]').find((candidate) => candidate.textContent === 'Today') as HTMLElement;
      button.click();
      assert.deepStrictEqual(page.lastPosted('showMonth'), { type: 'showMonth', month: '2026-09', date: '2026-09-25' });
    } finally {
      page.dispose();
    }
  });

  test('the note row opens the daily note, or creates it without asking', () => {
    const page = open(true);
    try {
      page.click('.day-note');
      assert.deepStrictEqual(page.lastPosted('openNote'), { type: 'openNote', filePath: 'notes/2026-09-25.md' });
      assert.strictEqual(page.find('.day-note').getAttribute('aria-label'), 'Open the daily note for 2026-09-25');
    } finally {
      page.dispose();
    }
    const missing = open(true, '2026-09-22');
    try {
      assert.match(missing.text('.day-panel') ?? '', /No daily note yet/);
      missing.click('[data-action="create-day"]');
      assert.deepStrictEqual(missing.lastPosted('createDay'), { type: 'createDay', date: '2026-09-22' });
    } finally {
      missing.dispose();
    }
  });
});

suite('The calendar day panel lists the day tasks', () => {
  const index = indexOf({
    'notes/tasks.md': [
      '# Tasks',
      '- [ ] Call Ren 📅 2026-09-25',
      '- [ ] Pay rent ⏫ 📅 2026-09-25',
      '- [ ] Both ⏳ 2026-09-25 📅 2026-09-25',
      '- [ ] Draft the brief ⏳ 2026-09-25',
      '- [x] Filed ✅ 2026-09-25',
      '- [ ] Later 📅 2026-10-03',
      ...Array.from({ length: 7 }, (_, at) => `- [ ] Many ${at} 📅 2026-09-30`),
      '',
    ].join('\n'),
  });

  test('due, scheduled, and done that day, most important first, a task due and scheduled only under Due', () => {
    const day = createCalendarDay(index, '2026-09-25', createQueryContext(NOW.getTime()));
    const titles = (items: { task: { title: string } }[]) => items.map((item) => item.task.title.replace(/\s+#\S+/, ''));
    assert.deepStrictEqual(titles(day.due), ['Pay rent', 'Call Ren', 'Both']);
    assert.deepStrictEqual(titles(day.scheduled), ['Draft the brief']);
    assert.deepStrictEqual(titles(day.done), ['Filed']);
    const parked = indexWithParking({ 'a.md': '- [ ] Idea 📅 2026-09-25 #parked\n- [ ] Real 📅 2026-09-25\n' });
    assert.deepStrictEqual(titles(createCalendarDay(parked, '2026-09-25', createQueryContext(NOW.getTime())).due), ['Real'], 'a parked task is left out');
  });

  test('moves a task to tomorrow from today or before, and a day on from a later day', () => {
    assert.deepStrictEqual(createCalendarDay(index, '2026-09-25', createQueryContext(NOW.getTime())).move, { date: '2026-09-26', label: 'Tomorrow' });
    assert.deepStrictEqual(createCalendarDay(index, '2026-09-20', createQueryContext(NOW.getTime())).move, { date: '2026-09-26', label: 'Tomorrow' });
    assert.deepStrictEqual(createCalendarDay(index, '2026-10-03', createQueryContext(NOW.getTime())).move, { date: '2026-10-04', label: 'Next day' });
  });

  test('says where a moved date went', () => {
    assert.strictEqual(describeDateChange('"Call Ren"', 'due', '2026-09-26'), '"Call Ren" is due 2026-09-26.');
    assert.strictEqual(describeDateChange('"Draft"', 'scheduled', '2026-09-26'), '"Draft" is scheduled 2026-09-26.');
    assert.strictEqual(describeDateChange('"Draft"', 'scheduled', undefined), '"Draft" has no scheduled date now.');
  });

  test('accepts the task messages, and only well formed ones', () => {
    assert.deepStrictEqual(parseCalendarMessage({ type: 'toggleTask', taskId: 't', completed: true }), { type: 'toggleTask', taskId: 't', completed: true });
    assert.deepStrictEqual(parseCalendarMessage({ type: 'moveTask', taskId: 't', field: 'scheduled', date: '2026-09-26' }), {
      type: 'moveTask',
      taskId: 't',
      field: 'scheduled',
      date: '2026-09-26',
    });
    assert.deepStrictEqual(parseCalendarMessage({ type: 'openTask', taskId: 't' }), { type: 'openTask', taskId: 't' });
    assert.strictEqual(parseCalendarMessage({ type: 'moveTask', taskId: 't', field: 'start', date: '2026-09-26' }), undefined);
    assert.strictEqual(parseCalendarMessage({ type: 'moveTask', taskId: 't', field: 'due', date: 'tomorrow' }), undefined);
    assert.strictEqual(parseCalendarMessage({ type: 'toggleTask', taskId: 't', completed: 'yes' }), undefined);
  });

  const open = (selectedDate: string): WebviewPage =>
    openWebviewPage(
      getCalendarHtml({ cspSource: 'vscode-webview://deckard' } as vscode.Webview),
      createCalendar(index, '2026-09', createQueryContext(NOW.getTime()), { dayPanel: true, selectedDate }),
    );

  test('draws the groups, a checkbox and a Tomorrow button on each row, and Done folded', () => {
    const page = open('2026-09-25');
    try {
      assert.deepStrictEqual(
        page.findAll('.day-group > h3, .day-group > summary').map((heading) => heading.textContent),
        ['Due (3)', 'Scheduled (1)', 'Done (1)', 'Notes created (1)'],
      );
      assert.strictEqual(page.findAll('.day-panel details.day-group[open]').length, 0, 'Done starts folded');
      const scheduled = page.find('.day-group[aria-label="Scheduled"] [data-action="move-task"]');
      assert.strictEqual(scheduled.textContent, 'Tomorrow');
      assert.strictEqual(scheduled.getAttribute('aria-label'), 'Move "Draft the brief" to tomorrow, 2026-09-26');
      page.click('.day-group[aria-label="Scheduled"] [data-action="move-task"]');
      const moved = page.lastPosted('moveTask');
      assert.strictEqual(moved?.field, 'scheduled');
      assert.strictEqual(moved?.date, '2026-09-26');
      const box = page.find('.day-group[aria-label="Due"] [data-action="toggle-task"]') as HTMLInputElement;
      box.checked = true;
      box.dispatchEvent(new page.window.Event('change', { bubbles: true }));
      assert.strictEqual(page.lastPosted('toggleTask')?.completed, true);
      page.click('.day-group[aria-label="Due"] .task-title');
      assert.ok(page.lastPosted('openTask'), 'the row opens its task');
      assert.strictEqual(page.findAll('.day-panel .empty').length, 0);
    } finally {
      page.dispose();
    }
  });

  test('shows five rows, then the rest on request, and Next day on a later day', () => {
    const page = open('2026-09-30');
    try {
      assert.strictEqual(page.findAll('.day-group[aria-label="Due"] .task-row').length, 5);
      assert.strictEqual(page.find('[data-action="move-task"]').textContent, 'Next day');
      page.click('[data-action="show-group"]');
      assert.strictEqual(page.findAll('.day-group[aria-label="Due"] .task-row').length, 7);
    } finally {
      page.dispose();
    }
    const empty = open('2026-09-22');
    try {
      assert.strictEqual(empty.text('.day-panel .empty'), 'Nothing due or scheduled.');
    } finally {
      empty.dispose();
    }
  });
});

suite('The calendar day panel lists the notes created that day', () => {
  const at = (hour: number) => new Date(2026, 8, 25, hour).getTime();
  const index = buildWorkspaceIndex(
    new Map(
      [
        ['notes/2026-09-25.md', '# 2026-09-25\n', 7],
        ['notes/week-2026-09-20-2026-09-26.md', '# Week\n', 7],
        ['work/Atlas kickoff.md', '# Atlas kickoff #project/atlas\nBody\n', 9],
        ['Ren 1on1.md', 'No heading here\n', 8],
        ...Array.from({ length: 5 }, (_, n) => [`ideas/idea-${n}.md`, `# Idea ${n}\n`, 10 + n] as [string, string, number]),
        ['old.md', '# Old\n', -30],
      ].map(([filePath, content, hour]) => [
        filePath as string,
        parseMarkdown(filePath as string, content as string, { createdAt: at(hour as number), updatedAt: at(12) }, {}),
      ]),
    ),
  );

  test('oldest first, by their first heading or their name, daily and weekly notes aside', () => {
    const day = createCalendarDay(index, '2026-09-25', createQueryContext(NOW.getTime()));
    assert.strictEqual(day.notesTotal, 7);
    assert.deepStrictEqual(
      day.notes.map((note) => [note.title, note.folder]),
      [
        ['Ren 1on1', ''],
        ['Atlas kickoff', 'work'],
        ['Idea 0', 'ideas'],
        ['Idea 1', 'ideas'],
        ['Idea 2', 'ideas'],
      ],
    );
  });

  test('a row opens its note, and Search all searches the day', () => {
    const page = openWebviewPage(
      getCalendarHtml({ cspSource: 'vscode-webview://deckard' } as vscode.Webview),
      createCalendar(index, '2026-09', createQueryContext(NOW.getTime()), { dayPanel: true }),
    );
    try {
      page.click('.day-created');
      assert.deepStrictEqual(page.lastPosted('openNote'), { type: 'openNote', filePath: 'Ren 1on1.md' });
      const all = page.find('[data-action="search-created"]');
      assert.strictEqual(all.textContent, 'Search all 7');
      assert.strictEqual(all.getAttribute('aria-label'), 'Search the 7 notes created on 2026-09-25');
      page.click('[data-action="search-created"]');
      assert.deepStrictEqual(page.lastPosted('searchCreated'), { type: 'searchCreated', date: '2026-09-25' });
    } finally {
      page.dispose();
    }
    assert.deepStrictEqual(parseCalendarMessage({ type: 'searchCreated', date: '2026-09-25' }), { type: 'searchCreated', date: '2026-09-25' });
    assert.strictEqual(parseCalendarMessage({ type: 'searchCreated', date: 'today' }), undefined);
  });
});
