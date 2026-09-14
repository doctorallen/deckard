import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse,
} from 'node:http';

import * as vscode from 'vscode';

import {
  handleMcpMessage,
  JsonRpcResponse,
  McpHandlers,
  McpTool,
  PARSE_ERROR,
} from '../../core/mcp/mcpProtocol';
import { measure } from '../../core/timing';
import { WorkspaceIndex } from '../../core/types';
import {
  answerQuery,
  answerTags,
  QUERY_TOOL_NAME,
  readQueryToolInput,
  readTagsToolInput,
} from '../state/assistantTools';

/** Where the server answers, on 127.0.0.1. */
export const MCP_PATH = '/mcp';
export const DEFAULT_MCP_PORT = 39217;
const TOKEN_KEY = 'deckard.mcpServer.token';
const MAX_BODY_BYTES = 1024 * 1024;

interface IndexSource {
  readonly ready: Promise<void>;
  getSnapshot(): WorkspaceIndex;
}

interface SecretStore {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
}

/** The command that adds the server to Claude Code, token included. */
export function getClaudeCodeSetup(port: number, token: string): string {
  return `claude mcp add --transport http deckard http://127.0.0.1:${port}${MCP_PATH} --header "Authorization: Bearer ${token}"`;
}

/**
 * A Model Context Protocol server on this computer only, so Claude Code and
 * other MCP clients can use the query and tag tools VS Code's assistants have.
 *
 * It listens on 127.0.0.1, answers only requests that carry its token, and
 * turns away requests a web page makes to another site's address, so a page
 * open in a browser cannot read notes through it. It stays off until
 * `deckard.mcpServer.enabled` is set.
 */
export class DeckardMcpServer implements vscode.Disposable {
  private server: Server | undefined;
  private token: string | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(
    private readonly indexer: IndexSource,
    private readonly secrets: SecretStore,
    private readonly tools: readonly McpTool[],
    private readonly version: string,
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard.mcpServer')) {
          void this.restart();
        }
      }),
    );
  }

  /** Starts or stops the server to match its settings. */
  public async restart(): Promise<void> {
    await this.stop();
    const configuration = vscode.workspace.getConfiguration('deckard');
    if (!configuration.get<boolean>('mcpServer.enabled', false)) {
      return;
    }
    const port = configuration.get<number>('mcpServer.port', DEFAULT_MCP_PORT);
    try {
      await this.start(port);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Deckard could not start its MCP server on port ${port}: ${error instanceof Error ? error.message : String(error)}. Set deckard.mcpServer.port to a free port.`,
      );
    }
  }

  /** Listens on a port, or on any free one for 0, and returns the port. */
  public async start(port: number): Promise<number> {
    this.token = await this.getToken();
    const server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
    const address = server.address();
    return typeof address === 'object' && address ? address.port : port;
  }

  public async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  public dispose(): void {
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
    void this.stop();
  }

  /** The token, made and stored the first time it is needed. */
  public async getToken(): Promise<string> {
    const stored = await this.secrets.get(TOKEN_KEY);
    if (stored) {
      return stored;
    }
    const token = randomBytes(32).toString('hex');
    await this.secrets.store(TOKEN_KEY, token);
    return token;
  }

  /** Replaces the token, so every copied setup stops working. */
  public async resetToken(): Promise<void> {
    const token = randomBytes(32).toString('hex');
    await this.secrets.store(TOKEN_KEY, token);
    this.token = token;
  }

  /**
   * Copies the command that adds the server to Claude Code, first offering to
   * turn the server on.
   */
  public async copySetup(): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('deckard');
    if (!configuration.get<boolean>('mcpServer.enabled', false)) {
      const choice = await vscode.window.showInformationMessage(
        "Deckard's MCP server is off. Turn it on for Claude Code and other MCP clients?",
        'Turn On',
      );
      if (choice !== 'Turn On') {
        return;
      }
      await configuration.update(
        'mcpServer.enabled',
        true,
        vscode.ConfigurationTarget.Global,
      );
    }
    const port = configuration.get<number>('mcpServer.port', DEFAULT_MCP_PORT);
    await vscode.env.clipboard.writeText(
      getClaudeCodeSetup(port, await this.getToken()),
    );
    void vscode.window.showInformationMessage(
      'Copied the command that adds Deckard to Claude Code. Run it in a terminal. It holds the server’s token, so keep it private.',
    );
  }

  public async resetTokenCommand(): Promise<void> {
    await this.resetToken();
    void vscode.window.showInformationMessage(
      'Deckard made a new MCP server token. Copy the setup again for each client that used the old one.',
    );
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    // A web page sends its origin, and a page on another site must not reach
    // notes even by guessing the port. Clients on this computer send none.
    const origin = request.headers.origin;
    if (origin !== undefined && !isLocalOrigin(origin)) {
      sendText(response, 403, 'Requests from web pages are not allowed.');
      return;
    }
    if (!this.isAuthorized(request.headers.authorization)) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      sendText(response, 401, 'Send the Deckard MCP server token as a bearer token.');
      return;
    }
    if (new URL(request.url ?? '/', 'http://127.0.0.1').pathname !== MCP_PATH) {
      sendText(response, 404, 'Not found.');
      return;
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      sendText(response, 405, 'Send MCP messages with POST.');
      return;
    }

    let body: string;
    try {
      body = await readBody(request, MAX_BODY_BYTES);
    } catch {
      response.setHeader('Connection', 'close');
      sendText(response, 413, 'The request is too large.');
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(body);
    } catch {
      sendJson(response, 400, {
        jsonrpc: '2.0',
        id: null,
        error: { code: PARSE_ERROR, message: 'The request is not JSON.' },
      });
      return;
    }

    const handlers = this.createHandlers();
    const answer = Array.isArray(message)
      ? (await Promise.all(message.map((item) => handleMcpMessage(item, handlers)))).filter(
          (item): item is JsonRpcResponse => item !== undefined,
        )
      : await handleMcpMessage(message, handlers);
    if (answer === undefined || (Array.isArray(answer) && answer.length === 0)) {
      response.writeHead(202).end();
      return;
    }
    sendJson(response, 200, answer);
  }

  private isAuthorized(header: string | undefined): boolean {
    const presented = /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1];
    if (!presented || !this.token) {
      return false;
    }
    const given = Buffer.from(presented);
    const expected = Buffer.from(this.token);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  private createHandlers(): McpHandlers {
    return {
      serverInfo: { name: 'deckard', version: this.version },
      instructions:
        "Deckard indexes the Markdown notes and checklist tasks in the user's VS Code workspace. Use deckard_query to find notes and tasks, and deckard_list_tags first when you need a tag's exact name.",
      tools: this.tools,
      callTool: async (name, args) => {
        // An early call waits for the first scan rather than answer from part of it.
        await this.indexer.ready;
        const index = this.indexer.getSnapshot();
        if (name === QUERY_TOOL_NAME) {
          const input = readQueryToolInput(args);
          return input
            ? { text: measure('MCP query', () => answerQuery(index, input)) }
            : {
                text: 'Send a Deckard query as "query", such as tag = #project/atlas AND task = open.',
                isError: true,
              };
        }
        return {
          text: measure('MCP tag list', () =>
            answerTags(index, readTagsToolInput(args)),
          ),
        };
      },
    };
  }
}

/** An origin on this computer, as a local tool running in a browser has. */
function isLocalOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    return (
      (protocol === 'http:' || protocol === 'https:') &&
      (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

function readBody(request: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
      } else {
        chunks.push(chunk);
      }
    });
    request.on('end', () =>
      tooLarge
        ? reject(new Error('The request is too large.'))
        : resolve(Buffer.concat(chunks).toString('utf8')),
    );
    request.on('error', reject);
  });
}

function sendText(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(text);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}
