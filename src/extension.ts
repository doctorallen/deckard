import * as vscode from 'vscode';

import { openDailyNoteForDate } from './ui/commands/dailyNoteForDate';
import { capture } from './ui/commands/capture';
import { openAdjacentDailyNote } from './ui/commands/dailyNote';
import { createDailyNoteWithRollover, rollTasksForward } from './ui/commands/rollover';
import { openPeriodicNoteWithReview, writeReviewCommand } from './ui/commands/review';
import { editTaskCommand } from './ui/commands/taskEditor';
import { breakIntoStepsCommand, readTaskArgument } from './ui/commands/taskSteps';
import { newNoteFromTemplate } from './ui/commands/templates';
import { toggleTaskDoneCommand } from './ui/commands/toggleTaskDone';
import { noteActionsCommand } from './ui/commands/noteActions';
import { excludeFolderCommand, includeFolderCommand } from './ui/commands/excludeFolders';
import { parkFolders, parkNotes, parkTag, unparkFolders, unparkNotes, unparkTag } from './ui/commands/parking';
import { extractHeadingCommand } from './ui/commands/extractHeading';
import { moveToCommand } from './ui/commands/moveTo';
import {
  CREATE_LINKED_NOTE_COMMAND,
  CREATE_MISSING_NOTES_COMMAND,
  createLinkedNote,
  createMissingNotes,
} from './ui/commands/linkHealth';
import { linkCurrentHeading } from './ui/commands/linkEntity';
import { setNotePinnedCommand } from './ui/commands/pinNote';
import { getAgendaQuery, pickAgendaGrouping, registerAgendaCommands } from './ui/commands/agendaActions';
import { renameHeadingCommand } from './ui/commands/linkMaintenance';
import { moveInlineTagsToFrontmatter } from './ui/commands/moveTagsToFrontmatter';
import { mergeIndexedTag, renameIndexedTag } from './ui/commands/renameTag';
import { isMarkdownDocument } from './ui/providers/tagDecorations';
import { LINK_MENTIONS_COMMAND, linkMentions } from './ui/commands/unlinkedMentions';
import { readNotesGraphOptions } from './ui/webview/notesGraph';
import { SearchPanels } from './ui/webview/searchPage';
import { setZenMode } from './ui/webview/zenMode';
import { tidyPreferences } from './ui/commands/tidyPreferences';
import { checkSetup } from './ui/commands/checkSetup';
import { createSampleWorkspace } from './ui/commands/sampleWorkspace';
import { exportPreferences, importPreferences, restorePreferences } from './ui/commands/preferenceBackups';
import { pickOutlineTag, setOutlineFollowCursor } from './ui/views/outlineTree';
import { OutlineNode } from './ui/state/outlineState';
import type { IndexReader } from './core/workspace/indexReader';
import { QueryBlocks } from './ui/preview/queryBlocks';
import { insertQueryBlock } from './ui/commands/insertQueryBlock';
import { chooseTheme, createChooseThemeDeps } from './ui/commands/chooseTheme';
import { settingTarget, writeSetting } from './ui/commands/settings';
import { createServices, startServices } from './composition/services';

/**
 * What the extension exports. VS Code's Markdown preview calls
 * `extendMarkdownIt` to draw ```deckard query blocks.
 */
export interface DeckardExports {
  extendMarkdownIt: QueryBlocks['extendMarkdownIt'];
}

/**
 * Creates the extension's service graph and registers every VS Code entrypoint.
 *
 * Keeping services alive from one activation boundary lets panels, the sidebar,
 * decorations, and completion all observe the same index and preference store.
 */
export function activate(context: vscode.ExtensionContext): DeckardExports {
  const services = createServices(context);
  const { log, whatsNew, tryNext, history, scanner, indexer, themePreview, quickFind, mcpServer, sectionFocus } = services;
  const { repository: preferences, pins: preferencePins, maintenance, snapshots, move: movePreferences } = services.preferences;
  const {
    tasks: taskWrites,
    tags: tagWrites,
    parking: parkingCommands,
    rollover,
    reviews: reviewWrites,
    templates,
    capture: captureContext,
  } = services.writes;
  const { service: links, notes: linkNotes } = services.links;
  const { search: searchPanels, dashboard, stats, help, notesGraph, relatedNotesDebug, calendar: calendarPage, taskBoard } =
    services.pages;
  const { sidebarNotes, calendar, outline, agenda } = services.views;
  const agendaService = services.agenda;
  context.subscriptions.push(
    vscode.commands.registerCommand('deckard.showLog', () => log.show()),
  );
  context.subscriptions.push(
    ...registerAgendaCommands({ view: agenda, agenda: agendaService, writes: taskWrites, indexer, preferences: movePreferences }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'deckard.outline.revealSection',
      (node?: unknown) => {
        const outlineNode = asOutlineNode(node);
        return outlineNode ? outline.revealSection(outlineNode) : undefined;
      },
    ),
    vscode.commands.registerCommand(
      'deckard.outline.openTagOverview',
      async (node?: unknown) => {
        const tagKey = await pickOutlineTag(
          asOutlineNode(node),
          'Choose a tag from this heading',
        );
        if (tagKey) {
          await searchPanels.show(tagKey);
        }
      },
    ),
    vscode.commands.registerCommand(
      'deckard.outline.renameTag',
      async (node?: unknown) => {
        const tagKey = await pickOutlineTag(
          asOutlineNode(node),
          'Choose a tag to rename',
        );
        if (tagKey) {
          await renameIndexedTag(indexer, tagKey, tagWrites);
        }
      },
    ),
    vscode.commands.registerCommand('deckard.focusSection', async (node?: unknown) => {
      const outlineNode = asOutlineNode(node);
      if (outlineNode) {
        await outline.revealSection(outlineNode);
      }
      await sectionFocus.focus(outlineNode?.line);
    }),
    vscode.commands.registerCommand('deckard.unfoldAllSections', () =>
      sectionFocus.unfoldAll(),
    ),
    vscode.commands.registerCommand('deckard.outline.filterByTag', async (node?: unknown) => {
      const outlineNode = asOutlineNode(node);
      if (outlineNode) {
        const key = await pickOutlineTag(outlineNode, 'Choose a tag to filter the Outline by');
        const tag = outlineNode.tags.find((candidate) => candidate.key === key);
        if (tag) {
          outline.setTagFilter(tag);
        }
        return;
      }
      const tags = outline.listTags();
      if (tags.length === 0) {
        void vscode.window.showInformationMessage('No heading in this note carries a tag to filter by.');
        return;
      }
      const chosen = await vscode.window.showQuickPick(
        tags.map((tag) => ({ label: tag.label, tag })),
        { placeHolder: 'Show only the headings that carry a tag' },
      );
      if (chosen) {
        outline.setTagFilter(chosen.tag);
      }
    }),
    vscode.commands.registerCommand('deckard.outline.clearTagFilter', () =>
      outline.setTagFilter(undefined),
    ),
    // The day panel is a setting, turned on and off from the Calendar's own
    // menu, and written where it is already set.
    vscode.commands.registerCommand('deckard.calendar.openDayPanel', () =>
      writeSetting('calendar.dayPanel', true, settingTarget('calendar.dayPanel')),
    ),
    vscode.commands.registerCommand('deckard.calendar.closeDayPanel', () =>
      writeSetting('calendar.dayPanel', false, settingTarget('calendar.dayPanel')),
    ),
    // Weekends, and repeats, the same way.
    vscode.commands.registerCommand('deckard.calendar.hideWeekends', () =>
      writeSetting('calendar.showWeekends', false, settingTarget('calendar.showWeekends')),
    ),
    vscode.commands.registerCommand('deckard.calendar.includeWeekends', () =>
      writeSetting('calendar.showWeekends', true, settingTarget('calendar.showWeekends')),
    ),
    vscode.commands.registerCommand('deckard.calendar.showRepeats', () =>
      writeSetting('calendar.showRepeats', true, settingTarget('calendar.showRepeats')),
    ),
    vscode.commands.registerCommand('deckard.calendar.hideRepeats', () =>
      writeSetting('calendar.showRepeats', false, settingTarget('calendar.showRepeats')),
    ),
    vscode.commands.registerCommand('deckard.agenda.setGrouping', () =>
      pickAgendaGrouping(agendaService, indexer.getSnapshot()),
    ),
    // The board is the search editor: the view's search opens there to be
    // tried and changed, and its Tasks view button keeps it.
    vscode.commands.registerCommand('deckard.agenda.editQuery', () =>
      taskBoard.show(getAgendaQuery()),
    ),
    vscode.commands.registerCommand('deckard.clearAgendaQuery', async () => {
      if (await writeSetting('agenda.query', undefined, settingTarget('agenda.query'))) {
        void vscode.window.showInformationMessage('The Tasks view lists every open task again.');
      }
    }),
    vscode.commands.registerCommand('deckard.outline.enableFollowCursor', () =>
      setOutlineFollowCursor(true),
    ),
    vscode.commands.registerCommand('deckard.outline.disableFollowCursor', () =>
      setOutlineFollowCursor(false),
    ),
    vscode.commands.registerCommand('deckard.enableZenMode', () =>
      setZenMode(true),
    ),
    vscode.commands.registerCommand('deckard.disableZenMode', () =>
      setZenMode(false),
    ),
    vscode.commands.registerCommand('deckard.tidyPreferences', () =>
      tidyPreferences(indexer, maintenance),
    ),
    vscode.commands.registerCommand('deckard.exportPreferences', () =>
      exportPreferences({ reader: preferences, maintenance }),
    ),
    vscode.commands.registerCommand('deckard.importPreferences', () =>
      importPreferences({ reader: preferences, maintenance }),
    ),
    vscode.commands.registerCommand('deckard.restorePreferences', () =>
      restorePreferences({ reader: preferences, maintenance }, snapshots),
    ),
    vscode.commands.registerCommand('deckard.checkSetup', () =>
      checkSetup(indexer, scanner),
    ),
    vscode.commands.registerCommand('deckard.createSampleWorkspace', () =>
      createSampleWorkspace(context),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('deckard.showDashboard', () =>
      dashboard.show(),
    ),
    vscode.commands.registerCommand('deckard.showStats', () => stats.show()),
    // A page may open Help at the section about it, such as the calendar's.
    vscode.commands.registerCommand('deckard.showHelp', (anchor?: unknown) =>
      help.show(typeof anchor === 'string' && /^[\w-]+$/.test(anchor) ? anchor : undefined),
    ),
    vscode.commands.registerCommand('deckard.chooseTheme', () =>
      chooseTheme(context.extension.packageJSON.contributes, createChooseThemeDeps(themePreview)),
    ),
    vscode.commands.registerCommand('deckard.openWalkthrough', () =>
      vscode.commands.executeCommand(
        'workbench.action.openWalkthrough',
        `${context.extension.id}#deckard.gettingStarted`,
        false,
      ),
    ),
    vscode.commands.registerCommand('deckard.openWhatsNew', async () => {
      await help.show('whats-new');
      await whatsNew.clear();
    }),
    vscode.commands.registerCommand('deckard.showNotesGraph', (options?: unknown) =>
      notesGraph.show(readNotesGraphOptions(options)),
    ),
    vscode.commands.registerCommand('deckard.showNotesGraphAroundNote', async () => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (!uri || !indexer.isNotesFile(uri)) {
        void vscode.window.showInformationMessage('Open a note to draw the graph around it.');
        return;
      }
      await notesGraph.showAround(indexer.getFilePath(uri));
    }),
    vscode.commands.registerCommand('deckard.noteActions', () =>
      noteActionsCommand({ index: indexer, preferences: preferencePins }),
    ),
    vscode.commands.registerCommand('deckard.showCalendar', () => calendarPage.show()),
    // From the sidebar, the page opens on the month and the day it shows.
    vscode.commands.registerCommand('deckard.calendar.openInEditor', () =>
      calendarPage.show(calendar.controller.month, calendar.controller.selectedDate),
    ),
    vscode.commands.registerCommand('deckard.showTaskBoard', async () => {
      await taskBoard.show();
      await tryNext.retire('taskBoard');
    }),
    vscode.commands.registerCommand(
      'deckard.activateNotesGraphNode',
      async (nodeId: unknown, open: unknown) => {
        if (typeof nodeId === 'string' && typeof open === 'boolean') {
          await notesGraph.activateNode(nodeId, open);
        }
      },
    ),
    vscode.commands.registerCommand(
      'deckard.highlightNotesGraphNode',
      (nodeId?: unknown) => {
        notesGraph.highlightNode(
          typeof nodeId === 'string' ? nodeId : undefined,
        );
      },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('deckard.reindexWorkspace', async () => {
      await indexer.ready;
      // Asked for by hand, every note is read and parsed again.
      await indexer.refresh({ reuse: 'none' });
      // Reindexing looked like it did nothing: a status-bar spinner, then
      // silence. Asked for by hand, it says what it found.
      const index = indexer.getSnapshot();
      const plural = (count: number, noun: string): string =>
        `${count} ${noun}${count === 1 ? '' : 's'}`;
      void vscode.window.showInformationMessage(
        `Deckard indexed ${plural(index.files.size, 'file')}: ${plural(
          index.sections.size,
          'note',
        )}, ${plural(index.tasks.size, 'task')}, and ${plural(
          index.tags.size,
          'tag',
        )}.`,
      );
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('deckard.createDailyNote', () =>
      createDailyNoteWithRollover(indexer, history, undefined, rollover),
    ),
    vscode.commands.registerCommand('deckard.openDailyNoteForDate', () =>
      openDailyNoteForDate(indexer, history),
    ),
    vscode.commands.registerCommand('deckard.rollTasksForward', () =>
      rollTasksForward(indexer, rollover),
    ),
    vscode.commands.registerCommand('deckard.previousDailyNote', () =>
      openAdjacentDailyNote(indexer, 'previous'),
    ),
    vscode.commands.registerCommand('deckard.nextDailyNote', () =>
      openAdjacentDailyNote(indexer, 'next'),
    ),
    vscode.commands.registerCommand('deckard.openWeeklyNote', () =>
      openPeriodicNoteWithReview(indexer, reviewWrites, 'week'),
    ),
    vscode.commands.registerCommand('deckard.openMonthlyNote', () =>
      openPeriodicNoteWithReview(indexer, reviewWrites, 'month'),
    ),
    vscode.commands.registerCommand('deckard.writeReview', async () => {
      await writeReviewCommand(indexer, reviewWrites);
      await tryNext.retire('weeklyReview');
    }),
    // One editor, two names: which one the palette offers is decided by
    // whether the cursor is on a task.
    vscode.commands.registerCommand('deckard.editTask', () =>
      editTaskCommand(indexer),
    ),
    vscode.commands.registerCommand('deckard.addTask', () =>
      editTaskCommand(indexer),
    ),
    // The Task Board runs this with the task it was asked about; an editor
    // menu passes its note, which is not a task.
    vscode.commands.registerCommand('deckard.breakIntoSteps', (task?: unknown) =>
      breakIntoStepsCommand(indexer, taskWrites, readTaskArgument(task)),
    ),
    vscode.commands.registerCommand('deckard.toggleTaskDone', () =>
      toggleTaskDoneCommand({ paths: indexer, tasks: taskWrites.tasks }),
    ),
    vscode.commands.registerCommand('deckard.capture', () =>
      capture(captureContext, 'today'),
    ),
    // The hover on a tagged entry passes the line it was shown on, so it
    // pins that entry rather than wherever the cursor happens to be.
    vscode.commands.registerCommand(
      'deckard.pinNote',
      async (documentUri?: unknown, line?: unknown) => {
        const pinned = await setNotePinnedCommand(
          indexer,
          preferencePins,
          true,
          typeof documentUri === 'string' ? documentUri : undefined,
          typeof line === 'number' ? line : undefined,
        );
        if (pinned) {
          await tryNext.retire('pinNote');
        }
        return pinned;
      },
    ),
    vscode.commands.registerCommand(
      'deckard.unpinNote',
      (documentUri?: unknown, line?: unknown) =>
        setNotePinnedCommand(
          indexer,
          preferencePins,
          false,
          typeof documentUri === 'string' ? documentUri : undefined,
          typeof line === 'number' ? line : undefined,
        ),
    ),
    vscode.commands.registerCommand('deckard.captureUnderHeading', () =>
      capture(captureContext, 'heading'),
    ),
    vscode.commands.registerCommand('deckard.newNoteFromTemplate', () =>
      newNoteFromTemplate(indexer, templates),
    ),
    // The Explorer passes the folder that was right-clicked.
    vscode.commands.registerCommand('deckard.newNoteFromTemplateHere', (folder?: unknown) =>
      newNoteFromTemplate(indexer, templates, folder instanceof vscode.Uri ? folder : undefined),
    ),
    vscode.commands.registerCommand('deckard.excludeFromIndex', (folder?: unknown) =>
      excludeFolderCommand(indexer, folder instanceof vscode.Uri ? folder : undefined),
    ),
    vscode.commands.registerCommand('deckard.includeInIndex', (folder?: unknown) =>
      includeFolderCommand(indexer, folder instanceof vscode.Uri ? folder : undefined),
    ),
    vscode.commands.registerCommand('deckard.parkNote', (uri?: unknown, uris?: unknown) =>
      parkNotes(parkingCommands, uri, uris),
    ),
    vscode.commands.registerCommand('deckard.unparkNote', (uri?: unknown, uris?: unknown) =>
      unparkNotes(parkingCommands, uri, uris),
    ),
    vscode.commands.registerCommand('deckard.parkFolder', (uri?: unknown, uris?: unknown) =>
      parkFolders(parkingCommands, uri, uris),
    ),
    vscode.commands.registerCommand('deckard.unparkFolder', (uri?: unknown, uris?: unknown) =>
      unparkFolders(parkingCommands, uri, uris),
    ),
    vscode.commands.registerCommand('deckard.parkTag', async (tag?: unknown) => {
      const outlineNode = asOutlineNode(tag);
      const key = outlineNode
        ? await pickOutlineTag(outlineNode, 'Choose a tag to park')
        : getCommandTagArgument(tag);
      if (outlineNode && !key) {
        return;
      }
      await parkTag(parkingCommands, key);
    }),
    vscode.commands.registerCommand('deckard.unparkTag', async (tag?: unknown) => {
      const outlineNode = asOutlineNode(tag);
      const key = outlineNode
        ? await pickOutlineTag(outlineNode, 'Choose a tag to unpark')
        : getCommandTagArgument(tag);
      if (outlineNode && !key) {
        return;
      }
      await unparkTag(parkingCommands, key);
    }),
    vscode.commands.registerCommand('deckard.copyMcpSetup', () =>
      mcpServer.copySetup(),
    ),
    vscode.commands.registerCommand('deckard.resetMcpToken', () =>
      mcpServer.resetTokenCommand(),
    ),
    vscode.commands.registerCommand(
      CREATE_LINKED_NOTE_COMMAND,
      (documentUri: unknown, name: unknown) =>
        typeof documentUri === 'string' && typeof name === 'string'
          ? createLinkedNote(indexer, vscode.Uri.parse(documentUri), name, linkNotes)
          : undefined,
    ),
    vscode.commands.registerCommand(
      CREATE_MISSING_NOTES_COMMAND,
      (documentUri: unknown, names: unknown) =>
        typeof documentUri === 'string' &&
        Array.isArray(names) &&
        names.every((name) => typeof name === 'string')
          ? createMissingNotes(indexer, vscode.Uri.parse(documentUri), names, { notes: linkNotes })
          : undefined,
    ),
    vscode.commands.registerCommand(
      LINK_MENTIONS_COMMAND,
      (documentUri: unknown) =>
        typeof documentUri === 'string'
          ? linkMentions(indexer, history, vscode.Uri.parse(documentUri), links)
          : undefined,
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('deckard.extractHeading', () =>
      extractHeadingCommand(indexer, linkNotes),
    ),
    vscode.commands.registerCommand('deckard.moveTo', () =>
      moveToCommand(indexer, movePreferences, taskWrites),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'deckard.showTagOverview',
      (tagKey?: unknown) => showTagOverview(searchPanels, indexer, tagKey),
    ),
    vscode.commands.registerCommand('deckard.search', (query?: unknown) =>
      searchPanels.showQuery(getCommandTagArgument(query) ?? ''),
    ),
    vscode.commands.registerCommand('deckard.insertQueryBlock', () =>
      insertQueryBlock(preferences),
    ),
    vscode.commands.registerCommand(
      'deckard.searchWorkspace',
      (initialQuery?: unknown) =>
        quickFind.show(getCommandTagArgument(initialQuery)),
    ),
    vscode.commands.registerCommand('deckard.quickFind.complete', () =>
      quickFind.complete(),
    ),
    vscode.commands.registerCommand('deckard.quickFind.openBeside', () =>
      quickFind.openBeside(),
    ),
    vscode.commands.registerCommand('deckard.quickFind.insertLink', () =>
      quickFind.insertLinkFromActive(),
    ),
    vscode.commands.registerCommand('deckard.quickFind.actions', () =>
      quickFind.showActions(),
    ),
    vscode.commands.registerCommand(
      'deckard.searchNotes',
      (requestedQuery?: unknown) =>
        showQuerySearch(searchPanels, indexer, requestedQuery),
    ),
    vscode.commands.registerCommand('deckard.linkCurrentHeading', () =>
      linkCurrentHeading(indexer),
    ),
    vscode.commands.registerCommand('deckard.moveTagsToFrontmatter', () =>
      moveInlineTagsToFrontmatter(),
    ),
    vscode.commands.registerCommand(
      'deckard.renameTag',
      (requestedTagKey?: unknown) =>
        renameIndexedTag(
          indexer,
          getCommandTagArgument(requestedTagKey),
          tagWrites,
        ),
    ),
    vscode.commands.registerCommand('deckard.renameHeading', () =>
      renameHeadingCommand(indexer, history, links),
    ),
    vscode.commands.registerCommand('deckard.undoLastChange', () =>
      history.undoLast(() => indexer.refresh()),
    ),
    vscode.commands.registerCommand(
      'deckard.mergeTag',
      (requestedTagKey?: unknown, requestedTargetKey?: unknown) =>
        mergeIndexedTag(
          indexer,
          getCommandTagArgument(requestedTagKey),
          tagWrites,
          getCommandTagArgument(requestedTargetKey),
        ),
    ),
    vscode.commands.registerCommand(
        'deckard.showEntryRelatedNotes',
        async (documentUri?: unknown, sourceLine?: unknown) => {
          if (
            typeof documentUri !== 'string' ||
            typeof sourceLine !== 'number' ||
            !Number.isInteger(sourceLine) ||
            sourceLine < 1
          ) {
            return;
          }
          const uri = vscode.Uri.parse(documentUri);
          if (!isMarkdownDocument({ languageId: 'markdown', uri })) {
            return;
          }
          await sidebarNotes.showRelatedNotesForEntry(uri, sourceLine);
        },
    ),
    vscode.commands.registerCommand(
      'deckard.showEntryRelatedNotesDebug',
      async (documentUri?: unknown, sourceLine?: unknown) => {
        if (
          typeof documentUri !== 'string' ||
          typeof sourceLine !== 'number' ||
          !Number.isInteger(sourceLine) ||
          sourceLine < 1
        ) {
          return;
        }
        const uri = vscode.Uri.parse(documentUri);
        if (!isMarkdownDocument({ languageId: 'markdown', uri })) {
          return;
        }
        await relatedNotesDebug.show(uri, sourceLine);
      },
    ),
  );

  startServices(services);

  return {
    extendMarkdownIt: (md) => services.queryBlocks.extendMarkdownIt(md),
  };
}

function getCommandTagArgument(value: unknown): string | undefined {
  const argument = Array.isArray(value) ? value[0] : value;
  return typeof argument === 'string' ? argument : undefined;
}

/**
 * Validates the tree argument because these commands are also reachable from
 * keybindings and other extensions, which can pass anything.
 */
function asOutlineNode(value: unknown): OutlineNode | undefined {
  return typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'line' in value &&
    'tags' in value
    ? (value as OutlineNode)
    : undefined;
}

/**
 * Opens a search page on a query.
 *
 * The command accepts a query argument so a link or another command can open a
 * saved search directly, and prompts for one otherwise.
 */
async function showQuerySearch(
  searchPanels: SearchPanels,
  indexer: IndexReader,
  requestedQuery: unknown,
): Promise<void> {
  await indexer.ready;
  const query =
    getCommandTagArgument(requestedQuery) ??
    (await vscode.window.showInputBox({
      title: 'Search Deckard notes',
      prompt:
        'Write a query, such as (tag = #project/atlas AND tag = #urgent) OR text ~ "vendor"',
      placeHolder: 'tag = #project/atlas AND task = open',
    }));

  if (query?.trim()) {
    await searchPanels.showQuery(query);
  }
}

/**
 * Resolves a command argument or user choice only after the initial index exists.
 *
 * Serialized command URIs arrive as arrays, while the command palette supplies
 * no argument, so both paths converge on the same validated panel entrypoint.
 */
async function showTagOverview(
  searchPanels: SearchPanels,
  indexer: IndexReader,
  requestedTag: unknown,
): Promise<void> {
  await indexer.ready;
  const tags = [...indexer.getSnapshot().tags.values()];
  const tagKey =
    getCommandTagArgument(requestedTag) ??
    (
      await vscode.window.showQuickPick(
        tags.map((tag) => ({
          label: tag.label,
          description: `${tag.count} ${tag.count === 1 ? 'entry' : 'entries'}`,
          key: tag.key,
        })),
        { placeHolder: 'Choose a tag to open its page' },
      )
    )?.key;

  if (tagKey) {
    await searchPanels.show(tagKey);
  }
}
