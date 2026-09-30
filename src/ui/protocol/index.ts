/**
 * The protocol between the extension host and its webview pages: each page's
 * snapshot, the messages it sends, and what several pages share. Only the
 * domain model is imported, so the host and the pages can both see it.
 */
export type * from './dashboard';
export type * from './searchPage';
export type * from './shared';
export type * from './stats';
