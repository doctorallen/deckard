import * as vscode from 'vscode';

import { measure } from '../../core/timing';
import { WorkspaceIndex } from '../../core/types';
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
import { createCalendar } from '../state/calendarState';
import { getCalendarHtml } from './calendarHtml';
import { parseCalendarMessage } from './messages';

interface CalendarIndexSource {
  readonly ready: Promise<void>;
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
  private month = formatLocalDate(new Date()).slice(0, 7);
  /** Whether the index changed while the calendar was hidden. */
  private isStale = false;

  public constructor(private readonly indexer: CalendarIndexSource) {
    this.disposables.push(
      indexer.onDidUpdate(() => this.refresh()),
      // What counts as today moves at midnight.
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.refresh();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard.theme')) {
          // The page reloads and asks for its state again when it is ready.
          this.renderHtml();
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
    void this.indexer.ready.then(() => this.refresh());
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
    void this.view.webview.postMessage({
      type: 'state',
      data: measure('Calendar', () =>
        createCalendar(this.indexer.getSnapshot(), this.month, new Date()),
      ),
    });
  }

  private async handleMessage(value: unknown): Promise<void> {
    const message = parseCalendarMessage(value);
    if (!message) {
      return;
    }
    switch (message.type) {
      case 'ready':
        this.refresh();
        return;
      case 'showMonth':
        this.month = message.month;
        this.refresh();
        return;
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
  private async openPeriod(period: NotePeriod, date: string): Promise<void> {
    const day = parseLocalDate(date);
    if (!day) {
      return;
    }
    const { name } = getPeriodicNote(period, day);
    // A week or month may be kept under the name Deckard writes now or the
    // one it wrote before, and either is that period's note.
    const names = new Set(findPeriodicNoteNames(period, day));
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
    const folder = await chooseTargetFolder();
    if (!folder) {
      return;
    }
    const noteUri = await ensurePeriodicNote(folder, period, day);
    await vscode.window.showTextDocument(noteUri, { preview: false });
  }
}
