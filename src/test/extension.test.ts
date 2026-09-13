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
    assert.ok(activationEvents.includes('onWebviewPanel:deckard.stats'));
    assert.ok(activationEvents.includes('onWebviewPanel:deckard.help'));
    const commands = extension.packageJSON.contributes?.commands ?? [];
    assert.deepStrictEqual(
      commands.map((command: { command: string }) => command.command),
      [
        'deckard.showDashboard',
        'deckard.showNotesGraph',
        'deckard.showStats',
        'deckard.showHelp',
        'deckard.reindexWorkspace',
        'deckard.createDailyNote',
        'deckard.extractHeading',
        'deckard.showTagOverview',
        'deckard.searchWorkspace',
        'deckard.searchNotes',
        'deckard.linkCurrentHeading',
        'deckard.moveTagsToFrontmatter',
        'deckard.renameTag',
        'deckard.showEntryRelatedNotesDebug',
      ],
    );
    assert.strictEqual(
      extension.packageJSON.contributes?.configuration?.properties[
        'deckard.notesFolder'
      ].default,
      '',
    );
    assert.strictEqual(
      extension.packageJSON.contributes?.configuration?.properties[
        'deckard.parseInlineTags'
      ].default,
      true,
    );
    assert.strictEqual(
      extension.packageJSON.contributes?.configuration?.properties[
        'deckard.highlightNoteSections'
      ].default,
      true,
    );
    assert.strictEqual(
      extension.packageJSON.contributes?.configuration?.properties[
        'deckard.autoSelectNoteSections'
      ].default,
      true,
    );
    assert.strictEqual(
      extension.packageJSON.contributes?.configuration?.properties[
        'deckard.tagTitleDisplayMode'
      ].default,
      'inline',
    );
    assert.deepStrictEqual(
      extension.packageJSON.contributes?.configuration?.properties[
        'deckard.tagTitleDisplayMode'
      ].enum,
      ['inline', 'separate'],
    );
    assert.strictEqual(
      extension.packageJSON.contributes?.configuration?.properties[
        'deckard.enableHeadingTagRelationships'
      ].default,
      true,
    );
    assert.strictEqual(
      extension.packageJSON.contributes?.configuration?.properties[
        'deckard.enableKeywordLinks'
      ].default,
      true,
    );
    assert.strictEqual(
      extension.packageJSON.contributes?.configuration?.properties[
        'deckard.enableTagAutocomplete'
      ].default,
      true,
    );
    assert.deepStrictEqual(
      extension.packageJSON.contributes?.configuration?.properties[
        'deckard.entityNamespaceAliases'
      ].default,
      { org: 'organization' },
    );
    assert.strictEqual(
      extension.packageJSON.contributes?.configuration?.properties[
        'deckard.personMarker'
      ].default,
      '@',
    );
    assert.ok(
      extension.packageJSON.contributes?.views?.deckard?.some(
        (view: { id: string; name: string; type: string }) =>
          view.id === 'deckard.relatedNotes' &&
          view.name === 'Deckard' &&
          view.type === 'webview',
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
      (await vscode.commands.getCommands(true)).includes('deckard.showStats'),
    );
    assert.ok(
      (await vscode.commands.getCommands(true)).includes('deckard.showHelp'),
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
    assert.ok(
      (await vscode.commands.getCommands(true)).includes(
        'deckard.searchWorkspace',
      ),
    );
    assert.ok(
      (await vscode.commands.getCommands(true)).includes('deckard.renameTag'),
    );
    assert.ok(
      (await vscode.commands.getCommands(true)).includes(
        'deckard.showEntryRelatedNotes',
      ),
    );
  });

  test('draws deckard query blocks in the Markdown preview engine', async () => {
    const extension = vscode.extensions.all.find(
      (candidate) => candidate.packageJSON.name === 'deckard-notes',
    );
    assert.ok(extension);
    assert.strictEqual(
      extension.packageJSON.contributes?.['markdown.markdownItPlugins'],
      true,
    );
    await extension.activate();

    // The built-in Markdown extension renders with every contributed plugin,
    // so this checks the export VS Code actually loads, not just the plugin.
    const html = await vscode.commands.executeCommand<string>(
      'markdown.api.render',
      '```deckard\ntag = #project/atlas\n```\n\n```js\nconst answer = 42;\n```\n',
    );
    assert.strictEqual(html.split('class="deckard-query-header"').length, 2);
    assert.ok(html.includes('answer'));
  });
});
