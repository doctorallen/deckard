/**
 * The Model Context Protocol, as much of it as Deckard's local server needs:
 * JSON-RPC 2.0 messages that start a session, list tools, and call one. The
 * server owns transport and authentication; this only answers messages.
 */

/** The protocol versions this server speaks, newest first. */
export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;

export interface McpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  text: string;
  isError?: boolean;
}

export interface McpHandlers {
  serverInfo: { name: string; version: string };
  instructions?: string;
  tools: readonly McpTool[];
  callTool(name: string, args: unknown): Promise<McpToolResult>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Answers one JSON-RPC message. A notification, which has no id, gets no
 * answer, and neither does a response the client sends back.
 */
export async function handleMcpMessage(
  message: unknown,
  handlers: McpHandlers,
): Promise<JsonRpcResponse | undefined> {
  if (!isRecord(message) || message.jsonrpc !== '2.0') {
    return failure(null, INVALID_REQUEST, 'Expected a JSON-RPC 2.0 message.');
  }
  const id = message.id;
  const hasId = typeof id === 'string' || typeof id === 'number';
  if (typeof message.method !== 'string') {
    return 'result' in message || 'error' in message
      ? undefined
      : failure(hasId ? id : null, INVALID_REQUEST, 'Expected a method.');
  }
  if (!hasId) {
    return undefined;
  }

  switch (message.method) {
    case 'initialize': {
      const requested = isRecord(message.params)
        ? message.params.protocolVersion
        : undefined;
      return success(id, {
        protocolVersion:
          typeof requested === 'string' &&
          MCP_PROTOCOL_VERSIONS.includes(requested)
            ? requested
            : MCP_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: handlers.serverInfo,
        ...(handlers.instructions ? { instructions: handlers.instructions } : {}),
      });
    }
    case 'ping':
      return success(id, {});
    case 'tools/list':
      return success(id, { tools: handlers.tools });
    case 'tools/call': {
      const params = isRecord(message.params) ? message.params : {};
      const name = params.name;
      if (
        typeof name !== 'string' ||
        !handlers.tools.some((tool) => tool.name === name)
      ) {
        return failure(id, INVALID_PARAMS, `Deckard has no tool named ${String(name)}.`);
      }
      // A tool that fails reports it as its result, so the model can read why.
      let answer: McpToolResult;
      try {
        answer = await handlers.callTool(name, params.arguments ?? {});
      } catch (error) {
        answer = {
          text: `Deckard could not answer: ${error instanceof Error ? error.message : String(error)}`,
          isError: true,
        };
      }
      return success(id, {
        content: [{ type: 'text', text: answer.text }],
        isError: answer.isError === true,
      });
    }
    default:
      return failure(id, METHOD_NOT_FOUND, `Deckard does not answer ${message.method}.`);
  }
}

/**
 * The tools VS Code's assistants get, as the extension manifest declares them,
 * so both kinds of client see the same names, descriptions, and inputs.
 */
export function readManifestTools(declared: unknown): McpTool[] {
  if (!Array.isArray(declared)) {
    return [];
  }
  return declared.flatMap((tool): McpTool[] =>
    isRecord(tool) &&
    typeof tool.name === 'string' &&
    typeof tool.modelDescription === 'string' &&
    isRecord(tool.inputSchema)
      ? [
          {
            name: tool.name,
            ...(typeof tool.displayName === 'string'
              ? { title: tool.displayName }
              : {}),
            description: tool.modelDescription,
            inputSchema: tool.inputSchema,
          },
        ]
      : [],
  );
}

function success(id: string | number, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function failure(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
