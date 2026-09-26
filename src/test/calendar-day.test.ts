import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { WorkspaceIndex } from '../core/types';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { createCalendar } from '../ui/state/calendarState';
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
