import * as assert from 'assert';

import {
  handleMcpMessage,
  MCP_PROTOCOL_VERSIONS,
  McpHandlers,
  readManifestTools,
} from '../core/mcp/mcpProtocol';

suite('MCP protocol', () => {
  const calls: unknown[] = [];
  const handlers: McpHandlers = {
    serverInfo: { name: 'deckard', version: '1.0.0' },
    tools: [
      { name: 'deckard_query', description: 'Search', inputSchema: { type: 'object' } },
      { name: 'broken', description: 'Fails', inputSchema: { type: 'object' } },
    ],
    callTool: async (name, args) => {
      calls.push([name, args]);
      if (name === 'broken') {
        throw new Error('the index is gone');
      }
      return { text: `answered ${name}` };
    },
  };

  test('starts a session in a version both sides speak', async () => {
    assert.deepStrictEqual(
      await handleMcpMessage(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test' } },
        },
        handlers,
      ),
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'deckard', version: '1.0.0' },
        },
      },
    );
    const newer = await handleMcpMessage(
      { jsonrpc: '2.0', id: 'b', method: 'initialize', params: { protocolVersion: '2099-01-01' } },
      handlers,
    );
    assert.strictEqual(
      (newer?.result as { protocolVersion: string }).protocolVersion,
      MCP_PROTOCOL_VERSIONS[0],
      'a version it does not know is answered with the newest it does',
    );
  });

  test('lists its tools and calls one', async () => {
    const list = await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, handlers);
    assert.deepStrictEqual(
      (list?.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name),
      ['deckard_query', 'broken'],
    );

    calls.length = 0;
    assert.deepStrictEqual(
      await handleMcpMessage(
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'deckard_query', arguments: { query: 'task = open' } },
        },
        handlers,
      ),
      {
        jsonrpc: '2.0',
        id: 3,
        result: { content: [{ type: 'text', text: 'answered deckard_query' }], isError: false },
      },
    );
    assert.deepStrictEqual(calls, [['deckard_query', { query: 'task = open' }]]);
  });

  test('reports a failing tool as its result, and an unknown tool as an error', async () => {
    const failed = await handleMcpMessage(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'broken' } },
      handlers,
    );
    assert.deepStrictEqual(failed?.result, {
      content: [{ type: 'text', text: 'Deckard could not answer: the index is gone' }],
      isError: true,
    });
    const unknown = await handleMcpMessage(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'delete_notes' } },
      handlers,
    );
    assert.strictEqual(unknown?.error?.code, -32602);
  });

  test('answers no notification, and turns away what is not a request it knows', async () => {
    assert.strictEqual(
      await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, handlers),
      undefined,
    );
    assert.strictEqual(
      await handleMcpMessage({ jsonrpc: '2.0', id: 6, result: {} }, handlers),
      undefined,
      "a client's response needs no answer",
    );
    assert.deepStrictEqual(await handleMcpMessage({ jsonrpc: '2.0', id: 7, method: 'ping' }, handlers), {
      jsonrpc: '2.0',
      id: 7,
      result: {},
    });
    assert.strictEqual(
      (await handleMcpMessage({ jsonrpc: '2.0', id: 8, method: 'resources/list' }, handlers))?.error
        ?.code,
      -32601,
    );
    assert.strictEqual(
      (await handleMcpMessage({ id: 9, method: 'ping' }, handlers))?.error?.code,
      -32600,
    );
  });

  test('offers the tools the extension manifest declares', () => {
    assert.deepStrictEqual(
      readManifestTools([
        {
          name: 'deckard_query',
          displayName: 'Search',
          modelDescription: 'Searches notes.',
          inputSchema: { type: 'object' },
          when: 'config.deckard.assistantTools',
        },
        { name: 'incomplete' },
      ]),
      [
        {
          name: 'deckard_query',
          title: 'Search',
          description: 'Searches notes.',
          inputSchema: { type: 'object' },
        },
      ],
    );
    assert.deepStrictEqual(readManifestTools(undefined), []);
  });
});
