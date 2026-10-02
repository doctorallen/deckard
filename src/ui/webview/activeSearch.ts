import { ActiveSource } from './host/activeSource';
import { SearchRefineState } from '../protocol/shared';

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
 *
 * It is an `ActiveSource` whose part in the sidebar is Refine, under the
 * names the search pages, the Task Board, and the sidebar call it by.
 */
export class ActiveSearch extends ActiveSource<SearchSource> {
  /** Fires when the sidebar opens or closes, which moves Refine. */
  public readonly onDidChangeRefineVisibility = this.onDidChangeSidebarVisibility;

  /** Whether the sidebar is showing this page's Refine options. */
  public isRefineInSidebar(source: SearchSource): boolean {
    return this.isShownInSidebar(source);
  }
}
