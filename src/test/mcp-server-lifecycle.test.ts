import * as assert from 'assert';
import { request as httpRequest } from 'node:http';
import { connect, createServer as createNetServer } from 'node:net';

import { WorkspaceWriteHistory } from '../ui/commands/workspaceWrites';
import { DeckardMcpServer, McpServerSettings } from '../ui/commands/mcpServer';
import { WorkspaceIndex } from '../domain/model';

/**
 * Secret storage as VS Code's is: shared by every window, with each read and
 * write a round trip that takes a moment.
 */
function createSecrets() {
  const values = new Map<string, string>();
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
  return {
    get: async (key: string) => {
      await tick();
      return values.get(key);
    },
    store: async (key: string, value: string) => {
      await tick();
      values.set(key, value);
    },
    values,
  };
}

/** A server over an empty index, its settings and secrets supplied by the test. */
function createServer(
  secrets = createSecrets(),
  settings: McpServerSettings = { enabled: false, port: 0 },
) {
  return new DeckardMcpServer({
    indexer: { ready: Promise.resolve(), getSnapshot: () => ({}) as WorkspaceIndex },
    history: new WorkspaceWriteHistory(),
    secrets,
    tools: [],
    version: 'test',
    readSettings: () => settings,
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
});
