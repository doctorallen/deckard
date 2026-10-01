import * as vscode from 'vscode';

import { onIndexUpdateInTurn, VIEW_PRIORITY, ViewUpdateSource, whenPublished } from '../../../core/workspace/publishing';
import type { IndexScanStatus } from '../../../core/workspace/indexReader';
import { measure } from '../../../shared/timing';
import type { MessageMap, MessageOf, PageMessage, StateMessage } from '../../protocol/messaging';
import { onDidChangePageChrome } from '../components';
import { followIndexing } from '../indexingProgress';
import { getDeckardTheme } from '../themes';
import type { ThemePreview } from '../themePreview';
import type { MessageHandler, PageContext, PageController } from './pageController';
import type { WebviewSurface } from './surface';

/**
 * The index a page is drawn from, as its host needs it: updates to redraw
 * on, the moment it first has notes to show, and, where the index has them,
 * the first scan's progress.
 */
export type HostIndexer = ViewUpdateSource &
  Parameters<typeof whenPublished>[0] &
  Partial<Pick<IndexScanStatus, 'hasIndexed' | 'scanProgress' | 'onDidProgress'>>;

/** What a `WebviewHost` is built with besides its page's controller. */
export interface WebviewHostOptions {
  /** The index; absent for a page drawn from nothing indexed, such as Help. */
  indexer?: HostIndexer;
  /** The theme Choose Theme… is previewing, which the page draws in. */
  themePreview: Pick<ThemePreview, 'current' | 'onDidChange'>;
}

/**
 * Owns one page's webview session: its HTML, the messages the page sends,
 * the snapshots sent back, and the listeners that keep them current.
 *
 * - The HTML is set when a panel or view is attached, and again when the
 *   theme or zen changes, which reloads the page.
 * - A message is narrowed by the page's table, and one that passes goes to
 *   its handler; anything else is dropped.
 * - The snapshot is sent after each index update, in the page's turn, and
 *   whenever the controller asks. A hidden page is only marked stale, and
 *   is sent one snapshot when it is shown again.
 * - Until the first scan finishes, the page is told how far it has got.
 *
 * It knows nothing of how a panel is created or a view resolved; the panel
 * and view adapters do that, and attach what they made here.
 */
export class WebviewHost<TSnapshot, TPageToHost extends MessageMap<TPageToHost>>
  implements PageContext, vscode.Disposable
{
  private readonly disposables: vscode.Disposable[] = [];
  private sessionDisposables: vscode.Disposable[] = [];
  private current: WebviewSurface | undefined;
  /** Whether the snapshot changed while the page was hidden. */
  private isStale = false;
  private readonly indexer: HostIndexer | undefined;
  private readonly themePreview: WebviewHostOptions['themePreview'];

  /**
   * Runs `controller`'s page, redrawing it after each index update, each
   * change the controller subscribes to, and each theme or zen change.
   */
  public constructor(
    public readonly controller: PageController<TSnapshot, TPageToHost>,
    options: WebviewHostOptions,
  ) {
    this.indexer = options.indexer;
    this.themePreview = options.themePreview;
    if (this.indexer) {
      this.disposables.push(
        onIndexUpdateInTurn(
          this.indexer,
          { name: controller.name, priority: () => this.current?.priority() ?? VIEW_PRIORITY.hidden },
          () => (controller.onIndexUpdate ? controller.onIndexUpdate(this) : this.refresh()),
        ),
      );
    }
    this.disposables.push(...(controller.subscribe?.(this) ?? []));
    const onChrome = controller.options.onChromeChange ?? 'redraw';
    if (onChrome !== 'none') {
      this.disposables.push(
        onDidChangePageChrome(() => {
          this.renderHtml();
          if (onChrome === 'redraw') {
            this.refresh();
          }
        }, this.themePreview),
      );
    }
  }

  /** The panel or view the page is shown in, while it is open. */
  public get surface(): WebviewSurface | undefined {
    return this.current;
  }

  /**
   * Shows the page in a panel or view: sets its HTML and listens to it until
   * the reader closes it or another is attached.
   */
  public attach(surface: WebviewSurface): void {
    this.current = surface;
    this.renderHtml();
    this.sessionDisposables = [
      this.followIndexing(surface),
      surface.onDidDispose(() => {
        this.current = undefined;
        this.controller.onDidDetach?.(this);
        this.detach();
      }),
      surface.webview.onDidReceiveMessage((value: unknown) => this.receive(value)),
      surface.onDidChangeViewState(() => {
        if (surface.visible && this.isOutOfDate()) {
          this.refresh();
        }
        this.controller.onDidChangeViewState?.(this);
      }),
    ];
    this.controller.onDidAttach?.(this);
  }

  /** Stops listening to the panel or view, leaving it open. */
  public detach(): void {
    this.sessionDisposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /** Sets the page's HTML again, in the theme it is drawn in now. */
  public renderHtml(): void {
    this.current?.render((webview) => this.controller.html(webview, getDeckardTheme(this.themePreview)));
  }

  /**
   * Sends the page its snapshot. A hidden page keeps what it shows and is
   * sent the newest when it is shown again. While the controller has no
   * snapshot, nothing is sent and a page that missed one still has.
   */
  public refresh(): void {
    const surface = this.current;
    if (!surface) {
      return;
    }
    if (!surface.visible) {
      this.isStale = true;
      this.controller.onDidMarkStale?.(this);
      return;
    }
    if (this.sendSnapshot(surface)) {
      this.controller.onDidSendSnapshot?.(this);
    }
  }

  /** Sends the page one message, while it is open. */
  public post(message: PageMessage): void {
    void this.current?.webview.postMessage(message);
  }

  /** Resolves when the index first has notes to show, or at once without one. */
  public whenPublished(): Promise<void> {
    return this.indexer ? whenPublished(this.indexer) : Promise.resolve();
  }

  /** Closes the page, if it is open, and stops every listener. */
  public dispose(): void {
    this.controller.dispose?.();
    this.detach();
    this.current?.close();
    this.current = undefined;
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /**
   * Builds the snapshot and posts it, timed in the log as the page's
   * options say, and says whether there was one to post.
   */
  private sendSnapshot(surface: WebviewSurface): boolean {
    const timing = this.controller.options.measure ?? { name: this.controller.name };
    const build = (): TSnapshot | undefined => this.controller.buildSnapshot();
    if (timing === false) {
      return this.send(surface, build());
    }
    if (timing.includesPost === true) {
      return measure(timing.name, () => this.send(surface, build()));
    }
    return this.send(surface, measure(timing.name, build));
  }

  /**
   * Posts a snapshot the controller built, and says whether there was one
   * to post. A page that was owed one is owed nothing once it is sent.
   */
  private send(surface: WebviewSurface, data: TSnapshot | undefined): boolean {
    if (data === undefined) {
      return false;
    }
    this.isStale = false;
    const message: StateMessage<TSnapshot> = { type: 'state', data };
    void surface.webview.postMessage(message);
    return true;
  }

  /**
   * Narrows a message the page sent and hands it to its handler. The page
   * may hold a snapshot from before the index changed, so each handler
   * checks what the message names against the index as it is now.
   */
  private async receive(value: unknown): Promise<void> {
    const message = this.controller.narrow(value);
    if (!message) {
      return;
    }
    const type = (message as unknown as PageMessage).type as keyof TPageToHost;
    const handler = this.controller.handlers[type] as MessageHandler<MessageOf<TPageToHost>>;
    await handler(message, this);
  }

  /**
   * Whether a page being shown is sent a new snapshot: when it missed one
   * while hidden, or when its controller says it is out of date for a
   * reason of its own. A page that refreshes itself when shown says never.
   */
  private isOutOfDate(): boolean {
    if (this.controller.options.refreshWhenShown === 'never') {
      return false;
    }
    return this.isStale || this.controller.isOutOfDate?.() === true;
  }

  /** Tells the page how far the first scan has got, until it is done. */
  private followIndexing(surface: WebviewSurface): vscode.Disposable {
    const indexer = this.indexer;
    if (this.controller.options.followIndexing === false || !isScanning(indexer)) {
      return { dispose: () => undefined };
    }
    return followIndexing(indexer, (message) => void surface.webview.postMessage(message));
  }
}

/**
 * Whether an index is still on its first scan and can say how far it has
 * got. An index that does not say whether it has indexed, as a test's
 * fake may not, is taken to have.
 */
function isScanning(
  indexer: HostIndexer | undefined,
): indexer is HostIndexer & Pick<IndexScanStatus, 'hasIndexed' | 'scanProgress' | 'onDidProgress'> {
  return indexer?.hasIndexed === false && indexer.onDidProgress !== undefined;
}
