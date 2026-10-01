import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';

/** The MCP server's setup: copying it for an assistant, and a new token. */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { mcpServer } = services;
  context.subscriptions.push(
    vscode.commands.registerCommand('deckard.copyMcpSetup', () =>
      mcpServer.copySetup(),
    ),
    vscode.commands.registerCommand('deckard.resetMcpToken', () =>
      mcpServer.resetTokenCommand(),
    ),
  );
}
