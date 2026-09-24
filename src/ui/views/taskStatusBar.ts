import * as vscode from 'vscode';

import { WorkspaceIndex } from '../../core/types';
import { createAgenda, selectAgendaTasks } from '../state/agendaState';

/**
 * What is due, in the status bar, and a reminder at an hour you choose.
 *
 * Everything else Deckard shows waits for a view to be opened. This is the
 * one count visible while you are writing code, and selecting it opens the
 * Tasks view, where the tasks themselves are.
 */

/** Open tasks that want attention today: overdue ones, and today's. */
export interface DueTaskCounts {
  overdue: number;
  today: number;
}

export function countDueTasks(
  index: WorkspaceIndex,
  now: number,
  /** `deckard.agenda.query`, so the count is of what the Tasks view lists. */
  query = '',
): DueTaskCounts {
  const groups = createAgenda(index, now, {
    tasks: selectAgendaTasks(index, query).tasks,
    upcomingDays: 1,
  });
  const count = (id: 'overdue' | 'today'): number =>
    groups.find((group) => group.id === id)?.entries.length ?? 0;
  return { overdue: count('overdue'), today: count('today') };
}

/**
 * What the status bar reads, or nothing when there is nothing due.
 *
 * Each number names its own group. The bar once read `22 due today, 17
 * overdue` when five tasks were due today, because the first number was
 * the two groups added together; the Tasks view it opens says 17 and 5.
 */
export function describeDueTasks(counts: DueTaskCounts): string | undefined {
  const parts: string[] = [];
  if (counts.overdue > 0) {
    parts.push(`${counts.overdue} overdue`);
  }
  if (counts.today > 0) {
    parts.push(`${counts.today} due today`);
  }
  return parts.length ? parts.join(', ') : undefined;
}

/** The longer sentence a reminder and the hover read. */
export function describeDueTasksAtLength(counts: DueTaskCounts): string {
  const tasks = (count: number): string =>
    `${count} ${count === 1 ? 'task is' : 'tasks are'}`;
  if (counts.overdue > 0 && counts.today > 0) {
    return `${tasks(counts.overdue)} overdue and ${counts.today} ${
      counts.today === 1 ? 'is' : 'are'
    } due today.`;
  }
  if (counts.overdue > 0) {
    return `${tasks(counts.overdue)} overdue.`;
  }
  if (counts.today > 0) {
    return `${tasks(counts.today)} due today.`;
  }
  return 'Nothing is due today.';
}

/** Minutes past midnight for an `HH:MM` setting, or nothing when it is off. */
export function parseReminderTime(value: string): number | undefined {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

/** How long until the next time of day, in milliseconds. */
export function millisecondsUntil(minuteOfDay: number, now: Date): number {
  const next = new Date(now);
  next.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

interface StatusBarIndexSource {
  readonly onDidUpdate: vscode.Event<WorkspaceIndex>;
  getSnapshot(): WorkspaceIndex;
}

function readAgendaQuery(): string {
  return vscode.workspace.getConfiguration('deckard').get<string>('agenda.query', '');
}

/** The command that opens the Tasks view, contributed by VS Code per view. */
const SHOW_AGENDA = 'deckard.agenda.focus';

export class TaskStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private reminder: ReturnType<typeof setTimeout> | undefined;

  public constructor(
    private readonly indexer: StatusBarIndexSource,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.item = vscode.window.createStatusBarItem(
      'deckard.dueTasks',
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.name = 'Deckard tasks';
    this.item.command = SHOW_AGENDA;
    this.disposables.push(
      this.item,
      indexer.onDidUpdate(() => this.refresh()),
      // What counts as today moves at midnight, and a window coming back is
      // the cheapest moment to notice.
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.refresh();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration('deckard.statusBar') ||
          event.affectsConfiguration('deckard.agenda.query')
        ) {
          this.refresh();
        }
        if (event.affectsConfiguration('deckard.taskReminderTime')) {
          this.scheduleReminder();
        }
      }),
    );
    this.scheduleReminder();
  }

  public dispose(): void {
    if (this.reminder) {
      clearTimeout(this.reminder);
      this.reminder = undefined;
    }
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /** Draws the count, or hides the item when nothing is due. */
  public refresh(): void {
    if (
      !vscode.workspace
        .getConfiguration('deckard')
        .get<boolean>('statusBar', true)
    ) {
      this.item.hide();
      return;
    }
    const counts = countDueTasks(
      this.indexer.getSnapshot(),
      this.now().getTime(),
      readAgendaQuery(),
    );
    const text = describeDueTasks(counts);
    if (!text) {
      this.item.hide();
      return;
    }
    this.item.text = `$(checklist) ${text}`;
    this.item.tooltip = `Deckard: ${describeDueTasksAtLength(
      counts,
    )} Select to open Tasks.`;
    // Overdue work is the one state worth colouring, and only then.
    this.item.backgroundColor =
      counts.overdue > 0
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined;
    this.item.show();
  }

  /**
   * Waits for the hour the setting names, then says what is due and asks
   * again tomorrow. Nothing is scheduled while the setting is empty.
   */
  private scheduleReminder(): void {
    if (this.reminder) {
      clearTimeout(this.reminder);
      this.reminder = undefined;
    }
    const minuteOfDay = parseReminderTime(
      vscode.workspace
        .getConfiguration('deckard')
        .get<string>('taskReminderTime', ''),
    );
    if (minuteOfDay === undefined) {
      return;
    }
    this.reminder = setTimeout(() => {
      void this.remind();
      this.scheduleReminder();
    }, millisecondsUntil(minuteOfDay, this.now()));
  }

  /** Says what is due, unless nothing is. */
  private async remind(): Promise<void> {
    const counts = countDueTasks(
      this.indexer.getSnapshot(),
      this.now().getTime(),
      readAgendaQuery(),
    );
    this.refresh();
    if (counts.overdue + counts.today === 0) {
      return;
    }
    const choice = await vscode.window.showInformationMessage(
      `Deckard: ${describeDueTasksAtLength(counts)}`,
      'Open Tasks',
    );
    if (choice === 'Open Tasks') {
      await vscode.commands.executeCommand(SHOW_AGENDA);
    }
  }
}
