import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

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
        'deckard.showTaskBoard',
        'deckard.showStats',
        'deckard.showHelp',
        'deckard.showLog',
        'deckard.reindexWorkspace',
        'deckard.createDailyNote',
        'deckard.extractHeading',
        'deckard.showTagOverview',
        'deckard.searchWorkspace',
        'deckard.searchNotes',
        'deckard.linkCurrentHeading',
        'deckard.moveTagsToFrontmatter',
        'deckard.renameTag',
        'deckard.mergeTag',
        'deckard.showEntryRelatedNotesDebug',
        'deckard.outline.revealSection',
        'deckard.outline.openTagOverview',
        'deckard.outline.renameTag',
        'deckard.outline.enableFollowCursor',
        'deckard.outline.disableFollowCursor',
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
    assert.strictEqual(
      extension.packageJSON.contributes?.configuration?.properties[
        'deckard.dashboard.openOnStartup'
      ].default,
      false,
    );
    assert.strictEqual(
      extension.packageJSON.contributes?.configuration?.properties[
        'deckard.tagOverview.hubNoteExpanded'
      ].default,
      true,
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

  test('counts the open tasks under a heading above it in the editor', async () => {
    const extension = vscode.extensions.all.find(
      (candidate) => candidate.packageJSON.name === 'deckard-notes',
    );
    assert.ok(extension);
    await extension.activate();

    const fileUri = vscode.Uri.file(
      path.join(os.tmpdir(), `deckard-references-${Date.now()}.md`),
    );
    await vscode.workspace.fs.writeFile(
      fileUri,
      Buffer.from('# Plan #project/atlas\n- [ ] Ship it\n- [x] Draft it\n', 'utf8'),
    );
    try {
      // The command asks the editor for lenses, so the document must be loaded.
      await vscode.workspace.openTextDocument(fileUri);
      const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
        'vscode.executeCodeLensProvider',
        fileUri,
        10,
      );
      const titles = lenses.map((lens) => lens.command?.title);
      assert.ok(titles.includes('1 open task'), JSON.stringify(titles));
      // A tagged heading also counts its Related Notes; this workspace has none.
      assert.ok(titles.includes('No related entries'), JSON.stringify(titles));
    } finally {
      await vscode.workspace.fs.delete(fileUri);
    }
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
