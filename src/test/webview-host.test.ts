import * as assert from 'assert';

import * as vscode from 'vscode';

import { exactlyType, narrowOpenTag, narrowWith } from '../ui/webview/host/narrowing';
import type { PageContext, PageController, PageOptions } from '../ui/webview/host/pageController';
import { PanelAdapter } from '../ui/webview/host/panelAdapter';
import { PanelSurface, scriptOptions } from '../ui/webview/host/surface';
import { ViewAdapter } from '../ui/webview/host/viewAdapter';
import { HostIndexer, WebviewHost } from '../ui/webview/host/webviewHost';
import { ThemePreview } from '../ui/webview/themePreview';
import { VIEW_PRIORITY } from '../core/workspace/publishing';
import { withConfigurationEvents } from './configurationEvents';
import { FakeSurface, FakeWebview, recordSurface } from './fakeWebview';
import { captureTimingLog } from './timingLog';

/** What the test page sends. */
interface TestPageToHost {
  openTag: { type: 'openTag'; tagKey: string };
  reload: { type: 'reload' };
}

/** A page whose snapshot is a counter, and which records what it was sent. */
function createController(options: Partial<PageOptions> = {}) {
  const calls: string[] = [];
  let snapshot: { count: number } | undefined = { count: 0 };
  const controller: PageController<{ count: number }, TestPageToHost> = {
    name: 'Test page',
    options: { retainContextWhenHidden: false, enableFindWidget: false, ...options },
    html: (_webview, theme) => `<p>${theme}</p>`,
    buildSnapshot: () => snapshot && { count: snapshot.count++ },
    narrow: narrowWith<TestPageToHost>({ openTag: narrowOpenTag, reload: exactlyType('reload') }),
    handlers: {
      openTag: (message) => {
        calls.push(`open ${message.tagKey}`);
      },
      reload: (_message, page) => page.refresh(),
    },
    onDidAttach: () => calls.push('attached'),
    onDidChangeViewState: (page) => calls.push(`view state ${page.surface?.visible}`),
    onDidDetach: () => calls.push('detached'),
    dispose: () => calls.push('disposed'),
  };
  return {
    controller,
    calls,
    setSnapshot: (next: { count: number } | undefined) => {
      snapshot = next;
    },
  };
}

/** An index that can fire updates and say how far its first scan has got. */
function createIndexer(hasIndexed = true) {
  const updates = new vscode.EventEmitter<void>();
  const progress = new vscode.EventEmitter<void>();
  const indexer = {
    ready: Promise.resolve(),
    hasIndexed,
    scanProgress: { completed: 3, total: 10 } as { completed: number; total: number } | undefined,
    onDidProgress: progress.event,
    onDidUpdate: (listener: () => void) => updates.event(listener),
  };
  return { indexer: indexer as HostIndexer & typeof indexer, updates, progress };
}

suite('WebviewHost', () => {
  test('hands a message its table accepts to its handler, and drops anything else', async () => {
    const { controller, calls } = createController();
    const host = new WebviewHost(controller, { themePreview: new ThemePreview() });
    const surface = new FakeSurface();
    try {
      host.attach(surface);
      for (const value of [undefined, 'openTag', { tagKey: '#a' }, { type: 'openTag', tagKey: '' }, { type: 'constructor' }, { type: 'toString' }, { type: 'reload', extra: 1 }]) {
        await surface.webview.send(value);
      }
      await surface.webview.send({ type: 'openTag', tagKey: '#project/relay', extra: true });
      assert.deepStrictEqual(calls, ['attached', 'open #project/relay']);
    } finally {
      host.dispose();
    }
  });

  test('sends the snapshot while the page is visible, and once when a hidden page is shown again', async () => {
    const { controller } = createController();
    const host = new WebviewHost(controller, { themePreview: new ThemePreview() });
    const surface = new FakeSurface();
    try {
      host.refresh();
      assert.deepStrictEqual(surface.webview.posted, [], 'nothing before a page is attached');
      host.attach(surface);
      host.refresh();
      await surface.webview.send({ type: 'reload' });
      assert.deepStrictEqual(surface.webview.postedOf('state'), [
        { type: 'state', data: { count: 0 } },
        { type: 'state', data: { count: 1 } },
      ]);

      surface.setVisible(false);
      host.refresh();
      host.refresh();
      assert.strictEqual(surface.webview.posted.length, 2, 'nothing is sent while hidden');
      surface.setVisible(true);
      assert.deepStrictEqual(surface.webview.posted.slice(2), [{ type: 'state', data: { count: 2 } }], 'one snapshot on showing');
      surface.setVisible(false);
      surface.setVisible(true);
      assert.strictEqual(surface.webview.posted.length, 3, 'a page that missed nothing is not sent one');
    } finally {
      host.dispose();
    }
  });

  test('sends nothing while the controller has no snapshot, and still owes a page that missed one', () => {
    const { controller, setSnapshot } = createController();
    const host = new WebviewHost(controller, { themePreview: new ThemePreview() });
    const surface = new FakeSurface();
    try {
      host.attach(surface);
      setSnapshot(undefined);
      host.refresh();
      assert.deepStrictEqual(surface.webview.posted, []);
      surface.setVisible(false);
      host.refresh();
      surface.setVisible(true);
      setSnapshot({ count: 5 });
      surface.setVisible(false);
      surface.setVisible(true);
      assert.deepStrictEqual(surface.webview.posted, [{ type: 'state', data: { count: 5 } }]);
    } finally {
      host.dispose();
    }
  });

  test('says when it marks a hidden page stale, and when it has sent a snapshot', () => {
    const { controller } = createController();
    const events: string[] = [];
    const host = new WebviewHost(
      { ...controller, onDidMarkStale: () => events.push('stale'), onDidSendSnapshot: () => events.push('sent') },
      { themePreview: new ThemePreview() },
    );
    const surface = new FakeSurface();
    try {
      host.attach(surface);
      host.refresh();
      surface.setVisible(false);
      host.refresh();
      surface.setVisible(true);
      assert.deepStrictEqual(events, ['sent', 'stale', 'sent']);
    } finally {
      host.dispose();
    }
  });

  test('on a theme or zen change: resets the HTML and sends the snapshot, or only resets it, or leaves the page', () => {
    for (const [onChromeChange, renders, states] of [['redraw', 2, 1], ['reload', 2, 0], ['none', 1, 0]] as const) {
      const { controller } = createController({ onChromeChange });
      const themePreview = new ThemePreview();
      const host = new WebviewHost(controller, { themePreview });
      const surface = new FakeSurface();
      try {
        host.attach(surface);
        themePreview.show('cooper');
        assert.strictEqual(surface.renders, renders, `${onChromeChange}: the HTML is set on attaching, and again in the previewed theme`);
        assert.strictEqual(surface.webview.postedOf('state').length, states, onChromeChange);
      } finally {
        host.dispose();
      }
    }
  });

  test('listens to the theme and zen before what the controller subscribes to, so one change resets the HTML first', () => {
    for (const onChromeChange of ['redraw', 'reload'] as const) {
      const { controller } = createController({ onChromeChange });
      const { result: host, fire } = withConfigurationEvents(
        () =>
          new WebviewHost(
            {
              ...controller,
              subscribe: (page) => [
                vscode.workspace.onDidChangeConfiguration((event) => {
                  if (event.affectsConfiguration('deckard.test')) {
                    page.refresh();
                  }
                }),
              ],
            },
            { themePreview: new ThemePreview() },
          ),
      );
      const surface = new FakeSurface();
      try {
        host.attach(surface);
        const events = recordSurface(surface);
        fire('deckard.theme', 'deckard.test.setting');
        assert.deepStrictEqual(
          events,
          onChromeChange === 'redraw' ? ['html', 'post state', 'post state'] : ['html', 'post state'],
          onChromeChange,
        );
      } finally {
        host.dispose();
      }
    }
  });

  test('a page not ready yet is sent nothing and owes nothing, hidden or shown, until it is', () => {
    let ready = false;
    const marked: string[] = [];
    const { controller } = createController();
    const host = new WebviewHost(
      { ...controller, isReady: () => ready, onDidMarkStale: () => void marked.push('stale') },
      { themePreview: new ThemePreview() },
    );
    const surface = new FakeSurface();
    try {
      host.attach(surface);
      host.refresh();
      surface.setVisible(false);
      host.refresh();
      ready = true;
      surface.setVisible(true);
      assert.deepStrictEqual([...surface.webview.posted, ...marked], []);
      host.refresh();
      assert.deepStrictEqual(surface.webview.postedOf('state'), [{ type: 'state', data: { count: 0 } }]);
    } finally {
      host.dispose();
    }
  });

  test('says it is disposed of once it has let go of the page, before its listeners go', () => {
    const calls: string[] = [];
    const { controller } = createController();
    const host = new WebviewHost(
      {
        ...controller,
        subscribe: () => [{ dispose: () => void calls.push('listener gone') }],
        dispose: () => void calls.push('dispose'),
        onDidDispose: (page) => {
          calls.push(`did dispose, ${page.surface === undefined ? 'no page' : 'a page'}`);
          page.refresh();
        },
      },
      { themePreview: new ThemePreview() },
    );
    const surface = new FakeSurface();
    host.attach(surface);
    host.dispose();
    assert.deepStrictEqual(calls, ['dispose', 'did dispose, no page', 'listener gone']);
    assert.strictEqual(surface.closed, true);
    assert.deepStrictEqual(surface.webview.posted, [], 'a refresh asked for then sends nothing');
  });

  test('sets the HTML again when a controller asks, while the page is open', () => {
    const { controller } = createController();
    const host = new WebviewHost(controller, { themePreview: new ThemePreview() });
    const surface = new FakeSurface();
    const page: PageContext = host;
    page.renderHtml();
    host.attach(surface);
    page.renderHtml();
    assert.strictEqual(surface.renders, 2, 'once on attaching, and once when asked');
    host.dispose();
  });

  test('on showing, sends a snapshot the controller says is out of date, and none when the page refreshes itself', () => {
    let outOfDate = false;
    const { controller } = createController();
    const host = new WebviewHost({ ...controller, isOutOfDate: () => outOfDate }, { themePreview: new ThemePreview() });
    const surface = new FakeSurface();
    try {
      host.attach(surface);
      surface.setVisible(false);
      surface.setVisible(true);
      assert.strictEqual(surface.webview.posted.length, 0);
      outOfDate = true;
      surface.setVisible(false);
      surface.setVisible(true);
      assert.strictEqual(surface.webview.posted.length, 1, 'a day that turned while hidden');
    } finally {
      host.dispose();
    }

    const own = createController({ refreshWhenShown: 'never' });
    const quiet = new WebviewHost(own.controller, { themePreview: new ThemePreview() });
    const second = new FakeSurface();
    try {
      quiet.attach(second);
      second.setVisible(false);
      quiet.refresh();
      second.setVisible(true);
      assert.deepStrictEqual(second.webview.posted, []);
    } finally {
      quiet.dispose();
    }
  });

  test('redraws after each index update, in the page\'s turn, or as the page says', () => {
    const { controller } = createController();
    const { indexer, updates } = createIndexer();
    const host = new WebviewHost(controller, { indexer, themePreview: new ThemePreview() });
    const surface = new FakeSurface();
    try {
      host.attach(surface);
      updates.fire();
      assert.strictEqual(surface.webview.postedOf('state').length, 1);
    } finally {
      host.dispose();
    }

    const own = createController();
    const indexUpdates: string[] = [];
    const custom = new WebviewHost(
      { ...own.controller, onIndexUpdate: () => indexUpdates.push('own') },
      { indexer, themePreview: new ThemePreview() },
    );
    const second = new FakeSurface();
    try {
      custom.attach(second);
      updates.fire();
      assert.deepStrictEqual(indexUpdates, ['own']);
      assert.deepStrictEqual(second.webview.posted, []);
    } finally {
      custom.dispose();
    }
  });

  test('names its turn by the page, and times each snapshot under its name, another, with the post, or not at all', () => {
    const turns: string[] = [];
    const indexer: HostIndexer = {
      ready: Promise.resolve(),
      onDidUpdate: () => ({ dispose: () => undefined }),
      onDidUpdateView: (_listener, options) => {
        turns.push(options.name);
        return { dispose: () => undefined };
      },
    };
    const lines = (measure?: PageOptions['measure']) => {
      const { controller } = createController(measure === undefined ? {} : { measure });
      const host = new WebviewHost(controller, { indexer, themePreview: new ThemePreview() });
      const surface = new FakeSurface();
      const post = surface.webview.postMessage.bind(surface.webview);
      const order: string[] = [];
      surface.webview.postMessage = (message: unknown) => {
        order.push('post');
        return post(message);
      };
      try {
        host.attach(surface);
        // A line is written when its time ends, so the post comes before a
        // line that times it, and after one that does not.
        return captureTimingLog(() => host.refresh(), order);
      } finally {
        host.dispose();
      }
    };
    assert.deepStrictEqual(lines(), ['Test page: N ms', 'post']);
    assert.deepStrictEqual(lines({ name: 'Tested' }), ['Tested: N ms', 'post']);
    assert.deepStrictEqual(lines({ name: 'Tested', includesPost: true }), ['post', 'Tested: N ms']);
    assert.deepStrictEqual(lines(false), ['post']);
    assert.deepStrictEqual(turns, ['Test page', 'Test page', 'Test page', 'Test page']);
  });

  test('leaves a page that is never sent a snapshot alone: nothing built, timed, or owed', () => {
    const { controller } = createController({ hasSnapshot: false });
    const built: string[] = [];
    const host = new WebviewHost(
      {
        ...controller,
        buildSnapshot: () => void built.push('built'),
        onDidMarkStale: () => void built.push('stale'),
      },
      { themePreview: new ThemePreview() },
    );
    const surface = new FakeSurface();
    try {
      host.attach(surface);
      const lines = captureTimingLog(() => {
        host.refresh();
        surface.setVisible(false);
        host.refresh();
        surface.setVisible(true);
      });
      assert.deepStrictEqual([...lines, ...built], []);
      assert.deepStrictEqual(surface.webview.posted, []);
    } finally {
      host.dispose();
    }
  });

  test('tells the page how far the first scan has got, unless the page says not to', () => {
    for (const followIndexing of [undefined, false]) {
      const { controller } = createController({ followIndexing });
      const { indexer, progress } = createIndexer(false);
      const host = new WebviewHost(controller, { indexer, themePreview: new ThemePreview() });
      const surface = new FakeSurface();
      try {
        host.attach(surface);
        indexer.scanProgress = { completed: 7, total: 10 };
        progress.fire();
        assert.deepStrictEqual(
          surface.webview.postedOf('indexing'),
          followIndexing === false
            ? []
            : [
                { type: 'indexing', progress: { completed: 3, total: 10 } },
                { type: 'indexing', progress: { completed: 7, total: 10 } },
              ],
        );
      } finally {
        host.dispose();
      }
    }
  });

  test('lets go of a page the reader closed, and closes its page when disposed of', async () => {
    const { controller, calls } = createController();
    const host = new WebviewHost(controller, { themePreview: new ThemePreview() });
    const surface = new FakeSurface();
    host.attach(surface);
    surface.dispose();
    assert.strictEqual(host.surface, undefined);
    await surface.webview.send({ type: 'openTag', tagKey: '#a' });
    host.refresh();
    assert.deepStrictEqual(surface.webview.posted, []);

    const next = new FakeSurface();
    host.attach(next);
    host.dispose();
    assert.strictEqual(next.closed, true);
    assert.strictEqual(host.surface, undefined);
    assert.deepStrictEqual(calls, ['attached', 'detached', 'attached', 'disposed']);
  });

  test('says when the page is shown, hidden, or brought forward', () => {
    const { controller, calls } = createController();
    const host = new WebviewHost(controller, { themePreview: new ThemePreview() });
    const surface = new FakeSurface();
    try {
      host.attach(surface);
      surface.setVisible(false);
      surface.setVisible(true);
      assert.deepStrictEqual(calls, ['attached', 'view state false', 'view state true']);
    } finally {
      host.dispose();
    }
  });
});

suite('ViewAdapter', () => {
  test('shows the page in each view VS Code resolves, and only in the newest', async () => {
    const { controller, calls } = createController();
    const host = new WebviewHost(controller, { themePreview: new ThemePreview() });
    const adapter = new ViewAdapter(host);
    const first = createView();
    const second = createView();
    try {
      adapter.resolveWebviewView(first.view);
      await host.whenPublished();
      await Promise.resolve();
      assert.deepStrictEqual(first.view.webview.options, { enableScripts: true });
      assert.match(first.view.webview.html, /^<p>[a-z]+<\/p>$/, 'its HTML, in the configured theme');
      assert.deepStrictEqual(first.webview.postedOf('state'), [{ type: 'state', data: { count: 0 } }]);

      adapter.resolveWebviewView(second.view);
      await first.webview.send({ type: 'openTag', tagKey: '#old' });
      await second.webview.send({ type: 'openTag', tagKey: '#new' });
      assert.strictEqual(adapter.view, second.view);
      assert.deepStrictEqual(calls.filter((call) => call.startsWith('open')), ['open #new']);
    } finally {
      adapter.dispose();
    }
  });
});

suite('PanelAdapter', () => {
  test('takes back a kept panel once the page has read what it saved, and closes a second', async () => {
    const steps: string[] = [];
    const { controller } = createController({
      restore: async (state: unknown) => {
        await Promise.resolve();
        steps.push(`restored ${JSON.stringify(state)}`);
      },
    });
    const host = new WebviewHost({ ...controller, onDidAttach: () => steps.push('attached') }, { themePreview: new ThemePreview() });
    const adapter = new PanelAdapter(host, { viewType: 'deckard.test', title: 'Test', extensionUri: vscode.Uri.file('/ext'), icon: ['resources', 'deckard.svg'] });
    const kept = createPanel();
    const second = createPanel();
    try {
      await adapter.restore(kept.panel, { query: 'is:open' });
      assert.deepStrictEqual(steps, ['restored {"query":"is:open"}', 'attached']);
      assert.strictEqual(adapter.panel, kept.panel);
      assert.deepStrictEqual(kept.panel.webview.options, { enableScripts: true });
      assert.strictEqual((kept.panel.iconPath as vscode.Uri).path, '/ext/resources/deckard.svg');
      assert.deepStrictEqual(kept.webview.postedOf('state'), [{ type: 'state', data: { count: 0 } }]);
      assert.strictEqual(adapter.open(), kept.panel, 'an open page is not opened again');

      await adapter.restore(second.panel);
      assert.strictEqual(second.disposed(), true);
      assert.strictEqual(adapter.panel, kept.panel);
    } finally {
      adapter.dispose();
    }
    assert.strictEqual(kept.disposed(), true);
  });

  test('ranks a panel for a redraw as a panel, or as its page says', () => {
    const { panel } = createPanel();
    Object.assign(panel, { active: false, visible: true });
    assert.strictEqual(new PanelSurface(panel).priority(), VIEW_PRIORITY.visible);
    Object.assign(panel, { active: true });
    assert.strictEqual(new PanelSurface(panel).priority(), VIEW_PRIORITY.active);
    assert.strictEqual(new PanelSurface(panel, () => VIEW_PRIORITY.housekeeping).priority(), VIEW_PRIORITY.housekeeping);
  });

  test('sets scripts on, keeps the options a panel was made with, or leaves a page with no script alone', () => {
    const kept = { enableScripts: false, enableCommandUris: true };
    assert.deepStrictEqual(scriptOptions(undefined, kept), { enableScripts: true });
    assert.deepStrictEqual(scriptOptions('on', kept), { enableScripts: true });
    assert.deepStrictEqual(scriptOptions('merge', kept), { enableScripts: true, enableCommandUris: true });
    assert.strictEqual(scriptOptions('off', kept), undefined);
  });
});

/** A webview panel around a fake webview, as VS Code makes or keeps one. */
function createPanel() {
  const webview = new FakeWebview();
  const viewState = new vscode.EventEmitter<void>();
  const disposal = new vscode.EventEmitter<void>();
  let disposed = false;
  const panel = {
    active: true,
    visible: true,
    iconPath: undefined as unknown,
    webview: Object.assign(webview, { options: {}, html: '' }),
    onDidChangeViewState: viewState.event,
    onDidDispose: disposal.event,
    reveal: () => undefined,
    dispose: () => {
      disposed = true;
      disposal.fire();
    },
  };
  return { panel: panel as unknown as vscode.WebviewPanel, webview, disposed: () => disposed };
}

/** A webview view around a fake webview, as VS Code resolves one. */
function createView() {
  const webview = new FakeWebview();
  const visibility = new vscode.EventEmitter<void>();
  const disposal = new vscode.EventEmitter<void>();
  const view = {
    visible: true,
    webview: Object.assign(webview, { options: {}, html: '' }),
    onDidChangeVisibility: visibility.event,
    onDidDispose: disposal.event,
  };
  return { view: view as unknown as vscode.WebviewView & { webview: FakeWebview & { html: string } }, webview };
}
