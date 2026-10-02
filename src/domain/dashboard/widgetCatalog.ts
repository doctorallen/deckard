/**
 * The widgets Home can show, and what each kind is and can do: one catalog
 * the host reads to keep a stored widget and the page reads to offer and
 * draw one, so the two never disagree about a kind.
 *
 * A pure module the page imports (decision D1 of
 * docs/implementation/20-webviews.md): no `vscode`, no I/O.
 */
import type { DashboardWidgetKind } from '../model/preferences';

/** One choice of how far back a widget looks: its days, and the words its button shows. */
export type WidgetDaysChoice = readonly [days: number, text: string];

/** What one kind of widget is, and what it can do. */
export interface WidgetKind {
  /** Its name in + Add widget, and in Related Notes' list of widgets to add. */
  readonly label: string;
  /** What it shows, in + Add widget's tip and in its gear's About row. */
  readonly description: string;
  /** Whether Home may hold more than one. */
  readonly repeatable: boolean;
  /** Whether it shows a number of entries, and offers how many. */
  readonly listed: boolean;
  /**
   * False for a listed widget that cannot be paged through: the Tasks view
   * counts each of its groups apart, and a saved search lists notes beside
   * tasks, so neither is one list for a page number to walk.
   */
  readonly pageable?: false;
  /** For a widget that looks back, the spans its gear offers. */
  readonly days?: readonly WidgetDaysChoice[];
  /** For a widget that looks back, how far it looks until the reader says. */
  readonly defaultDays?: number;
}

/** The spans a widget that looks back over weeks offers. */
const WEEKS: readonly WidgetDaysChoice[] = [[7, '7d'], [14, '14d'], [30, '30d'], [90, '90d']];

/** The spans Gone quiet offers, over months. */
const MONTHS: readonly WidgetDaysChoice[] = [[30, '30d'], [60, '60d'], [90, '90d'], [180, '180d']];

/**
 * Every kind of widget, in the order + Add widget offers them. A saved
 * search's widget is offered once for each saved search, by name, rather
 * than as its kind.
 */
export const WIDGET_KINDS: Readonly<Record<DashboardWidgetKind, WidgetKind>> = {
  search: { label: 'Search', description: 'A search box that opens a search page', repeatable: false, listed: false },
  tasks: { label: 'Tasks', description: 'The tasks a search finds, ranked as on the Task Board', repeatable: true, listed: true },
  agenda: { label: 'Tasks view', description: 'Overdue, today, and upcoming tasks', repeatable: false, listed: true, pageable: false },
  favoriteTags: { label: 'Favorite tags', description: 'The tags you favorited', repeatable: false, listed: true },
  topTags: { label: 'Frequent tags', description: 'The tags you open most, lately', repeatable: false, listed: true },
  savedSearches: { label: 'Saved searches', description: 'Your saved searches', repeatable: false, listed: false },
  recentSearches: { label: 'Recent searches', description: 'The searches you ran lately', repeatable: false, listed: true },
  recentNotes: { label: 'Recently opened', description: 'The notes you opened lately', repeatable: false, listed: true },
  stats: { label: 'Workspace', description: 'How many notes, tasks, and tags there are', repeatable: false, listed: false },
  savedQuery: { label: 'Saved search results', description: 'What one saved search finds', repeatable: true, listed: true, pageable: false },
  todayNote: { label: 'Today', description: "Today's daily note and its open tasks", repeatable: false, listed: true },
  quickAdd: { label: 'Quick add', description: "Add a task to today's daily note", repeatable: false, listed: false },
  staleTasks: { label: 'Stale tasks', description: 'Open tasks in notes left unchanged for a while', repeatable: false, listed: true, days: WEEKS, defaultDays: 30 },
  relatedNotes: { label: 'Related notes', description: 'Notes related to the note you had open last', repeatable: false, listed: true },
  tagPairs: { label: 'Tags written together', description: 'Tags most often carried together, which may want a hub note or one name', repeatable: false, listed: true },
  unhubbedTags: { label: 'Tags without a hub', description: 'Frequently used tags with no hub note', repeatable: false, listed: true },
  newTags: { label: 'New tags', description: 'Tags first seen lately, to catch typos early', repeatable: false, listed: true, days: WEEKS, defaultDays: 14 },
  quietPeople: { label: 'Gone quiet', description: 'People, projects, or any namespace you have not written about lately', repeatable: false, listed: true, days: MONTHS, defaultDays: 90 },
  pinnedNotes: { label: 'Pinned notes', description: 'Notes you pin to Home', repeatable: false, listed: true },
  tryNext: { label: 'Try next', description: 'One suggestion, when your notes are ready for it', repeatable: false, listed: false },
};

/**
 * The most widgets Home holds. The page offers no more once it holds this
 * many, and the host keeps no more than this.
 */
export const HOME_WIDGET_LIMIT = 30;

/**
 * The longest task Quick add sends, which the host accepts: its field takes
 * no more, so a task the host would refuse is never typed.
 */
export const QUICK_ADD_MAX_LENGTH = 1000;

/** Whether a value, read from storage or from a choice, names a kind of widget. */
export function isWidgetKind(value: unknown): value is DashboardWidgetKind {
  return typeof value === 'string' && Object.hasOwn(WIDGET_KINDS, value);
}
