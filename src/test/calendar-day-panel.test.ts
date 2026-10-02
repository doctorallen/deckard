import * as assert from 'assert';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import { createQueryContext } from '../domain/query/queryContext';
import type { CalendarDayDetail } from '../ui/protocol/calendar';
import { createCalendarDay } from '../ui/state/calendarState';
import { getCalendarDayScript } from '../ui/webview/calendarDay';
import { getComponentScript } from '../ui/webview/components';
import { bundleShared } from './sharedBundle';
import { openWebviewPage, WebviewPage } from './webviewPage';

/**
 * The calendar's day panel (src/webview/shared/calendar/dayPanel.tsx)
 * against the template script it replaces (calendarDay.ts), which Related
 * Notes still draws: each day drawn both ways must be the same DOM, node
 * for node, so the panel looks the same in the calendars and in Related
 * Notes, and Related Notes can take the component when it moves.
 */

/** Friday 2026-09-25, mid-morning. */
const NOW = new Date(2026, 8, 25, 10).getTime();

/** A workspace whose 25th holds every kind of row and group the panel draws. */
function createIndex() {
  const at = (hour: number) => new Date(2026, 8, 25, hour).getTime();
  const notes: Array<[string, string, number]> = [
    ['notes/2026-09-25.md', '# 2026-09-25\n', 7],
    ['work/Atlas.md', [
      '# Atlas #project/atlas',
      '## Actions',
      '- [ ] Call **Ren** about #project/atlas 📅 2026-09-25 ⏫',
      '- [ ] Pay <rent> & "fees" 📅 2026-09-25 🔽',
      '- [ ] Draft [the brief](https://example.com) ⏳ 2026-09-25',
      '- [ ] Water the plants 📅 2026-09-25 🔁 every week',
      '- [ ] Steps to take 📅 2026-09-25',
      '  - [ ] one',
      '  - [x] two',
      '- [x] Filed `the form` 📅 2026-09-24 ✅ 2026-09-25',
      ...Array.from({ length: 6 }, (_, n) => `- [ ] Later ${n} @person/ana ⏳ 2026-09-25`),
      '',
    ].join('\n'), 8],
    ...Array.from({ length: 6 }, (_, n) => [`ideas/idea-${n}.md`, `# Idea ${n}\n`, 9 + n] as [string, string, number]),
    ['Loose.md', 'No heading\n', 9],
  ];
  return buildWorkspaceIndex(new Map(notes.map(([filePath, content, hour]) => [
    filePath,
    parseMarkdown(filePath, content, { createdAt: at(hour), updatedAt: at(12) }, {}),
  ])));
}

/** The days drawn both ways: full, quiet, a later day, and rows with every part of their meta line. */
function createDays(): Array<[string, CalendarDayDetail]> {
  const index = createIndex();
  const context = createQueryContext(NOW);
  const full = createCalendarDay(index, '2026-09-25', context, { showRepeats: true });
  const first = full.due[0];
  const extras: CalendarDayDetail = {
    ...full,
    relative: undefined,
    notePath: undefined,
    due: [
      { ...first, parked: true, stepsLabel: '1 of 2 steps · next: one', headingPath: ['Atlas', 'Actions', 'Deeper'] },
      { ...first, dueLabel: undefined, overdue: undefined, headingPath: ['Atlas'] },
      { ...first, stale: true, overdue: false },
      { ...first, overdue: true },
    ],
  };
  return [
    ['a full day', full],
    ['every group shown whole, and rows with every part', extras],
    ['a quiet day with no note', createCalendarDay(index, '2026-09-22', context)],
    ['a later day, with a repeat', createCalendarDay(index, '2026-10-02', context, { showRepeats: true })],
  ];
}

suite('The calendar day panel draws what its template drew', () => {
  let legacy: WebviewPage;
  let core: WebviewPage;
  suiteSetup(() => {
    const script = `(function () {\n  const vscode = acquireVsCodeApi();\n${getComponentScript('replicant')}\n${getCalendarDayScript()}\n  window.legacy = { renderCalendarDayPanel: renderCalendarDayPanel, shownGroups: shownGroups };\n}());`;
    legacy = openWebviewPage(`<!DOCTYPE html><html><head></head><body><main id="app"></main><div id="live-status"></div><script>${script}</script></body></html>`);
    const bundle = bundleShared(['calendar/dayPanel']);
    core = openWebviewPage(`<!DOCTYPE html><html><head></head><body><main id="app"></main><div id="live-status"></div><script>${bundle}</script></body></html>`);
  });
  suiteTeardown(() => {
    legacy.dispose();
    core.dispose();
  });

  type Helpers = Record<string, (...args: unknown[]) => unknown>;
  const old = () => (legacy.window as unknown as { legacy: Helpers & { shownGroups: Set<string> } }).legacy;
  const shared = () => (core.window as unknown as { shared: Helpers }).shared;

  /** A container's inputs with their checked state as an attribute, which the template wrote and Preact sets as a property. */
  const settle = (container: Element): Element => {
    container.querySelectorAll('input').forEach((input) => {
      input.toggleAttribute('checked', (input as HTMLInputElement).checked);
    });
    container.normalize();
    return container;
  };
  const drawnBefore = (day: CalendarDayDetail): Element => {
    const container = legacy.document.createElement('div');
    container.innerHTML = String(old().renderCalendarDayPanel(JSON.parse(JSON.stringify(day))));
    return settle(container);
  };
  const drawnNow = (day: CalendarDayDetail, shownGroups: string[]): Element => {
    const container = core.document.createElement('div');
    shared().render(shared().h(shared().DayPanel, { day: JSON.parse(JSON.stringify(day)), shownGroups }), container);
    return settle(container);
  };

  test('each day, with its groups folded to five rows and then shown whole', () => {
    for (const [what, day] of createDays()) {
      old().shownGroups.clear();
      const before = drawnBefore(day);
      const now = drawnNow(day, []);
      assert.ok(before.isEqualNode(now), `${what}\n  before: ${before.innerHTML}\n  now:    ${now.innerHTML}`);
      ['due', 'scheduled', 'repeats'].forEach((group) => old().shownGroups.add(group));
      const wholeBefore = drawnBefore(day);
      const wholeNow = drawnNow(day, ['due', 'scheduled', 'repeats']);
      assert.ok(wholeBefore.isEqualNode(wholeNow), `${what}, shown whole\n  before: ${wholeBefore.innerHTML}\n  now:    ${wholeNow.innerHTML}`);
    }
  });

  test('the days draw every kind of row: tags in titles, steps, Done, a repeat, and Search all', () => {
    const days = createDays();
    const now = drawnNow(days[0][1], []);
    assert.deepStrictEqual(
      [...now.querySelectorAll('.day-group > h3, .day-group > summary')].map((heading) => heading.textContent),
      ['Due (4)', 'Scheduled (7)', 'Done (1)', 'Notes created (8)'],
    );
    assert.ok(now.querySelector('.task-title .tag-open.inline-tag[data-tag-key]'), 'a tag in a title is a control');
    assert.ok(now.querySelector('.task-title strong'), 'a title keeps its emphasis');
    assert.ok(now.querySelector('.task-steps'), 'a task with steps says how far it has got');
    assert.ok(now.querySelector('[data-action="search-created"]'));
    assert.ok(now.querySelector('[data-action="show-group"][data-group="scheduled"]'));
    const later = drawnNow(days[3][1], []);
    assert.ok(later.querySelector('.day-group[aria-label="Repeats"] .repeat-mark'), 'a repeat has its mark where the checkbox goes');
    assert.ok(drawnNow(days[1][1], []).querySelector('.parked-label'));
    assert.ok(drawnNow(days[2][1], []).querySelector('.empty'));
  });
});
