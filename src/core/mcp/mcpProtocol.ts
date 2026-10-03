/**
 * The Model Context Protocol, as much of it as Deckard's local server needs:
 * JSON-RPC 2.0 messages that start a session, list tools, and call one. The
 * server owns transport and authentication; this only answers messages.
 */

import { isRecord } from '../../shared/guards';

/** The protocol versions this server speaks, newest first. */
export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/** JSON-RPC's code for a message that is not JSON at all. */
export const PARSE_ERROR = -32700;
/** JSON-RPC's code for JSON that is not a request: no `jsonrpc: '2.0'` or no method. */
export const INVALID_REQUEST = -32600;
/** JSON-RPC's code for a method this server does not answer. */
export const METHOD_NOT_FOUND = -32601;
/** JSON-RPC's code for a known method called with parameters it cannot use. */
export const INVALID_PARAMS = -32602;

/** A tool as `tools/list` describes it to the client: its name, wording, and JSON Schema input. */
export interface McpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** What a tool call answers: text for the model, flagged when the call failed. */
export interface McpToolResult {
  text: string;
  isError?: boolean;
}

/**
 * What the server supplies to answer messages: who it is, what it tells the
 * client to do, the tools it offers, and the call that runs one by name.
 */
export interface McpHandlers {
  serverInfo: { name: string; version: string };
  instructions?: string;
  tools: readonly McpTool[];
  callTool(name: string, args: unknown): Promise<McpToolResult>;
}

/** A JSON-RPC 2.0 response: a `result` on success, an `error` otherwise. */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Answers one request whose method this server knows, given its id and params. */
type MethodHandler = (
  id: string | number,
  params: unknown,
  handlers: McpHandlers,
) => Promise<JsonRpcResponse> | JsonRpcResponse;

/**
 * The methods this server answers. A Map rather than an object, so a method
 * named after an Object.prototype member, such as `toString`, is not found.
 */
const METHODS = new Map<string, MethodHandler>([
  ['initialize', answerInitialize],
  ['ping', (id) => success(id, {})],
  ['tools/list', (id, _params, handlers) => success(id, { tools: handlers.tools })],
  ['tools/call', answerToolCall],
]);

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
  // Only a method METHODS names is answered: a Map holds no inherited names
  // such as constructor, and the check says so where the call is made.
  if (!METHODS.has(message.method)) {
    return failure(id, METHOD_NOT_FOUND, `Deckard does not answer ${message.method}.`);
  }
  const answer = METHODS.get(message.method)!;
  return answer(id, message.params, handlers);
}

/** Starts a session: agrees a protocol version and says what the server offers. */
function answerInitialize(
  id: string | number,
  params: unknown,
  handlers: McpHandlers,
): JsonRpcResponse {
  const requested = isRecord(params) ? params.protocolVersion : undefined;
  return success(id, {
    protocolVersion: negotiateProtocolVersion(requested),
    capabilities: { tools: { listChanged: false } },
    serverInfo: handlers.serverInfo,
    ...(handlers.instructions ? { instructions: handlers.instructions } : {}),
  });
}

/**
 * The version the client asked for when this server speaks it, else the
 * newest this server speaks, which the client may then refuse.
 */
function negotiateProtocolVersion(requested: unknown): string {
  if (typeof requested === 'string' && MCP_PROTOCOL_VERSIONS.includes(requested)) {
    return requested;
  }
  return MCP_PROTOCOL_VERSIONS[0];
}

/**
 * Runs a tool by name. An unknown tool is refused as invalid params; a tool
 * that throws is answered as a failed result, so the model can read why.
 */
async function answerToolCall(
  id: string | number,
  rawParams: unknown,
  handlers: McpHandlers,
): Promise<JsonRpcResponse> {
  const params = isRecord(rawParams) ? rawParams : {};
  const name = params.name;
  if (
    typeof name !== 'string' ||
    !handlers.tools.some((tool) => tool.name === name)
  ) {
    return failure(id, INVALID_PARAMS, `Deckard has no tool named ${String(name)}.`);
  }
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

/** A response carrying a result. */
function success(id: string | number, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

/** A response carrying an error; `id` is null when the request's own id could not be read. */
function failure(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
