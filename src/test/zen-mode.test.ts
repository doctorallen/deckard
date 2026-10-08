import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../domain/markdown/parser';
import { createPreferences, TestPreferences } from './preferenceServices';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createDashboardSnapshot } from '../ui/state/dashboardState';
import { createDashboardWidgets } from '../ui/state/dashboardWidgets';
import { isZenModeEnabled } from '../ui/webview/zenMode';
import { openWebviewPage, WebviewPage } from './webviewPage';
import { renderPage } from './pages';
import { readPageChrome } from '../ui/webview/host/pageChrome';
import { pageSheets, readSheet } from './sheets';
import { createQueryContext } from '../domain/query/queryContext';
import { createSearchPageSnapshot } from '../ui/state/searchPageState';

/** A memento that keeps what it is given, as the dashboard tests use. */
class MemoryMemento implements vscode.Memento {
  private readonly values = new Map<string, unknown>();

  keys(): readonly string[] {
    return [...this.values.keys()];
  }

  get<T>(key: string, fallback?: T): T | undefined {
    return (this.values.has(key) ? this.values.get(key) : fallback) as T;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.values.delete(key);
    } else {
      this.values.set(key, value);
    }
  }
}

/**
 * Zen's switch: the setting, the body's marker, ⋯'s checkbox, and the sheet
 * Zen's looks hang on. Zen's promise, that it takes nothing away and leaves
 * every control reachable where it stands, is held by 'Zen keeps every
 * control on the page' and the rest of Zen's contract in
 * zen-controls.test.ts, which draw each page with Zen on and off without
 * VS Code, so they run with the unit suites.
 */
suite('Zen mode', () => {
  const pages: WebviewPage[] = [];
  let store: TestPreferences | undefined;

  const configuration = () => vscode.workspace.getConfiguration('deckard');

  const setZen = async (enabled: boolean): Promise<void> => {
    await configuration().update(
      'display.zen',
      enabled ? true : undefined,
      vscode.ConfigurationTarget.Global,
    );
  };

  teardown(async () => {
    pages.splice(0).forEach((page) => page.dispose());
    store?.repository.dispose();
    store = undefined;
    await configuration().update(
      'display.zen',
      undefined,
      vscode.ConfigurationTarget.Global,
    );
  });

  const NOTES: Record<string, string> = {
    'notes/one.md': [
      '# One #project/atlas #risk/vendor',
      'The lift is stuck.',
      '- [ ] Chase it 📅 2026-09-01 #project/atlas',
    ].join('\n'),
    'notes/two.md': '# Two #project/atlas\nMore prose.',
  };

  const index = () =>
    buildWorkspaceIndex(
      new Map(
        Object.entries(NOTES).map(([path, content]) => [
          path,
          parseMarkdown(path, content),
        ]),
      ),
    );

  /** The Dashboard's HTML and the snapshot its script is driven with. */
  const dashboard = () => {
    store = createPreferences(new MemoryMemento());
    const preferences = store.reader.value;
    const built = index();
    const snapshot = {
      ...createDashboardSnapshot({ index: built, preferences, queryContext: createQueryContext(Date.now()) }),
      widgets: createDashboardWidgets(built, preferences, {
        queryContext: createQueryContext(Date.parse('2026-09-21T00:00:00Z')),
      }),
    };
    const page = openWebviewPage(
      renderPage('dashboard', { chrome: readPageChrome() }),
      snapshot,
    );
    pages.push(page);
    return page;
  };

  const searchPage = () => {
    store = createPreferences(new MemoryMemento());
    const page = openWebviewPage(
      renderPage('searchPage', { chrome: readPageChrome() }),
      createSearchPageSnapshot(index(), store.reader.value, '#project/atlas', { queryContext: createQueryContext(Date.now()) }),
    );
    pages.push(page);
    return page;
  };

  test('reads the setting, and is off until it is asked for', async () => {
    assert.strictEqual(isZenModeEnabled(), false);
    await setZen(true);
    assert.strictEqual(isZenModeEnabled(), true);
    await setZen(false);
    assert.strictEqual(isZenModeEnabled(), false);
  });

  test('marks the body only when it is on, and always ships its sheet', async () => {
    const off = renderPage('dashboard', { chrome: readPageChrome() });
    await setZen(true);
    const on = renderPage('dashboard', { chrome: readPageChrome() });

    const zenOf = (html: string): boolean => {
      const page = openWebviewPage(html);
      try {
        return page.document.body.classList.contains('zen');
      } finally {
        page.dispose();
      }
    };
    assert.strictEqual(zenOf(off), false, 'off marks the body');
    assert.strictEqual(zenOf(on), true, 'on does not mark the body');
    assert.ok(pageSheets(off).includes('body[data-density=compact] {'), 'the sheet ships when zen is off');
    assert.ok(pageSheets(on).includes('body[data-density=compact] {'), 'the sheet ships when zen is on');
  });

  test('offers ⋯ a Zen checkbox, in Appearance, that says whether Zen is on', async () => {
    const zenBox = 'input[type="checkbox"][data-action="set-zen"]';
    assert.strictEqual((dashboard().find(zenBox) as HTMLInputElement).checked, false);

    await setZen(true);
    assert.strictEqual((dashboard().find(zenBox) as HTMLInputElement).checked, true, 'the box is ticked while Zen is on');
  });

  test('⋯ offers Appearance: the theme, then Zen, then the page width, and asks the host to choose a theme', () => {
    for (const page of [dashboard(), searchPage()]) {
      const labels = page.findAll('.page-menu [aria-label="Appearance"] .view-options-group').map((group) => group.children[0].textContent);
      assert.deepStrictEqual(labels, ['Theme', 'Zen', 'Page width']);
      assert.ok(page.find('.page-menu [aria-label="Appearance"] input[data-action="set-zen"]'), 'the Zen checkbox is in Appearance');
      assert.ok(!labels.includes('Display'), 'the three steps are gone');
      const button = page.find('[data-action="choose-theme"]');
      assert.strictEqual(button.textContent, 'Corpo…');
      assert.strictEqual(button.getAttribute('aria-label'), 'Theme: Corpo. Choose another');
      page.click('[data-action="choose-theme"]');
      assert.deepStrictEqual(page.lastPosted('chooseTheme'), { type: 'chooseTheme' });
    }
  });

  test('posts the reader\'s choice to the host', async () => {
    const page = dashboard();
    page.click('[data-action="set-zen"]');
    assert.deepStrictEqual(page.lastPosted('setZenMode'), { type: 'setZenMode', enabled: true });

    await setZen(true);
    const zen = dashboard();
    zen.click('[data-action="set-zen"]');
    assert.deepStrictEqual(zen.lastPosted('setZenMode'), { type: 'setZenMode', enabled: false }, 'unticked, it turns Zen off');
    assert.strictEqual(zen.findAll('[data-action="display-command"]').length, 0, 'no Reset or Customize… line');
  });

  test('folds provenance and hides ornament, and keeps what carries meaning', () => {
    const sheet = readSheet('shared/display.css');

    // Ornament goes.
    assert.match(sheet, /body\[data-styling=plain\] \.eyebrow-trail,/);
    assert.match(sheet, /body\[data-styling=plain\] \.metric::before \{/);
    assert.match(sheet, /body\[data-help=hidden\] \.help-text \{ display: none; \}/);

    // DECKARD ▾ is the way to every other page, and stays.
    assert.ok(!/\.eyebrow-home/.test(sheet.replace(':not(:has(.eyebrow-home))', '')), 'DECKARD ▾ is never hidden');

    // The parse error shares the hint's slot and must not go with it.
    assert.ok(
      !/\.query-error/.test(sheet),
      'help text must never hide a search that failed to parse',
    );

    // Board details carry the due date and the word "overdue".
    assert.ok(
      !/\.board-details/.test(sheet),
      'Display must not fold the board details, which carry overdue state',
    );

  });

  test('keeps a line for card details, in and out of zen, without leaving the tree', () => {
    const sheet = readSheet('shared/provenance.css');
    const reveal = readSheet('shared/reveal.css');

    // One line, cut short, revealed by opacity alone, so it takes its room
    // at rest and nothing moves when it shows.
    assert.match(sheet, /\.entry-details \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/);
    assert.match(reveal, /\[data-reveal\][^{]*\{ opacity: 0; \}/);
    assert.ok(!/::after/.test(sheet), 'nothing is laid over the next entry');
    // With nothing ticked it is folded off-screen rather than out of the
    // tree, so a screen reader still reads where the entry is written.
    assert.match(sheet, /body\[data-file-line=never\] \.entry-details,/);
    assert.match(sheet, /clip-path: inset\(50%\)/);
    for (const rules of [sheet, reveal]) {
      assert.ok(!/display: none|visibility: hidden/.test(rules), 'card details and row actions never leave the accessibility tree');
    }
    assert.ok(!/body\.zen/.test(sheet), 'it is the same with zen off');
    assert.ok(
      !/\.board-details/.test(sheet),
      'the board details carry overdue state and never fold',
    );
  });

  test('declares no color, so the contrast matrix cannot move', () => {
    const sheet = readSheet('shared/display.css');
    const declarations = sheet.match(/[a-z-]+\s*:[^;}]+/g) ?? [];
    const colored = declarations.filter((declaration) =>
      /^\s*(color|background|background-color|border-color)\s*:/.test(
        declaration,
      ),
    );

    assert.deepStrictEqual(colored, []);
  });
});
