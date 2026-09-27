import * as vscode from 'vscode';
import { onDidChangePageChrome } from './components';

import { measure } from '../../core/timing';
import { CalendarMessage, WorkspaceIndex } from '../../core/types';
import {
  chooseTargetFolder,
  ensurePeriodicNote,
  findPeriodicNoteNames,
  formatLocalDate,
  getPeriodicNote,
  listDailyNotes,
  NotePeriod,
  parseLocalDate,
} from '../commands/dailyNote';
import { openSourceAt } from '../commands/navigation';
import { setTaskDateField } from '../commands/agendaActions';
import { openTask, toggleTask } from '../commands/taskActions';
import { readWeekStart } from '../commands/datePrompt';
import { CalendarOptions, CalendarSnapshot, clampToMonth, createCalendar } from '../state/calendarState';
import { getCalendarHtml } from './calendarHtml';
import { parseCalendarMessage } from './messages';
import { onIndexUpdateInTurn, viewPriority, whenPublished } from '../../core/workspace/publishing';

interface CalendarIndexSource {
  readonly ready: Promise<void>;
  readonly published?: Promise<void>;
  readonly onDidUpdate: vscode.Event<unknown>;
  getSnapshot(): WorkspaceIndex;
}

/**
 * A month calendar in the Deckard sidebar. Each day shows whether it has a
 * daily note and how many open tasks are due; selecting a day, a week, or the
 * month opens its note, and offers to create one that does not exist yet.
 */
export class CalendarView
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private readonly disposables: vscode.Disposable[] = [];
  private viewDisposables: vscode.Disposable[] = [];
  private view: vscode.WebviewView | undefined;
  /** Whether the index changed while the calendar was hidden. */
  private isStale = false;
  public readonly controller: CalendarController;

  public constructor(private readonly indexer: CalendarIndexSource) {
    this.controller = new CalendarController(indexer, readDayPanel, () => this.refresh());
    this.disposables.push(
      onIndexUpdateInTurn(
        indexer,
        { name: 'Calendar', priority: () => viewPriority(this.view) },
        () => this.refresh(),
      ),
      // What counts as today moves at midnight.
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.refresh();
        }
      }),
      // The page reloads and asks for its state again when it is ready.
      onDidChangePageChrome(() => this.renderHtml()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration('deckard.calendar.weekStart') ||
          event.affectsConfiguration('deckard.calendar.dayPanel') ||
          event.affectsConfiguration('deckard.calendar.showRepeats') ||
          event.affectsConfiguration('deckard.tasks.needsNewDateAfterDays')
        ) {
          this.refresh();
        }
      }),
    );
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.disposeViewListeners();
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    this.viewDisposables = [
      webviewView.onDidDispose(() => {
        this.view = undefined;
        this.disposeViewListeners();
      }),
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible && this.isStale) {
          this.refresh();
        }
      }),
      webviewView.webview.onDidReceiveMessage((message) =>
        this.handleMessage(message),
      ),
    ];
    this.renderHtml();
    void whenPublished(this.indexer).then(() => this.refresh());
  }

  public dispose(): void {
    this.disposeViewListeners();
    this.view = undefined;
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  private disposeViewListeners(): void {
    this.viewDisposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  private renderHtml(): void {
    if (this.view) {
      this.view.webview.html = getCalendarHtml(this.view.webview);
    }
  }

  private refresh(): void {
    if (!this.view) {
      return;
    }
    // A hidden calendar keeps its month and catches up when shown again.
    if (!this.view.visible) {
      this.isStale = true;
      return;
    }
    this.isStale = false;
    void this.view.webview.postMessage({ type: 'state', data: this.controller.snapshot() });
  }

  private async handleMessage(value: unknown): Promise<void> {
    const message = parseCalendarMessage(value);
    if (message) {
      await this.controller.handle(message);
    }
  }
}

/**
 * The month and the day a calendar shows, and what it does when asked:
 * one for the sidebar Calendar and one for the calendar page, so the two
 * behave alike and each keeps its own place.
 */
export class CalendarController {
  public month = formatLocalDate(new Date()).slice(0, 7);
  /** The day chosen for the panel; today while none was chosen. */
  public selectedDate: string | undefined;

  public constructor(
    private readonly indexer: Pick<CalendarIndexSource, 'getSnapshot'>,
    /** Whether the day panel is showing, and so a new month keeps a chosen day. */
    private readonly dayPanel: () => boolean,
    /** Draws the calendar again, after its month or day changed. */
    private readonly refresh: () => void,
  ) {}

  /** The calendar as it is now, for the host to post. */
  public snapshot(options: CalendarOptions = {}): CalendarSnapshot {
    return measure('Calendar', () =>
      createCalendar(this.indexer.getSnapshot(), this.month, new Date(), readWeekStart(), {
        dayPanel: this.dayPanel(),
        selectedDate: this.selectedDate,
        showRepeats: readShowRepeats(),
        ...options,
      }),
    );
  }

  /**
   * What either calendar asks of its host, for the month and day it shows.
   * `ready` is the host's own, since only the host knows its webview.
   */
  public async handle(message: CalendarMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.refresh();
        return;
      case 'showMonth':
        this.month = message.month;
        // A new month keeps the chosen day's place in it.
        if (message.date) {
          this.selectedDate = message.date;
        } else if (this.selectedDate || this.dayPanel()) {
          this.selectedDate = clampToMonth(this.selectedDate ?? formatLocalDate(new Date()), message.month);
        }
        if (this.selectedDate === formatLocalDate(new Date())) {
          this.selectedDate = undefined;
        }
        this.refresh();
        return;
      case 'selectDay':
        // Today is held as no choice, so after midnight it is the new today.
        this.selectedDate = message.date === formatLocalDate(new Date()) ? undefined : message.date;
        if (message.date.slice(0, 7) !== this.month) {
          this.month = message.date.slice(0, 7);
        }
        this.refresh();
        return;
      case 'createDay': {
        const day = parseLocalDate(message.date);
        if (day) {
          await this.createPeriodNote('day', day);
        }
        return;
      }
      case 'openNote':
        if (this.indexer.getSnapshot().files.has(message.filePath)) {
          await openSourceAt(message.filePath, 1);
        }
        return;
      case 'searchCreated':
        await vscode.commands.executeCommand('deckard.search', `created = ${message.date}`);
        return;
      case 'openTask': {
        const task = this.indexer.getSnapshot().tasks.get(message.taskId);
        if (task) {
          await openTask(task);
        }
        return;
      }
      case 'toggleTask': {
        const task = this.indexer.getSnapshot().tasks.get(message.taskId);
        if (task) {
          await toggleTask(task, message.completed);
        }
        return;
      }
      case 'moveTask': {
        const task = this.indexer.getSnapshot().tasks.get(message.taskId);
        if (task && !task.completed) {
          await setTaskDateField(task, message.field, message.date);
        }
        return;
      }
      case 'openDay': {
        const note = listDailyNotes(this.indexer.getSnapshot()).find(
          (entry) => entry.date === message.date,
        );
        if (note) {
          await openSourceAt(note.filePath, 1);
          return;
        }
        await this.openPeriod('day', message.date);
        return;
      }
      case 'openWeek':
        await this.openPeriod('week', message.date);
        return;
      case 'openMonth':
        await this.openPeriod('month', `${this.month}-01`);
        return;
    }
  }

  /**
   * Opens a week's or month's note wherever the index has it, or offers to
   * create the note for a day, week, or month in the notes folder.
   */
  public async openPeriod(period: NotePeriod, date: string): Promise<void> {
    const day = parseLocalDate(date);
    if (!day) {
      return;
    }
    const weekStart = readWeekStart();
    const { name } = getPeriodicNote(period, day, weekStart);
    // A week or month may be kept under the name Deckard writes now or the
    // one it wrote before, and either is that period's note.
    const names = new Set(findPeriodicNoteNames(period, day, weekStart));
    const existing =
      period === 'day'
        ? undefined
        : [...this.indexer.getSnapshot().files.keys()]
            .sort()
            .find((filePath) =>
              names.has((filePath.split('/').pop() ?? '').replace(/\.md$/i, '')),
            );
    if (existing) {
      await openSourceAt(existing, 1);
      return;
    }
    const choice = await vscode.window.showInformationMessage(
      `There is no note for ${name} yet.`,
      'Create',
    );
    if (choice !== 'Create') {
      return;
    }
    await this.createPeriodNote(period, day);
  }

  /** Creates a day's, week's, or month's note from its template, and opens it. */
  private async createPeriodNote(period: NotePeriod, day: Date): Promise<void> {
    const folder = await chooseTargetFolder();
    if (!folder) {
      return;
    }
    const noteUri = await ensurePeriodicNote(folder, period, day);
    await vscode.window.showTextDocument(noteUri, { preview: false });
  }
}

/** `deckard.calendar.showRepeats`: whether a repeating task is drawn on its rule's later dates. */
export function readShowRepeats(): boolean {
  return vscode.workspace.getConfiguration('deckard').get<boolean>('calendar.showRepeats', true) !== false;
}

/** `deckard.calendar.dayPanel`: whether the chosen day shows below the month. */
export function readDayPanel(): boolean {
  return vscode.workspace.getConfiguration('deckard').get<boolean>('calendar.dayPanel', false) === true;
}
