import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { isMarkdownFile } from '../../../core/workspace/scanner';
import { registerCommand } from '../runCommand';
import { openNoteAt } from '../noteOpening';
import { findHubTagKey } from '../../state/hubTree';
import { goToPage } from '../../views/pagesTree';
import type { TaskStatusType } from '../../../domain/model';
import { isTaskStatusType } from '../../../domain/tasks/taskStatuses';

/**
 * Opening the pages: Go to…, Home, Stats, Help and
 * What's new, the Notes Graph and its nodes, the Calendar page, the Task
 * Board, the note page, and Related Notes for one entry.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer, whatsNew, tryNext } = services;
  const { dashboard, stats, help, notesGraph, calendar: calendarPage, taskBoard, taskStatuses } = services.pages;
  const { readNotesGraphOptions } = services.pageCommands;
  const calendar = services.views.calendar;
  // Every page, as the top of Context lists them, from anywhere.
  context.subscriptions.push(registerCommand('deckard.goTo', () => goToPage(indexer, context.extensionUri)));
  context.subscriptions.push(
    registerCommand('deckard.showDashboard', () =>
      dashboard.show(),
    ),
    registerCommand('deckard.showStats', () => stats.show()),
    // New status… on the board's gear, and Give It a Character after the
    // move into checkboxes, open it on a new row.
    registerCommand('deckard.editTaskStatuses', (options?: unknown) => taskStatuses.show(readNewStatusRow(options))),
    // A page may open Help at the section about it, such as the calendar's.
    registerCommand('deckard.showHelp', (anchor?: unknown) =>
      help.show(typeof anchor === 'string' && /^[\w-]+$/.test(anchor) ? anchor : undefined),
    ),
    registerCommand('deckard.openWhatsNew', async () => {
      await help.show('whats-new');
      await whatsNew.clear();
    }),
    registerCommand('deckard.showNotesGraph', (options?: unknown) =>
      notesGraph.show(readNotesGraphOptions(options)),
    ),
    // The note page names its note; the editor's is the active one.
    registerCommand('deckard.showNotesGraphAroundNote', async (filePath?: unknown) => {
      if (typeof filePath === 'string' && indexer.getSnapshot().files.has(filePath)) {
        await notesGraph.showAround(filePath);
        return;
      }
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (!uri || !indexer.isNotesFile(uri)) {
        void vscode.window.showInformationMessage('Open a note to draw the graph around it.');
        return;
      }
      await notesGraph.showAround(indexer.getFilePath(uri));
    }),
    registerCommand('deckard.showCalendar', () => calendarPage.show()),
    // From the sidebar, the page opens on the month and the day it shows.
    registerCommand('deckard.calendar.openInEditor', () =>
      calendarPage.show(calendar.controller.month, calendar.controller.selectedDate),
    ),
    registerCommand('deckard.showTaskBoard', async () => {
      await taskBoard.show();
      await tryNext.retire('taskBoard');
    }),
    ...registerNotePageCommands(services),
    ...registerGraphNodeCommands(services),
    ...registerEntryRelatedNotes(services),
  );
}

/**
 * Open Note as Page: a note it is given, at a line, or, from the palette,
 * the note in the editor at the cursor's line.
 */
function registerNotePageCommands(services: Services): vscode.Disposable[] {
  const { indexer } = services;
  return [
    // A note, opened where deckard.openNotesIn says, or the other way: for a
    // tree row or a lens, which cannot read the keys a click held.
    registerCommand('deckard.openNote', async (filePath?: unknown, line?: unknown, options?: unknown) => {
      if (typeof filePath !== 'string' || !indexer.getSnapshot().files.has(filePath)) {
        return;
      }
      const at = typeof line === 'number' && Number.isInteger(line) && line > 0 ? line : 1;
      const opposite = typeof options === 'object' && options !== null && (options as { opposite?: unknown }).opposite === true;
      await openNoteAt(filePath, at, { opposite });
    }),
    registerCommand('deckard.openNotePage', async (filePath?: unknown, line?: unknown, options?: unknown) => {
      const how = typeof options === 'object' && options !== null ? (options as { beside?: unknown; preserveFocus?: unknown }) : {};
      const beside = how.beside === true;
      if (typeof filePath === 'string' && filePath) {
        const at = typeof line === 'number' && Number.isInteger(line) && line > 0 ? line : undefined;
        await showAsPage(services, { filePath, ...(at ? { line: at } : {}) }, { beside, preserveFocus: how.preserveFocus === true });
        return;
      }
      const location = readEditorNote(indexer, filePath);
      if (!location) {
        void vscode.window.showInformationMessage('Open a note to read it as a page.');
        return;
      }
      // In the note's own group, in front of its editor, as Markdown's Open
      // Preview opens there.
      await showAsPage(services, location, { beside, ...(location.column ? { column: location.column } : {}) });
    }),
  ];
}

/**
 * Shows a note as a page: a hub note as its tag's search page, which draws
 * the note at its top with the tag's progress, notes, and tasks under it, so
 * a page of the note alone would say less; any other note on the note page.
 * The editor still opens a hub note's Markdown.
 */
async function showAsPage(
  services: Services,
  location: { filePath: string; line?: number },
  how: Parameters<Services['pages']['notePage']['show']>[1],
): Promise<void> {
  const hubTag = findHubTagKey(services.indexer.getSnapshot(), location.filePath);
  if (hubTag) {
    await services.pages.search.show(hubTag);
    return;
  }
  await services.pages.notePage.show(location, how);
}

/**
 * The note Open Note as Page reads when it is not named by path: the one
 * whose title bar it was run from, which VS Code names and which need not be
 * the editor with the focus, or else the active editor's, at its cursor when
 * that editor shows it. Undefined when that is no note.
 */
function readEditorNote(
  indexer: Services['indexer'],
  given: unknown,
): { filePath: string; line?: number; column?: vscode.ViewColumn } | undefined {
  const editor = vscode.window.activeTextEditor;
  const uri = given instanceof vscode.Uri ? given : editor?.document.uri;
  if (!uri || !indexer.isNotesFile(uri)) {
    return undefined;
  }
  const shown = editor?.document.uri.toString() === uri.toString() ? editor : undefined;
  const column = shown?.viewColumn ?? findTextTabColumn(uri);
  return {
    filePath: indexer.getFilePath(uri),
    ...(shown ? { line: shown.selection.active.line + 1 } : {}),
    ...(column ? { column } : {}),
  };
}

/** The group a note's text tab is in, the active group first, when one holds it. */
function findTextTabColumn(uri: vscode.Uri): vscode.ViewColumn | undefined {
  const holds = (group: vscode.TabGroup): boolean =>
    group.tabs.some((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString());
  const { activeTabGroup, all } = vscode.window.tabGroups;
  return (holds(activeTabGroup) ? activeTabGroup : all.find(holds))?.viewColumn;
}

/** What the Notes Graph page runs on a node it was clicked or hovered on. */
function registerGraphNodeCommands(services: Services): vscode.Disposable[] {
  const { notesGraph } = services.pages;
  return [
    registerCommand(
      'deckard.activateNotesGraphNode',
      async (nodeId: unknown, open: unknown) => {
        if (typeof nodeId === 'string' && typeof open === 'boolean') {
          await notesGraph.activateNode(nodeId, open);
        }
      },
    ),
    registerCommand(
      'deckard.highlightNotesGraphNode',
      (nodeId?: unknown) => {
        notesGraph.highlightNode(
          typeof nodeId === 'string' ? nodeId : undefined,
        );
      },
    ),
  ];
}

/**
 * Related Notes for the entry a lens or hover was on, and the page that
 * shows how it ranks, for the entry a link names or, from the palette, the
 * one the cursor is in.
 */
function registerEntryRelatedNotes(services: Services): vscode.Disposable[] {
  const { sidebarNotes } = services.views;
  const { relatedNotesDebug } = services.pages;
  return [
    registerCommand(
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
        if (!isMarkdownFile(uri)) {
          return;
        }
        await sidebarNotes.showRelatedNotesForEntry(uri, sourceLine);
      },
    ),
    registerCommand(
      'deckard.showEntryRelatedNotesDebug',
      async (documentUri?: unknown, sourceLine?: unknown) => {
        const asked = readEntryArguments(documentUri, sourceLine);
        if (!asked || !isMarkdownFile(asked.uri)) {
          return;
        }
        await relatedNotesDebug.show(asked.uri, asked.line);
      },
    ),
  ];
}

/**
 * The new row Edit Task Statuses is asked to open with, from a command's
 * argument: `{ newStatus: { name?, type? } }`, or none.
 */
function readNewStatusRow(options: unknown): { name: string; type: TaskStatusType } | undefined {
  const newStatus = (options as { newStatus?: { name?: unknown; type?: unknown } } | undefined)?.newStatus;
  if (!newStatus || typeof newStatus !== 'object') {
    return undefined;
  }
  return {
    name: typeof newStatus.name === 'string' ? newStatus.name.slice(0, 80) : '',
    type: isTaskStatusType(newStatus.type) ? newStatus.type : 'todo',
  };
}

/**
 * The entry a command was asked about: the note and line a link names, or,
 * run from the palette with neither, the line the cursor is on in the
 * editor; undefined for anything else.
 */
function readEntryArguments(documentUri: unknown, sourceLine: unknown): { uri: vscode.Uri; line: number } | undefined {
  if (documentUri === undefined && sourceLine === undefined) {
    const editor = vscode.window.activeTextEditor;
    return editor ? { uri: editor.document.uri, line: editor.selection.active.line + 1 } : undefined;
  }
  return typeof documentUri === 'string' && typeof sourceLine === 'number' && Number.isInteger(sourceLine) && sourceLine >= 1
    ? { uri: vscode.Uri.parse(documentUri), line: sourceLine }
    : undefined;
}
