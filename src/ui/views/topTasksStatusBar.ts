import * as vscode from 'vscode';

import type { WorkspaceIndex } from '../../domain/model';
import { readTopCount, topTasksName } from '../../domain/tasks/topTasks';
import { escapeMarkdown } from '../../shared/text';
import { resolveSourceUri } from '../commands/navigation';
import { PICK_TOP_TASKS_COMMAND } from '../commands/topTasks';
import { describeTopStatus, type TopStatus } from '../state/topTasksState';

/** What the item reads from the indexer, and when it redraws. */
interface TopStatusIndexSource {
  readonly ready: Promise<void>;
  readonly onDidUpdate: vscode.Event<WorkspaceIndex>;
  getSnapshot(): WorkspaceIndex;
}

/** How often the day is checked, so the item turns over at midnight. */
const CHECK_INTERVAL_MS = 60 * 1000;

/**
 * Today's top tasks in the status bar, beside the due count
 * (docs/implementation/50-top-three.md): how many are done and the first
 * that is not, which selecting the item opens; `3/3 done` once none is
 * left; and, while today has none, the offer to pick, shown only where a
 * daily note of the last two weeks has a section. Hidden while
 * `deckard.tasks.topCount` is 0.
 */
export class TopTasksStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Counts the draws, so a note found for an earlier draw is not shown by a later one. */
  private generation = 0;
  private disposed = false;

  /** Creates the item and starts listening; the first draw waits for the index. */
  public constructor(
    private readonly indexer: TopStatusIndexSource,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.item = vscode.window.createStatusBarItem('deckard.topTasks', vscode.StatusBarAlignment.Right, 99);
    this.item.name = 'Deckard top tasks';
    this.disposables.push(
      this.item,
      indexer.onDidUpdate(() => void this.refresh()),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          void this.refresh();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard.tasks.topCount')) {
          void this.refresh();
        }
      }),
    );
    void indexer.ready.then(() => {
      if (this.disposed) {
        return;
      }
      void this.refresh();
      this.timer = setInterval(() => void this.refresh(), CHECK_INTERVAL_MS);
    });
  }

  /** Stops the checks and removes the item. */
  public dispose(): void {
    this.disposed = true;
    clearInterval(this.timer);
    this.timer = undefined;
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /** Draws the item as today's picks stand, or hides it when there is nothing to say. */
  public async refresh(): Promise<void> {
    const generation = (this.generation += 1);
    const count = readTopCount(vscode.workspace.getConfiguration('deckard'));
    const status = describeTopStatus(this.indexer.getSnapshot(), this.now().getTime(), count);
    if (!status) {
      this.item.hide();
      return;
    }
    const uri = status.next ? await resolveSourceUri(status.next.filePath) : undefined;
    if (generation !== this.generation || this.disposed) {
      return;
    }
    this.item.text = `$(target) ${status.text}`;
    this.item.tooltip = createTooltip(status, count);
    this.item.command = status.next && uri ? openLine(uri, status.next.lineNumber) : PICK_TOP_TASKS_COMMAND;
    this.item.show();
  }
}

/** The command that opens a note at a one-based line. */
function openLine(uri: vscode.Uri, line: number): vscode.Command {
  const position = new vscode.Position(Math.max(line - 1, 0), 0);
  return {
    command: 'vscode.open',
    title: 'Open Task',
    arguments: [uri, { selection: new vscode.Range(position, position), preview: false }],
  };
}

/** The hover: today's picks, each with whether it is done, and what selecting the item does. */
function createTooltip(status: TopStatus, count: number): vscode.MarkdownString {
  const name = topTasksName(count);
  if (status.kind === 'offer') {
    return new vscode.MarkdownString(`Deckard: today has no ${name.toLowerCase()} yet.\n\nSelect to pick.`, true);
  }
  const tooltip = new vscode.MarkdownString(`Deckard: ${name}`, true);
  tooltip.appendMarkdown(
    `\n\n${status.tasks
      .map((task) => `- ${task.completed ? '$(pass)' : '$(circle-large-outline)'} ${escapeMarkdown(task.title, 'inline')}`)
      .join('\n')}`,
  );
  tooltip.appendMarkdown(status.next ? '\n\nSelect to open the first not done.' : '\n\nSelect to change them.');
  return tooltip;
}
