import * as vscode from 'vscode';

import { SearchRefineState } from '../../core/types';

/**
 * A page whose search the Related Notes sidebar can refine: a search page or
 * the Task Board.
 */
export interface SearchSource {
  /** The search the page shows, with its facets, or undefined for none. */
  getRefineState(): SearchRefineState | undefined;
  /** Runs a search on the page, as its own search box would. */
  applySearch(queryText: string): Promise<void>;
}

/**
 * Knows which search page is the active editor, and whether the sidebar is
 * open to show that search's Refine options.
 *
 * A page registers itself when its panel becomes active and leaves when it
 * stops being active. The sidebar reads the active search from here, and a
 * page asks here whether its Refine options are in the sidebar, so it can
 * show a line in their place.
 */
export class ActiveSearch implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly refineVisibilityEmitter = new vscode.EventEmitter<void>();
  private source: SearchSource | undefined;
  private sidebarVisible = false;

  /** Fires when the active search changes, or its results do. */
  public readonly onDidChange = this.changeEmitter.event;
  /** Fires when the sidebar opens or closes, which moves Refine. */
  public readonly onDidChangeRefineVisibility =
    this.refineVisibilityEmitter.event;

  public constructor() {
    this.disposables.push(this.changeEmitter, this.refineVisibilityEmitter);
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        // A text editor taking focus means no search page is active.
        if (editor) {
          this.setActive(undefined);
        }
      }),
    );
  }

  public get active(): SearchSource | undefined {
    return this.source;
  }

  /** Makes a page the active search, or clears it. */
  public setActive(source: SearchSource | undefined): void {
    if (this.source === source) {
      return;
    }
    this.source = source;
    this.changeEmitter.fire();
    // The page that was active takes its Refine options back, and the new
    // one gives its own up.
    if (this.sidebarVisible) {
      this.refineVisibilityEmitter.fire();
    }
  }

  /** Stops a page being the active search, if it is. */
  public release(source: SearchSource): void {
    if (this.source === source) {
      this.setActive(undefined);
    }
  }

  /** Tells the sidebar the active page's search or results changed. */
  public notifyChanged(source: SearchSource): void {
    if (this.source === source) {
      this.changeEmitter.fire();
    }
  }

  /** Whether the sidebar is showing this page's Refine options. */
  public isRefineInSidebar(source: SearchSource): boolean {
    return this.sidebarVisible && this.source === source;
  }

  /** Records whether the Related Notes sidebar is open. */
  public setSidebarVisible(visible: boolean): void {
    if (this.sidebarVisible === visible) {
      return;
    }
    this.sidebarVisible = visible;
    if (this.source) {
      this.refineVisibilityEmitter.fire();
    }
  }

  public dispose(): void {
    this.source = undefined;
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }
}
