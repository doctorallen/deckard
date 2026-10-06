/**
 * The Pages view's messages: every Deckard page, as a list of labeled rows
 * or a row of icons, the pages and the look as the reader chose them.
 */
import type { IndexingMessage, MessageOf, StateMessage } from './messaging';
import type { GoToPageMessage } from './shared';

/** How Pages draws its pages: labeled rows, or a row of their icons. */
export type PagesViewStyle = 'list' | 'icons';

/** One page as Pages draws it. */
export interface PagesViewPage {
  /** The page's name in the page list, such as `board`, which names its glyph. */
  id: string;
  label: string;
  /** What is worth knowing about it now, such as "3 due today". */
  description: string;
  /** A sentence on what it is, for its tip. */
  detail: string;
}

/** What Pages draws: the pages the reader keeps there, in order, and how. */
export interface PagesViewSnapshot {
  style: PagesViewStyle;
  pages: PagesViewPage[];
}

/** What Pages sends: only which page to open, which the host checks. */
export interface PagesViewPageToHost {
  goToPage: GoToPageMessage;
}

/** What the host sends Pages, by type. */
export interface PagesViewHostToPage {
  state: StateMessage<PagesViewSnapshot>;
  indexing: IndexingMessage;
}

/** A message from Pages. */
export type PagesViewMessage = MessageOf<PagesViewPageToHost>;
