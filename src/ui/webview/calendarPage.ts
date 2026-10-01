import * as vscode from 'vscode';

import type { WorkspaceIndex } from '../../domain/model';
import type { CalendarDayDetail, CalendarMessage, CalendarPagePageToHost, CalendarSnapshot } from '../protocol/calendar';
import type { TaskWrites } from '../commands/taskActions';
import type { ActiveCalendar, CalendarDaySource } from './activeCalendar';
import { PanelAdapter } from './host/panelAdapter';
import { viewPriority } from './host/panelPriority';
import { WebviewHost } from './host/webviewHost';
import type { CalendarController } from './pages/calendar/calendarController';
import { CalendarPageController } from './pages/calendarPage/calendarPageController';
import type { ThemePreview } from './themePreview';

/** The index the calendar page is drawn from and redraws on. */
interface CalendarPageIndexSource {
  readonly ready: Promise<void>;
  readonly published?: Promise<void>;
  readonly onDidUpdate: vscode.Event<unknown>;
  getSnapshot(): WorkspaceIndex;
}

/** What the calendar page is built from. */
export interface CalendarPanelOptions {
  indexer: CalendarPageIndexSource;
  extensionUri: vscode.Uri;
  /** What checking a task off, or dropping it on a day, writes through. */
  writes: TaskWrites;
  /** The theme Choose Theme… is previewing, which the page draws in. */
  themePreview: ThemePreview;
  /** Where the page says it is in front, so Related Notes can show its day. */
  activeCalendar?: ActiveCalendar;
}

/**
 * The calendar as a page of its own: a month, or a week, of days large
 * enough to list their tasks by name, with the chosen day's panel beside
 * it. It keeps its own month and day, apart from the sidebar Calendar's,
 * and does what the sidebar's does through the same controller.
 *
 * The page is `CalendarPageController`, run by a `WebviewHost` in one
 * panel; this is the name the extension and its serializer know it by, and
 * what Related Notes reads the chosen day from while the page is in front.
 */
export class CalendarPanel implements CalendarDaySource, vscode.Disposable {
  private readonly page: PanelAdapter<CalendarSnapshot, CalendarPagePageToHost>;
  private readonly pageController: CalendarPageController;
  /** The month and day the page shows. */
  public readonly controller: CalendarController;

  /** Builds the page; nothing is shown until `show` or `restore`. */
  public constructor(options: CalendarPanelOptions) {
    const { indexer, themePreview } = options;
    this.pageController = new CalendarPageController({
      indexer,
      writes: options.writes,
      activeCalendar: options.activeCalendar,
      source: this,
      refresh: () => this.page.host.refresh(),
      post: (message) => this.page.host.post(message),
      extensionUri: options.extensionUri,
    });
    this.controller = this.pageController.calendar;
    // The page ranks for a redraw as a side view does: never ahead of the
    // editor in front.
    this.page = new PanelAdapter(new WebviewHost(this.pageController, { indexer, themePreview }), {
      viewType: 'deckard.calendarPage',
      title: 'Deckard Calendar',
      extensionUri: options.extensionUri,
      icon: ['resources', 'views', 'calendar.svg'],
      priority: viewPriority,
    });
  }

  /**
   * Opens the page, on a month and a day when given, such as the sidebar's.
   * An open page is brought forward and drawn at once; a new one is drawn
   * once the index has notes to show.
   */
  public async show(month?: string, date?: string): Promise<void> {
    if (month) {
      this.controller.month = month;
    }
    if (date) {
      this.controller.selectedDate = date;
    }
    const open = this.page.panel;
    if (open) {
      open.reveal(vscode.ViewColumn.Active);
      this.page.host.refresh();
      return;
    }
    this.page.open();
    await this.page.host.whenPublished();
    this.page.host.refresh();
  }

  /** Takes back a page VS Code kept across a reload. */
  public restore(panel: vscode.WebviewPanel): Promise<void> {
    return this.page.restore(panel);
  }

  /** The chosen day as last drawn, which Related Notes shows while the page is in front. */
  public getDay(): CalendarDayDetail | undefined {
    return this.pageController.getDay();
  }

  /** Does what Related Notes' copy of the day panel asks, as the page's own panel would. */
  public async handleDayMessage(message: CalendarMessage): Promise<void> {
    await this.controller.handle(message);
  }

  /** Closes the page, if it is open, and stops every listener. */
  public dispose(): void {
    this.page.dispose();
  }
}
