import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const requestedPort = process.env.DECKARD_CDP_PORT;
let port;
const theme = process.env.DECKARD_SCREENSHOT_THEME ?? 'replicant';
// A VS Code color theme, such as "Default Light Modern", for themes that follow it.
const colorTheme = process.env.DECKARD_SCREENSHOT_COLOR_THEME;
const view = process.env.DECKARD_SCREENSHOT_VIEW ?? 'dashboard';

// A side bar pane, such as a tree view, that is expanded and lists rows.
function expandedPaneWithRows(title) {
  return `[...document.querySelectorAll('.pane')].some((pane) => { const header = pane.querySelector('.pane-header'); return header?.getAttribute('aria-expanded') === 'true' && header.querySelector('.title')?.textContent?.trim() === ${JSON.stringify(title)} && pane.querySelectorAll('.pane-body .monaco-list-row').length > 2; })`;
}

/**
 * What each screenshot shows and how to tell it has rendered.
 *
 * The companion runs `command`, or `scene` when a view needs more than one
 * step, then closes the side bars and other editors unless `keepLayout` is
 * set. A scene runs in the capture host with `run`, `openNote`, and `delay`
 * in scope. `renderedAssertion` is checked inside the view's webview, from
 * `webviewExtension` when that is not Deckard, or in the workbench itself for
 * `target: 'workbench'` views that are not webviews. `collapsePanes` closes
 * side bar panes by title before the capture, so one view has the room.
 */
const viewConfiguration = {
  dashboard: {
    command: 'deckard.showDashboard',
    output: 'docs/images/dashboard.png',
    title: 'Dashboard',
    renderedAssertion:
      "document.querySelector('iframe')?.contentDocument?.title === 'Deckard Dashboard' && Boolean(document.querySelector('iframe')?.contentDocument?.querySelector('#app > header h1'))",
  },
  'notes-graph': {
    command: 'deckard.showNotesGraph',
    output: 'docs/images/notes-graph.png',
    title: 'Notes Graph',
    renderedAssertion:
      "document.querySelector('iframe')?.contentDocument?.title === 'Deckard Notes Graph' && Boolean(document.querySelector('iframe')?.contentDocument?.querySelector('#graph')) && Boolean(document.querySelector('iframe')?.contentDocument?.querySelector('.overlay'))",
  },
  'related-notes': {
    scene: `await openNote('2026-08-28.md', 'Sable will retain');
    await run('workbench.view.extension.deckard');
    await run('deckard.relatedNotes.focus');`,
    keepLayout: true,
    output: 'docs/images/related-notes.png',
    title: 'Related Notes',
    renderedAssertion:
      "document.querySelector('iframe')?.contentDocument?.title === 'Deckard Related Notes' && Boolean(document.querySelector('iframe')?.contentDocument?.querySelector('#app .sidebar-header'))",
  },
  find: {
    scene: `await run('deckard.searchWorkspace', 'meridian');`,
    keepLayout: true,
    target: 'workbench',
    output: 'docs/images/find.png',
    title: 'Find',
    renderedAssertion:
      "Boolean(document.querySelector('.quick-input-widget')) && document.querySelector('.quick-input-widget').style.display !== 'none' && document.querySelectorAll('.quick-input-list .monaco-list-row').length > 3",
  },
  'notes-search': {
    scene: `await run('deckard.searchNotes', '#project/meridian-vault is:open');`,
    output: 'docs/images/notes-search.png',
    title: 'Notes search',
    renderedAssertion:
      "document.querySelector('iframe')?.contentDocument?.title === 'Deckard Dashboard' && Boolean(document.querySelector('iframe')?.contentDocument?.querySelector('#notes-panel:not([hidden]) .query-workspace'))",
  },
  'tag-overview': {
    scene: `await run('deckard.showTagOverview', '#project/ghostline-relay');`,
    output: 'docs/images/tag-overview.png',
    title: 'Tag Overview',
    renderedAssertion:
      // The shell exists before the page script fills it, so wait for content
      // it renders, or the capture can catch an unpainted page.
      "document.querySelector('iframe')?.contentDocument?.title === 'Deckard Tag Overview' && Boolean(document.querySelector('iframe')?.contentDocument?.querySelector('#app > header h1')?.textContent?.trim()) && Boolean(document.querySelector('iframe')?.contentDocument?.querySelector('.query-workspace'))",
  },
  help: {
    command: 'deckard.showHelp',
    output: 'docs/images/help.png',
    title: 'Help',
    renderedAssertion:
      "document.querySelector('iframe')?.contentDocument?.title === 'Deckard Help' && document.querySelector('iframe')?.contentDocument?.querySelector('main > article > header h1')?.textContent === 'Help'",
  },
  stats: {
    // A fresh profile has no view history, so open some overviews first.
    scene: `for (const tag of ['#project/meridian-vault', '#project/meridian-vault', '#project/meridian-vault', '#person/sable-ortiz', '#person/sable-ortiz', '#team/harbor', '#risk/ethics', '#planning']) {
      await run('deckard.showTagOverview', tag);
    }
    await run('deckard.showStats');`,
    output: 'docs/images/stats.png',
    title: 'Stats',
    renderedAssertion:
      "document.querySelector('iframe')?.contentDocument?.title === 'Deckard Stats' && Boolean(document.querySelector('iframe')?.contentDocument?.querySelector('#app > header h1'))",
  },
  'task-board': {
    command: 'deckard.showTaskBoard',
    output: 'docs/images/task-board.png',
    title: 'Task Board',
    renderedAssertion:
      "document.querySelector('iframe')?.contentDocument?.title === 'Deckard Task Board' && Boolean(document.querySelector('iframe')?.contentDocument?.querySelector('.board-column'))",
  },
  'query-blocks': {
    scene: `await openNote('2026-09-09.md', '## Task review', 0, 'AtTop');
    await run('markdown.showPreviewToSide');`,
    keepLayout: true,
    webviewExtension: 'vscode.markdown-language-features',
    output: 'docs/images/query-blocks.png',
    title: 'query block preview',
    renderedAssertion:
      "Boolean(document.querySelector('iframe')?.contentDocument?.querySelector('.deckard-query-header'))",
  },
  'editor-assistance': {
    // Hover previews are left out: the editor dismisses its hover while the
    // screenshot is taken, so one never appears in the image even when the
    // page reports it shown.
    scene: `await openNote('2026-08-28.md', '## Meridian entry');`,
    keepLayout: true,
    target: 'workbench',
    output: 'docs/images/editor-assistance.png',
    title: 'editor reference counts',
    // Shared-tag counts resolve after the backlink count.
    renderedAssertion:
      "[...document.querySelectorAll('.codelens-decoration')].some((lens) => lens.textContent.includes('Linked from')) && [...document.querySelectorAll('.codelens-decoration')].some((lens) => lens.textContent.includes('share a tag'))",
  },
  outline: {
    scene: `await openNote('2026-08-26.md', '## Meridian requirements');
    await run('workbench.view.extension.deckard');
    await run('deckard.outline.focus');`,
    keepLayout: true,
    target: 'workbench',
    collapsePanes: ['Related Notes', 'Agenda'],
    output: 'docs/images/outline.png',
    title: 'Outline',
    renderedAssertion: expandedPaneWithRows('Outline'),
  },
  agenda: {
    scene: `await openNote('2026-08-26.md', '## Meridian requirements');
    await run('workbench.view.extension.deckard');
    await run('deckard.agenda.focus');`,
    keepLayout: true,
    target: 'workbench',
    collapsePanes: ['Related Notes', 'Outline'],
    output: 'docs/images/agenda.png',
    title: 'Agenda',
    renderedAssertion: expandedPaneWithRows('Agenda'),
  },
};
const selectedView = viewConfiguration[view];
if (!selectedView) {
  throw new Error(`Unknown screenshot view: ${view}`);
}
const output = resolve(
  repositoryRoot,
  process.env.DECKARD_SCREENSHOT_OUTPUT ?? selectedView.output,
);
const promote = process.env.DECKARD_SCREENSHOT_PROMOTE === '1';
const workspace = mkdtempSync(join(tmpdir(), 'deckard-screenshot-workspace-'));
const profile = mkdtempSync(join(tmpdir(), 'deckard-screenshot-profile-'));
const extensions = mkdtempSync(
  join(tmpdir(), 'deckard-screenshot-extensions-'),
);
const companion = mkdtempSync(join(tmpdir(), 'deckard-screenshot-companion-'));
const candidate = join(tmpdir(), `deckard-${view}-${Date.now()}.png`);
let portOwner;
let succeeded = false;

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options }).trim();
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function choosePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once('error', rejectPort);
    server.listen(
      requestedPort ? Number(requestedPort) : 0,
      '127.0.0.1',
      () => {
        const address = server.address();
        const selectedPort =
          typeof address === 'object' && address ? address.port : undefined;
        server.close((error) =>
          error ? rejectPort(error) : resolvePort(selectedPort),
        );
      },
    );
  });
}

async function requestJson(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function waitForCdp() {
  let failure;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const version = await requestJson('/json/version');
      const targets = await requestJson('/json/list');
      if (
        typeof version.webSocketDebuggerUrl === 'string' &&
        Array.isArray(targets)
      ) {
        return version;
      }
      failure = new Error('CDP response did not include webSocketDebuggerUrl');
    } catch (error) {
      failure = error;
    }
    await delay(1000);
  }
  const listener = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
  }).stdout;
  throw new Error(
    `CDP endpoint was not reachable on port ${port}: ${failure?.message ?? 'unknown error'}\n${listener}`,
  );
}

async function createCdpClient(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 0;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) {
      return;
    }
    pending.delete(message.id);
    message.error
      ? request.reject(new Error(JSON.stringify(message.error)))
      : request.resolve(message.result ?? {});
  };
  await new Promise((resolveOpen, rejectOpen) => {
    socket.onopen = resolveOpen;
    socket.onerror = rejectOpen;
  });
  return {
    call(method, params = {}, sessionId) {
      return new Promise((resolveCall, rejectCall) => {
        const id = ++nextId;
        pending.set(id, { resolve: resolveCall, reject: rejectCall });
        socket.send(
          JSON.stringify({
            id,
            method,
            params,
            ...(sessionId ? { sessionId } : {}),
          }),
        );
      });
    },
    close() {
      socket.close();
    },
  };
}

function writeFixture() {
  mkdirSync(join(workspace, '.vscode'));
  writeFileSync(
    join(workspace, '.vscode', 'settings.json'),
    JSON.stringify({
      'deckard.theme': theme,
      ...(colorTheme ? { 'workbench.colorTheme': colorTheme } : {}),
      'workbench.secondarySideBar.defaultVisibility': false,
      'workbench.startupEditor': 'none',
    }),
  );
  cpSync(join(repositoryRoot, 'development', 'notes'), workspace, {
    recursive: true,
  });
}

// Runs inside the isolated host so no OS-level keystrokes touch other windows.
function writeCompanionExtension() {
  writeFileSync(
    join(companion, 'package.json'),
    JSON.stringify({
      name: 'deckard-screenshot-helper',
      publisher: 'deckard-screenshot',
      version: '0.0.1',
      engines: { vscode: '^1.134.0' },
      activationEvents: ['onStartupFinished'],
      main: './extension.js',
    }),
  );
  const scene =
    selectedView.scene ?? `await run(${JSON.stringify(selectedView.command)});`;
  writeFileSync(
    join(companion, 'extension.js'),
    `const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
async function run(command, ...args) {
  await vscode.commands.executeCommand(command, ...args);
}
// Opens a sample note with the cursor in the first line containing text.
async function openNote(fileName, text, offset = 0, reveal = 'InCenterIfOutsideViewport') {
  const workspace = vscode.workspace.workspaceFolders?.[0];
  if (!workspace) throw new Error('Screenshot workspace is unavailable');
  const editor = await vscode.window.showTextDocument(
    vscode.Uri.joinPath(workspace.uri, fileName),
    { preview: false },
  );
  const lines = editor.document.getText().split(/\\r?\\n/);
  const line = lines.findIndex((candidate) => candidate.includes(text));
  if (line < 0) throw new Error(fileName + ' has no line containing ' + text);
  const position = new vscode.Position(line, lines[line].indexOf(text) + offset);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType[reveal],
  );
  return editor;
}
async function activate() {
  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const commands = await vscode.commands.getCommands(true);
      if (commands.includes('deckard.showDashboard')) {
        break;
      }
      await delay(500);
    }
    // The capture sizes the window first, so the scene is laid out at the
    // size it is captured at and a hover is not dismissed by a resize.
    for (
      let attempt = 0;
      attempt < 120 && !fs.existsSync(path.join(__dirname, 'sized'));
      attempt += 1
    ) {
      await delay(500);
    }
    await run('deckard.reindexWorkspace');
    await run('workbench.action.closeAllEditors');
    await run('workbench.action.closeSidebar');
    await run('workbench.action.closeAuxiliaryBar');
    ${scene}
    await delay(1500);
    if (!${Boolean(selectedView.keepLayout)}) {
      await run('workbench.action.closeOtherEditors');
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await run('workbench.action.closeSidebar');
        await run('workbench.action.closeAuxiliaryBar');
        await delay(300);
      }
    }
    fs.writeFileSync(path.join(__dirname, 'ready'), 'ok');
  } catch (error) {
    fs.writeFileSync(path.join(__dirname, 'error'), error.stack || String(error));
  }
}
module.exports = { activate };
`,
  );
}

function launchWorkbench() {
  if (process.env.DECKARD_SCREENSHOT_SKIP_BUILD !== '1') {
    const build = spawnSync(process.execPath, ['esbuild.js'], {
      cwd: repositoryRoot,
      stdio: 'inherit',
    });
    if (build.status !== 0) {
      throw new Error('Extension build failed');
    }
  }
  spawn(
    'code',
    [
      '--new-window',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-telemetry',
      '--user-data-dir',
      profile,
      '--extensions-dir',
      extensions,
      '--extensionDevelopmentPath',
      repositoryRoot,
      '--extensionDevelopmentPath',
      companion,
      `--remote-debugging-port=${port}`,
      workspace,
    ],
    { detached: true, stdio: 'ignore' },
  ).unref();
}

function verifyPortOwner() {
  const listener = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN']).split(
    '\n',
  )[1];
  portOwner = listener?.trim().split(/\s+/)[1];
  if (!portOwner) {
    throw new Error(`No process owns CDP port ${port}`);
  }
  const command = run('ps', ['-ww', '-p', portOwner, '-o', 'command=']);
  if (
    !command.includes(profile) ||
    !command.includes(repositoryRoot) ||
    !command.includes('--disable-workspace-trust')
  ) {
    throw new Error(
      `CDP port ${port} is not owned by this capture host: ${command}`,
    );
  }
}

async function stopWorkbench() {
  if (!portOwner) {
    return;
  }

  try {
    process.kill(Number(portOwner), 'SIGTERM');
  } catch (error) {
    if (error.code === 'ESRCH') {
      return;
    }
    throw error;
  }

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const listener = spawnSync(
      'lsof',
      ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'],
      { encoding: 'utf8' },
    );
    if (listener.status !== 0) {
      return;
    }
    await delay(250);
  }

  throw new Error(`Capture host did not release CDP port ${port}`);
}

async function evaluate(client, expression, sessionId) {
  const result = await client.call(
    'Runtime.evaluate',
    { expression, returnByValue: true },
    sessionId,
  );
  return result.result?.value;
}

async function isRendered(client, targets, workbenchSessionId) {
  if (selectedView.target === 'workbench') {
    return Boolean(
      await evaluate(client, selectedView.renderedAssertion, workbenchSessionId),
    );
  }
  const extensionId = selectedView.webviewExtension ?? 'esperinnovations.deckard-notes';
  const webviews = targets.filter(
    (target) =>
      target.type === 'iframe' &&
      target.url.includes(`extensionId=${extensionId}`) &&
      target.url.includes('vscode-webview://'),
  );
  for (const webview of webviews) {
    const { sessionId } = await client.call('Target.attachToTarget', {
      targetId: webview.targetId,
      flatten: true,
    });
    const rendered = Boolean(
      await evaluate(client, selectedView.renderedAssertion, sessionId),
    );
    await client.call('Target.detachFromTarget', { sessionId });
    if (rendered) {
      return true;
    }
  }
  return false;
}

async function capture(client) {
  let workbenchSessionId;
  let panesCollapsed = !selectedView.collapsePanes;
  try {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const targets =
        (await client.call('Target.getTargets')).targetInfos ?? [];
      const workbench = targets.find(
        (target) =>
          target.type === 'page' &&
          (target.url ?? '').endsWith('/workbench/workbench.html'),
      );
      if (workbench && !workbenchSessionId) {
        ({ sessionId: workbenchSessionId } = await client.call(
          'Target.attachToTarget',
          { targetId: workbench.targetId, flatten: true },
        ));
        await client.call(
          'Emulation.setDeviceMetricsOverride',
          {
            width: 1920,
            height: 1080,
            deviceScaleFactor: 1,
            mobile: false,
          },
          workbenchSessionId,
        );
        writeFileSync(join(companion, 'sized'), 'ok');
      }
      const ready = existsSync(join(companion, 'ready'));
      const errorPath = join(companion, 'error');
      if (existsSync(errorPath)) {
        throw new Error(readFileSync(errorPath, 'utf8'));
      }
      if (workbenchSessionId && ready && !panesCollapsed) {
        await evaluate(
          client,
          `for (const header of document.querySelectorAll('.pane-header[aria-expanded="true"]')) { if (${JSON.stringify(selectedView.collapsePanes)}.includes(header.querySelector('.title')?.textContent?.trim())) header.click(); }`,
          workbenchSessionId,
        );
        panesCollapsed = true;
        await delay(1000);
        continue;
      }
      if (
        workbenchSessionId &&
        ready &&
        (await isRendered(client, targets, workbenchSessionId))
      ) {
        const screenshot = await client.call(
          'Page.captureScreenshot',
          { format: 'png', fromSurface: true },
          workbenchSessionId,
        );
        writeFileSync(candidate, Buffer.from(screenshot.data, 'base64'));
        const png = readFileSync(candidate);
        if (
          !png
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
          png.readUInt32BE(16) !== 1920 ||
          png.readUInt32BE(20) !== 1080
        ) {
          throw new Error('Candidate is not a 1920x1080 PNG');
        }
        console.log(
          `Captured candidate ${candidate} from verified Deckard ${selectedView.title} view.`,
        );
        if (promote) {
          mkdirSync(resolve(output, '..'), { recursive: true });
          writeFileSync(output, png);
          console.log(`Promoted candidate to ${basename(output)}.`);
        } else {
          console.log(
            'Inspect the candidate, then rerun with DECKARD_SCREENSHOT_PROMOTE=1 to update the repository image.',
          );
        }
        return;
      }
      await delay(1000);
    }
    throw new Error(
      `Deckard ${selectedView.title} view did not render within 90 seconds`,
    );
  } finally {
    client.close();
  }
}

try {
  port = await choosePort();
  writeFixture();
  writeCompanionExtension();
  launchWorkbench();
  const version = await waitForCdp();
  verifyPortOwner();
  const client = await createCdpClient(version.webSocketDebuggerUrl);
  await capture(client);
  succeeded = true;
} finally {
  // DECKARD_SCREENSHOT_KEEP_HOST=1 leaves a successful capture's host open,
  // as a failed one is, so its page can be inspected over the same port.
  if (succeeded && process.env.DECKARD_SCREENSHOT_KEEP_HOST !== '1') {
    await stopWorkbench();
    rmSync(workspace, { recursive: true, force: true });
    rmSync(profile, { recursive: true, force: true });
    rmSync(extensions, { recursive: true, force: true });
    rmSync(companion, { recursive: true, force: true });
  } else {
    console.error(
      `Capture diagnostics retained:\nworkspace=${workspace}\nprofile=${profile}\nextensions=${extensions}\ncompanion=${companion}\nport=${port}\npid=${portOwner}`,
    );
  }
}
