import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { registerCommand } from '../runCommand';

/** The MCP server's setup: copying it for an assistant, and a new token. */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { mcpServer } = services;
  context.subscriptions.push(
    registerCommand('deckard.copyMcpSetup', () =>
      mcpServer.copySetup(),
    ),
    registerCommand('deckard.resetMcpToken', () =>
      mcpServer.resetTokenCommand(),
    ),
  );
}
