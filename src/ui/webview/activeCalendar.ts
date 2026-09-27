import * as vscode from 'vscode';

import { CalendarDayDetail, CalendarMessage } from '../../core/types';

/** A calendar whose chosen day the Related Notes sidebar can show: the calendar page. */
export interface CalendarDaySource {
  /** The day chosen, as the day panel draws it, or undefined before the first draw. */
  getDay(): CalendarDayDetail | undefined;
  /** Does what the sidebar's copy of the panel asks, as the page's own panel would. */
  handleDayMessage(message: CalendarMessage): Promise<void>;
}

/**
 * Knows whether the calendar page is the active editor, and whether the
 * Related Notes sidebar is open to show its chosen day.
 *
 * While both are so, the day is shown in the sidebar and the page gives the
 * month its whole width; with the sidebar closed, or another editor in
 * front, the page keeps its own panel beside the month. It is ActiveSearch's
 * arrangement for Refine, for the calendar.
 */
export class ActiveCalendar implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly visibilityEmitter = new vscode.EventEmitter<void>();
  private source: CalendarDaySource | undefined;
  private sidebarVisible = false;

  /** Fires when the active calendar changes, or its chosen day does. */
  public readonly onDidChange = this.changeEmitter.event;
  /** Fires when the day moves between the sidebar and the page. */
  public readonly onDidChangeDayVisibility = this.visibilityEmitter.event;

  public constructor() {
    this.disposables.push(this.changeEmitter, this.visibilityEmitter);
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        // A text editor in front means the calendar page is not.
        if (editor) {
          this.setActive(undefined);
        }
      }),
    );
  }

  public get active(): CalendarDaySource | undefined {
    return this.source;
  }

  public setActive(source: CalendarDaySource | undefined): void {
    if (this.source === source) {
      return;
    }
    const was = this.source;
    this.source = source;
    this.changeEmitter.fire();
    if (this.sidebarVisible && (was || source)) {
      this.visibilityEmitter.fire();
    }
  }

  public release(source: CalendarDaySource): void {
    if (this.source === source) {
      this.setActive(undefined);
    }
  }

  /** Tells the sidebar the active calendar's day changed. */
  public notifyChanged(source: CalendarDaySource): void {
    if (this.source === source) {
      this.changeEmitter.fire();
    }
  }

  /** Whether the sidebar is showing this calendar's chosen day. */
  public isDayInSidebar(source: CalendarDaySource): boolean {
    return this.sidebarVisible && this.source === source;
  }

  /** Records whether the Related Notes sidebar is open. */
  public setSidebarVisible(visible: boolean): void {
    if (this.sidebarVisible === visible) {
      return;
    }
    this.sidebarVisible = visible;
    if (this.source) {
      this.visibilityEmitter.fire();
    }
  }

  public dispose(): void {
    this.source = undefined;
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }
}
