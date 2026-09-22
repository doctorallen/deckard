import * as assert from 'assert';
import { request as httpRequest } from 'node:http';

import * as vscode from 'vscode';

import { readManifestTools } from '../core/mcp/mcpProtocol';
import { parseMarkdown } from '../core/markdown/parser';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { DeckardMcpServer, getClaudeCodeSetup } from '../ui/commands/mcpServer';

suite('MCP server', () => {
  const secrets = new Map<string, string>();
  const note = parseMarkdown(
    'notes/atlas.md',
    '# Atlas #project/atlas\n- [ ] Call Ren about the budget',
    { createdAt: 1, updatedAt: 2 },
    {},
  );
  const index = buildWorkspaceIndex(new Map([[note.filePath, note]]));
  const server = new DeckardMcpServer(
    { ready: Promise.resolve(), getSnapshot: () => index },
    {
      get: async (key) => secrets.get(key),
      store: async (key, value) => {
        secrets.set(key, value);
      },
    },
    readManifestTools(
      vscode.extensions.getExtension('esperinnovations.deckard-notes')?.packageJSON.contributes
        .languageModelTools,
    ),
    '1.0.0',
  );
  let port = 0;
  let token = '';

  suiteSetup(async () => {
    port = await server.start(0);
    token = await server.getToken();
  });
  suiteTeardown(async () => {
    await server.stop();
    server.dispose();
  });

  /** Sends a request with full control of its headers, as a client would. */
  function send(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const request = httpRequest(
        { host: '127.0.0.1', port, path, method, headers },
        (response) => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            text += chunk;
          });
          response.on('end', () => resolve({ status: response.statusCode ?? 0, body: text }));
        },
      );
      request.on('error', reject);
      request.end(body);
    });
  }

  const post = (message: unknown, headers: Record<string, string> = {}) =>
    send(
      'POST',
      '/mcp',
      {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
        ...headers,
      },
      JSON.stringify(message),
    );

  test('answers a tool call that carries the token, from the local index', async () => {
    const response = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'deckard_query', arguments: { query: 'task = open' } },
    });
    assert.strictEqual(response.status, 200);
    const answer = JSON.parse(response.body) as { result: { content: Array<{ text: string }> } };
    assert.ok(answer.result.content[0].text.includes('Call Ren about the budget'));
  });

  test('a write with nothing usable in it writes nothing, and says what to send', async () => {
    const response = await post({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'deckard_add_task', arguments: {} },
    });
    assert.strictEqual(response.status, 200);
    const answer = JSON.parse(response.body) as { result: { isError?: boolean; content: Array<{ text: string }> } };
    assert.strictEqual(answer.result.isError, true);
    assert.match(answer.result.content[0].text, /Send the task's words as "text"/);

    const change = await post({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'deckard_change_task', arguments: { note: 'notes/atlas.md', line: 2 } },
    });
    const changed = JSON.parse(change.body) as { result: { isError?: boolean; content: Array<{ text: string }> } };
    assert.strictEqual(changed.result.isError, true, 'no change named is nothing to do');
  });

  test("lists the tools VS Code's assistants have", async () => {
    const response = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const answer = JSON.parse(response.body) as { result: { tools: Array<{ name: string }> } };
    assert.deepStrictEqual(
      answer.result.tools.map((tool) => tool.name),
      ['deckard_query', 'deckard_list_tags', 'deckard_add_task', 'deckard_change_task'],
    );
  });

  test('turns away a request without the token, or from a web page', async () => {
    const ping = { jsonrpc: '2.0', id: 3, method: 'ping' };
    assert.strictEqual((await post(ping, { Authorization: '' })).status, 401);
    assert.strictEqual((await post(ping, { Authorization: 'Bearer wrong' })).status, 401);
    assert.strictEqual(
      (await post(ping, { Origin: 'https://example.com' })).status,
      403,
      'a page on another site is refused, token or not',
    );
    assert.strictEqual(
      (await post(ping, { Origin: 'http://localhost:6274' })).status,
      200,
      'a local tool in a browser may connect with the token',
    );
  });

  test('accepts notifications, and only POST on its own path', async () => {
    assert.strictEqual(
      (await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status,
      202,
    );
    const authorization = { Authorization: `Bearer ${token}` };
    assert.strictEqual((await send('GET', '/mcp', authorization)).status, 405);
    assert.strictEqual((await send('POST', '/other', authorization, '{}')).status, 404);
    assert.strictEqual(
      (await send('POST', '/mcp', { ...authorization, 'Content-Type': 'application/json' }, 'not json'))
        .status,
      400,
    );
  });

  test('a new token retires the old one', async () => {
    const old = token;
    await server.resetToken();
    token = await server.getToken();
    assert.notStrictEqual(token, old);
    const ping = { jsonrpc: '2.0', id: 4, method: 'ping' };
    assert.strictEqual((await post(ping, { Authorization: `Bearer ${old}` })).status, 401);
    assert.strictEqual((await post(ping)).status, 200);
  });

  test('sets Claude Code up with the address and the token', () => {
    assert.strictEqual(
      getClaudeCodeSetup(39217, 'abc123'),
      'claude mcp add --transport http deckard http://127.0.0.1:39217/mcp --header "Authorization: Bearer abc123"',
    );
  });
});
