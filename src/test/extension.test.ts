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
    // Settings are grouped into titled sections; read them as one map.
    const sections: Array<{ title?: string; properties: Record<string, never> }> =
      extension.packageJSON.contributes?.configuration ?? [];
    assert.ok(sections.every((section) => section.title), 'every group has a title');
    const settings: Record<string, { default?: unknown; enum?: unknown[] }> =
      Object.assign({}, ...sections.map((section) => section.properties));
    assert.strictEqual(Object.keys(settings).length, 54);
    // Where one note ends and the next begins.
    assert.deepStrictEqual(settings['deckard.noteBoundaries'].enum, [
      'line',
      'heading',
      'marked',
    ]);
    assert.strictEqual(settings['deckard.noteBoundaries'].default, 'line');
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
        'deckard.pinNote',
        'deckard.unpinNote',
        'deckard.previousDailyNote',
        'deckard.nextDailyNote',
        'deckard.openWeeklyNote',
        'deckard.openMonthlyNote',
        'deckard.editTask',
        'deckard.addTask',
        'deckard.capture',
        'deckard.captureUnderHeading',
        'deckard.writeReview',
        'deckard.rollTasksForward',
        'deckard.newNoteFromTemplate',
        'deckard.copyMcpSetup',
        'deckard.resetMcpToken',
        'deckard.extractHeading',
        'deckard.showTagOverview',
        'deckard.search',
        'deckard.searchWorkspace',
        'deckard.quickFind.complete',
        'deckard.searchNotes',
        'deckard.linkCurrentHeading',
        'deckard.moveTagsToFrontmatter',
        'deckard.renameTag',
        'deckard.mergeTag',
        'deckard.renameHeading',
        'deckard.undoLastChange',
        'deckard.showEntryRelatedNotesDebug',
        'deckard.outline.revealSection',
        'deckard.outline.openTagOverview',
        'deckard.outline.renameTag',
        'deckard.agenda.editQuery',
        'deckard.agenda.setGrouping',
        'deckard.outline.enableFollowCursor',
        'deckard.outline.disableFollowCursor',
        'deckard.enableZenMode',
        'deckard.disableZenMode',
        'deckard.tidyPreferences',
        'deckard.exportPreferences',
        'deckard.importPreferences',
        'deckard.restorePreferences',
        'deckard.checkSetup',
        'deckard.createSampleWorkspace',
        'deckard.agenda.editTask',
        'deckard.agenda.dueToday',
        'deckard.agenda.dueTomorrow',
        'deckard.agenda.dueNextWeek',
        'deckard.agenda.dueOnDate',
        'deckard.agenda.reschedule',
        'deckard.rescheduleOverdue',
      ],
    );
    assert.strictEqual(
      settings[
        'deckard.notesFolder'
      ].default,
      '',
    );
    assert.deepStrictEqual(settings['deckard.exclude'].default, {});
    assert.strictEqual(
      settings[
        'deckard.parseInlineTags'
      ].default,
      true,
    );
    assert.strictEqual(
      settings[
        'deckard.highlightNoteSections'
      ].default,
      true,
    );
    assert.strictEqual(
      settings[
        'deckard.autoSelectNoteSections'
      ].default,
      true,
    );
    assert.strictEqual(
      settings[
        'deckard.tagTitleDisplayMode'
      ].default,
      'inline',
    );
    assert.deepStrictEqual(
      settings[
        'deckard.tagTitleDisplayMode'
      ].enum,
      ['inline', 'separate'],
    );
    assert.strictEqual(
      settings[
        'deckard.enableHeadingTagRelationships'
      ].default,
      true,
    );
    assert.strictEqual(
      settings[
        'deckard.enableKeywordLinks'
      ].default,
      true,
    );
    assert.strictEqual(
      settings[
        'deckard.enableTagAutocomplete'
      ].default,
      true,
    );
    assert.deepStrictEqual(
      settings[
        'deckard.entityNamespaceAliases'
      ].default,
      { org: 'organization' },
    );
    assert.strictEqual(
      settings[
        'deckard.personMarker'
      ].default,
      '@',
    );
    assert.strictEqual(
      settings[
        'deckard.dashboard.openOnStartup'
      ].default,
      false,
    );
    assert.strictEqual(
      settings[
        'deckard.tagOverview.hubNoteExpanded'
      ].default,
      true,
    );
    assert.ok(
      extension.packageJSON.contributes?.views?.deckard?.some(
        (view: { id: string; name: string; type: string }) =>
          view.id === 'deckard.relatedNotes' &&
          view.name === 'Related Notes' &&
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
    assert.ok(
      (await vscode.commands.getCommands(true)).includes(
        'deckard.createMissingNotes',
      ),
    );
    assert.ok(
      (await vscode.commands.getCommands(true)).includes('deckard.linkMentions'),
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
      // A tagged heading also counts the entries elsewhere that share one of
      // its tags. No other note here carries #project/atlas, and a heading
      // with nothing to show gets no lens at all.
      assert.ok(
        !titles.some((title) => title?.includes('share a tag')),
        JSON.stringify(titles),
      );
    } finally {
      await vscode.workspace.fs.delete(fileUri);
    }
  });

  test('says above a task what it waits on and what it holds up', async () => {
    const extension = vscode.extensions.all.find(
      (candidate) => candidate.packageJSON.name === 'deckard-notes',
    );
    assert.ok(extension);
    await extension.activate();

    const fileUri = vscode.Uri.file(
      path.join(os.tmpdir(), `deckard-dependencies-${Date.now()}.md`),
    );
    await vscode.workspace.fs.writeFile(
      fileUri,
      Buffer.from(
        [
          '# Plan',
          '- [ ] Draft 🆔 draft',
          '- [ ] Send ⛔ draft',
          '- [ ] Book ⛔ nowhere',
          '- [ ] Plain',
          '',
        ].join('\n'),
        'utf8',
      ),
    );
    try {
      await vscode.workspace.openTextDocument(fileUri);
      const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
        'vscode.executeCodeLensProvider',
        fileUri,
        20,
      );
      const titles = lenses.map(
        (lens) => `${lens.range.start.line}: ${lens.command?.title}`,
      );
      for (const expected of [
        '1: Blocks 1 open task',
        '2: Waiting on 1 open task',
        '3: No task has 🆔 nowhere',
      ]) {
        assert.ok(titles.includes(expected), JSON.stringify(titles));
      }
      // The plain task gets nothing of its own.
      assert.ok(!titles.some((title) => title.startsWith('4:')), JSON.stringify(titles));
    } finally {
      await vscode.workspace.fs.delete(fileUri);
    }
  });

  test('says above an embed what the preview cannot draw', async () => {
    const extension = vscode.extensions.all.find(
      (candidate) => candidate.packageJSON.name === 'deckard-notes',
    );
    assert.ok(extension);
    await extension.activate();

    const fileUri = vscode.Uri.file(
      path.join(os.tmpdir(), `deckard-embeds-${Date.now()}.md`),
    );
    await vscode.workspace.fs.writeFile(
      fileUri,
      Buffer.from('# Plan\n![[#Plan]]\n![[#Nowhere]]\n', 'utf8'),
    );
    try {
      await vscode.workspace.openTextDocument(fileUri);
      const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
        'vscode.executeCodeLensProvider',
        fileUri,
        20,
      );
      const titles = lenses.map(
        (lens) => `${lens.range.start.line}: ${lens.command?.title}`,
      );
      assert.ok(
        titles.includes('2: Embed: This note has no heading "Nowhere"'),
        JSON.stringify(titles),
      );
      assert.ok(!titles.some((title) => title.startsWith('1:')), JSON.stringify(titles));
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

  test('registers its tools for AI assistants', async () => {
    const extension = vscode.extensions.all.find(
      (candidate) => candidate.packageJSON.name === 'deckard-notes',
    );
    assert.ok(extension);
    assert.deepStrictEqual(
      (extension.packageJSON.contributes?.languageModelTools ?? []).map(
        (tool: { name: string }) => tool.name,
      ),
      ['deckard_query', 'deckard_list_tags', 'deckard_add_task', 'deckard_change_task'],
    );
    await extension.activate();

    // Calling a tool first asks the user to allow it, so this checks that
    // both are registered; the calls themselves are tested directly.
    const registered = vscode.lm.tools.map((tool) => tool.name);
    assert.ok(registered.includes('deckard_query'), JSON.stringify(registered));
    assert.ok(registered.includes('deckard_list_tags'));
  });
});
