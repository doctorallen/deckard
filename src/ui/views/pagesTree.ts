import * as vscode from 'vscode';

import type { IndexReader } from '../../core/workspace/indexReader';
import { listDailyNotes, formatLocalDate } from '../../domain/notes/periodicNotes';
import { readQueryContext } from '../commands/queryContext';
import { createTaskGlance } from '../state/dashboardState';
import type { GoToPagesMessage } from '../protocol/shared';
import { DeckardPageId, listDeckardPages, PageFacts } from '../state/deckardPages';
import { countNotes } from '../../domain/index/noteEntryIndex';

/**
 * What the Pages view and Go to… read about each page: its hint from the
 * notes as they are now, its glyph, and the menu DECKARD opens on a page.
 * The view itself is a webview (webview/pagesView.ts).
 */

/** What the hints are drawn from, as the index and the settings are now. */
export function readPageFacts(indexer: Pick<IndexReader, 'getSnapshot'>, now: Date = new Date()): PageFacts {
  const index = indexer.getSnapshot();
  const agendaQuery = vscode.workspace.getConfiguration('deckard').get<string>('agenda.query', '');
  const context = readQueryContext(now.getTime());
  const glance = createTaskGlance(index, agendaQuery, context);
  const today = formatLocalDate(now);
  return {
    dueToday: glance.today,
    overdue: glance.overdue,
    notes: countNotes(index),
    files: index.files.size,
    today: now,
    todayNoteExists: listDailyNotes(index).some((note) => note.date === today),
    findKey: process.platform === 'darwin' ? '⌥⇧⌘F' : 'Ctrl+Shift+Alt+F',
    dateFormats: context.dateFormats,
  };
}

/** Go to…'s key, as the platform writes it. */
const GO_TO_KEY = process.platform === 'darwin' ? '⌥⇧⌘P' : 'Ctrl+Shift+Alt+P';

/**
 * The menu DECKARD opens at the top of a page: every page but `current`,
 * each with the hint the Pages view gives it, and Go to…'s key. Without an
 * index to read, the pages are listed without hints.
 */
export function describeGoToMenu(indexer: Pick<IndexReader, 'getSnapshot'> | undefined, current?: DeckardPageId): GoToPagesMessage {
  const facts = indexer ? readPageFacts(indexer) : undefined;
  const pages = listDeckardPages(facts ?? { dueToday: 0, overdue: 0, notes: 0, files: 0, today: new Date(), todayNoteExists: true, findKey: '' });
  return {
    type: 'goToPages',
    pages: pages
      .filter((page) => page.id !== current)
      .map((page) => ({ id: page.id, label: page.label, description: facts ? page.description : '' })),
    key: GO_TO_KEY,
  };
}

/** A page's glyph, light and dark, as an icon path. */
export function pageIcon(extensionUri: vscode.Uri, id: DeckardPageId): { light: vscode.Uri; dark: vscode.Uri } {
  return {
    light: vscode.Uri.joinPath(extensionUri, 'resources', 'pages', `${id}-light.svg`),
    dark: vscode.Uri.joinPath(extensionUri, 'resources', 'pages', `${id}-dark.svg`),
  };
}

/** Deckard: Go to…, the same pages as a quick pick, from anywhere. */
export async function goToPage(indexer: Pick<IndexReader, 'getSnapshot'>, extensionUri: vscode.Uri): Promise<void> {
  const pages = listDeckardPages(readPageFacts(indexer));
  const picked = await vscode.window.showQuickPick(
    pages.map((page) => ({
      label: page.label,
      description: page.description,
      detail: page.detail,
      iconPath: pageIcon(extensionUri, page.id),
      page,
    })),
    { title: 'Go to a Deckard page', placeHolder: 'Type to narrow: bo for the Task Board', matchOnDescription: true },
  );
  if (picked) {
    await vscode.commands.executeCommand(picked.page.command);
  }
}
