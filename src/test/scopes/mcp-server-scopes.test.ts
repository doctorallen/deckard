import * as assert from 'assert';

import * as vscode from 'vscode';

import { activateDeckard, answerMessages, arrange, Arrangement, clearEverywhere, deckard, decidingLevel, isMultiRoot, levels } from './scopes';

/** The places the server can be off: by default, for the user, in the workspace, or in the workspace over the user's on. */
const OFF: Arrangement<boolean>[] = [
  { name: 'off by default', values: {} },
  { name: 'off for the user', values: { user: false } },
  { name: 'off in the workspace', values: { workspace: false } },
  { name: 'on for the user, off in the workspace', values: { user: true, workspace: false } },
];

/**
 * Copy Claude Code Setup offers to turn the MCP server on when it is off,
 * and turns it on where the value in force is set, so the setup it copies
 * names a server that is running.
 */
suite(`Copy Claude Code Setup turning the MCP server on, with settings at every level (${isMultiRoot() ? 'multi-root' : 'single folder'})`, () => {
  suiteSetup(() => activateDeckard());

  teardown(() => clearEverywhere('mcpServer.enabled'));

  for (const arrangement of OFF) {
    test(`${arrangement.name}: Turn On turns it on`, async () => {
      await arrange('mcpServer.enabled', arrangement);
      const level = decidingLevel('mcpServer.enabled');
      // The command copies the setup to the machine's clipboard, which is put back after.
      const clipboard = await vscode.env.clipboard.readText();
      const answering = answerMessages('Turn On');
      let copied: string;
      try {
        await vscode.commands.executeCommand('deckard.copyMcpSetup');
        copied = await vscode.env.clipboard.readText();
      } finally {
        answering.dispose();
        await vscode.env.clipboard.writeText(clipboard);
      }

      assert.strictEqual(deckard().get('mcpServer.enabled'), true, 'the window reads the server as on');
      assert.strictEqual(levels('mcpServer.enabled')[level], true, `written in the ${level} settings, ${JSON.stringify(levels('mcpServer.enabled'))}`);
      assert.match(copied, /claude mcp add/, 'and the setup is copied');
    });
  }
});
