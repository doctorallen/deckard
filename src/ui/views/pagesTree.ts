import * as vscode from 'vscode';

import type { IndexReader, IndexUpdates } from '../../core/workspace/indexReader';
import { listDailyNotes, formatLocalDate } from '../../domain/notes/periodicNotes';
import { readQueryContext } from '../commands/queryContext';
import { createTaskGlance } from '../state/dashboardState';
import { DeckardPage, DeckardPageId, listDeckardPages, PageFacts } from '../state/deckardPages';

/**
 * The Pages view: every Deckard page as a labeled row with its glyph and a
 * hint, first in the Deckard sidebar, so a page is found by reading rather
 * than by guessing at an icon. Go to… lists the same pages.
 */

/** What the hints are drawn from, as the index and the settings are now. */
export function readPageFacts(indexer: Pick<IndexReader, 'getSnapshot'>, now: Date = new Date()): PageFacts {
  const index = indexer.getSnapshot();
  const agendaQuery = vscode.workspace.getConfiguration('deckard').get<string>('agenda.query', '');
  const glance = createTaskGlance(index, agendaQuery, readQueryContext(now.getTime()));
  const today = formatLocalDate(now);
  return {
    dueToday: glance.today,
    overdue: glance.overdue,
    notes: index.sections.size,
    files: index.files.size,
    today: now,
    todayNoteExists: listDailyNotes(index).some((note) => note.date === today),
    findKey: process.platform === 'darwin' ? '⌥⇧⌘F' : 'Ctrl+Shift+Alt+F',
  };
}

/** A page's glyph, light and dark, as an icon path. */
export function pageIcon(extensionUri: vscode.Uri, id: DeckardPageId): { light: vscode.Uri; dark: vscode.Uri } {
  return {
    light: vscode.Uri.joinPath(extensionUri, 'resources', 'pages', `${id}-light.svg`),
    dark: vscode.Uri.joinPath(extensionUri, 'resources', 'pages', `${id}-dark.svg`),
  };
}

/** The Pages view's rows, redrawn as the index changes. */
export class PagesTreeProvider implements vscode.TreeDataProvider<DeckardPage>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly listeners: vscode.Disposable[];

  /** Listens at once; the rows are read when VS Code asks for them. */
  public constructor(
    private readonly indexer: Pick<IndexReader, 'getSnapshot'> & IndexUpdates,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.listeners = [
      this.changeEmitter,
      indexer.onDidUpdate(() => this.changeEmitter.fire()),
      // The day turning shows when the window is next in front.
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.changeEmitter.fire();
        }
      }),
    ];
  }

  /** Every page, in order. */
  public getChildren(): DeckardPage[] {
    return listDeckardPages(readPageFacts(this.indexer));
  }

  /** One page as a row that opens it. */
  public getTreeItem(page: DeckardPage): vscode.TreeItem {
    const item = new vscode.TreeItem(page.label, vscode.TreeItemCollapsibleState.None);
    item.id = page.id;
    item.description = page.description;
    item.tooltip = `${page.label}: ${page.detail}`;
    item.iconPath = pageIcon(this.extensionUri, page.id);
    item.command = { command: page.command, title: `Open ${page.label}` };
    item.accessibilityInformation = { label: `${page.label}, ${page.description}`, role: 'link' };
    return item;
  }

  /** Stops listening. */
  public dispose(): void {
    this.listeners.forEach((listener) => listener.dispose());
  }
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
