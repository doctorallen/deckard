import type * as vscode from 'vscode';

/**
 * Disposes what it holds, in the order it was handed them, when it is itself
 * disposed.
 *
 * VS Code disposes `context.subscriptions` in the order they were pushed, so
 * an object pushed late is disposed late. Until Phase 5, `deactivate()`
 * disposed 27 services by hand before VS Code disposed the subscriptions,
 * and that order is not the order they were made in: the search pages went
 * before the active search, and Related Notes before the active calendar,
 * while the log was still open. A search page that is the active search
 * releases it as it goes, which redraws Related Notes, and the sidebar going
 * hides itself from the active calendar, which redraws the calendar page.
 * Pushed first and filled later, this keeps that order and that moment, so
 * shutting down does exactly what it did; each object is disposed once,
 * where deactivate() and the subscriptions used to dispose it twice.
 *
 * Like `deactivate()`, it stops at the first dispose that throws; VS Code
 * logs the error and goes on to the next subscription.
 */
export class DisposalOrder implements vscode.Disposable {
  private readonly items: vscode.Disposable[] = [];

  /** Adds disposables after those already held. */
  public add(...items: vscode.Disposable[]): void {
    this.items.push(...items);
  }

  /** Disposes everything held, first added first, and lets it go. */
  public dispose(): void {
    for (const item of this.items.splice(0)) {
      item.dispose();
    }
  }
}
