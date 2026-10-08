/**
 * What a Home widget is drawn with besides its own data: whether Home is
 * being arranged, the saved searches a widget can follow,
 * and what the reader has open or typed that a draw must keep.
 */
import type { ComponentChild } from 'preact';

import type { DashboardSavedFilter } from '../../ui/protocol/dashboard';

/** What every widget on Home is drawn with. */
export interface HomeContext {
  /** Whether Home is being arranged, when each widget shows its width, gear, and remove. */
  readonly editing: boolean;
  /** The saved searches, which a saved search's widget offers in its gear. */
  readonly savedFilters: readonly DashboardSavedFilter[];
  /** The widget whose gear is open, which stays open across a draw. */
  readonly openOptions: string | undefined;
  /** A tasks widget's search being typed in its gear, by widget. */
  readonly queryDrafts: Readonly<Record<string, string>>;
  /** Home's search box, the one every search page uses. */
  readonly searchBar: () => ComponentChild;
}
