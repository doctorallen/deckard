/**
 * The Pages view's narrowing table: it only asks for a page, which the
 * host opens by the command the page list names for it.
 */
import type { PagesViewPageToHost } from '../../../protocol/pagesView';
import { narrowGoToPage, NarrowingTable, narrowWith } from '../../host/narrowing';

/** Each message Pages may send, and what it must hold. */
export const PAGES_VIEW_MESSAGES: NarrowingTable<PagesViewPageToHost> = {
  goToPage: narrowGoToPage,
};

/** A message from Pages, narrowed by its table, or undefined. */
export const narrowPagesViewMessage = narrowWith(PAGES_VIEW_MESSAGES);
