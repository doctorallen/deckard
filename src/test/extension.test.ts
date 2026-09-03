import * as assert from 'assert';

import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  test('contributes the Deckard commands and settings', () => {
    const extension = vscode.extensions.all.find(
      (candidate) => candidate.packageJSON.name === 'deckard-notes',
    );
    assert.ok(extension);
    const activationEvents = extension.packageJSON.activationEvents ?? [];
    assert.ok(activationEvents.includes('onWebviewPanel:deckard.dashboard'));
    assert.ok(activationEvents.includes('onWebviewPanel:deckard.tagOverview'));
    const commands = extension.packageJSON.contributes?.commands ?? [];
    assert.deepStrictEqual(
      commands.map((command: { command: string }) => command.command),
      [
        'deckard.showDashboard',
        'deckard.reindexWorkspace',
        'deckard.createDailyNote',
        'deckard.extractHeading',
        'deckard.showTagOverview',
      ],
    );
    assert.strictEqual(
      extension.packageJSON.contributes?.configuration?.properties[
        'deckard.notesFolder'
      ].default,
      'notes',
    );
    assert.strictEqual(
      extension.packageJSON.contributes?.configuration?.properties[
        'deckard.parseInlineTags'
      ].default,
      true,
    );
    assert.ok(
      extension.packageJSON.contributes?.views?.deckard?.some(
        (view: { id: string; type: string }) =>
          view.id === 'deckard.relatedNotes' && view.type === 'webview',
      ),
    );
    assert.ok(
      extension.packageJSON.contributes?.viewsContainers?.activitybar?.some(
        (container: { id: string }) => container.id === 'deckard',
      ),
    );
  });

  test('activates and registers the dashboard command', async () => {
    const extension = vscode.extensions.all.find(
      (candidate) => candidate.packageJSON.name === 'deckard-notes',
    );
    assert.ok(extension);
    await extension.activate();
    assert.ok(
      (await vscode.commands.getCommands(true)).includes(
        'deckard.showDashboard',
      ),
    );
    assert.ok(
      (await vscode.commands.getCommands(true)).includes(
        'deckard.reindexWorkspace',
      ),
    );
    assert.ok(
      (await vscode.commands.getCommands(true)).includes(
        'deckard.extractHeading',
      ),
    );
  });
});
