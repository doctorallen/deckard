import * as vscode from 'vscode';

import { onIndexUpdateInTurn, whenPublished } from '../../core/workspace/publishing';
import { viewPriority } from './panelPriority';
import { CalendarDayDetail, CalendarMessage, WorkspaceIndex } from '../../core/types';
import { ActiveCalendar, CalendarDaySource } from './activeCalendar';
import { settingTarget, writeSetting } from '../commands/settings';
import { CalendarController, readShowRepeats, readShowWeekends } from './calendar';
import { getCalendarHtml } from './calendarHtml';
import { onDidChangePageChrome } from './components';
import { parseCalendarPageMessage } from './messages';
import { setZenMode } from './zenMode';

interface CalendarPageIndexSource {
  readonly ready: Promise<void>;
  readonly published?: Promise<void>;
  readonly onDidUpdate: vscode.Event<unknown>;
  getSnapshot(): WorkspaceIndex;
}

/**
 * The calendar as a page of its own: a month, or a week, of days large
 * enough to list their tasks by name, with the chosen day's panel beside
 * it. It keeps its own month and day, apart from the sidebar Calendar's,
 * and does what the sidebar's does through the same controller.
 */
export class CalendarPanel implements CalendarDaySource, vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private panelDisposables: vscode.Disposable[] = [];
  /** Whether the index changed while the page was hidden. */
  private isStale = false;
  public readonly controller: CalendarController;
  /** The chosen day as last drawn, which Related Notes shows while the page is in front. */
  private day: CalendarDayDetail | undefined;

  public constructor(
    private readonly indexer: CalendarPageIndexSource,
    private readonly extensionUri: vscode.Uri,
    /** Where the page says it is in front, so Related Notes can show its day. */
    private readonly activeCalendar?: ActiveCalendar,
  ) {
    // The page always shows the chosen day: it has the room.
    this.controller = new CalendarController(
      indexer,
      () => true,
      () => this.refresh(),
      (taskId) => {
        void this.panel?.webview.postMessage({ type: 'moveRefused', taskId });
        this.refresh();
      },
    );
    this.disposables.push(
      onIndexUpdateInTurn(
        indexer,
        { name: 'Calendar page', priority: () => viewPriority(this.panel) },
        () => this.refresh(),
      ),
      // What counts as today moves at midnight.
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.refresh();
        }
      }),
      onDidChangePageChrome(() => this.renderHtml()),
      // The day moving to or from the sidebar redraws the page with or
      // without its own panel.
      ...(activeCalendar ? [activeCalendar.onDidChangeDayVisibility(() => this.refresh())] : []),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration('deckard.calendar.weekStart') ||
          event.affectsConfiguration('deckard.calendar.showRepeats') ||
          event.affectsConfiguration('deckard.calendar.showWeekends') ||
          event.affectsConfiguration('deckard.tasks.needsNewDateAfterDays')
        ) {
          this.refresh();
        }
      }),
    );
  }

  /** Opens the page, on a month and a day when given, such as the sidebar's. */
  public async show(month?: string, date?: string): Promise<void> {
    if (month) {
      this.controller.month = month;
    }
    if (date) {
      this.controller.selectedDate = date;
    }
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      this.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'deckard.calendarPage',
      'Deckard Calendar',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.attachPanel(panel);
    await whenPublished(this.indexer);
    this.refresh();
  }

  /** Takes back a page VS Code kept across a reload. */
  public async restore(panel: vscode.WebviewPanel): Promise<void> {
    if (this.panel) {
      panel.dispose();
      return;
    }
    this.attachPanel(panel);
    await whenPublished(this.indexer);
    this.refresh();
  }

  public getDay(): CalendarDayDetail | undefined {
    return this.day;
  }

  public async handleDayMessage(message: CalendarMessage): Promise<void> {
    await this.controller.handle(message);
  }

  public dispose(): void {
    this.activeCalendar?.release(this);
    this.disposePanelListeners();
    this.panel?.dispose();
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  private attachPanel(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'resources', 'views', 'calendar.svg');
    panel.webview.options = { enableScripts: true };
    this.renderHtml();
    this.panelDisposables = [
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.day = undefined;
        this.activeCalendar?.release(this);
        this.disposePanelListeners();
      }),
      panel.webview.onDidReceiveMessage((message: unknown) => this.handleMessage(message)),
      panel.onDidChangeViewState(() => {
        if (panel.visible && this.isStale) {
          this.refresh();
        }
        this.updateActivity(panel.active);
      }),
    ];
    this.updateActivity(panel.active);
  }

  /** Says the page is in front, or is not, so Related Notes follows it. */
  private updateActivity(active: boolean): void {
    if (active) {
      this.activeCalendar?.setActive(this);
    } else {
      this.activeCalendar?.release(this);
    }
  }

  private disposePanelListeners(): void {
    this.panelDisposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  private renderHtml(): void {
    if (this.panel) {
      this.panel.webview.html = getCalendarHtml(this.panel.webview, { page: true });
    }
  }

  private refresh(): void {
    if (!this.panel) {
      return;
    }
    // A hidden page keeps its month and catches up when shown again.
    if (!this.panel.visible) {
      this.isStale = true;
      return;
    }
    this.isStale = false;
    const snapshot = this.controller.snapshot({ layout: 'page', dayPanel: true });
    this.day = snapshot.selected;
    void this.panel.webview.postMessage({
      type: 'state',
      data: {
        ...snapshot,
        // Related Notes is showing the day, so the month takes the width.
        ...(this.activeCalendar?.isDayInSidebar(this) ? { dayInSidebar: true } : {}),
      },
    });
    this.activeCalendar?.notifyChanged(this);
  }

  public async handleMessage(value: unknown): Promise<void> {
    const message = parseCalendarPageMessage(value);
    if (!message) {
      return;
    }
    switch (message.type) {
      case 'setShowRepeats':
        if (message.show !== readShowRepeats()) {
          await writeSetting('calendar.showRepeats', message.show, settingTarget('calendar.showRepeats'));
        }
        return;
      case 'setShowWeekends':
        if (message.show !== readShowWeekends()) {
          await writeSetting('calendar.showWeekends', message.show, settingTarget('calendar.showWeekends'));
        }
        return;
      case 'setZenMode':
        await setZenMode(message.enabled);
        return;
      case 'chooseTheme':
        await vscode.commands.executeCommand('deckard.chooseTheme');
        return;
      case 'openHelp':
        await vscode.commands.executeCommand('deckard.showHelp', 'periodic');
        return;
      default:
        await this.controller.handle(message);
    }
  }
}
