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
import { measure, measureAsync } from '../../shared/timing';
import { writeSetting } from './settings';
import { openSettingAction, reportFailure, settingLabel } from './notify';
import { ASSISTANT_TOOLS, ToolRunners } from '../state/assistantTools';
import { addTask, changeTask } from './assistantWrites';
import { readQueryContext } from './queryContext';
import { WorkspaceWriteHistory } from './workspaceWrites';
import { WorkspaceIndex } from '../../domain/model';

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

/** What the server is built from. */
export interface McpServerOptions {
  indexer: IndexSource;
  /**
   * The history the add-task and change-task tools write to, so Undo Last
   * Change takes back what a client wrote, as it does for VS Code's tools.
   */
  history: WorkspaceWriteHistory;
  /** Where its token is kept. */
  secrets: SecretStore;
  /** The tools it lists, from the manifest. */
  tools: readonly McpTool[];
  /** Deckard's version, which the server reports. */
  version: string;
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

  private readonly indexer: IndexSource;
  private readonly history: WorkspaceWriteHistory;
  private readonly secrets: SecretStore;
  private readonly tools: readonly McpTool[];
  private readonly version: string;

  /**
   * Keeps the server in step with `deckard.mcpServer.*`. It does not start
   * listening here; `restart` does, once the settings say to.
   */
  public constructor(options: McpServerOptions) {
    this.indexer = options.indexer;
    this.history = options.history;
    this.secrets = options.secrets;
    this.tools = options.tools;
    this.version = options.version;
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
      const inUse = (error as NodeJS.ErrnoException | undefined)?.code === 'EADDRINUSE';
      void reportFailure({
        outcome: inUse
          ? `Deckard could not start its MCP server on port ${port}, because another program is using it.`
          : `Deckard could not start its MCP server on port ${port}.`,
        fix: `Choose a free port in the "${settingLabel('mcpServer.port')}" setting.`,
        action: openSettingAction('mcpServer.port'),
        error,
      });
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

  /** Closes the server and every open connection; nothing when it is not running. */
  public async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) {
      return;
    }
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** Stops following the settings and closes the server, without waiting for it. */
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
      const written = await writeSetting(
        'mcpServer.enabled',
        true,
        vscode.ConfigurationTarget.Global,
      );
      if (!written) {
        return;
      }
    }
    const port = configuration.get<number>('mcpServer.port', DEFAULT_MCP_PORT);
    await vscode.env.clipboard.writeText(
      getClaudeCodeSetup(port, await this.getToken()),
    );
    void vscode.window.showInformationMessage(
      'Copied the command that adds Deckard to Claude Code. Run it in a terminal. It holds the server’s token, so keep it private.',
    );
  }

  /** Reset MCP Server Token: replaces the token and says each client must be set up again. */
  public async resetTokenCommand(): Promise<void> {
    await this.resetToken();
    void vscode.window.showInformationMessage(
      'Deckard made a new MCP server token. Copy the setup again for each client that used the old one.',
    );
  }

  /**
   * Answers one HTTP request: refuses another site's page, a missing or wrong
   * token, any other path, and any method but POST, then answers the MCP
   * message in the body.
   */
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

  /** Whether the request carries the token, compared in constant time so its bytes cannot be guessed by timing. */
  private isAuthorized(header: string | undefined): boolean {
    const presented = /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1];
    if (!presented || !this.token) {
      return false;
    }
    const given = Buffer.from(presented);
    const expected = Buffer.from(this.token);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  /** What the MCP protocol layer answers with: the server's name, its instructions, and the tools run on the index. */
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
        const tool = ASSISTANT_TOOLS.find((entry) => entry.name === name);
        if (!tool) {
          return { text: `Unknown tool: ${name}`, isError: true };
        }
        const runners = this.createRunners(index);
        if (tool.kind === 'read') {
          const call = tool.read(args, runners);
          return call.kind === 'run'
            ? { text: measure(tool.measure.mcp, call.run) }
            : { text: call.text.mcp, isError: true };
        }
        // A write over MCP has no dialog of its own; the refactor preview is
        // where the reader sees the line and can decline it.
        const call = tool.read(args, runners);
        return call.kind === 'run'
          ? measureAsync(tool.measure.mcp, call.run)
          : { text: call.text.mcp, isError: true };
      },
    };
  }

  /**
   * What the tools answer with over MCP: the index read once the first scan
   * was done, for every tool in the call, and the same writes VS Code's
   * tools make, into the same history.
   */
  private createRunners(index: WorkspaceIndex): ToolRunners {
    return {
      getSnapshot: () => index,
      readQueryContext: () => readQueryContext(),
      addTask: (input) => addTask(this.indexer, this.history, input),
      changeTask: (input) => changeTask(this.indexer, this.history, input),
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

/** The request body as text; rejects a body over `limit` bytes, which is read but not kept. */
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

/** Ends the response with a plain-text body. */
function sendText(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(text);
}

/** Ends the response with a JSON body. */
function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}
