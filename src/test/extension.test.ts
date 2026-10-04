import * as assert from 'assert';
import { readFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  test('puts Deckard in a note\'s title bar, and the days beside a daily note', () => {
    const extension = vscode.extensions.all.find(
      (candidate) => candidate.packageJSON.name === 'deckard-notes',
    );
    assert.ok(extension);
    const menus: Record<string, Array<{ command?: string; submenu?: string; when?: string; group?: string }>> =
      extension.packageJSON.contributes.menus;
    const title = (command: string) =>
      menus['editor/title'].filter((entry) => entry.command === command).map((entry) => [entry.when, entry.group]);
    assert.deepStrictEqual(title('deckard.previousDailyNote'), [
      ['resourceLangId == markdown && deckard.isDailyNote', 'navigation@10'],
    ]);
    assert.deepStrictEqual(title('deckard.nextDailyNote'), [
      ['resourceLangId == markdown && deckard.isDailyNote', 'navigation@11'],
    ]);
    assert.deepStrictEqual(title('deckard.noteActions'), [
      ['resourceLangId == markdown && deckard.isNote', 'navigation@12'],
    ]);
    // A note's context menu has one Deckard submenu, grouped by what it acts on.
    assert.deepStrictEqual(menus['editor/context'], [
      { submenu: 'deckard.editor.context', when: 'resourceLangId == markdown && deckard.isNote', group: 'z_deckard@1' },
    ]);
    assert.deepStrictEqual(
      menus['deckard.editor.context'].map((entry) => `${entry.group} ${entry.command}`),
      [
        '1_task@1 deckard.toggleTaskDone',
        '1_task@2 deckard.editTask',
        '1_task@3 deckard.breakIntoSteps',
        '1_task@4 deckard.addTask',
        '2_heading@1 deckard.renameHeading',
        '2_heading@2 deckard.extractHeading',
        '2_heading@3 deckard.focusSection',
        '3_move@1 deckard.moveTo',
        '3_move@2 deckard.copyAsPlainMarkdown',
        '3_move@3 deckard.openNotePage',
        '4_pin@1 deckard.pinNote',
        '4_pin@2 deckard.unpinNote',
        '4_pin@3 deckard.parkNote',
        '4_pin@4 deckard.unparkNote',
      ],
    );
    // A folder in the Explorer can take a note, or leave Deckard and come back.
    // A note there can be parked, or unparked.
    assert.deepStrictEqual(menus['explorer/context'], [
      { submenu: 'deckard.explorer.context', when: 'explorerResourceIsFolder || resourceExtname == .md', group: 'z_deckard@1' },
    ]);
    assert.deepStrictEqual(
      menus['deckard.explorer.context'].map((entry) => [entry.command, entry.when]),
      [
        ['deckard.newNoteFromTemplateHere', 'explorerResourceIsFolder'],
        ['deckard.excludeFromIndex', 'explorerResourceIsFolder && resourcePath not in deckard.excludedFolders'],
        ['deckard.includeInIndex', 'explorerResourceIsFolder && resourcePath in deckard.excludedFolders'],
        ['deckard.parkNote', 'resourceExtname == .md && !(resourcePath in deckard.parkedNotes)'],
        ['deckard.unparkNote', 'resourceExtname == .md && resourcePath in deckard.parkedNotes'],
        ['deckard.parkFolder', 'explorerResourceIsFolder && !(resourcePath in deckard.parkedFolders)'],
        ['deckard.unparkFolder', 'explorerResourceIsFolder && resourcePath in deckard.parkedFolders'],
      ],
    );
    assert.deepStrictEqual(
      menus['editor/title/context'].map((entry) => entry.command),
      ['deckard.parkNote', 'deckard.unparkNote'],
    );
    assert.deepStrictEqual(
      menus['file/newFile'].map((entry) => entry.command),
      ['deckard.createDailyNote', 'deckard.newNoteFromTemplate'],
    );
    // Zen is one button on every Deckard page.
    assert.deepStrictEqual(title('deckard.enableZenMode'), [
      ['activeWebviewPanelId =~ /^deckard\\./ && !deckard.zenMode', 'navigation@90'],
    ]);
    assert.deepStrictEqual(title('deckard.disableZenMode'), [
      ['activeWebviewPanelId =~ /^deckard\\./ && deckard.zenMode', 'navigation@90'],
    ]);
  });

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
    assert.strictEqual(Object.keys(settings).length, 84);
    assert.strictEqual(settings['deckard.calendar.dayPanel'].default, false);
    assert.strictEqual(settings['deckard.calendar.showRepeats'].default, true);
    assert.deepStrictEqual(settings['deckard.parked.tags'].default, ['parked']);
    assert.deepStrictEqual(settings['deckard.parked.folders'].default, {});
    assert.deepStrictEqual(settings['deckard.periodicNote.reviewSections'].default, []);
    assert.deepStrictEqual(settings['deckard.board.limits'].default, {});
    assert.deepStrictEqual(settings['deckard.tasks.onHoldStatuses'].default, ['waiting', 'someday']);
    assert.strictEqual(settings['deckard.tasks.needsNewDateAfterDays'].default, 30);
    // The day a week starts on.
    assert.deepStrictEqual(settings['deckard.calendar.weekStart'].enum, ['sunday', 'monday', 'locale']);
    assert.strictEqual(settings['deckard.calendar.weekStart'].default, 'sunday');
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
        'deckard.goTo',
        'deckard.showNotesGraph',
        'deckard.showNotesGraphAroundNote',
        'deckard.showTaskBoard',
        'deckard.showCalendar',
        'deckard.calendar.openInEditor',
        'deckard.showStats',
        'deckard.showHelp',
        'deckard.openWalkthrough',
        'deckard.openWhatsNew',
        'deckard.showLog',
        'deckard.reindexWorkspace',
        'deckard.createHubNoteForTag',
        'deckard.pauseHere',
        'deckard.resumeHere',
        'deckard.chooseScope',
        'deckard.chooseEditorPreset',
        'deckard.createDailyNote',
        'deckard.pinNote',
        'deckard.unpinNote',
        'deckard.previousDailyNote',
        'deckard.nextDailyNote',
        'deckard.openDailyNoteForDate',
        'deckard.openWeeklyNote',
        'deckard.openMonthlyNote',
        'deckard.noteActions',
        'deckard.editTask',
        'deckard.breakIntoSteps',
        'deckard.addTask',
        'deckard.toggleTaskDone',
        'deckard.capture',
        'deckard.captureUnderHeading',
        'deckard.writeReview',
        'deckard.rollTasksForward',
        'deckard.newNoteFromTemplate',
        'deckard.newNoteFromTemplateHere',
        'deckard.excludeFromIndex',
        'deckard.includeInIndex',
        'deckard.parkNote',
        'deckard.unparkNote',
        'deckard.parkFolder',
        'deckard.unparkFolder',
        'deckard.parkTag',
        'deckard.unparkTag',
        'deckard.copyMcpSetup',
        'deckard.resetMcpToken',
        'deckard.moveTo',
        'deckard.extractHeading',
        'deckard.copyAsPlainMarkdown',
        'deckard.openNotePage',
        'deckard.openNote',
        'deckard.hubs.openInEditor',
        'deckard.hubs.openAsPage',
        'deckard.quickFind.openOther',
        'deckard.showTagOverview',
        'deckard.search',
        'deckard.insertQueryBlock',
        'deckard.searchWorkspace',
        'deckard.quickFind.complete',
        'deckard.quickFind.openBeside',
        'deckard.quickFind.insertLink',
        'deckard.quickFind.actions',
        'deckard.searchNotes',
        'deckard.linkCurrentHeading',
        'deckard.moveTagsToFrontmatter',
        'deckard.renameTag',
        'deckard.mergeTag',
        'deckard.renameHeading',
        'deckard.undoLastChange',
        'deckard.showEntryRelatedNotesDebug',
        'deckard.hubs.openHubNote',
        'deckard.agenda.editQuery',
        'deckard.clearAgendaQuery',
        'deckard.agenda.setGrouping',
        'deckard.focusSection',
        'deckard.unfoldAllSections',
        'deckard.outline.enableFollowCursor',
        'deckard.outline.disableFollowCursor',
        'deckard.outline.filterByTag',
        'deckard.outline.clearTagFilter',
        'deckard.chooseTheme',
        'deckard.enableZenMode',
        'deckard.disableZenMode',
        'deckard.tidyPreferences',
        'deckard.exportTaskCalendar',
        'deckard.exportPreferences',
        'deckard.importPreferences',
        'deckard.restorePreferences',
        'deckard.checkSetup',
        'deckard.createSampleWorkspace',
        'deckard.createWorkSample',
        'deckard.agenda.editTask',
        'deckard.agenda.breakIntoSteps',
        'deckard.agenda.dueToday',
        'deckard.agenda.dueTomorrow',
        'deckard.agenda.dueNextWeek',
        'deckard.agenda.dueOnDate',
        'deckard.agenda.moveTo',
        'deckard.agenda.reschedule',
        'deckard.rescheduleOverdue',
        'deckard.agenda.showMore',
        'deckard.calendar.openDayPanel',
        'deckard.calendar.closeDayPanel',
        'deckard.calendar.hideWeekends',
        'deckard.calendar.includeWeekends',
        'deckard.calendar.showRepeats',
        'deckard.calendar.hideRepeats',
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
          view.name === 'Context' &&
          view.type === 'webview',
      ),
    );
    assert.ok(
      extension.packageJSON.contributes?.viewsContainers?.activitybar?.some(
        (container: { id: string }) => container.id === 'deckard',
      ),
    );
  });

  test('walks a new reader through six steps it can check off, links before tasks', async () => {
    const extension = vscode.extensions.all.find(
      (candidate) => candidate.packageJSON.name === 'deckard-notes',
    );
    assert.ok(extension);
    const root = extension.extensionPath;
    const contributes = extension.packageJSON.contributes;
    const steps: Array<{
      id: string;
      description: string;
      media: { image?: string | Record<string, string>; markdown?: string; altText?: string };
      completionEvents?: string[];
    }> = contributes.walkthroughs[0].steps;
    assert.deepStrictEqual(
      steps.map((step) => step.id.replace('deckard.walkthrough.', '')),
      ['openNote', 'addTags', 'linkNotes', 'search', 'captureTask', 'openHome'],
    );
    const commands = new Set<string>(contributes.commands.map((command: { command: string }) => command.command));
    const views = new Set<string>(
      Object.values(contributes.views as Record<string, Array<{ id: string }>>).flat().map((view) => `${view.id}.focus`),
    );
    // The composition root sets the walkthrough's context keys, in its two
    // halves.
    const compiled = ['extension.js', path.join('composition', 'services.js')]
      .map((file) => readFileSync(path.join(root, 'out', file), 'utf8'))
      .join('\n');
    const registered = new Set(await vscode.commands.getCommands(true));
    let total = 0;
    for (const step of steps) {
      for (const match of step.description.matchAll(/\(command:([\w.]+)/g)) {
        const id = match[1];
        // Deckard's own links name a contributed command or view; another,
        // such as extension.open for Esper Themes, is one VS Code registers.
        const known = id.startsWith('deckard.')
          ? commands.has(id) || views.has(id)
          : registered.has(id);
        assert.ok(known, `${step.id} links ${id}`);
      }
      for (const event of step.completionEvents ?? []) {
        const key = /^onContext:(.+)$/.exec(event)?.[1];
        if (key) {
          assert.ok(compiled.includes(`'setContext', '${key}'`), `${step.id} waits on ${key}, which is set`);
        }
      }
      const media = step.media.image ?? step.media.markdown;
      const paths = typeof media === 'string' ? [media] : Object.values(media ?? {});
      for (const file of new Set(paths)) {
        const { size } = (await import('fs')).statSync(path.join(root, file));
        if (file.endsWith('.png')) {
          assert.ok(size <= 150 * 1024, `${file} is at most 150 KB`);
          total += size;
        }
      }
      if (step.media.image) {
        assert.ok(step.media.altText, `${step.id} says what its image shows`);
      }
    }
    assert.ok(total <= 1024 * 1024, 'the walkthrough images come to at most 1 MB');
    await extension.activate();
    assert.ok((await vscode.commands.getCommands(true)).includes('deckard.openWalkthrough'));
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

  test('draws no lenses in a Markdown file outside every workspace folder', async () => {
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
      // It is not a note, so Deckard's counts stay out of it; the counts
      // themselves are held in editor-references.test.ts.
      const titles = lenses.map((lens) => lens.command?.title);
      assert.deepStrictEqual(titles, []);
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
