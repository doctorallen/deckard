/**
 * Where a search page has been, so the mouse's back and forward buttons can
 * step through its searches the way a browser steps through pages.
 *
 * An entry keeps the pages of results the reader was on, so going back to a
 * search returns to the place in it they left rather than to its start.
 */
export interface SearchHistoryEntry {
  query: string;
  notePage: number;
  taskPage: number;
}

/** A page stepped through a hundred searches remembers the last hundred. */
const MAX_ENTRIES = 100;

export class SearchHistory {
  private readonly backEntries: SearchHistoryEntry[] = [];
  private forwardEntries: SearchHistoryEntry[] = [];

  /**
   * Records leaving `from` for another search. As in a browser, a new search
   * made after going back ends the searches that were ahead of it.
   */
  public leave(from: SearchHistoryEntry): void {
    this.backEntries.push(from);
    if (this.backEntries.length > MAX_ENTRIES) {
      this.backEntries.shift();
    }
    this.forwardEntries = [];
  }

  /** The search before `current`, which becomes the one ahead of it. */
  public back(current: SearchHistoryEntry): SearchHistoryEntry | undefined {
    const entry = this.backEntries.pop();
    if (entry) {
      this.forwardEntries.push(current);
    }
    return entry;
  }

  /** The search `back` left, which `current` becomes the one before. */
  public forward(current: SearchHistoryEntry): SearchHistoryEntry | undefined {
    const entry = this.forwardEntries.pop();
    if (entry) {
      this.backEntries.push(current);
    }
    return entry;
  }
}
