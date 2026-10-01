import type * as vscode from 'vscode';

import type { MessageMap, MessageOf, PageMessage } from '../../protocol/messaging';
import type { DeckardTheme } from '../themeNames';
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
 * What a page's Content Security Policy grants beyond scripts by nonce and
 * styles from the extension: images from other origins, or `true` for any
 * HTTPS origin, and fonts. The page shell of Phase 6 step 3 reads it; until
 * then each page's builder writes its own policy.
 */
export interface ContentSecurityExtras {
  readonly images?: readonly string[] | true;
  readonly fonts?: boolean;
}

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
   * leaves it, for a page drawn afresh each time it is shown.
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
  /** The page's HTML, for a webview, in a theme. */
  html(webview: vscode.Webview, theme: DeckardTheme): string;
  /** Everything the page draws, or undefined while there is nothing to send. */
  buildSnapshot(): TSnapshot | undefined;
  /** The page's narrowing table: a message it may send, or undefined. */
  narrow(value: unknown): MessageOf<TPageToHost> | undefined;
  readonly handlers: MessageHandlers<TPageToHost>;
  /** What else redraws the page, besides the index and its theme. */
  subscribe?(page: PageContext): vscode.Disposable[];
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
}
