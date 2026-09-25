import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { PreferencesStore } from '../core/storage/preferences';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import {
  createDashboardSnapshot,
  createSearchPageSnapshot,
} from '../ui/state/dashboardState';
import { createDashboardWidgets } from '../ui/state/dashboardWidgets';
import { getProvenanceCss, getZenCss } from '../ui/webview/components';
import { getDashboardHtml } from '../ui/webview/dashboardHtml';
import { getSearchPageHtml } from '../ui/webview/searchPageHtml';
import { isZenModeEnabled } from '../ui/webview/zenMode';
import { openWebviewPage, WebviewPage } from './webviewPage';

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
  let store: PreferencesStore | undefined;

  const configuration = () => vscode.workspace.getConfiguration('deckard');

  const setZen = async (enabled: boolean): Promise<void> => {
    await configuration().update(
      'zenMode',
      enabled,
      vscode.ConfigurationTarget.Global,
    );
  };

  teardown(async () => {
    pages.splice(0).forEach((page) => page.dispose());
    store?.dispose();
    store = undefined;
    await configuration().update(
      'zenMode',
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

  const webview = {
    cspSource: 'vscode-webview://deckard',
    asWebviewUri: (resource: vscode.Uri) => resource,
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
    store = new PreferencesStore(new MemoryMemento());
    const preferences = store.value;
    const built = index();
    const snapshot = {
      ...createDashboardSnapshot(built, preferences),
      widgets: createDashboardWidgets(built, preferences, {
        now: Date.parse('2026-09-21T00:00:00Z'),
        upcomingDays: 7,
        tagTitleDisplayMode: 'inline' as const,
      }),
    };
    const page = openWebviewPage(
      getDashboardHtml(webview, vscode.Uri.file('/deckard')),
      snapshot,
    );
    pages.push(page);
    return page;
  };

  const searchPage = () => {
    store = new PreferencesStore(new MemoryMemento());
    const page = openWebviewPage(
      getSearchPageHtml(webview),
      createSearchPageSnapshot(index(), store.value, '#project/atlas'),
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
    const off = getDashboardHtml(webview, vscode.Uri.file('/deckard'));
    await setZen(true);
    const on = getDashboardHtml(webview, vscode.Uri.file('/deckard'));

    assert.ok(!off.includes('<body class="zen">'), 'off marks the body');
    assert.ok(on.includes('<body class="zen">'), 'on does not mark the body');
    assert.ok(off.includes('body.zen {'), 'the sheet ships when zen is off');
    assert.ok(on.includes('body.zen {'), 'the sheet ships when zen is on');
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

  test('offers the gear a zen row that says which way it is set', async () => {
    const off = dashboard().find('[data-action="set-zen-mode"][data-value="on"]');
    assert.strictEqual(off?.getAttribute('aria-pressed'), 'false');

    await setZen(true);
    const on = dashboard().find('[data-action="set-zen-mode"][data-value="on"]');
    assert.strictEqual(on?.getAttribute('aria-pressed'), 'true');
  });

  test('posts the reader\'s choice to the host', async () => {
    const page = dashboard();
    page.click('[data-action="set-zen-mode"][data-value="on"]');

    assert.deepStrictEqual(page.lastPosted('setZenMode'), {
      type: 'setZenMode',
      enabled: true,
    });
  });

  test('folds provenance and hides ornament, and keeps what carries meaning', () => {
    const sheet = getZenCss();

    // Ornament goes.
    assert.match(sheet, /body\.zen \.eyebrow,/);
    assert.match(sheet, /body\.zen \.metric::before,/);
    assert.match(sheet, /body\.zen \.query-hint,/);

    // The parse error shares the hint's slot and must not go with it.
    assert.ok(
      !/\.query-error/.test(sheet),
      'zen must never hide a search that failed to parse',
    );

    // Board details carry the due date and the word "overdue".
    assert.ok(
      !/\.board-details/.test(sheet),
      'zen must not fold the board details, which carry overdue state',
    );

  });

  test('folds where an entry is written, in and out of zen, without leaving the tree', () => {
    const sheet = getProvenanceCss();

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
    const sheet = getZenCss();
    const declarations = sheet.match(/[a-z-]+\s*:[^;}]+/g) ?? [];
    const colored = declarations.filter((declaration) =>
      /^\s*(color|background|background-color|border-color)\s*:/.test(
        declaration,
      ),
    );

    assert.deepStrictEqual(colored, []);
  });
});
