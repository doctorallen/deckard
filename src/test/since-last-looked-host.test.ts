import * as assert from 'assert';

import * as vscode from 'vscode';

import { TagVisits } from '../core/storage/tagVisits';
import { DAY_MS } from '../domain/markdown/calendar';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { WorkspaceIndex } from '../domain/model';
import { createQueryContext } from '../domain/query/queryContext';
import { NavigationService } from '../services/navigationService';
import type { SearchPageState } from '../ui/protocol/searchPage';
import { captureTagPageState } from '../ui/state/searchPageState';
import { toTagVisit, VISIT_COUNTS_AFTER_MS } from '../ui/state/sinceLastLooked';
import { ActiveSearch } from '../ui/webview/activeSearch';
import { WebviewHost } from '../ui/webview/host/webviewHost';
import { SearchIndexer, SearchPageController, SearchPageControllerOptions, VisitClock } from '../ui/webview/pages/searchPage/searchPageController';
import { ThemePreview } from '../ui/webview/themePreview';
import { FakeSurface } from './fakeWebview';
import { createPreferences, MemoryStore } from './preferenceServices';
import { REPOSITORY_ROOT } from './pageWebview';

/** Now: 14 Oct 2026, noon. */
const NOW = new Date(2026, 9, 14, 12).getTime();

/** An index of notes, parsed as the scanner parses them. */
function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(new Map(Object.entries(notes).map(([filePath, content]) => [filePath, parseMarkdown(filePath, content)])));
}

/** The Rates team's notes at the last visit, and now, with one entry written since. */
const THEN = { 'notes/standup.md': '# Rates standup #team/rates\nThe curve feed lagged.' };
const LATER = { ...THEN, 'notes/handover.md': '# Lead handover #team/rates\nAlex moves to FX.' };

/** A clock the test moves: its time, and the timers waiting on it, which run when it is moved past them. */
function createClock(start: number): VisitClock & { advance(ms: number): void; waiting(): number } {
  let now = start;
  let timers: Array<{ at: number; run: () => void; handle: number }> = [];
  let next = 1;
  return {
    now: () => now,
    setTimeout: (run, ms) => {
      const handle = next++;
      timers.push({ at: now + ms, run, handle });
      return handle;
    },
    clearTimeout: (handle) => {
      timers = timers.filter((timer) => timer.handle !== handle);
    },
    advance: (ms) => {
      now += ms;
      const due = timers.filter((timer) => timer.at <= now);
      timers = timers.filter((timer) => timer.at > now);
      due.forEach((timer) => timer.run());
    },
    waiting: () => timers.length,
  };
}

/** The Rates team's page, in front, over `notes`, with the visits kept in `visits`. */
function openRatesPage(notes: Record<string, string>, visits: TagVisits, clock: ReturnType<typeof createClock>) {
  const index = indexOf(notes);
  const indexer = {
    ready: Promise.resolve(),
    hasIndexed: true,
    getSnapshot: () => index,
    getUri: (filePath: string) => vscode.Uri.file(filePath),
    getParkedRules: () => ({ tags: [], notes: [] }),
    onDidUpdate: () => ({ dispose: () => undefined }),
  } as unknown as SearchIndexer;
  const activeSearch = new ActiveSearch();
  const options: SearchPageControllerOptions = {
    originQuery: '#team/rates',
    queryText: '#team/rates',
    indexer,
    preferences: createPreferences(new MemoryStore()),
    activeSearch,
    source: { getRefineState: () => undefined, applySearch: async () => undefined },
    writes: {} as SearchPageControllerOptions['writes'],
    exports: {} as SearchPageControllerOptions['exports'],
    navigation: new NavigationService(),
    openTag: async () => undefined,
    extensionUri: vscode.Uri.file(REPOSITORY_ROOT),
    setTitle: () => undefined,
    onDidClose: () => undefined,
    visits,
    clock,
  };
  const host = new WebviewHost(new SearchPageController(options), { indexer, themePreview: new ThemePreview() });
  const surface = new FakeSurface();
  host.attach(surface);
  // As SearchPanel shows a page: attached, then drawn.
  host.refresh();
  const states = () => surface.webview.postedOf<{ type: 'state'; data: SearchPageState }>('state').map((message) => message.data);
  return {
    surface,
    last: () => states()[states().length - 1],
    send: (message: unknown) => surface.webview.send(message),
    dispose: () => {
      host.dispose();
      activeSearch.dispose();
    },
  };
}

/** Lets the visit the timer started be written. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

suite('Since you last looked, counted', () => {
  test('a visit counts once the page has been in front for five seconds, and not before', async () => {
    const visits = new TagVisits(new MemoryStore());
    const clock = createClock(NOW);
    const page = openRatesPage(THEN, visits, clock);
    try {
      clock.advance(VISIT_COUNTS_AFTER_MS - 1);
      await settle();
      assert.strictEqual(visits.get('#team/rates'), undefined, 'not yet');
      clock.advance(1);
      await settle();
      assert.strictEqual(visits.get('#team/rates')?.seenAt, NOW + VISIT_COUNTS_AFTER_MS);
      assert.strictEqual(clock.waiting(), 0, 'and once, while it stays in front');
    } finally {
      page.dispose();
    }
  });

  test('a page left before its five seconds counts nothing, and put in front again starts them again', async () => {
    const visits = new TagVisits(new MemoryStore());
    const clock = createClock(NOW);
    const page = openRatesPage(THEN, visits, clock);
    try {
      clock.advance(3000);
      page.surface.setVisible(false);
      clock.advance(10_000);
      await settle();
      assert.strictEqual(visits.get('#team/rates'), undefined);
      page.surface.setVisible(true);
      clock.advance(VISIT_COUNTS_AFTER_MS);
      await settle();
      assert.ok(visits.get('#team/rates'));
    } finally {
      page.dispose();
    }
  });

  test('draws the band from the last visit, keeps it through the visit counting, and clears it once the page is left and put in front again', async () => {
    const visits = new TagVisits(new MemoryStore());
    const before = NOW - 12 * DAY_MS;
    await visits.record('#team/rates', toTagVisit(captureTagPageState(indexOf(THEN), '#team/rates', createQueryContext(before)), before));
    const clock = createClock(NOW);
    const page = openRatesPage(LATER, visits, clock);
    try {
      assert.deepStrictEqual(page.last().since?.chips.map((chip) => chip.label), ['1 new mention']);
      clock.advance(VISIT_COUNTS_AFTER_MS);
      await settle();
      assert.strictEqual(visits.get('#team/rates')?.seenAt, NOW + VISIT_COUNTS_AFTER_MS);
      await page.send({ type: 'setSinceFilter', kind: 'mentions' });
      assert.ok(page.last().since, 'the band stays while the reader is on the page');
      assert.deepStrictEqual(page.last().sections.map((card) => card.filePath), ['notes/handover.md'], 'and its chip filters');
      page.surface.setVisible(false);
      page.surface.setVisible(true);
      // The next draw, whatever asks for it.
      await page.send({ type: 'setResultPage', kind: 'notes', page: 1 });
      assert.strictEqual(page.last().since, undefined, 'seen a moment ago: no band');
      assert.deepStrictEqual(page.last().sections.map((card) => card.filePath).sort(), ['notes/handover.md', 'notes/standup.md'], 'and no filter');
    } finally {
      page.dispose();
    }
  });

  test('Mark seen counts the visit now, and the band goes at once', async () => {
    const visits = new TagVisits(new MemoryStore());
    const before = NOW - 12 * DAY_MS;
    await visits.record('#team/rates', toTagVisit(captureTagPageState(indexOf(THEN), '#team/rates', createQueryContext(before)), before));
    const clock = createClock(NOW);
    const page = openRatesPage(LATER, visits, clock);
    try {
      assert.ok(page.last().since);
      clock.advance(1000);
      await page.send({ type: 'markSeen' });
      assert.strictEqual(visits.get('#team/rates')?.seenAt, NOW + 1000);
      assert.strictEqual(page.last().since, undefined);
      assert.ok(page.last().sections.every((card) => !card.isNew));
      clock.advance(VISIT_COUNTS_AFTER_MS);
      await settle();
      assert.strictEqual(visits.get('#team/rates')?.seenAt, NOW + 1000, 'the timer it replaced counts nothing more');
    } finally {
      page.dispose();
    }
  });
});
