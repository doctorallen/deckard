import * as assert from 'assert';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { WorkspaceIndex } from '../domain/model';
import type { CalendarPageToHost, CalendarSnapshot } from '../ui/protocol/calendar';
import { formatLocalDate } from '../ui/commands/dailyNote';
import { WebviewHost } from '../ui/webview/host/webviewHost';
import { CalendarViewController } from '../ui/webview/pages/calendar/calendarController';
import { ThemePreview } from '../ui/webview/themePreview';
import { FakeSurface } from './fakeWebview';
import { createTaskWrites } from './taskWrites';

/** Today, and the month it is in, as the calendar starts on. */
const today = formatLocalDate(new Date());
const thisMonth = today.slice(0, 7);

/**
 * The sidebar Calendar over today's daily note, attached to a fake view:
 * what it is sent, and what its messages do.
 */
function openCalendar(options: { scanning?: boolean } = {}) {
  const files = [parseMarkdown(`/notes/${today}.md`, `# ${today}\n- [ ] Call Ren 📅 ${today}\n`)];
  let index: WorkspaceIndex = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
  const updates = new vscode.EventEmitter<void>();
  const progress = new vscode.EventEmitter<void>();
  const indexer = {
    ready: new Promise<void>(() => undefined),
    published: Promise.resolve(),
    getSnapshot: () => index,
    onDidUpdate: (listener: () => void) => updates.event(listener),
    ...(options.scanning ? { hasIndexed: false, scanProgress: { completed: 1, total: 4 }, onDidProgress: progress.event } : {}),
  };
  const themePreview = new ThemePreview();
  let host: WebviewHost<CalendarSnapshot, CalendarPageToHost> | undefined;
  const controller = new CalendarViewController({
    indexer,
    writes: createTaskWrites(),
    themePreview,
    refresh: () => host?.refresh(),
  });
  host = new WebviewHost(controller, { indexer, themePreview });
  const surface = new FakeSurface();
  surface.active = false;
  host.attach(surface);
  const states = () => surface.webview.postedOf<{ type: 'state'; data: CalendarSnapshot }>('state');
  return {
    host,
    controller,
    surface,
    themePreview,
    states,
    send: (message: unknown) => surface.webview.send(message),
    updateIndex: (next: WorkspaceIndex) => {
      index = next;
      updates.fire();
    },
  };
}

/**
 * Runs `run` with commands, shown documents, and offers recorded rather
 * than done, and returns what was recorded, in order.
 */
async function record(run: () => Promise<void>): Promise<unknown[][]> {
  const commands = vscode.commands as unknown as Record<string, unknown>;
  const window = vscode.window as unknown as Record<string, unknown>;
  const workspace = vscode.workspace as unknown as Record<string, unknown>;
  const originals = [commands.executeCommand, window.showInformationMessage, window.showTextDocument, workspace.openTextDocument];
  const calls: unknown[][] = [];
  commands.executeCommand = async (...call: unknown[]) => void calls.push(call);
  window.showInformationMessage = async (message: string) => void calls.push(['offer', message]);
  workspace.openTextDocument = async (uri: vscode.Uri) => ({ uri, lineCount: 40 });
  // Recorded as it is shown, so a stand-in for VS Code without selections
  // records it too.
  window.showTextDocument = async (document: { uri: vscode.Uri }, options: { preview: boolean }) => {
    calls.push(['open', document.uri.fsPath, options.preview]);
    return { document, revealRange: () => undefined };
  };
  try {
    await run();
  } finally {
    [commands.executeCommand, window.showInformationMessage, window.showTextDocument, workspace.openTextDocument] = originals;
  }
  return calls;
}

suite('Calendar host', () => {
  test('sends the month when asked, and once on showing after a hidden update', async () => {
    const { host, surface, states, send, updateIndex } = openCalendar();
    try {
      assert.strictEqual(states().length, 0, 'attaching sends nothing by itself');
      await send({ type: 'ready' });
      assert.strictEqual(states().length, 1);
      assert.strictEqual(states()[0].data.month, thisMonth);

      surface.setVisible(false);
      updateIndex(buildWorkspaceIndex(new Map()));
      updateIndex(buildWorkspaceIndex(new Map()));
      assert.strictEqual(states().length, 1, 'nothing is sent while hidden');
      surface.setVisible(true);
      assert.strictEqual(states().length, 2, 'showing it sends one');
      surface.setVisible(true);
      assert.strictEqual(states().length, 2, 'and only while it missed one');
    } finally {
      host.dispose();
    }
  });

  test('steps months and chooses days through the host, which draws each', async () => {
    const { host, controller, states, send } = openCalendar();
    try {
      await send({ type: 'showMonth', month: '2031-02' });
      assert.strictEqual(states().pop()?.data.month, '2031-02');
      await send({ type: 'selectDay', date: '2031-03-14' });
      assert.strictEqual(controller.calendar.month, '2031-03', 'a day in another month moves to it');
      assert.strictEqual(controller.calendar.selectedDate, '2031-03-14');
      assert.strictEqual(states().pop()?.data.month, '2031-03');
      await send({ type: 'selectDay', date: today });
      assert.strictEqual(controller.calendar.selectedDate, undefined, 'today is held as no choice');
    } finally {
      host.dispose();
    }
  });

  test('a theme change only resets the HTML, and the page asks for its state again', async () => {
    const { host, surface, states, themePreview } = openCalendar();
    try {
      const renders = surface.renders;
      themePreview.show('corpo');
      assert.strictEqual(surface.renders, renders + 1);
      assert.strictEqual(states().length, 0, 'no snapshot is sent with it');
    } finally {
      host.dispose();
    }
  });

  test('opens an indexed note and searches a day, and offers a missing day rather than making it', async () => {
    const { host, send } = openCalendar();
    try {
      const calls = await record(async () => {
        await send({ type: 'openNote', filePath: `/notes/${today}.md` });
        await send({ type: 'openNote', filePath: '/notes/missing.md' });
        await send({ type: 'openDay', date: today });
        await send({ type: 'searchCreated', date: '2026-09-25' });
        await send({ type: 'openDay', date: '2031-03-14' });
      });
      assert.deepStrictEqual(calls, [
        ['open', `/notes/${today}.md`, false],
        ['open', `/notes/${today}.md`, false],
        ['deckard.search', 'created = 2026-09-25'],
        ['offer', 'There is no note for 2031-03-14 yet.'],
      ]);
    } finally {
      host.dispose();
    }
  });

  test('acts on nothing it does not accept, and never says how indexing is going', async () => {
    const { host, surface, send } = openCalendar({ scanning: true });
    try {
      const calls = await record(async () => {
        await send({ type: 'openNote', filePath: `/notes/${today}.md`, line: 3 });
        await send({ type: 'selectDay', date: today, extra: 1 });
        await send({ type: 'chooseTheme' });
        await send({ type: 'setShowRepeats', show: false });
        await send({ type: 'moveTask', taskId: 'gone', field: 'due', date: today });
      });
      assert.deepStrictEqual(calls, []);
      assert.deepStrictEqual(surface.webview.posted, [], 'and a refused move is not answered in the sidebar');
    } finally {
      host.dispose();
    }
  });

  test('is named Calendar, and keeps its context while hidden', () => {
    const { host, controller } = openCalendar();
    try {
      assert.strictEqual(controller.name, 'Calendar');
      assert.deepStrictEqual(controller.options, {
        retainContextWhenHidden: true,
        enableFindWidget: false,
        followIndexing: false,
        onChromeChange: 'none',
      });
    } finally {
      host.dispose();
    }
  });
});
