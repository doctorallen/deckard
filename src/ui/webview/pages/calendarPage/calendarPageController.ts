import * as vscode from 'vscode';

import type {
  CalendarDayDetail,
  CalendarMoveRefusedMessage,
  CalendarPagePageToHost,
  CalendarSnapshot,
} from '../../../protocol/calendar';
import { settingTarget, writeSetting } from '../../../commands/settings';
import type { TaskWrites } from '../../../commands/taskActions';
import type { ActiveCalendar, CalendarDaySource } from '../../activeCalendar';
import { getCalendarHtml } from '../../calendarHtml';
import type { MessageHandlers, PageContext, PageController, PageOptions } from '../../host/pageController';
import { chooseTheme, openHelp, setZenMode } from '../../host/sharedHandlers';
import type { DeckardTheme } from '../../themeNames';
import {
  CalendarController,
  CalendarIndex,
  calendarHandlers,
  onDidFocusWindow,
  readShowRepeats,
  readShowWeekends,
} from '../calendar/calendarController';
import { narrowCalendarPageMessage } from './messages';

/** What the calendar page is drawn from, what it writes through, and whom it tells. */
export interface CalendarPageControllerOptions {
  indexer: CalendarIndex;
  /** What checking a task off, or dropping it on a day, writes through. */
  writes: TaskWrites;
  /** Where the page says it is in front, so Related Notes can show its day. */
  activeCalendar?: ActiveCalendar;
  /** The page as Related Notes knows it: what it reads the day from and hands the day's messages to. */
  source: CalendarDaySource;
  /** Sends the page its snapshot through its host, or marks it stale while hidden. */
  refresh: () => void;
  /** Sends the page one message through its host, while it is open. */
  post: (message: CalendarMoveRefusedMessage) => void;
}

/**
 * The calendar as a page of its own: a month, or a week, of days large
 * enough to list their tasks by name, with the chosen day's panel beside
 * it. It keeps its own month and day in `calendar`, apart from the sidebar
 * Calendar's, and does what the sidebar's does through the same
 * `CalendarController`.
 *
 * While it is in front and Related Notes is open, the chosen day moves to
 * the sidebar and the month takes the page's width.
 */
export class CalendarPageController implements PageController<CalendarSnapshot, CalendarPagePageToHost> {
  public readonly name = 'Calendar page';
  /**
   * A theme or zen change only resets the HTML; the page then reloads and
   * asks for its state with `ready`.
   */
  public readonly options: PageOptions = {
    retainContextWhenHidden: true,
    enableFindWidget: false,
    followIndexing: false,
    onChromeChange: 'reload',
    // CalendarController times the calendar it builds, as "Calendar".
    measure: false,
  };
  public readonly narrow = narrowCalendarPageMessage;
  public readonly handlers: MessageHandlers<CalendarPagePageToHost>;
  /** The month and the day the page shows, apart from the sidebar's. */
  public readonly calendar: CalendarController;
  /** The chosen day as last drawn, which Related Notes shows while the page is in front. */
  private day: CalendarDayDetail | undefined;

  /** Starts on this month, with the day panel always on. */
  public constructor(private readonly calendarPage: CalendarPageControllerOptions) {
    // The page always shows the chosen day: it has the room.
    this.calendar = new CalendarController(calendarPage.indexer, calendarPage.writes, {
      dayPanel: () => true,
      refresh: calendarPage.refresh,
      refused: (taskId) => {
        calendarPage.post({ type: 'moveRefused', taskId });
        calendarPage.refresh();
      },
    });
    this.handlers = {
      ...calendarHandlers(this.calendar),
      setShowRepeats: async (message) => {
        if (message.show !== readShowRepeats()) {
          await writeSetting('calendar.showRepeats', message.show, settingTarget('calendar.showRepeats'));
        }
      },
      setShowWeekends: async (message) => {
        if (message.show !== readShowWeekends()) {
          await writeSetting('calendar.showWeekends', message.show, settingTarget('calendar.showWeekends'));
        }
      },
      setZenMode: setZenMode(),
      chooseTheme: chooseTheme(),
      openHelp: openHelp('periodic'),
    };
  }

  /** The calendar's HTML, laid out as a page rather than for the sidebar. */
  public html(webview: vscode.Webview, theme: DeckardTheme): string {
    return getCalendarHtml(webview, { page: true, theme });
  }

  /**
   * The month or week as it is now, with the chosen day's panel, which is
   * kept for Related Notes.
   */
  public buildSnapshot(): CalendarSnapshot {
    const snapshot = this.calendar.snapshot({ layout: 'page', dayPanel: true });
    this.day = snapshot.selected;
    return {
      ...snapshot,
      // Related Notes is showing the day, so the month takes the width.
      ...(this.calendarPage.activeCalendar?.isShownInSidebar(this.calendarPage.source) ? { dayInSidebar: true } : {}),
    };
  }

  /** The chosen day as last drawn, or undefined before the first draw and after the page closes. */
  public getDay(): CalendarDayDetail | undefined {
    return this.day;
  }

  /**
   * Redraws when today may have moved, when the day moves to or from the
   * sidebar, and when a calendar setting changes.
   */
  public subscribe(page: PageContext): vscode.Disposable[] {
    const { activeCalendar } = this.calendarPage;
    return [
      onDidFocusWindow(() => page.refresh()),
      // The day moving to or from the sidebar redraws the page with or
      // without its own panel.
      ...(activeCalendar ? [activeCalendar.onDidChangeSidebarVisibility(() => page.refresh())] : []),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration('deckard.calendar.weekStart') ||
          event.affectsConfiguration('deckard.calendar.showRepeats') ||
          event.affectsConfiguration('deckard.calendar.showWeekends') ||
          event.affectsConfiguration('deckard.tasks.needsNewDateAfterDays')
        ) {
          page.refresh();
        }
      }),
    ];
  }

  /** Tells Related Notes the day it may be showing was drawn again. */
  public onDidSendSnapshot(): void {
    this.calendarPage.activeCalendar?.notifyChanged(this.calendarPage.source);
  }

  /** A new or restored panel says whether it is in front. */
  public onDidAttach(page: PageContext): void {
    this.updateActivity(page.surface?.active === true);
  }

  /** The panel coming to the front or leaving it says so, so Related Notes follows it. */
  public onDidChangeViewState(page: PageContext): void {
    this.updateActivity(page.surface?.active === true);
  }

  /** A closed page has no day to show, and is no longer in front. */
  public onDidDetach(): void {
    this.day = undefined;
    this.calendarPage.activeCalendar?.release(this.calendarPage.source);
  }

  /** The page stops being in front before its panel closes. */
  public dispose(): void {
    this.calendarPage.activeCalendar?.release(this.calendarPage.source);
  }

  /** Says the page is in front, or is not, so Related Notes follows it. */
  private updateActivity(active: boolean): void {
    if (active) {
      this.calendarPage.activeCalendar?.setActive(this.calendarPage.source);
    } else {
      this.calendarPage.activeCalendar?.release(this.calendarPage.source);
    }
  }
}
