import * as assert from 'assert';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { connect, createServer as createNetServer } from 'node:net';

import * as vscode from 'vscode';

import { WorkspaceWriteHistory } from '../ui/commands/workspaceWrites';
import { DeckardMcpServer, McpServerSettings } from '../ui/commands/mcpServer';
import { WorkspaceIndex } from '../domain/model';

/**
 * Secret storage as VS Code's is: shared by every window, with each read and
 * write a round trip that takes a moment, and a change heard in every window.
 */
function createSecrets() {
  const values = new Map<string, string>();
  const changes = new vscode.EventEmitter<{ key: string }>();
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
  return {
    get: async (key: string) => {
      await tick();
      return values.get(key);
    },
    store: async (key: string, value: string) => {
      await tick();
      values.set(key, value);
      changes.fire({ key });
    },
    onDidChange: changes.event,
    values,
  };
}

/** A server over an empty index, its settings and secrets supplied by the test. */
function createServer(
  secrets = createSecrets(),
  settings: McpServerSettings = { enabled: false, port: 0 },
  retryDelay?: number,
) {
  return new DeckardMcpServer({
    indexer: { ready: Promise.resolve(), getSnapshot: () => ({}) as WorkspaceIndex },
    history: new WorkspaceWriteHistory(),
    secrets,
    tools: [],
    version: 'test',
    readSettings: () => settings,
    retryDelay,
  });
}

/** A port nothing on this computer is listening on, as the system hands one out. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** Whether anything accepts a connection on this port. */
function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** The status a ping with this token gets from the server on this port. */
function ping(port: number, token: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.on('error', reject);
    request.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
  });
}

suite('MCP server lifecycle', () => {
  test('the token copied while the server starts is the one it accepts', async () => {
    const secrets = createSecrets();
    const server = createServer(secrets);
    try {
      // Turning the server on from Copy MCP Server Setup starts it and copies
      // the token at once, before either has stored one.
      const [port, copied] = await Promise.all([server.start(0), server.getToken()]);
      assert.strictEqual(secrets.values.get('deckard.mcpServer.token'), copied);
      assert.strictEqual(await ping(port, copied), 200);
    } finally {
      await server.stop();
      server.dispose();
    }
  });

  test('two restarts in a row leave one server, which stop closes', async () => {
    const first = await findFreePort();
    const second = await findFreePort();
    const settings = { enabled: true, port: first };
    const server = createServer(createSecrets(), settings);
    try {
      // The port changes while the first restart is still reading the token.
      const restarts = [server.restart()];
      await pause(2);
      settings.port = second;
      restarts.push(server.restart());
      await Promise.all(restarts);
      assert.deepStrictEqual(
        [await isListening(first), await isListening(second)],
        [false, true],
        'only the server on the port the settings name is running',
      );
      await server.stop();
      assert.deepStrictEqual([await isListening(first), await isListening(second)], [false, false]);
    } finally {
      server.dispose();
    }
  });

  test('closing the window while the server starts leaves nothing listening', async () => {
    const port = await findFreePort();
    const server = createServer(createSecrets(), { enabled: true, port });
    const restarted = server.restart();
    server.dispose();
    await restarted;
    await pause(20);
    assert.strictEqual(await isListening(port), false);
  });

  /** Runs `body` with every error message Deckard shows collected rather than shown. */
  async function collectErrors(body: (errors: string[]) => Promise<void>): Promise<void> {
    const window = vscode.window as unknown as Record<string, unknown>;
    const showErrorMessage = window.showErrorMessage;
    const errors: string[] = [];
    window.showErrorMessage = async (message: string) => {
      errors.push(message);
      return undefined;
    };
    try {
      await body(errors);
    } finally {
      window.showErrorMessage = showErrorMessage;
    }
  }

  test("a second window finds its port held by the first window's Deckard, says nothing, and takes the port when that window closes", async () => {
    await collectErrors(async (errors) => {
      const port = await findFreePort();
      const secrets = createSecrets();
      const first = createServer(secrets, { enabled: true, port });
      const second = createServer(secrets, { enabled: true, port }, 20);
      try {
        await first.restart();
        await second.restart();
        assert.deepStrictEqual(errors, []);
        const token = await first.getToken();
        first.dispose();
        await pause(100);
        assert.strictEqual(await ping(port, token), 200, 'the second window serves the port now');
      } finally {
        first.dispose();
        await second.stop();
        second.dispose();
      }
    });
  });

  test('a port another program holds is still reported', async () => {
    await collectErrors(async (errors) => {
      // Another program answers on the port, but not as Deckard does.
      const other = createHttpServer((_request, response) => {
        response.writeHead(401).end('Who are you?');
      });
      await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
      const address = other.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const server = createServer(createSecrets(), { enabled: true, port });
      try {
        await server.restart();
        assert.deepStrictEqual(errors, [
          `Deckard could not start its MCP server on port ${port}, because another program is using it. Choose a free port in the "MCP Server: Port" setting.`,
        ]);
      } finally {
        server.dispose();
        await new Promise((resolve) => other.close(resolve));
      }
    });
  });

  test('a token reset in another window retires the old token here too', async () => {
    const secrets = createSecrets();
    const running = createServer(secrets);
    const elsewhere = createServer(secrets);
    try {
      const port = await running.start(0);
      const old = await running.getToken();
      await elsewhere.resetToken();
      await pause(20);
      const token = await elsewhere.getToken();
      assert.notStrictEqual(token, old);
      assert.strictEqual(await ping(port, old), 401);
      assert.strictEqual(await ping(port, token), 200);
    } finally {
      await running.stop();
      running.dispose();
      elsewhere.dispose();
    }
  });
});
