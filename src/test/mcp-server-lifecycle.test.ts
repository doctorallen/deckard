import * as assert from 'assert';
import { request as httpRequest } from 'node:http';

import { WorkspaceWriteHistory } from '../ui/commands/workspaceWrites';
import { DeckardMcpServer } from '../ui/commands/mcpServer';
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
function createServer(secrets = createSecrets()) {
  return new DeckardMcpServer({
    indexer: { ready: Promise.resolve(), getSnapshot: () => ({}) as WorkspaceIndex },
    history: new WorkspaceWriteHistory(),
    secrets,
    tools: [],
    version: 'test',
  });
}

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
});
