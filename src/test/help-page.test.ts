import * as assert from 'assert';

import * as vscode from 'vscode';

import * as fs from 'fs';
import * as path from 'path';

import { HelpPanel } from '../ui/webview/help';
import { GUIDE_CONTENTS, GUIDE_PAGES, WHATS_NEW } from '../ui/webview/guide';
import { HelpManifest } from '../ui/webview/pages/help/helpManifest';
import { openWebviewPage } from './webviewPage';
import { renderPage } from './pages';
import { ThemePreview } from '../ui/webview/themePreview';

suite('Help page', () => {
  const extensionUri = vscode.Uri.file('/tmp/deckard-extension');
  const manifest = (
    JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'),
    ) as { contributes: HelpManifest }
  ).contributes;

  test('its contents list the guide\u2019s pages as the guide\u2019s README groups and orders them', () => {
    const page = openWebviewPage(renderPage('help'));
    try {
      const links = page.findAll('nav a[data-guide-page]');
      assert.deepStrictEqual(
        links.map((link) => link.getAttribute('data-guide-page')),
        ['README', ...GUIDE_CONTENTS.flatMap(({ pages }) => pages)],
      );
      assert.deepStrictEqual(
        links.map((link) => link.textContent),
        ['README', ...GUIDE_CONTENTS.flatMap(({ pages }) => pages)].map((name) => (name === WHATS_NEW ? 'Changelog' : GUIDE_PAGES[name])),
      );
      assert.deepStrictEqual(page.findAll('nav .nav-group').map((group) => group.textContent), GUIDE_CONTENTS.map(({ group }) => group));
      assert.strictEqual(page.findAll('.card, .read-more, article section:not(#whats-new)').length, 0, 'and nothing of the quick glance');
    } finally {
      page.dispose();
    }
  });

  test('opens at the guide\u2019s contents, and shows the page its host sends, marked in the contents', () => {
    const page = openWebviewPage(renderPage('help'));
    try {
      assert.deepStrictEqual(page.posted, [{ type: 'openGuide', page: 'README' }]);
      page.window.dispatchEvent(new page.window.MessageEvent('message', {
        data: { type: 'guide', page: 'README', title: 'Deckard guide', html: '<h1 id="deckard-guide">Deckard guide</h1>' },
      }));
      assert.strictEqual(page.document.activeElement, page.find('#guide-view h1'), 'the focus is on its title');
      assert.deepStrictEqual(page.findAll('nav a[aria-current="page"]').map((link) => link.getAttribute('data-guide-page')), ['README']);
      assert.strictEqual((page.find('#whats-new') as HTMLElement).hidden, true);
    } finally {
      page.dispose();
    }
  });

  test('a page in the contents is asked for, and What\u2019s new shows at once', () => {
    const page = openWebviewPage(renderPage('help'));
    try {
      page.click('nav a[data-guide-page="tasks"]');
      assert.deepStrictEqual(page.lastPosted('openGuide'), { type: 'openGuide', page: 'tasks' });
      page.window.dispatchEvent(new page.window.MessageEvent('message', {
        data: { type: 'guide', page: 'tasks', title: 'Tasks', html: '<h1 id="tasks">Tasks</h1>' },
      }));
      assert.deepStrictEqual(page.findAll('nav a[aria-current]').map((link) => link.getAttribute('data-guide-page')), ['tasks']);
      const asked = page.posted.length;
      page.click(`nav a[data-guide-page="${WHATS_NEW}"]`);
      assert.strictEqual(page.posted.length, asked, 'What\u2019s new is drawn in the page, so nothing is asked for');
      assert.strictEqual((page.find('#whats-new') as HTMLElement).hidden, false);
      assert.strictEqual((page.find('#guide-view') as HTMLElement).hidden, true);
      assert.deepStrictEqual(page.findAll('nav a[aria-current]').map((link) => link.getAttribute('data-guide-page')), [WHATS_NEW]);
      assert.strictEqual(page.document.activeElement?.textContent, 'Changelog');
    } finally {
      page.dispose();
    }
  });

  test('a command a guide page names runs from Help', () => {
    const page = openWebviewPage(renderPage('help'));
    try {
      page.window.dispatchEvent(new page.window.MessageEvent('message', {
        data: {
          type: 'guide',
          page: 'search',
          title: 'Search',
          html: '<h1>Search</h1><p><button type="button" class="command-link" data-command="deckard.searchWorkspace">Deckard: Find in Notes</button></p>',
        },
      }));
      page.click('#guide-view .command-link');
      assert.deepStrictEqual(page.lastPosted('runCommand'), { type: 'runCommand', command: 'deckard.searchWorkspace' });
    } finally {
      page.dispose();
    }
  });

  test('asked to show a place, it goes there', () => {
    const page = openWebviewPage(renderPage('help'));
    try {
      page.window.dispatchEvent(new page.window.MessageEvent('message', { data: { type: 'reveal', page: 'tasks', anchor: 'task-metadata' } }));
      assert.deepStrictEqual(page.lastPosted('openGuide'), { type: 'openGuide', page: 'tasks', anchor: 'task-metadata' });
      page.window.dispatchEvent(new page.window.MessageEvent('message', {
        data: { type: 'guide', page: 'tasks', title: 'Tasks', anchor: 'task-metadata', html: '<h1 id="tasks">Tasks</h1><h2 id="task-metadata">Task metadata</h2><h2 id="tasks-view">Tasks view</h2>' },
      }));
      const revealed: string[] = [];
      page.window.HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
        revealed.push(this.id);
      };
      const asked = page.posted.length;
      page.window.dispatchEvent(new page.window.MessageEvent('message', { data: { type: 'reveal', page: 'tasks', anchor: 'tasks-view' } }));
      assert.deepStrictEqual(revealed, ['tasks-view'], 'a heading of the page shown is gone to at once');
      assert.strictEqual(page.posted.length, asked);
      page.window.dispatchEvent(new page.window.MessageEvent('message', { data: { type: 'reveal', page: WHATS_NEW } }));
      assert.strictEqual((page.find('#whats-new') as HTMLElement).hidden, false);
    } finally {
      page.dispose();
    }
  });

  test("lists what is new, newest first, and marks what is new since the update", () => {
    const release = (version: string, date: string) => ({ version, date, highlights: [`**${version}** things.`] });
    const releases = [
      { version: 'Unreleased', highlights: ['Not yet.'] },
      ...['1.27.0', '1.26.0', '1.25.0', '1.24.0', '1.23.0', '1.22.0'].map((version, i) =>
        release(version, `2026-10-0${9 - i}`),
      ),
    ];
    const page = openWebviewPage(
      renderPage('help', { help: { options: { releases, newSince: '1.25.0', place: { page: WHATS_NEW } } } }),
    );
    try {
      assert.deepStrictEqual(
        page.findAll('#whats-new h2').map((heading) => heading.firstChild?.textContent?.trim()),
        ['1.27.0 · 2026-10-09', '1.26.0 · 2026-10-08', '1.25.0 · 2026-10-07', '1.24.0 · 2026-10-06', '1.23.0 · 2026-10-05'],
      );
      assert.strictEqual(page.findAll('#whats-new .whats-new-chip').length, 2, 'New only after 1.25.0');
      assert.strictEqual(page.find('#whats-new li strong').textContent, '1.27.0');
      assert.strictEqual(page.document.body.getAttribute('data-page'), WHATS_NEW);
      assert.deepStrictEqual(page.posted, [], 'no guide page is asked for');
      assert.strictEqual(page.document.activeElement?.textContent, 'Changelog', 'opened on What is new, it goes there');
      page.click('[data-action="open-changelog"]');
      assert.ok(page.lastPosted('openChangelog'));
    } finally {
      page.dispose();
    }
    assert.match(
      renderPage('help', { help: { options: { releases: [] } } }),
      /This version's changes are listed in the changelog\./,
    );
  });

  test('its host runs only what Help may run', async () => {
    const commands = vscode.commands as unknown as Record<string, unknown>;
    const original = commands.executeCommand;
    const ran: string[] = [];
    commands.executeCommand = async (id: string) => void ran.push(id);
    const help = new HelpPanel({ extensionUri, themePreview: new ThemePreview(), manifest });
    try {
      await help.handle({ type: 'runCommand', command: 'deckard.editTask' });
      await help.handle({ type: 'runCommand', command: 'workbench.action.quit' });
      await help.handle({ type: 'runCommand', command: 'deckard.showStats' });
    } finally {
      commands.executeCommand = original;
      help.dispose();
    }
    assert.deepStrictEqual(ran, ['deckard.showStats']);
  });

  test('its panel runs scripts, made new or restored', async () => {
    const window = vscode.window as unknown as Record<string, unknown>;
    const original = window.createWebviewPanel;
    const made: unknown[] = [];
    const fakePanel = () => ({
      webview: {
        options: {} as vscode.WebviewOptions,
        html: '',
        cspSource: 'x',
        asWebviewUri: (uri: vscode.Uri) => uri,
        onDidReceiveMessage: () => ({ dispose: () => undefined }),
        postMessage: async () => true,
      },
      onDidDispose: () => ({ dispose: () => undefined }),
      onDidChangeViewState: () => ({ dispose: () => undefined }),
      reveal: () => undefined,
      dispose: () => undefined,
    });
    window.createWebviewPanel = (...args: unknown[]) => {
      made.push(args[3]);
      return fakePanel();
    };
    assert.strictEqual(window.createWebviewPanel === original, false, 'the panel can be stood in for');
    const help = new HelpPanel({ extensionUri, themePreview: new ThemePreview() });
    const restoredHelp = new HelpPanel({ extensionUri, themePreview: new ThemePreview() });
    try {
      await help.show();
      assert.strictEqual((made[0] as vscode.WebviewPanelOptions & vscode.WebviewOptions).enableScripts, true);

      const restored = fakePanel();
      await restoredHelp.restore(restored as unknown as vscode.WebviewPanel);
      assert.strictEqual(restored.webview.options.enableScripts, true);
    } finally {
      window.createWebviewPanel = original;
      help.dispose();
      restoredHelp.dispose();
    }
  });

  test('shown again, it comes back to the page it showed and where it was scrolled', () => {
    const html = renderPage('help', { help: { options: { place: { page: WHATS_NEW } } } });
    const guide = { type: 'guide', page: 'search', title: 'Search', anchor: 'query-language', html: '<h1 id="search">Search</h1><h2 id="query-language">Query language</h2>' };
    let saved: unknown;
    const first = openWebviewPage(html);
    try {
      first.window.dispatchEvent(new first.window.MessageEvent('message', { data: guide }));
      saved = first.savedState();
      const { drawn, ...place } = saved as { drawn: unknown };
      assert.strictEqual(typeof drawn, 'string');
      assert.deepStrictEqual(place, { place: { page: 'search', anchor: 'query-language' }, scrollY: 0 });
    } finally {
      first.dispose();
    }

    // VS Code loads the same HTML again when a hidden Help is shown.
    const again = openWebviewPage(html, undefined, { savedState: { ...(saved as object), scrollY: 640 } });
    try {
      assert.deepStrictEqual(again.posted, [{ type: 'openGuide', page: 'search', anchor: 'query-language' }], 'it asks for its guide page again');
      assert.strictEqual((again.find('#whats-new') as HTMLElement).hidden, true, 'rather than opening at the place it was drawn at');
      const revealed: string[] = [];
      again.window.HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
        revealed.push(this.id);
      };
      again.window.dispatchEvent(new again.window.MessageEvent('message', { data: guide }));
      assert.strictEqual(again.text('#guide-view h2'), 'Query language');
      assert.deepStrictEqual(revealed, [], 'and goes where it was scrolled, not to the heading');
      const { place } = again.savedState() as { place?: unknown };
      assert.deepStrictEqual(place, { page: 'search', anchor: 'query-language' });
    } finally {
      again.dispose();
    }

    // Shown again on What's new, it is there at once.
    const onWhatsNew = openWebviewPage(html, undefined, {
      savedState: { ...(saved as object), place: { page: WHATS_NEW } },
    });
    try {
      assert.deepStrictEqual(onWhatsNew.posted, []);
      assert.strictEqual((onWhatsNew.find('#whats-new') as HTMLElement).hidden, false);
    } finally {
      onWhatsNew.dispose();
    }
  });

  test('drawn anew, such as for a theme, it opens where it is drawn, not where it was', () => {
    const saved = (() => {
      const page = openWebviewPage(renderPage('help'));
      try {
        page.window.dispatchEvent(new page.window.MessageEvent('message', {
          data: { type: 'guide', page: 'search', title: 'Search', html: '<h1 id="search">Search</h1>' },
        }));
        return page.savedState();
      } finally {
        page.dispose();
      }
    })();
    const redrawn = openWebviewPage(
      renderPage('help', { help: { options: { place: { page: 'tasks', anchor: 'task-metadata' } } } }),
      undefined,
      { savedState: saved },
    );
    try {
      assert.deepStrictEqual(redrawn.posted, [{ type: 'openGuide', page: 'tasks', anchor: 'task-metadata' }]);
    } finally {
      redrawn.dispose();
    }
  });
});
