import * as vscode from 'vscode';

import type { WorkspaceIndex } from '../../../../domain/model';
import { measure } from '../../../../shared/timing';
import type { CalendarMessage, CalendarPageToHost, CalendarSnapshot } from '../../../protocol/calendar';
import { setTaskDateField } from '../../../commands/agendaActions';
import {
  chooseTargetFolder,
  ensurePeriodicNote,
  findPeriodicNoteNames,
  formatLocalDate,
  getPeriodicNote,
  listDailyNotes,
  NotePeriod,
  parseLocalDate,
} from '../../../commands/dailyNote';
import { readWeekStart } from '../../../commands/datePrompt';
import { openSourceAt } from '../../../commands/navigation';
import { readQueryContext } from '../../../commands/queryContext';
import { openTask, TaskWrites, toggleTask } from '../../../commands/taskActions';
import { CalendarOptions, clampToMonth, createCalendar } from '../../../state/calendarState';
import { getCalendarHtml } from '../../calendarHtml';
import { onDidChangePageChrome } from '../../components';
import type { MessageHandlers, PageContext, PageController, PageOptions } from '../../host/pageController';
import { ready } from '../../host/sharedHandlers';
import type { DeckardTheme } from '../../themeNames';
import type { ThemePreview } from '../../themePreview';
import { getDeckardTheme } from '../../themes';
import { narrowCalendarMessage } from './messages';

/** The index a calendar reads its days, notes, and tasks from. */
export interface CalendarIndex {
  getSnapshot(): WorkspaceIndex;
}

/** What a calendar's controller asks of the view or page that shows it. */
export interface CalendarControllerHost {
  /** Whether the day panel is showing, and so a new month keeps a chosen day. */
  dayPanel: () => boolean;
  /** Draws the calendar again, after its month or day changed. */
  refresh: () => void;
  /** Says a task was not moved, so a page that moved it at once can say so. */
  refused?: (taskId: string) => void;
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

  /** Starts on this month, with no day chosen. */
  public constructor(
    private readonly indexer: CalendarIndex,
    /** What checking a task off, or dropping it on a day, writes through. */
    private readonly writes: TaskWrites,
    private readonly host: CalendarControllerHost,
  ) {}

  /**
   * The calendar as it is now, for the host to post, timed in the log as
   * "Calendar" for either calendar, as it always was.
   */
  public snapshot(options: CalendarOptions = {}): CalendarSnapshot {
    return measure('Calendar', () =>
      createCalendar(this.indexer.getSnapshot(), this.month, readQueryContext(), {
        dayPanel: this.host.dayPanel(),
        selectedDate: this.selectedDate,
        showRepeats: readShowRepeats(),
        showWeekends: readShowWeekends(),
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
        this.host.refresh();
        return;
      case 'showMonth':
        this.month = message.month;
        // A new month keeps the chosen day's place in it.
        if (message.date) {
          this.selectedDate = message.date;
        } else if (this.selectedDate || this.host.dayPanel()) {
          this.selectedDate = clampToMonth(this.selectedDate ?? formatLocalDate(new Date()), message.month);
        }
        if (this.selectedDate === formatLocalDate(new Date())) {
          this.selectedDate = undefined;
        }
        this.host.refresh();
        return;
      case 'selectDay':
        // Today is held as no choice, so after midnight it is the new today.
        this.selectedDate = message.date === formatLocalDate(new Date()) ? undefined : message.date;
        if (message.date.slice(0, 7) !== this.month) {
          this.month = message.date.slice(0, 7);
        }
        this.host.refresh();
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
          await openSourceAt({ filePath: message.filePath, line: 1 });
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
          await toggleTask(this.writes, task, message.completed);
        }
        return;
      }
      case 'moveTask': {
        const task = this.indexer.getSnapshot().tasks.get(message.taskId);
        const moved = task && !task.completed ? await setTaskDateField(this.writes, task, message.field, message.date) : false;
        if (!moved) {
          this.host.refused?.(message.taskId);
        }
        return;
      }
      case 'openDay': {
        const note = listDailyNotes(this.indexer.getSnapshot()).find(
          (entry) => entry.date === message.date,
        );
        if (note) {
          await openSourceAt({ filePath: note.filePath, line: 1 });
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
      await openSourceAt({ filePath: existing, line: 1 });
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

/** `deckard.calendar.showWeekends`: whether Saturday and Sunday are drawn. */
export function readShowWeekends(): boolean {
  return vscode.workspace.getConfiguration('deckard').get<boolean>('calendar.showWeekends', true) !== false;
}

/** `deckard.calendar.showRepeats`: whether a repeating task is drawn on its rule's later dates. */
export function readShowRepeats(): boolean {
  return vscode.workspace.getConfiguration('deckard').get<boolean>('calendar.showRepeats', true) !== false;
}

/** `deckard.calendar.dayPanel`: whether the chosen day shows below the month. */
export function readDayPanel(): boolean {
  return vscode.workspace.getConfiguration('deckard').get<boolean>('calendar.dayPanel', false) === true;
}

/** What the sidebar Calendar is drawn from, and what it writes through. */
export interface CalendarViewControllerOptions {
  indexer: CalendarIndex;
  /** What checking a task off, or dropping it on a day, writes through. */
  writes: TaskWrites;
  /** The theme Choose Theme… is previewing, which the calendar draws in. */
  themePreview: Pick<ThemePreview, 'current' | 'onDidChange'>;
  /** Sends the calendar its snapshot through its host, or marks it stale while hidden. */
  refresh: () => void;
}

/**
 * The sidebar Calendar, a month in the Deckard sidebar. Each day shows
 * whether it has a daily note and how many open tasks are due; selecting a
 * day, a week, or the month opens its note, and offers to create one that
 * does not exist yet. Its month and day are `calendar`'s, which does what
 * each message asks.
 */
export class CalendarViewController implements PageController<CalendarSnapshot, CalendarPageToHost> {
  public readonly name = 'Calendar';
  /**
   * The view's registration keeps it running while hidden. A theme or zen
   * change is listened for in `subscribe`, so the host leaves it alone.
   */
  public readonly options: PageOptions = {
    retainContextWhenHidden: true,
    enableFindWidget: false,
    followIndexing: false,
    onChromeChange: 'none',
    // CalendarController times the calendar it builds.
    measure: false,
  };
  public readonly narrow = narrowCalendarMessage;
  public readonly handlers: MessageHandlers<CalendarPageToHost>;
  /** The month and the day the sidebar shows, apart from the page's. */
  public readonly calendar: CalendarController;

  /** Starts on this month, with the day panel as `deckard.calendar.dayPanel` says. */
  public constructor(private readonly view: CalendarViewControllerOptions) {
    this.calendar = new CalendarController(view.indexer, view.writes, {
      dayPanel: readDayPanel,
      refresh: view.refresh,
    });
    this.handlers = calendarHandlers(this.calendar);
  }

  /** The sidebar Calendar's HTML. */
  public html(webview: vscode.Webview, theme: DeckardTheme): string {
    return getCalendarHtml(webview, { theme });
  }

  /** The month as it is now. */
  public buildSnapshot(): CalendarSnapshot {
    return this.calendar.snapshot();
  }

  /** Redraws when today may have moved, on a theme or zen change, and when a calendar setting changes. */
  public subscribe(page: PageContext): vscode.Disposable[] {
    return [
      onDidFocusWindow(() => page.refresh()),
      onDidChangeCalendarChrome(page, (webview, theme) => this.html(webview, theme), this.view.themePreview),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration('deckard.calendar.weekStart') ||
          event.affectsConfiguration('deckard.calendar.dayPanel') ||
          event.affectsConfiguration('deckard.calendar.showRepeats') ||
          event.affectsConfiguration('deckard.calendar.showWeekends') ||
          event.affectsConfiguration('deckard.tasks.needsNewDateAfterDays')
        ) {
          page.refresh();
        }
      }),
    ];
  }
}

/**
 * The handlers both calendars share, one for each message the sidebar
 * Calendar sends. `ready` asks for the snapshot again; every other message
 * is `calendar`'s to act on, for the month and day it shows.
 */
export function calendarHandlers(calendar: CalendarController): MessageHandlers<CalendarPageToHost> {
  const handle = (message: CalendarMessage): Promise<void> => calendar.handle(message);
  return {
    ready: ready(),
    openMonth: handle,
    showMonth: handle,
    openDay: handle,
    openWeek: handle,
    selectDay: handle,
    createDay: handle,
    openNote: handle,
    openTask: handle,
    toggleTask: handle,
    moveTask: handle,
    searchCreated: handle,
  };
}

/** Calls back when the window comes into focus: what counts as today moves at midnight. */
export function onDidFocusWindow(listener: () => void): vscode.Disposable {
  return vscode.window.onDidChangeWindowState((state) => {
    if (state.focused) {
      listener();
    }
  });
}

/**
 * Sets a calendar's HTML again on a theme or zen change; the page then
 * reloads and asks for its state with `ready`. A calendar listens for this
 * itself, between its focus and settings listeners, where it always has,
 * rather than through the host, which would listen after both: one settings
 * change that touches the theme and a calendar setting still resets the
 * HTML before the snapshot is posted.
 */
export function onDidChangeCalendarChrome(
  page: PageContext,
  html: (webview: vscode.Webview, theme: DeckardTheme) => string,
  themePreview: Pick<ThemePreview, 'current' | 'onDidChange'>,
): vscode.Disposable {
  return onDidChangePageChrome(
    () => page.surface?.render((webview) => html(webview, getDeckardTheme(themePreview))),
    themePreview,
  );
}
