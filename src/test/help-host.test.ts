import * as assert from 'assert';

import * as vscode from 'vscode';

import * as path from 'path';

import type { HelpPageToHost } from '../ui/protocol/help';
import { HelpPanel } from '../ui/webview/help';
import type { HelpManifest } from '../ui/webview/pages/help/helpManifest';
import { WebviewHost } from '../ui/webview/host/webviewHost';
import { HelpController } from '../ui/webview/pages/help/helpController';
import { ThemePreview } from '../ui/webview/themePreview';
import { FakeSurface } from './fakeWebview';
import { captureTimingLog } from './timingLog';

const extensionUri = vscode.Uri.file('/tmp/deckard-extension');
/** The repository, whose docs/guide is the guide the VSIX ships. */
const repositoryUri = vscode.Uri.file(path.resolve(__dirname, '..', '..'));
/** The Markdown extension's command Help renders the guide with. */
const RENDER = 'markdown.api.render';

/** Two commands: one Help may run, and one it names as code only. */
const manifest: HelpManifest = {
  commands: [
    { command: 'deckard.showStats', title: 'Show Stats', category: 'Deckard' },
    { command: 'deckard.editTask', title: 'Edit Task', category: 'Deckard' },
  ],
  menus: { commandPalette: [{ command: 'deckard.editTask', when: 'editorLangId == markdown' }] },
};

/**
 * A webview panel as VS Code makes one, recording what its host does to
 * it: each HTML set, each message posted, and each reveal.
 */
function fakePanel(options: unknown = {}) {
  const listeners: Array<(message: unknown) => unknown> = [];
  const disposed = new vscode.EventEmitter<void>();
  const panel = {
    options,
    iconPath: undefined as unknown,
    visible: true,
    active: true,
    reveals: 0,
    disposed: false,
    htmls: [] as string[],
    posted: [] as unknown[],
    webview: {
      options: {} as vscode.WebviewOptions,
      cspSource: 'vscode-webview://deckard',
      asWebviewUri: (uri: vscode.Uri) => uri,
      get html(): string {
        return panel.htmls[panel.htmls.length - 1] ?? '';
      },
      set html(value: string) {
        panel.htmls.push(value);
      },
      onDidReceiveMessage: (listener: (message: unknown) => unknown) => {
        listeners.push(listener);
        return { dispose: () => void listeners.splice(listeners.indexOf(listener), 1) };
      },
      postMessage: async (message: unknown) => {
        panel.posted.push(JSON.parse(JSON.stringify(message)));
        return true;
      },
    },
    onDidDispose: disposed.event,
    onDidChangeViewState: new vscode.EventEmitter<void>().event,
    reveal: () => void (panel.reveals += 1),
    dispose: () => {
      panel.disposed = true;
      disposed.fire();
    },
    /** Delivers a message as the page posts it, and resolves once its handler has run. */
    send: async (message: unknown) => {
      await Promise.all([...listeners].map((listener) => listener(JSON.parse(JSON.stringify(message)))));
    },
  };
  return panel;
}

type FakePanel = ReturnType<typeof fakePanel>;

/**
 * Runs `run` with each panel Help makes recorded, each command it runs
 * recorded rather than run, and each releases read noted in `events`.
 */
async function withHelp(
  run: (help: HelpPanel, made: FakePanel[], events: unknown[][], themePreview: ThemePreview) => Promise<void>,
): Promise<void> {
  const window = vscode.window as unknown as Record<string, unknown>;
  const commands = vscode.commands as unknown as Record<string, unknown>;
  const originals = [window.createWebviewPanel, commands.executeCommand];
  const made: FakePanel[] = [];
  const events: unknown[][] = [];
  window.createWebviewPanel = (viewType: string, title: string, _column: unknown, options: unknown) => {
    events.push(['create', viewType, title]);
    const panel = fakePanel(options);
    made.push(panel);
    return panel;
  };
  commands.executeCommand = async (...call: unknown[]) => void events.push(call);
  const themePreview = new ThemePreview();
  const help = new HelpPanel({
    extensionUri,
    themePreview,
    manifest,
    whatsNew: {
      releases: async () => {
        events.push(['releases']);
        return [{ version: '1.27.0', date: '2026-10-09', highlights: ['**1.27.0** things.'] }];
      },
      newSince: () => '1.26.0',
    },
  });
  try {
    await run(help, made, events, themePreview);
  } finally {
    [window.createWebviewPanel, commands.executeCommand] = originals;
    help.dispose();
  }
}

/** The folders Help may load from: the built pages and the icons. */
const HELP_ROOTS = ['/tmp/deckard-extension/dist/webview', '/tmp/deckard-extension/resources'];

/** Webview options with each resource root as its path, to compare. */
function withRoots<T extends { localResourceRoots?: readonly vscode.Uri[] }>(options: T): Omit<T, 'localResourceRoots'> & { localResourceRoots?: string[] } {
  return { ...options, localResourceRoots: options.localResourceRoots?.map((root) => root.path) };
}

/** The section a Help page's HTML opens at, or undefined for the top. */
function anchorOf(html: string): string | undefined {
  return /<body[^>]* data-anchor="([^"]*)"/.exec(html)?.[1];
}

suite('Help host', () => {
  test('a new Help reads What is new first, opens at the section asked for, and runs scripts', async () => {
    await withHelp(async (help, made, events) => {
      await help.show('whats-new');
      assert.deepStrictEqual(events, [['releases'], ['create', 'deckard.help', 'Deckard Help'], [RENDER, '']], 'and starts the Markdown extension');
      assert.strictEqual(made.length, 1);
      const [panel] = made;
      assert.deepStrictEqual(withRoots(panel.options as vscode.WebviewOptions), {
        enableScripts: true,
        retainContextWhenHidden: false,
        enableFindWidget: true,
        localResourceRoots: HELP_ROOTS,
      });
      assert.strictEqual(panel.webview.options.enableScripts, true);
      assert.ok(String((panel.iconPath as vscode.Uri).fsPath).endsWith('resources/deckard.svg'));
      assert.strictEqual(panel.htmls.length, 1);
      assert.strictEqual(anchorOf(panel.htmls[0]), 'whats-new');
      assert.match(panel.htmls[0], /1\.27\.0/);
      assert.strictEqual(panel.reveals, 1);
      assert.deepStrictEqual(panel.posted, [], 'Help is sent no snapshot');
    });
  });

  test('an open Help is asked to show a section, and is brought forward either way', async () => {
    await withHelp(async (help, made, events) => {
      await help.show();
      assert.strictEqual(anchorOf(made[0].htmls[0]), undefined);
      await help.show('commands');
      await help.show();
      assert.strictEqual(made.length, 1);
      assert.deepStrictEqual(made[0].posted, [{ type: 'reveal', anchor: 'commands' }]);
      assert.strictEqual(made[0].reveals, 3);
      assert.strictEqual(made[0].htmls.length, 1, 'the open page is not drawn again');
      assert.deepStrictEqual(events.filter(([event]) => event === 'releases').length, 1, 'What is new is read when Help opens');
    });
  });

  test('a hidden Help, which is not running to be asked, is drawn again at the section asked for', async () => {
    await withHelp(async (help, made) => {
      await help.show();
      made[0].visible = false;
      await help.show('commands');
      assert.strictEqual(made[0].htmls.length, 2);
      assert.strictEqual(anchorOf(made[0].htmls[1]), 'commands');
      assert.deepStrictEqual(made[0].posted, [], 'nothing is posted to a page that is not running');
      assert.strictEqual(made[0].reveals, 2);
      await help.show();
      assert.strictEqual(made[0].htmls.length, 2, 'shown with no section, it is only brought forward');
    });
  });

  test('a theme change draws Help again from the top, and sends nothing', async () => {
    await withHelp(async (help, made, _events, themePreview) => {
      await help.show('whats-new');
      themePreview.show('cooper');
      assert.strictEqual(made[0].htmls.length, 2);
      assert.strictEqual(anchorOf(made[0].htmls[1]), undefined);
      assert.deepStrictEqual(made[0].posted, []);
    });
  });

  test('a restored Help reads What is new before it is drawn, keeps its options, and is sent nothing', async () => {
    await withHelp(async (help, _made, events) => {
      const kept = fakePanel();
      kept.webview.options = { enableCommandUris: true };
      const read = events.length;
      await help.restore(kept as unknown as vscode.WebviewPanel);
      assert.deepStrictEqual(events.slice(read), [['releases'], [RENDER, '']]);
      assert.deepStrictEqual(withRoots(kept.webview.options), { enableCommandUris: true, enableScripts: true, localResourceRoots: HELP_ROOTS });
      assert.strictEqual(kept.htmls.length, 1);
      assert.strictEqual(anchorOf(kept.htmls[0]), undefined);
      assert.deepStrictEqual(kept.posted, []);
      assert.strictEqual(kept.reveals, 0, 'a restored panel is not brought forward');

      const second = fakePanel();
      await help.restore(second as unknown as vscode.WebviewPanel);
      assert.strictEqual(second.disposed, true, 'a second kept panel is closed');
      assert.strictEqual(second.htmls.length, 0);
      assert.deepStrictEqual(events.slice(read), [['releases'], [RENDER, '']]);
    });
  });

  test('runs only the commands Help may run, and opens the changelog', async () => {
    await withHelp(async (help, made, events) => {
      await help.show();
      const before = events.length;
      await made[0].send({ type: 'runCommand', command: 'deckard.editTask' });
      await made[0].send({ type: 'runCommand', command: 'workbench.action.quit' });
      await made[0].send({ type: 'runCommand', command: 'deckard.showStats' });
      await made[0].send({ type: 'openChangelog' });
      const ran = events.slice(before);
      assert.deepStrictEqual(ran.map(([command]) => command), ['deckard.showStats', 'markdown.showPreview']);
      assert.ok(String((ran[1][1] as vscode.Uri).fsPath).endsWith('/tmp/deckard-extension/CHANGELOG.md'));
    });
  });

  test('a guide page the guide has is sent, and one that cannot be read says so; others are refused', async () => {
    await withHelp(async (help, made) => {
      await help.show();
      await made[0].send({ type: 'openGuide', page: 'no-such-page' });
      await made[0].send({ type: 'openGuide', page: '../../package' });
      assert.deepStrictEqual(made[0].posted, []);

      // The test extension folder has no guide, so the page cannot be read.
      await made[0].send({ type: 'openGuide', page: 'tasks', anchor: 'task-metadata' });
      const [guide] = made[0].posted as Array<{ type: string; page: string; title: string; html: string; anchor?: string }>;
      assert.deepStrictEqual({ ...guide, html: undefined }, {
        type: 'guide',
        page: 'tasks',
        title: guide.title,
        html: undefined,
        anchor: 'task-metadata',
      });
      assert.ok(guide.title.length > 0);
      assert.match(guide.html, /Deckard could not read this page of the guide\./);
      assert.match(guide.html, /docs\/guide\/tasks\.md/);
    });
  });

  test('its host runs only what Help may run, open or not, and reads no guide without a panel', async () => {
    await withHelp(async (help, made, events) => {
      await help.handle({ type: 'runCommand', command: 'deckard.editTask' });
      await help.handle({ type: 'runCommand', command: 'workbench.action.quit' });
      await help.handle({ type: 'runCommand', command: 'deckard.showStats' });
      await help.handle({ type: 'openGuide', page: 'tasks' });
      assert.deepStrictEqual(events, [['deckard.showStats']]);
      assert.deepStrictEqual(made, []);
    });
  });

  test('a closed Help stops listening, and opens anew', async () => {
    await withHelp(async (help, made, _events, themePreview) => {
      await help.show();
      made[0].dispose();
      themePreview.show('cooper');
      assert.strictEqual(made[0].htmls.length, 1, 'a closed panel is not drawn again');
      await help.show('whats-new');
      assert.strictEqual(made.length, 2);
      assert.strictEqual(anchorOf(made[1].htmls[0]), 'whats-new');
    });
  });

  test('refreshes nothing and writes nothing to the log, shown, hidden, or shown again', () => {
    const controller = new HelpController({ extensionUri, manifest });
    const host = new WebviewHost<never, HelpPageToHost>(controller, { themePreview: new ThemePreview() });
    const surface = new FakeSurface();
    try {
      host.attach(surface);
      const lines = captureTimingLog(() => {
        host.refresh();
        surface.setVisible(false);
        host.refresh();
        surface.setVisible(true);
        surface.setVisible(false);
        surface.setVisible(true);
      });
      assert.deepStrictEqual(lines, []);
      assert.deepStrictEqual(surface.webview.posted, []);
    } finally {
      host.dispose();
    }
  });

  test('its controller sends no snapshot and draws at a section only while asked', () => {
    const controller = new HelpController({ extensionUri, manifest });
    const host = new WebviewHost<never, HelpPageToHost>(controller, { themePreview: new ThemePreview() });
    const surface = new FakeSurface();
    try {
      host.attach(surface);
      host.refresh();
      assert.deepStrictEqual(surface.webview.posted, []);
      const webview = { cspSource: 'x', asWebviewUri: (uri: vscode.Uri) => uri } as unknown as vscode.Webview;
      assert.strictEqual(anchorOf(controller.drawingAt('settings', () => controller.html(webview, { theme: 'corpo', zen: false }))), 'settings');
      assert.strictEqual(anchorOf(controller.html(webview, { theme: 'corpo', zen: false })), undefined);
    } finally {
      host.dispose();
    }
  });

  test('a guide page is rendered by the Markdown extension, its links and screenshots rewritten for the panel', async () => {
    const rendered: unknown[] = [];
    await withGuideRenderer(
      async (source) => {
        rendered.push(source);
        return '<span id="markdown-mermaid" aria-hidden="true"></span>\n<h1 data-line="0" class="code-line" dir="auto" id="tasks">Tasks</h1>\n' +
          '<p data-line="2" class="code-line" dir="auto"><a href="task-board.md" data-href="task-board.md">board</a> ' +
          '<img src="../images/agenda.png" alt="Tasks view." data-src="../images/agenda.png"></p>';
      },
      async (surface) => {
        assert.deepStrictEqual(rendered, [''], 'the Markdown extension was started as Help opened');
        await surface.webview.send({ type: 'openGuide', page: 'tasks', anchor: 'task-metadata' });
        assert.strictEqual(rendered.length, 2);
        assert.match(String(rendered[1]), /^# Tasks\n/, 'the page as the VSIX ships it');
        assert.deepStrictEqual(surface.webview.posted, [{
          type: 'guide',
          page: 'tasks',
          title: 'Tasks',
          anchor: 'task-metadata',
          html: '<h1 data-line="0" class="code-line" dir="auto" id="tasks">Tasks</h1>\n' +
            '<p data-line="2" class="code-line" dir="auto"><a href="#" data-guide-page="task-board">board</a> ' +
            '<img src="https://raw.githubusercontent.com/doctorallen/deckard/master/docs/images/agenda.png" alt="Tasks view."></p>',
        }]);
      },
    );
  });

  test('without the Markdown extension, a guide page says so in one sentence and links to the page on the site', async () => {
    for (const unavailable of [
      () => Promise.reject(new Error(`command '${RENDER}' not found`)),
      () => Promise.resolve(undefined),
    ]) {
      await withGuideRenderer(unavailable, async (surface) => {
        await surface.webview.send({ type: 'openGuide', page: 'daily-notes' });
        await surface.webview.send({ type: 'openGuide', page: 'README' });
        assert.deepStrictEqual(surface.webview.posted, [
          {
            type: 'guide',
            page: 'daily-notes',
            title: 'Daily notes, reviews, and the calendar',
            html: '<p>Help shows the guide with VS Code’s built-in Markdown extension, which is not available, so this page is on the guide’s site: ' +
              '<a href="https://deckard.esperinnovations.com/daily-notes.html">Daily notes, reviews, and the calendar</a>.</p>',
          },
          {
            type: 'guide',
            page: 'README',
            title: 'Deckard guide',
            html: '<p>Help shows the guide with VS Code’s built-in Markdown extension, which is not available, so this page is on the guide’s site: ' +
              '<a href="https://deckard.esperinnovations.com">Deckard guide</a>.</p>',
          },
        ]);
      });
    }
  });

  test('a failed start of the Markdown extension as Help opens is not reported', async () => {
    await withGuideRenderer(
      () => Promise.reject(new Error(`command '${RENDER}' not found`)),
      async (surface, calls) => {
        assert.deepStrictEqual(calls, [[RENDER, '']], 'it was asked to start as Help opened');
        assert.deepStrictEqual(surface.webview.posted, []);
      },
    );
  });
});

/**
 * Runs `run` with Help's controller reading the repository's guide in a
 * fake panel, and VS Code's Markdown extension standing in as `render`.
 * Every command run is recorded in `calls`; only the Markdown extension's
 * answers.
 */
async function withGuideRenderer(
  render: (source: unknown) => Promise<unknown>,
  run: (surface: FakeSurface, calls: unknown[][]) => Promise<void>,
): Promise<void> {
  const commands = vscode.commands as unknown as Record<string, unknown>;
  const original = commands.executeCommand;
  const calls: unknown[][] = [];
  commands.executeCommand = (...call: unknown[]) => {
    calls.push(call);
    return call[0] === RENDER ? render(call[1]) : Promise.resolve(undefined);
  };
  const controller = new HelpController({ extensionUri: repositoryUri, manifest });
  const host = new WebviewHost<never, HelpPageToHost>(controller, { themePreview: new ThemePreview() });
  const surface = new FakeSurface();
  try {
    host.attach(surface);
    // Lets the start the host asked for as it attached settle, or fail.
    await new Promise((resolve) => setImmediate(resolve));
    await run(surface, calls);
  } finally {
    commands.executeCommand = original;
    host.dispose();
  }
}
