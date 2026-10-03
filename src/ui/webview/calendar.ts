import * as vscode from 'vscode';

import type { WorkspaceIndex } from '../../domain/model';
import type { CalendarPageToHost, CalendarSnapshot } from '../protocol/calendar';
import type { TaskWrites } from '../commands/taskActions';
import { ViewAdapter } from './host/viewAdapter';
import { WebviewHost } from './host/webviewHost';
import { CalendarController, CalendarViewController } from './pages/calendar/calendarController';
import type { ThemePreview } from './themePreview';

/** The index the sidebar Calendar is drawn from and redraws on. */
interface CalendarIndexSource {
  readonly ready: Promise<void>;
  readonly published?: Promise<void>;
  readonly onDidUpdate: vscode.Event<unknown>;
  getSnapshot(): WorkspaceIndex;
}

/** What the sidebar Calendar is built from. */
export interface CalendarViewOptions {
  indexer: CalendarIndexSource;
  /** What checking a task off, or dropping it on a day, writes through. */
  writes: TaskWrites;
  /** The theme Choose Theme… is previewing, which the calendar draws in. */
  themePreview: ThemePreview;
  /** The extension's folder, which the calendar's style sheets are under. */
  extensionUri: vscode.Uri;
  /** Opens a tag's page, as a tag in a task's title in the day panel asks. */
  openTag: (tagKey: string) => unknown;
}

/**
 * A month calendar in the Deckard sidebar. Each day shows whether it has a
 * daily note and how many open tasks are due; selecting a day, a week, or the
 * month opens its note, and offers to create one that does not exist yet.
 *
 * The page is `CalendarViewController`, run by a `WebviewHost` in the view
 * VS Code resolves; this is the name the extension registers it by.
 */
export class CalendarView implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly page: ViewAdapter<CalendarSnapshot, CalendarPageToHost>;
  /** The month and day the sidebar shows, which the calendar page opens on. */
  public readonly controller: CalendarController;

  /** Builds the calendar; nothing is drawn until VS Code resolves its view. */
  public constructor(options: CalendarViewOptions) {
    const { indexer, themePreview, extensionUri } = options;
    const controller = new CalendarViewController({
      indexer,
      writes: options.writes,
      refresh: () => this.page.host.refresh(),
      post: (message) => this.page.host.post(message),
      openTag: options.openTag,
      extensionUri,
    });
    this.controller = controller.calendar;
    this.page = new ViewAdapter(new WebviewHost(controller, { indexer, themePreview }), extensionUri);
  }

  /** Draws the calendar in the view VS Code made, and again once there are notes. */
  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.page.resolveWebviewView(webviewView);
  }

  /** Stops every listener; the view is VS Code's to close. */
  public dispose(): void {
    this.page.dispose();
  }
}
