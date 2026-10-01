import * as assert from 'assert';

import * as vscode from 'vscode';

import { RelatedNotesDebugPanel } from '../ui/webview/relatedNotesDebug';
import type { EntryRelatedNotesDiagnostic, SidebarNotesView } from '../ui/webview/sidebarNotes';
import { ThemePreview } from '../ui/webview/themePreview';

/** An entry's evidence, with nothing ranked, under a title the tab names. */
function diagnosticFor(title: string): EntryRelatedNotesDiagnostic {
  return {
    filePath: 'notes/a.md',
    sourceLine: 1,
    title,
    tags: [],
    snapshot: { activeTags: [], notes: [], tagTitleDisplayMode: 'inline', state: 'ready' },
  } as unknown as EntryRelatedNotesDiagnostic;
}

/** A webview panel as VS Code makes one, recording each HTML set, title, and reveal. */
function fakePanel(options: unknown) {
  const disposed = new vscode.EventEmitter<void>();
  const received: Array<(message: unknown) => unknown> = [];
  const panel = {
    options,
    title: '',
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
      get html(): string {
        return panel.htmls[panel.htmls.length - 1] ?? '';
      },
      set html(value: string) {
        panel.htmls.push(value);
      },
      onDidReceiveMessage: (listener: (message: unknown) => unknown) => {
        received.push(listener);
        return { dispose: () => void received.splice(received.indexOf(listener), 1) };
      },
      postMessage: async (message: unknown) => void panel.posted.push(message),
    },
    onDidDispose: disposed.event,
    onDidChangeViewState: new vscode.EventEmitter<void>().event,
    reveal: () => void (panel.reveals += 1),
    dispose: () => {
      panel.disposed = true;
      disposed.fire();
    },
    /** Delivers a message as a page would post one, and resolves once it is handled. */
    send: async (message: unknown) => {
      await Promise.all([...received].map((listener) => listener(message)));
    },
  };
  return panel;
}

type FakePanel = ReturnType<typeof fakePanel>;

/**
 * Runs `run` with the debug page over an index whose entries have the
 * evidence `diagnostics` lists by line, recording each panel it makes and
 * each failure it reports.
 */
async function withDebugPage(
  diagnostics: Map<number, EntryRelatedNotesDiagnostic>,
  run: (debug: RelatedNotesDebugPanel, made: FakePanel[], failures: string[], themePreview: ThemePreview) => Promise<void>,
): Promise<void> {
  const window = vscode.window as unknown as Record<string, unknown>;
  const originals = [window.createWebviewPanel, window.showErrorMessage];
  const made: FakePanel[] = [];
  const failures: string[] = [];
  window.createWebviewPanel = (viewType: string, title: string, _column: unknown, options: unknown) => {
    const panel = fakePanel({ viewType, title, options });
    made.push(panel);
    return panel;
  };
  window.showErrorMessage = async (text: string) => void failures.push(text);
  const sidebarNotes = {
    getEntryDiagnostic: async (_uri: vscode.Uri, line: number) => diagnostics.get(line),
  } as unknown as SidebarNotesView;
  const themePreview = new ThemePreview();
  const debug = new RelatedNotesDebugPanel({ sidebarNotes, extensionUri: vscode.Uri.file('/tmp/deckard-extension'), themePreview });
  try {
    await run(debug, made, failures, themePreview);
  } finally {
    [window.createWebviewPanel, window.showErrorMessage] = originals;
    debug.dispose();
  }
}

suite('Related Notes debug host', () => {
  const note = vscode.Uri.file('/notes/a.md');

  test('draws an entry in a new panel with no scripts, titled for the entry, and brings it forward', async () => {
    await withDebugPage(new Map([[1, diagnosticFor('Kickoff')]]), async (debug, made) => {
      await debug.show(note, 1);
      assert.strictEqual(made.length, 1);
      const [panel] = made;
      assert.deepStrictEqual(panel.options, {
        viewType: 'deckard.relatedNotesDebug',
        title: 'Deckard: Related Notes Debug',
        options: { retainContextWhenHidden: true, enableFindWidget: true },
      });
      assert.deepStrictEqual(panel.webview.options, {}, 'the page runs no script');
      assert.ok(String((panel.iconPath as vscode.Uri).fsPath).endsWith('resources/deckard.svg'));
      assert.strictEqual(panel.title, 'Deckard: Related Notes Debug — Kickoff');
      assert.strictEqual(panel.htmls.length, 1);
      assert.match(panel.htmls[0], /Kickoff/);
      assert.strictEqual(panel.reveals, 1);
    });
  });

  test('draws the next entry in place in the open panel', async () => {
    const diagnostics = new Map([[1, diagnosticFor('Kickoff')], [5, diagnosticFor('Retro')]]);
    await withDebugPage(diagnostics, async (debug, made) => {
      await debug.show(note, 1);
      await debug.show(note, 5);
      assert.strictEqual(made.length, 1);
      assert.strictEqual(made[0].htmls.length, 2);
      assert.match(made[0].htmls[1], /Retro/);
      assert.strictEqual(made[0].title, 'Deckard: Related Notes Debug — Retro');
      assert.strictEqual(made[0].reveals, 2);
    });
  });

  test('says when the entry is not there, and opens nothing', async () => {
    await withDebugPage(new Map(), async (debug, made, failures) => {
      await debug.show(note, 3);
      assert.deepStrictEqual(made, []);
      assert.strictEqual(failures.length, 1);
      assert.match(failures[0], /could not find that entry/);
    });
  });

  test('a theme change leaves the page as drawn, and nothing it is sent is acted on or answered', async () => {
    await withDebugPage(new Map([[1, diagnosticFor('Kickoff')]]), async (debug, made, _failures, themePreview) => {
      await debug.show(note, 1);
      themePreview.show('cooper');
      await made[0].send({ type: 'openSource', filePath: '/notes/a.md', line: 1 });
      assert.strictEqual(made[0].htmls.length, 1);
      assert.deepStrictEqual(made[0].posted, []);
    });
  });

  test('a closed page opens anew, and disposing closes an open one', async () => {
    await withDebugPage(new Map([[1, diagnosticFor('Kickoff')]]), async (debug, made) => {
      await debug.show(note, 1);
      made[0].dispose();
      await debug.show(note, 1);
      assert.strictEqual(made.length, 2);
      debug.dispose();
      assert.strictEqual(made[1].disposed, true);
    });
  });
});
