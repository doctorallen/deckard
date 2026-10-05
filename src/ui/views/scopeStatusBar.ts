import * as vscode from 'vscode';

import {
  isPausedHere,
  looksLikeCodeRepository,
  onDidChangePaused,
  onDidChangeScope,
  readNotesFolder,
  WHOLE_WORKSPACE_KEPT,
} from '../commands/writeTarget';

/**
 * What Deckard reads, said in the status bar only when it is worth a
 * glance: while it is paused here, and while it reads a whole code
 * repository because no notes folder is set, until the reader keeps that.
 * A folder of notes, or a repository with a notes folder, shows nothing.
 */

/** The facts the item is drawn from. */
export interface ScopeFacts {
  paused: boolean;
  /** The workspace folder read whole although it looks like a code repository, if any. */
  wholeRepository?: string;
  /** The reader chose to keep reading the whole workspace. */
  kept: boolean;
}

/** The item's text, tip, and command; undefined to hide it. */
export function describeScope(facts: ScopeFacts): { text: string; tooltip: string; command: string } | undefined {
  if (facts.paused) {
    return {
      text: '$(debug-pause) Deckard paused',
      tooltip: 'Deckard reads and writes nothing in this workspace. Select to resume.',
      command: 'deckard.resumeHere',
    };
  }
  if (facts.wholeRepository && !facts.kept) {
    return {
      text: '$(book) Deckard: whole workspace',
      tooltip: `No notes folder is set, so Deckard reads every Markdown file in ${facts.wholeRepository}, READMEs and docs included. Select to choose a notes folder, leave folders out, or pause Deckard here.`,
      command: 'deckard.chooseScope',
    };
  }
  return undefined;
}

/** The status bar item, redrawn when the pause, the notes folder, or the folders change. */
export class ScopeStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('deckard.scope', vscode.StatusBarAlignment.Left, 10);
  private readonly listeners: vscode.Disposable[];

  /** Listens at once; the first draw is `refresh`'s. */
  public constructor(private readonly workspaceState: vscode.Memento) {
    this.item.name = 'Deckard Scope';
    this.listeners = [
      onDidChangePaused(() => void this.refresh()),
      onDidChangeScope(() => void this.refresh()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard.notesFolder')) {
          void this.refresh();
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh()),
    ];
  }

  /** Draws the item as the workspace is now, or hides it. */
  public async refresh(): Promise<void> {
    let wholeRepository: string | undefined;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (!readNotesFolder(folder) && (await looksLikeCodeRepository(folder))) {
        wholeRepository = folder.name;
        break;
      }
    }
    const shown = describeScope({
      paused: isPausedHere(),
      wholeRepository,
      kept: this.workspaceState.get<boolean>(WHOLE_WORKSPACE_KEPT) === true,
    });
    if (!shown) {
      this.item.hide();
      return;
    }
    this.item.text = shown.text;
    this.item.tooltip = shown.tooltip;
    this.item.command = shown.command;
    this.item.show();
  }

  /** Removes the item and stops listening. */
  public dispose(): void {
    this.listeners.forEach((listener) => listener.dispose());
    this.item.dispose();
  }
}
