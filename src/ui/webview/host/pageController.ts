import type * as vscode from 'vscode';

import type { MessageMap, MessageOf, PageMessage } from '../../protocol/messaging';
import type { DeckardTheme } from '../themeNames';
import type { ContentSecurityExtras } from './pageShell';
import type { PageScripts, WebviewSurface } from './surface';

/**
 * What a page's controller and its message handlers may ask of the host
 * that shows it.
 */
export interface PageContext {
  /**
   * Sends the page its snapshot now, or, while it is hidden, notes that it
   * is out of date so it is sent when the page is shown again.
   */
  refresh(): void;
  /** Sends the page one message, while it is open. */
  post(message: PageMessage): void;
  /** Sets the page's HTML again, in the theme it is drawn in now, while it is open. */
  renderHtml(): void;
  /** The panel or view the page is shown in, while it is open. */
  readonly surface: WebviewSurface | undefined;
}

/**
 * Acts on one message a page sent, after the page's table has narrowed it.
 * A handler is an adapter: it asks, calls one service, and reports.
 */
export type MessageHandler<T> = (message: T, page: PageContext) => unknown;

/** A page's handlers, one for each message type its map names. */
export type MessageHandlers<M> = { readonly [K in keyof M]: MessageHandler<M[K]> };

/**
 * How the host times a page's snapshot in the log: the name the line is
 * written under, and whether the time includes posting the snapshot as
 * well as building it.
 */
export interface SnapshotTiming {
  readonly name: string;
  /** Time the post too, as Home's host always did; false unless a page says so. */
  readonly includesPost?: boolean;
}

/** What a page needs from the webview it is shown in. */
export interface PageOptions {
  /** Keep the page running while its tab is hidden; see decision 0006. */
  readonly retainContextWhenHidden: boolean;
  /** Offer VS Code's find widget on the page. */
  readonly enableFindWidget: boolean;
  /**
   * Tell the page how far the first scan has got while it waits for the
   * index; true unless a page says otherwise.
   */
  readonly followIndexing?: boolean;
  /** Whether the page runs a script, and how; `on` unless a page says otherwise. */
  readonly scripts?: PageScripts;
  /**
   * What a theme or zen change does to the open page: `redraw` (the
   * default) resets its HTML and sends the snapshot; `reload` only resets
   * the HTML, for a page that asks for its state when it loads; `none`
   * leaves it, for a page drawn afresh each time it is shown, or one that
   * listens for the change itself. The host listens before anything the
   * controller subscribes to.
   */
  readonly onChromeChange?: 'redraw' | 'reload' | 'none';
  /**
   * Whether the host sends a snapshot when the page is shown after missing
   * one while hidden: `if-stale` (the default), or `never`, for a page that
   * refreshes itself in `onDidChangeViewState`.
   */
  readonly refreshWhenShown?: 'if-stale' | 'never';
  /**
   * Whether the page is ever sent a snapshot: true unless a page drawn
   * whole in its HTML, such as Help, says false. A refresh of such a page
   * does nothing at all: nothing is built, timed, or posted, and a hidden
   * page is not marked stale.
   */
  readonly hasSnapshot?: boolean;
  /**
   * How the host times each snapshot in the log. By default it times
   * `buildSnapshot` under the page's `name`. A page whose line has always
   * had another name, or timed the post too, says so; `false` leaves the
   * timing to the page, for one that times only part of its build, inside
   * `buildSnapshot`, as it always has.
   */
  readonly measure?: SnapshotTiming | false;
  /** What the page's Content Security Policy grants beyond the default. */
  readonly csp?: ContentSecurityExtras;
  /**
   * Whether the page draws a snapshot its HTML carries as inert JSON
   * (decision 0005), which `html` is then handed. A page that does and is
   * not kept running while hidden has its HTML set again with the last
   * snapshot it was sent, when it is hidden, so VS Code reloads it showing
   * that rather than its loading line (Q2 of docs/implementation/
   * 20-webviews.md); the snapshot is the one kept, not built again.
   */
  readonly readsInertState?: boolean;
  /**
   * Whether a page that `readsInertState` has a snapshot built into its
   * HTML whenever the HTML is set while the page is shown and the index has
   * notes to show, so it draws them on its first frame rather than its
   * loading line: for a page whose snapshot is cheap to build (Q3 of
   * docs/implementation/20-webviews.md, under 50 ms median on the
   * 5,000-note bench). The snapshot is built and timed as one sent is, and
   * is the last the page was sent; a hidden page is built nothing.
   */
  readonly embedsSnapshot?: boolean;
  /**
   * Reads what VS Code kept for a panel across a reload, before the panel
   * is drawn again. The value is whatever the page last saved, so it is
   * checked here.
   */
  restore?(state: unknown): void | Promise<void>;
}

/**
 * One page, as its host runs it: what it draws, what it may be sent, what
 * it does with each message, and what it needs of its webview. A
 * `WebviewHost` owns the webview's session and calls in here; everything
 * the page decides lives here, and nothing about panels or views does.
 *
 * The optional hooks are for what some pages do around the session: say
 * they are in front (`onDidAttach`, `onDidChangeViewState`), forget what
 * belonged to a closed panel (`onDidDetach`), or redraw only when the index
 * changed what they show (`onIndexUpdate`).
 */
export interface PageController<TSnapshot, TPageToHost extends MessageMap<TPageToHost>> {
  /**
   * The page's name in the log: its turn after an index update, and, unless
   * `options.measure` names it otherwise, how long its snapshot took to
   * build.
   */
  readonly name: string;
  readonly options: PageOptions;
  /**
   * The page's HTML, for a webview, in a theme, carrying `state` as inert
   * JSON when given one, which only a page that `readsInertState` is.
   */
  html(webview: vscode.Webview, theme: DeckardTheme, state?: TSnapshot): string;
  /** Everything the page draws, or undefined while there is nothing to send. */
  buildSnapshot(): TSnapshot | undefined;
  /** The page's narrowing table: a message it may send, or undefined. */
  narrow(value: unknown): MessageOf<TPageToHost> | undefined;
  readonly handlers: MessageHandlers<TPageToHost>;
  /**
   * What else redraws the page, besides the index and its theme. These are
   * listened to after the theme and zen.
   */
  subscribe?(page: PageContext): vscode.Disposable[];
  /**
   * Whether the page has anything to show yet, such as a search page
   * before the first scan. While it says no, a refresh sends nothing, and a
   * hidden page is not marked stale.
   */
  isReady?(): boolean;
  /**
   * Whether the page needs a new snapshot when shown for a reason besides
   * an index update it missed, such as Home's day having turned.
   */
  isOutOfDate?(): boolean;
  /** Called when a refresh finds the page hidden and marks it stale. */
  onDidMarkStale?(page: PageContext): void;
  /** Called after each snapshot is sent, such as to tell the sidebar it changed. */
  onDidSendSnapshot?(page: PageContext): void;
  /** Replaces the refresh an index update makes. */
  onIndexUpdate?(page: PageContext): void;
  /** Called when the page has been given a panel or view, after its HTML is set. */
  onDidAttach?(page: PageContext): void;
  /** Called on each view-state change, after the stale refresh. */
  onDidChangeViewState?(page: PageContext): void;
  /** Called when the reader closes the page, before its listeners go. */
  onDidDetach?(page: PageContext): void;
  /** Called first when the host is disposed of. */
  dispose?(): void;
  /**
   * Called when the host is disposed of, once it has stopped listening to
   * its panel or view and let go of it, and before its listeners go: a
   * refresh a listener asks for then finds no page.
   */
  onDidDispose?(page: PageContext): void;
}
