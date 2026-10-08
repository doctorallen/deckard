import * as vscode from 'vscode';

/**
 * Knows which page of one kind is the active editor, and whether the
 * Related Notes sidebar is open to show what that page offers there: the
 * search page's or Task Board's Refine options, or the calendar page's
 * chosen day.
 *
 * A page makes itself the active source when its panel comes to the front
 * and releases itself when it leaves. The sidebar reads the active source
 * from here, and a page asks here whether the sidebar is showing its part,
 * so it can give that part's room to the rest of the page.
 *
 * It is the one shape of what were `ActiveSearch` and `ActiveCalendar`.
 */
export class ActiveSource<T> implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly sidebarVisibilityEmitter = new vscode.EventEmitter<void>();
  private source: T | undefined;
  private sidebarVisible = false;

  /** Fires when the active source changes, or what it shows does. */
  public readonly onDidChange = this.changeEmitter.event;
  /**
   * Fires when the sidebar opens or closes while a source is active, or the
   * active source changes while it is open: either moves the source's part
   * between the sidebar and its page.
   */
  public readonly onDidChangeSidebarVisibility = this.sidebarVisibilityEmitter.event;

  /** Starts with no page in front, and clears it when a text editor comes to the front. */
  public constructor() {
    this.disposables.push(this.changeEmitter, this.sidebarVisibilityEmitter);
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        // A text editor in front means no page is.
        if (editor) {
          this.setActive(undefined);
        }
      }),
    );
  }

  /** The page in front, or undefined while none of this kind is. */
  public get active(): T | undefined {
    return this.source;
  }

  /** Makes a page the active source, or clears it. */
  public setActive(source: T | undefined): void {
    if (this.source === source) {
      return;
    }
    this.source = source;
    this.changeEmitter.fire();
    // The page that was active takes its part back, and the new one gives
    // its own up.
    if (this.sidebarVisible) {
      this.sidebarVisibilityEmitter.fire();
    }
  }

  /** Stops a page being the active source, if it is. */
  public release(source: T): void {
    if (this.source === source) {
      this.setActive(undefined);
    }
  }

  /** Tells the sidebar that what the active page shows has changed. */
  public notifyChanged(source: T): void {
    if (this.source === source) {
      this.changeEmitter.fire();
    }
  }

  /** Whether the sidebar is showing this page's part. */
  public isShownInSidebar(source: T): boolean {
    return this.sidebarVisible && this.source === source;
  }

  /** Records whether the Related Notes sidebar is open. */
  public setSidebarVisible(visible: boolean): void {
    if (this.sidebarVisible === visible) {
      return;
    }
    this.sidebarVisible = visible;
    if (this.source) {
      this.sidebarVisibilityEmitter.fire();
    }
  }

  /** Forgets the page in front and stops every listener. */
  public dispose(): void {
    this.source = undefined;
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }
}
