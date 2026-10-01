import * as assert from 'assert';

import * as vscode from 'vscode';

import * as fs from 'fs';
import * as path from 'path';

import { HelpPanel } from '../ui/webview/help';
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
  const helpHtml = (platform: NodeJS.Platform = 'darwin') =>
    renderPage('help', { help: { manifest, options: { platform } } });

  test('names only commands Deckard contributes', () => {
    const titles = new Set(manifest.commands?.map((command) => command.title));
    const named = [...renderPage('help').matchAll(/<code>Deckard: ([^<]+)<\/code>/g)].map(
      (match) => match[1],
    );
    assert.ok(named.length > 20, 'Help names the commands it describes');
    assert.deepStrictEqual(named.filter((title) => !titles.has(title)), []);
  });

  test('a command it names runs from Help, with its shortcut beside it', () => {
    const page = openWebviewPage(helpHtml());
    try {
      const find = page
        .findAll('article button.command-link[data-command="deckard.searchWorkspace"]')
        .find((button) => button.textContent === 'Deckard: Find in Notes');
      assert.ok(find, 'the prose names Find as a button');
      assert.strictEqual(find.nextElementSibling?.textContent, 'Cmd+Shift+Alt+F');
      (find as HTMLElement).click();
      assert.ok(
        page.findAll('#commands td button.command-link').some((button) => button.textContent === 'Find in Notes'),
        'and so does the commands table',
      );
      assert.deepStrictEqual(page.lastPosted('runCommand'), {
        type: 'runCommand',
        command: 'deckard.searchWorkspace',
      });
      assert.strictEqual(
        page.findAll('article button.command-link[data-command="deckard.editTask"]').length,
        0,
        'Edit Task acts on the note in the editor, so Help names it as code',
      );
      assert.ok(page.findAll('article code').some((code) => code.textContent === 'Deckard: Edit Task'));
    } finally {
      page.dispose();
    }
    assert.match(helpHtml('linux'), /<kbd class="shortcut">Ctrl\+Shift\+Alt\+F<\/kbd>/);
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
      renderPage('help', { help: { manifest, options: { releases, newSince: '1.25.0', anchor: 'whats-new' } } }),
    );
    try {
      assert.deepStrictEqual(
        page.findAll('#whats-new h3').map((heading) => heading.firstChild?.textContent?.trim()),
        ['1.27.0 · 2026-10-09', '1.26.0 · 2026-10-08', '1.25.0 · 2026-10-07', '1.24.0 · 2026-10-06', '1.23.0 · 2026-10-05'],
      );
      assert.strictEqual(page.findAll('#whats-new .whats-new-chip').length, 2, 'New only after 1.25.0');
      assert.strictEqual(page.find('#whats-new li strong').textContent, '1.27.0');
      assert.strictEqual(page.document.body.getAttribute('data-anchor'), 'whats-new');
      assert.strictEqual(page.document.activeElement?.textContent, "What's new", 'opened on What is new, it goes there');
      page.click('[data-action="open-changelog"]');
      assert.ok(page.lastPosted('openChangelog'));
      assert.ok(page.find('nav a[href="#whats-new"]'));
    } finally {
      page.dispose();
    }
    assert.match(
      renderPage('help', { help: { manifest, options: { releases: [] } } }),
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

  test('its rail marks the section being read', () => {
    const page = openWebviewPage(
      renderPage('help'),
    );
    try {
      assert.strictEqual(page.findAll('nav a[aria-current="location"]').length, 1);
    } finally {
      page.dispose();
    }
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

  test('shown again, it comes back to the guide page it showed and where it was scrolled', () => {
    const html = renderPage('help', { help: { manifest, options: { anchor: 'whats-new' } } });
    const guide = { type: 'guide', page: 'search', title: 'Search', anchor: 'query-language', html: '<h1 id="search">Search</h1><h2 id="query-language">Query language</h2>' };
    let saved: unknown;
    const first = openWebviewPage(html);
    try {
      first.window.dispatchEvent(new first.window.MessageEvent('message', { data: guide }));
      saved = first.savedState();
      const { drawn, ...place } = saved as { drawn: unknown };
      assert.strictEqual(typeof drawn, 'string');
      assert.deepStrictEqual(place, { guide: { page: 'search', anchor: 'query-language' }, scrollY: 0 });
      first.click('#guide-view [data-action="guide-back"]');
      const { drawn: _drawn, ...back } = first.savedState() as { drawn: unknown };
      assert.deepStrictEqual(back, { scrollY: 0 }, 'back on Help, no guide page is kept');
    } finally {
      first.dispose();
    }

    // VS Code loads the same HTML again when a hidden Help is shown.
    const again = openWebviewPage(html, undefined, { savedState: { ...(saved as object), scrollY: 640 } });
    try {
      assert.deepStrictEqual(again.posted, [{ type: 'openGuide', page: 'search', anchor: 'query-language' }], 'it asks for its guide page again');
      assert.notStrictEqual(again.document.activeElement?.textContent, "What's new", 'rather than opening at the section it was drawn at');
      const revealed: string[] = [];
      again.window.HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
        revealed.push(this.id);
      };
      again.window.dispatchEvent(new again.window.MessageEvent('message', { data: guide }));
      assert.strictEqual(again.text('#guide-view h2'), 'Query language');
      assert.deepStrictEqual(revealed, [], 'and goes where it was scrolled, not to the heading');
      const { drawn: _drawn, ...place } = again.savedState() as { drawn: unknown; guide?: unknown };
      assert.deepStrictEqual(place.guide, { page: 'search', anchor: 'query-language' });
    } finally {
      again.dispose();
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
      renderPage('help', { help: { manifest, options: { anchor: 'whats-new' } } }),
      undefined,
      { savedState: saved },
    );
    try {
      assert.deepStrictEqual(redrawn.posted, [], 'no guide page is asked for');
      assert.strictEqual(redrawn.document.activeElement?.textContent, "What's new");
      assert.strictEqual((redrawn.find('#guide-view') as HTMLElement).hidden, true);
    } finally {
      redrawn.dispose();
    }
  });
});
