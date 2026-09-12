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
const view = process.env.DECKARD_SCREENSHOT_VIEW ?? 'dashboard';
const viewConfiguration = {
  dashboard: {
    command: 'deckard.showDashboard',
    output: 'docs/images/dashboard.png',
    title: 'Dashboard',
    renderedAssertion:
      "document.querySelector('iframe')?.contentDocument?.title === 'Deckard Dashboard' && Boolean(document.querySelector('iframe')?.contentDocument?.querySelector('#app > header h1'))",
  },
  'related-notes': {
    command: 'workbench.view.extension.deckard',
    output: 'docs/images/related-notes.png',
    title: 'Related Notes',
    renderedAssertion:
      "document.querySelector('iframe')?.contentDocument?.title === 'Deckard Related Notes' && Boolean(document.querySelector('iframe')?.contentDocument?.querySelector('#app .sidebar-header'))",
  },
  'tag-overview': {
    command: 'deckard.showTagOverview',
    output: 'docs/images/tag-overview.png',
    title: 'Tag Overview',
    renderedAssertion:
      "document.querySelector('iframe')?.contentDocument?.title === 'Deckard Tag Overview' && Boolean(document.querySelector('iframe')?.contentDocument?.querySelector('#app > header h1'))",
  },
  help: {
    command: 'deckard.showHelp',
    output: 'docs/images/help.png',
    title: 'Help',
    renderedAssertion:
      "document.querySelector('iframe')?.contentDocument?.title === 'Deckard Help' && document.querySelector('iframe')?.contentDocument?.querySelector('main > article > header h1')?.textContent === 'Help'",
  },
  stats: {
    command: 'deckard.showStats',
    output: 'docs/images/stats.png',
    title: 'Stats',
    renderedAssertion:
      "document.querySelector('iframe')?.contentDocument?.title === 'Deckard Stats' && Boolean(document.querySelector('iframe')?.contentDocument?.querySelector('#app > header h1'))",
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
const candidate = join(tmpdir(), `deckard-dashboard-${Date.now()}.png`);
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
  writeFileSync(
    join(companion, 'extension.js'),
    `const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
  const view = ${JSON.stringify(view)};
async function run(command, ...args) {
  await vscode.commands.executeCommand(command, ...args);
}
async function activate() {
  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const commands = await vscode.commands.getCommands(true);
      if (commands.includes('deckard.showDashboard')) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await run('deckard.reindexWorkspace');
    await run('workbench.action.closeAllEditors');
    await run('workbench.action.closeSidebar');
    await run('workbench.action.closeAuxiliaryBar');
    if (view === 'related-notes') {
      const workspace = vscode.workspace.workspaceFolders?.[0];
      if (!workspace) throw new Error('Screenshot workspace is unavailable');
      const editor = await vscode.window.showTextDocument(
        vscode.Uri.joinPath(workspace.uri, '2026-08-28.md'),
        { preview: false },
      );
      const position = new vscode.Position(14, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenterIfOutsideViewport,
      );
      await run('workbench.view.extension.deckard');
      await run('deckard.relatedNotes.focus');
    } else if (view === 'tag-overview') {
      await run('deckard.showTagOverview', '#project/ghostline-relay');
    } else {
      await run(${JSON.stringify(selectedView.command)});
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (view !== 'related-notes') {
      await run('workbench.action.closeOtherEditors');
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await run('workbench.action.closeSidebar');
        await run('workbench.action.closeAuxiliaryBar');
        await new Promise((resolve) => setTimeout(resolve, 300));
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

async function capture(client) {
  try {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const targets =
        (await client.call('Target.getTargets')).targetInfos ?? [];
      const workbench = targets.find(
        (target) =>
          target.type === 'page' &&
          (target.url ?? '').endsWith('/workbench/workbench.html'),
      );
      const webview = targets.find(
        (target) =>
          target.type === 'iframe' &&
          target.url.includes('extensionId=esperinnovations.deckard-notes') &&
          target.url.includes('vscode-webview://'),
      );
      const ready = existsSync(join(companion, 'ready'));
      const errorPath = join(companion, 'error');
      if (existsSync(errorPath)) {
        throw new Error(readFileSync(errorPath, 'utf8'));
      }
      if (workbench && webview && ready) {
        const { sessionId: webviewSessionId } = await client.call(
          'Target.attachToTarget',
          { targetId: webview.targetId, flatten: true },
        );
        const assertion = await client.call(
          'Runtime.evaluate',
          {
            expression: selectedView.renderedAssertion,
            returnByValue: true,
          },
          webviewSessionId,
        );
        const rendered = Boolean(assertion.result?.value);
        await client.call('Target.detachFromTarget', {
          sessionId: webviewSessionId,
        });
        if (!rendered) {
          await delay(1000);
          continue;
        }
        const { sessionId } = await client.call('Target.attachToTarget', {
          targetId: workbench.targetId,
          flatten: true,
        });
        await client.call(
          'Emulation.setDeviceMetricsOverride',
          {
            width: 1920,
            height: 1080,
            deviceScaleFactor: 1,
            mobile: false,
          },
          sessionId,
        );
        const screenshot = await client.call(
          'Page.captureScreenshot',
          { format: 'png', fromSurface: true },
          sessionId,
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
          `Captured candidate ${candidate} from verified Deckard ${selectedView.title} webview.`,
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
      `Deckard ${selectedView.title} webview did not render within 90 seconds`,
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
  if (succeeded) {
    await stopWorkbench();
    rmSync(workspace, { recursive: true, force: true });
    rmSync(profile, { recursive: true, force: true });
    rmSync(extensions, { recursive: true, force: true });
    rmSync(companion, { recursive: true, force: true });
  } else {
    console.error(
      `Capture diagnostics retained:\nworkspace=${workspace}\nprofile=${profile}\nextensions=${extensions}\ncompanion=${companion}\nport=${port}`,
    );
  }
}
