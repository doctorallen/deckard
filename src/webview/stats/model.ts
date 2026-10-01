import type { DeckardStatsSnapshot } from '../../ui/protocol/stats';

/**
 * What the Stats page draws from: the host's snapshot, and the three
 * choices a reader makes on the page.
 */
export interface StatsState {
  /** The host's last snapshot; undefined until the first arrives. */
  readonly snapshot: DeckardStatsSnapshot | undefined;
  /** Whether Notes nothing links to lists every note sent, not the first ten. */
  readonly showAllOrphans: boolean;
  /** Whether the tags used once are listed under their bar. */
  readonly showUsedOnce: boolean;
  /** Whether Tags written together is a list rather than a grid. */
  readonly pairsAsTable: boolean;
}

/** The state with a snapshot to draw, which is all the page's parts ever see. */
export type DrawnStats = StatsState & { readonly snapshot: DeckardStatsSnapshot };

/** How many notes nothing links to are listed before Show more. */
export const ORPHANS_SHOWN = 10;

/** The lists a row may name in `data-list`, each a list of the snapshot whose items carry what opens them. */
export const ROW_LISTS = ['unreadable', 'orphanNotes', 'tagViews', 'entityViews', 'sectionViews'] as const;

/** One of those lists, by name. */
export type RowList = (typeof ROW_LISTS)[number];

/** One count with its noun, singular or plural: "1 note", "3 notes". */
export function counted(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
