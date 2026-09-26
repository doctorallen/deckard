import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { WorkspaceIndex } from '../core/types';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { clampToMonth, createCalendar, createCalendarDay } from '../ui/state/calendarState';
import { parseCalendarMessage } from '../ui/webview/messages';
import { getCalendarHtml } from '../ui/webview/calendarHtml';
import { openWebviewPage, WebviewPage } from './webviewPage';

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
    createCalendar(index, '2026-09', NOW),
  );
}

suite('The calendar counts what is scheduled', () => {
  const index = indexOf({ 'notes/tasks.md': SCHEDULED });
  const calendar = createCalendar(index, '2026-09', NOW);
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
    assert.deepStrictEqual(createCalendarDay(index, '2026-09-25', NOW), {
      date: '2026-09-25',
      title: 'Friday, September 25',
      relative: 'Today',
      notePath: 'notes/2026-09-25.md',
    });
    assert.strictEqual(createCalendarDay(index, '2026-09-24', NOW).relative, 'Yesterday');
    assert.strictEqual(createCalendarDay(index, '2026-09-26', NOW).relative, 'Tomorrow');
    assert.strictEqual(createCalendarDay(index, '2027-10-01', NOW).title, 'Friday, October 1, 2027');
    assert.strictEqual(createCalendarDay(index, '2026-10-02', NOW).notePath, undefined);
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
      createCalendar(index, '2026-09', NOW, 0, { dayPanel, selectedDate }),
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
