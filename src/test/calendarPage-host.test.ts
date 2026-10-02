import * as assert from 'assert';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { CalendarMessage, CalendarPagePageToHost, CalendarSnapshot } from '../ui/protocol/calendar';
import { formatLocalDate } from '../ui/commands/dailyNote';
import { ActiveCalendar, CalendarDaySource } from '../ui/webview/activeCalendar';
import { WebviewHost } from '../ui/webview/host/webviewHost';
import { CalendarPageController } from '../ui/webview/pages/calendarPage/calendarPageController';
import { ThemePreview } from '../ui/webview/themePreview';
import { withConfigurationEvents } from './configurationEvents';
import { FakeSurface, recordSurface } from './fakeWebview';
import { captureTimingLog } from './timingLog';
import { createTaskWrites } from './taskWrites';
import { pageExtensionUri, pageWebview } from './pageWebview';
import { openWebviewPage } from './webviewPage';

const today = formatLocalDate(new Date());

/**
 * The calendar page over today's daily note, attached to a fake panel in
 * front, with the active calendar Related Notes reads: what the page is
 * sent, what it says about being in front, and what its messages do.
 */
function openPage() {
  const files = [parseMarkdown(`/notes/${today}.md`, `# ${today}\n- [ ] Call Ren 📅 ${today}\n`)];
  const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
  const indexer = {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    onDidUpdate: new vscode.EventEmitter<void>().event,
  };
  const activeCalendar = new ActiveCalendar();
  const themePreview = new ThemePreview();
  let host: WebviewHost<CalendarSnapshot, CalendarPagePageToHost> | undefined;
  const source: CalendarDaySource = {
    getDay: () => controller.getDay(),
    handleDayMessage: (message: CalendarMessage) => controller.calendar.handle(message),
  };
  const controller: CalendarPageController = new CalendarPageController({
    indexer,
    writes: createTaskWrites(),
    activeCalendar,
    source,
    refresh: () => host?.refresh(),
    post: (message) => host?.post(message),
    extensionUri: pageExtensionUri(),
  });
  host = new WebviewHost(controller, { indexer, themePreview });
  const surface = new FakeSurface();
  host.attach(surface);
  return {
    host,
    controller,
    surface,
    source,
    activeCalendar,
    themePreview,
    types: () => surface.webview.posted.map((message) => (message as { type: string }).type),
    states: () => surface.webview.postedOf<{ type: 'state'; data: CalendarSnapshot }>('state'),
    send: (message: unknown) => surface.webview.send(message),
    dispose: () => {
      host?.dispose();
      activeCalendar.dispose();
    },
  };
}

/** Runs `run` with commands recorded rather than run, and returns them in order. */
async function recordCommands(run: () => Promise<void>): Promise<unknown[][]> {
  const commands = vscode.commands as unknown as Record<string, unknown>;
  const original = commands.executeCommand;
  const calls: unknown[][] = [];
  commands.executeCommand = async (...call: unknown[]) => void calls.push(call);
  try {
    await run();
  } finally {
    commands.executeCommand = original;
  }
  return calls;
}

suite('Calendar page host', () => {
  test('an edit to the theme and a calendar setting at once reloads the page before the month is sent', () => {
    const { result: page, fire } = withConfigurationEvents(() => openPage());
    try {
      const events = recordSurface(page.surface);
      fire('deckard.zenMode', 'deckard.calendar.showRepeats');
      assert.deepStrictEqual(events, ['html', 'post state']);
    } finally {
      page.dispose();
    }
  });

  test('takes its turn as Calendar page, and times the calendar as Calendar, as it always has', () => {
    const page = openPage();
    try {
      assert.strictEqual(page.controller.name, 'Calendar page');
      assert.deepStrictEqual(captureTimingLog(() => page.host.refresh()), ['Calendar: N ms']);
    } finally {
      page.dispose();
    }
  });

  test('is the active calendar while in front, and lets go when it leaves or closes', () => {
    const page = openPage();
    try {
      assert.strictEqual(page.activeCalendar.active, page.source, 'a panel attached in front says so');
      page.surface.setVisible(false);
      assert.strictEqual(page.activeCalendar.active, undefined);
      page.surface.setVisible(true);
      assert.strictEqual(page.activeCalendar.active, page.source);
      page.host.refresh();
      assert.ok(page.controller.getDay(), 'the chosen day is kept as it is drawn');
      page.surface.dispose();
      assert.strictEqual(page.activeCalendar.active, undefined);
      assert.strictEqual(page.controller.getDay(), undefined, 'a closed page has no day');
    } finally {
      page.dispose();
    }
  });

  test('draws the day beside the month, or leaves it to Related Notes while that is open', () => {
    const page = openPage();
    try {
      let changes = 0;
      page.activeCalendar.onDidChange(() => (changes += 1));
      page.host.refresh();
      assert.strictEqual(page.states()[0].data.dayInSidebar, undefined);
      assert.strictEqual(page.states()[0].data.selected?.date, today);
      assert.strictEqual(changes, 1, 'Related Notes is told the day was drawn');

      page.activeCalendar.setSidebarVisible(true);
      assert.strictEqual(page.states().length, 2, 'the day moving to the sidebar redraws the page');
      assert.strictEqual(page.states()[1].data.dayInSidebar, true);
    } finally {
      page.dispose();
    }
  });

  test('a move it could not make is said, and the page drawn again', async () => {
    const page = openPage();
    try {
      await page.send({ type: 'moveTask', taskId: 'gone', field: 'due', date: today });
      assert.deepStrictEqual(page.types(), ['moveRefused', 'state']);
      assert.deepStrictEqual(page.surface.webview.posted[0], { type: 'moveRefused', taskId: 'gone' });
    } finally {
      page.dispose();
    }
  });

  test("runs the gear's theme and help, at the periodic notes, and writes no setting already so", async () => {
    const page = openPage();
    try {
      const shown = vscode.workspace.getConfiguration('deckard').get<boolean>('calendar.showRepeats', true) !== false;
      const calls = await recordCommands(async () => {
        await page.send({ type: 'chooseTheme' });
        await page.send({ type: 'openHelp' });
        await page.send({ type: 'setShowRepeats', show: shown });
      });
      assert.deepStrictEqual(calls, [['deckard.chooseTheme'], ['deckard.showHelp', 'periodic']]);
    } finally {
      page.dispose();
    }
  });

  test('a theme change only resets the HTML, and the page asks for its state again', async () => {
    const page = openPage();
    try {
      const renders = page.surface.renders;
      page.themePreview.show('corpo');
      assert.strictEqual(page.surface.renders, renders + 1);
      assert.deepStrictEqual(page.types(), []);
      await page.send({ type: 'ready' });
      assert.deepStrictEqual(page.types(), ['state']);
    } finally {
      page.dispose();
    }
  });

  test('is named Calendar page, is not kept running while hidden, and has no find widget', () => {
    const page = openPage();
    try {
      assert.strictEqual(page.controller.name, 'Calendar page');
      assert.deepStrictEqual(page.controller.options, {
        retainContextWhenHidden: false,
        enableFindWidget: false,
        followIndexing: false,
        onChromeChange: 'reload',
        measure: false,
        readsInertState: true,
        embedsSnapshot: true,
      });
    } finally {
      page.dispose();
    }
  });

  test('is not kept running while hidden: hidden, its HTML carries the month it was sent, which loaded draws as the posted month did', () => {
    const page = openPage();
    const pages: ReturnType<typeof openWebviewPage>[] = [];
    try {
      page.surface.htmlWebview = pageWebview as vscode.Webview;
      let builds = 0;
      const build = page.controller.buildSnapshot.bind(page.controller);
      page.controller.buildSnapshot = () => {
        builds += 1;
        return build();
      };
      page.host.refresh();
      const [sent] = page.states();
      page.surface.setVisible(false);
      assert.strictEqual(builds, 1, 'the month it carries is the one sent, not built again');
      const carried = /<script type="application\/json" id="state">([^<]*)<\/script>/.exec(String(page.surface.html));
      assert.ok(carried, 'the hidden page\'s HTML carries the month');
      assert.deepStrictEqual(JSON.parse(carried[1]), sent.data);
      const reloaded = openWebviewPage(String(page.surface.html));
      const drawn = openWebviewPage(String(page.surface.html).replace(carried[0], ''), sent.data);
      pages.push(reloaded, drawn);
      assert.strictEqual(reloaded.findAll('#app .loading').length, 0);
      assert.deepStrictEqual(reloaded.posted, [{ type: 'ready' }], 'it asks for a newer month, as it always has');
      assert.strictEqual(reloaded.find('#app').innerHTML, drawn.find('#app').innerHTML);
    } finally {
      pages.forEach((opened) => opened.dispose());
      page.dispose();
    }
  });

  test('lets go of being in front before it closes', () => {
    const page = openPage();
    assert.strictEqual(page.activeCalendar.active, page.source);
    page.host.dispose();
    assert.strictEqual(page.activeCalendar.active, undefined);
    assert.strictEqual(page.surface.closed, true);
    page.activeCalendar.dispose();
  });
});
