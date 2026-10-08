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
  /** Its name in + Add widget. */
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
  /** For a widget that lists one namespace's tags, the one it lists until the reader says. */
  readonly defaultNamespace?: string;
}

/** The spans Gone quiet offers, over months. */
const MONTHS: readonly WidgetDaysChoice[] = [[30, '30d'], [60, '60d'], [90, '90d'], [180, '180d']];

/**
 * Every kind of widget, in the order + Add widget offers them. A saved
 * search's widget is offered once for each saved search, by name, rather
 * than as its kind.
 */
export const WIDGET_KINDS: Readonly<Record<DashboardWidgetKind, WidgetKind>> = {
  search: { label: 'Search', description: 'A search box that opens a search page', repeatable: false, listed: false },
  tasks: { label: 'Tasks', description: 'The tasks a search finds, sorted as on the Task Board or as its gear says', repeatable: true, listed: true },
  agenda: { label: 'Tasks view', description: 'Overdue, today, and upcoming tasks', repeatable: false, listed: true, pageable: false },
  favoriteTags: { label: 'Favorite tags', description: 'The tags you favorited', repeatable: false, listed: true },
  topTags: { label: 'Frequent tags', description: 'The tags you open most, lately', repeatable: false, listed: true },
  savedSearches: { label: 'Saved searches', description: 'Your saved searches', repeatable: false, listed: false },
  recentSearches: { label: 'Recent searches', description: 'The searches you ran lately', repeatable: false, listed: true },
  recentNotes: { label: 'Recently opened', description: 'The notes you opened lately', repeatable: false, listed: true },
  savedQuery: { label: 'Saved search results', description: 'What one saved search finds', repeatable: true, listed: true, pageable: false },
  todayNote: { label: 'Today', description: "Today's daily note and its open tasks", repeatable: false, listed: true },
  quietPeople: { label: 'Gone quiet', description: 'People, projects, or any namespace you have not written about lately', repeatable: false, listed: true, days: MONTHS, defaultDays: 90, defaultNamespace: 'person' },
  progress: { label: 'Progress', description: 'How far along each project’s tasks are, or any namespace’s', repeatable: false, listed: true, defaultNamespace: 'project' },
  pinnedNotes: { label: 'Pinned notes', description: 'Notes you pin to Home', repeatable: false, listed: true },
  tryNext: { label: 'Try next', description: 'One suggestion, when your notes are ready for it', repeatable: false, listed: false },
};

/**
 * How many entries a listed widget's gear offers to show, and its pager to
 * show a page at a time. The host keeps no more than the largest.
 */
export const WIDGET_ENTRY_COUNTS: readonly number[] = [3, 5, 10, 20];

/**
 * The most widgets Home holds. The page offers no more once it holds this
 * many, and the host keeps no more than this.
 */
export const HOME_WIDGET_LIMIT = 30;

/**
 * Whether Gone quiet can watch a namespace: a word of letters, digits,
 * dashes, and underscores that starts with a letter. Its gear offers only
 * these, and the host keeps only these.
 */
export function isWatchableNamespace(namespace: string): boolean {
  return namespace.length <= 64 && /^[A-Za-z][A-Za-z0-9_-]*$/.test(namespace);
}

/**
 * The namespace a widget lists: the one the reader chose, or its kind's
 * default. A widget kept with no namespace lists its default.
 */
export function widgetNamespace(widget: { readonly kind: DashboardWidgetKind; readonly namespace?: string }): string {
  return widget.namespace || WIDGET_KINDS[widget.kind].defaultNamespace || 'person';
}

/** Whether a value, read from storage or from a choice, names a kind of widget. */
export function isWidgetKind(value: unknown): value is DashboardWidgetKind {
  return typeof value === 'string' && Object.hasOwn(WIDGET_KINDS, value);
}
