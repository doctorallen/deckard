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
 * Zen mode's promise is that it takes nothing away. The check that matters is
 * not that the eyebrow is gone — it is that the set of controls a reader can
 * reach is the same with zen on as with it off.
 */
suite('Zen mode', () => {
  const pages: WebviewPage[] = [];
  let store: TestPreferences | undefined;

  const configuration = () => vscode.workspace.getConfiguration('deckard');

  const setZen = async (enabled: boolean): Promise<void> => {
    await configuration().update(
      'display.level',
      enabled ? 'zen' : undefined,
      vscode.ConfigurationTarget.Global,
    );
  };

  teardown(async () => {
    pages.splice(0).forEach((page) => page.dispose());
    store?.repository.dispose();
    store = undefined;
    await configuration().update(
      'display.level',
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

  /** Everything a reader can act on, as the page draws it. */
  const controls = (page: WebviewPage): string[] =>
    page
      .findAll('button, input, select, a, summary, [data-action], [tabindex]')
      .map((element) =>
        [
          element.tagName.toLowerCase(),
          element.getAttribute('data-action') ?? '',
          element.getAttribute('data-value') ?? '',
          element.getAttribute('type') ?? '',
          (element.textContent ?? '').trim().slice(0, 40),
        ].join('|'),
      )
      .sort();

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

  test('takes no control away from the Dashboard', async () => {
    const before = controls(dashboard());
    await setZen(true);
    const after = controls(dashboard());

    assert.deepStrictEqual(after, before);
    assert.ok(before.length > 10, 'the page drew something to compare');
  });

  test('takes no control away from a search page', async () => {
    const before = controls(searchPage());
    await setZen(true);
    const after = controls(searchPage());

    assert.deepStrictEqual(after, before);
  });

  test('offers the gear a Display row that says which step is in force', async () => {
    const zenStep = '[data-action="set-display"][data-display="level"][data-value="zen"]';
    assert.strictEqual(dashboard().find(zenStep)?.getAttribute('aria-pressed'), 'false');

    await setZen(true);
    assert.strictEqual(dashboard().find(zenStep)?.getAttribute('aria-pressed'), 'true', 'Zen mode reads as the Zen step');
  });

  test('every gear offers the theme, then the page width, then Display, and asks the host to choose a theme', () => {
    for (const page of [dashboard(), searchPage()]) {
      const labels = page.findAll('.view-options-group').map((group) => group.children[0].textContent);
      const theme = labels.indexOf('Theme');
      assert.ok(theme >= 0 && labels[theme + 1] === 'Page width' && labels[theme + 2] === 'Display', labels.join());
      const button = page.find('[data-action="choose-theme"]');
      assert.strictEqual(button.textContent, 'Corpo…');
      assert.strictEqual(button.getAttribute('aria-label'), 'Theme: Corpo. Choose another');
      page.click('[data-action="choose-theme"]');
      assert.deepStrictEqual(page.lastPosted('chooseTheme'), { type: 'chooseTheme' });
    }
  });

  test('posts the reader\'s choice to the host', async () => {
    const page = dashboard();
    page.click('[data-action="set-display"][data-display="level"][data-value="quiet"]');
    assert.deepStrictEqual(page.lastPosted('setDisplay'), { type: 'setDisplay', setting: 'level', value: 'quiet' });

    page.click('[data-action="display-command"][data-command="customize"]');
    assert.deepStrictEqual(page.lastPosted('displayCommand'), { type: 'displayCommand', command: 'customize' });
  });

  test('folds provenance and hides ornament, and keeps what carries meaning', () => {
    const sheet = readSheet('shared/display.css');

    // Ornament goes.
    assert.match(sheet, /body\[data-styling=plain\] \.eyebrow-trail,/);
    assert.match(sheet, /body\[data-styling=plain\] \.metric::before \{/);
    assert.match(sheet, /body\[data-help=hidden\] \.query-hint,/);

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

  test('folds where an entry is written, in and out of zen, without leaving the tree', () => {
    const sheet = readSheet('shared/provenance.css');

    // Folded off-screen rather than out of the tree, so it is still
    // announced, still found by find-in-page, and comes back on focus.
    assert.match(sheet, /\.task-row \.task-source,/);
    assert.match(sheet, /clip-path: inset\(50%\)/);
    assert.match(sheet, /\.task-row:focus-within \.task-source/);
    assert.ok(
      !/\.task-source[^{]*\{[^}]*display: none/.test(sheet),
      'provenance must not leave the accessibility tree',
    );
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
