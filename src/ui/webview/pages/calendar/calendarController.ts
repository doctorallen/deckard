import * as vscode from 'vscode';

import { isOpenTask } from '../../../../domain/tasks/taskStatuses';
import { openNoteAt } from '../../../commands/noteOpening';
import { sameShownDayIn } from '../../../../domain/markdown/calendar';
import type { WorkspaceIndex } from '../../../../domain/model';
import { NavigationService } from '../../../../services/navigationService';
import { measure } from '../../../../shared/timing';
import type {
  CalendarMessage,
  CalendarMoveRefusedMessage,
  CalendarMoveTaskMessage,
  CalendarPageToHost,
  CalendarShowMonthMessage,
  CalendarSnapshot,
} from '../../../protocol/calendar';
import { setTaskDateField } from '../../../commands/agendaActions';
import { chooseTargetFolder, ensurePeriodicNote } from '../../../commands/dailyNote';
import { readWeekStart } from '../../../commands/datePrompt';
import { readQueryContext } from '../../../commands/queryContext';
import { openTask, TaskWrites, toggleTask } from '../../../commands/taskActions';
import { CalendarOptions, createCalendar } from '../../../state/calendarState';
import { getCalendarHtml } from '../../calendarHtml';
import type { MessageHandlers, PageContext, PageController, PageOptions } from '../../host/pageController';
import { ready } from '../../host/sharedHandlers';
import type { PageChrome } from '../../components';
import { narrowCalendarMessage } from './messages';
import {
  findPeriodicNoteNames,
  formatLocalDate,
  getPeriodicNote,
  listDailyNotes,
  NotePeriod,
  parseLocalDate,
} from '../../../../domain/notes/periodicNotes';

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
  /**
   * Says a task was not moved, so a page that moved it at once can say so,
   * with the move's number when the page gave it one.
   */
  refused?: (taskId: string, requestId: number | undefined) => void;
  /** Opens a tag's page, by its key in the index, as a tag in a task's title asks. */
  openTag: (tagKey: string) => unknown;
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
  private readonly navigation = new NavigationService();

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
        this.showMonth(message);
        return;
      case 'selectDay':
        this.selectDay(message.date);
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
          await openNoteAt(message.filePath, 1, { pin: true, opposite: message.opposite === true });
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
      case 'moveTask':
        await this.moveTask(message);
        return;
      case 'openDay':
        await this.openDay(message.date);
        return;
      case 'openWeek':
        await this.openPeriod('week', message.date);
        return;
      case 'openMonth':
        await this.openPeriod('month', `${this.month}-01`);
        return;
      case 'openTag': {
        // The day panel may have been drawn before the tag was renamed, so
        // the tag is found as the other pages find a tag a title names.
        const tag = this.navigation.resolveTag(this.indexer.getSnapshot(), message.tagKey, 'lenient');
        if (tag.kind === 'open') {
          await this.host.openTag(tag.tagKey);
        }
        return;
      }
    }
  }

  /**
   * Shows another month, drawn at the next refresh, with a day of it
   * chosen: `date` when it is in that month, else the place in it of
   * `date`, of the chosen day, or, with the panel on, of today. With the
   * panel off and no day chosen, none is.
   */
  public moveToMonth(month: string, date?: string): void {
    this.month = month;
    const today = formatLocalDate(new Date());
    const from = date ?? this.selectedDate ?? (this.host.dayPanel() ? today : undefined);
    // The chosen day is always one of the month shown: a day outside it
    // would leave the page's Week layout drawing one week while it stepped
    // from another. With the weekends hidden it is a weekday, as a step on
    // the page lands, since a hidden day can be neither seen nor focused.
    if (from !== undefined) {
      this.selectedDate = from.slice(0, 7) === month ? from : sameShownDayIn(from, month, !readShowWeekends());
    }
    if (this.selectedDate === today) {
      this.selectedDate = undefined;
    }
  }

  /** Steps to another month, taking the day the step chose or keeping the chosen day's place in it. */
  private showMonth(message: CalendarShowMonthMessage): void {
    this.moveToMonth(message.month, message.date);
    this.host.refresh();
  }

  /** Chooses a day, moving to its month when it lies in another. */
  private selectDay(date: string): void {
    // Today is held as no choice, so after midnight it is the new today.
    this.selectedDate = date === formatLocalDate(new Date()) ? undefined : date;
    if (date.slice(0, 7) !== this.month) {
      this.month = date.slice(0, 7);
    }
    this.host.refresh();
  }

  /**
   * Moves an open task to the day it was dropped on; a completed or vanished
   * task, or a write that did not land, is handed back to the page as refused.
   */
  private async moveTask(message: CalendarMoveTaskMessage): Promise<void> {
    const task = this.indexer.getSnapshot().tasks.get(message.taskId);
    const moved = task && isOpenTask(task) ? await setTaskDateField(this.writes, task, message.field, message.date) : false;
    if (!moved) {
      this.host.refused?.(message.taskId, message.requestId);
    }
  }

  /** Opens the daily note the index has for a day, or offers to create one. */
  private async openDay(date: string): Promise<void> {
    const note = listDailyNotes(this.indexer.getSnapshot()).find(
      (entry) => entry.date === date,
    );
    if (note) {
      await openNoteAt(note.filePath, 1, { pin: true });
      return;
    }
    await this.openPeriod('day', date);
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
      await openNoteAt(existing, 1, { pin: true });
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
  /** Sends the calendar its snapshot through its host, or marks it stale while hidden. */
  refresh: () => void;
  /** Sends the calendar one message through its host, while it is drawn. */
  post: (message: CalendarMoveRefusedMessage) => void;
  /** Opens a tag's page, as a tag in a task's title in the day panel asks. */
  openTag: (tagKey: string) => unknown;
  /** The extension's folder, which the page's style sheets are under. */
  extensionUri: vscode.Uri;
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
   * The view is not kept running while hidden (Q1 of
   * docs/implementation/20-webviews.md): hidden, its HTML is set again with
   * the last month it was sent, which it draws when shown. A theme or zen
   * change only resets the HTML; the page then reloads and asks for its
   * state with `ready`. Its HTML carries the month, built when it is set
   * (15 ms median on the 5,000-note bench, under Q3's 50 ms).
   */
  public readonly options: PageOptions = {
    retainContextWhenHidden: false,
    enableFindWidget: false,
    followIndexing: false,
    onChromeChange: 'reload',
    // CalendarController times the calendar it builds.
    measure: false,
    readsInertState: true,
    embedsSnapshot: true,
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
      openTag: view.openTag,
      // A move the day panel asked for that could not be made is said, as
      // on the calendar page, and the panel drawn again as it is.
      refused: (taskId, requestId) => {
        view.post({ type: 'moveRefused', taskId, ...(requestId === undefined ? {} : { requestId }) });
        view.refresh();
      },
    });
    this.handlers = calendarHandlers(this.calendar);
  }

  /** The sidebar Calendar's HTML, carrying the month when given one. */
  public html(webview: vscode.Webview, chrome: PageChrome, state?: CalendarSnapshot): string {
    return getCalendarHtml(webview, this.view.extensionUri, { chrome, state });
  }

  /** The month as it is now. */
  public buildSnapshot(): CalendarSnapshot {
    return this.calendar.snapshot();
  }

  /** Redraws when today may have moved, and when a calendar setting changes. */
  public subscribe(page: PageContext): vscode.Disposable[] {
    return [
      onDidFocusWindow(() => page.refresh()),
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
    openTag: handle,
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
