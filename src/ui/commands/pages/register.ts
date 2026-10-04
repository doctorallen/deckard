import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { isMarkdownFile } from '../../../core/workspace/scanner';
import { registerCommand } from '../runCommand';
import { openNoteAt } from '../noteOpening';

/**
 * Opening the pages: Home, Stats, Help and What's new, the Notes Graph and
 * its nodes, the Calendar page, the Task Board, the note page, and Related
 * Notes for one entry.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer, whatsNew, tryNext } = services;
  const { dashboard, stats, help, notesGraph, calendar: calendarPage, taskBoard } = services.pages;
  const { readNotesGraphOptions } = services.pageCommands;
  const calendar = services.views.calendar;
  context.subscriptions.push(
    registerCommand('deckard.showDashboard', () =>
      dashboard.show(),
    ),
    registerCommand('deckard.showStats', () => stats.show()),
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
    registerCommand('deckard.showNotesGraphAroundNote', async () => {
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
  const { notePage } = services.pages;
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
        await notePage.show({ filePath, ...(at ? { line: at } : {}) }, beside, beside && how.preserveFocus === true);
        return;
      }
      const editor = vscode.window.activeTextEditor;
      if (!editor || !indexer.isNotesFile(editor.document.uri)) {
        void vscode.window.showInformationMessage('Open a note to read it as a page.');
        return;
      }
      await notePage.show({ filePath: indexer.getFilePath(editor.document.uri), line: editor.selection.active.line + 1 }, beside);
    }),
  ];
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

/** Related Notes for the entry a lens or hover was on, and its debug page. */
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
        await relatedNotesDebug.show(uri, sourceLine);
      },
    ),
  ];
}
