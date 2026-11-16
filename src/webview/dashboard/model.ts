/**
 * What the Dashboard draws from besides the host's snapshot: the tab shown,
 * the tag columns, the Tags tab's search and namespace filter, whether Home
 * is being arranged and its hint put away, how the Types tab is sorted and
 * which types are opened on it, and what the reader has open or is typing
 * that a draw must keep.
 */
import type { DashboardColumnCount, DashboardMode, DashboardPageState } from '../../ui/protocol/dashboard';

/** The Dashboard's tabs in the order they are drawn, which the arrow keys move along. */
export const MODES: readonly DashboardMode[] = ['home', 'browse', 'types'];

/** The tab a kept or sent value names, or Home for anything else. */
export function readMode(value: unknown): DashboardMode {
  return MODES.find((mode) => mode === value) ?? 'home';
}

/** A column the Types tab's table sorts by. */
export type TypesSortColumn = 'name' | 'rule' | 'rows' | 'open-tasks' | 'last-mentioned';

/** How the Types tab's table is sorted. */
export interface TypesSort {
  column: TypesSortColumn;
  direction: 'asc' | 'desc';
}

/** The page's own state, as the template's script held it. */
export interface DashboardView {
  /** Home, the Tags tab, or the Types tab. */
  mode: DashboardMode;
  /** How many columns the Tags tab lays its tags out in, once known. */
  tagColumns: DashboardColumnCount | undefined;
  /** What is typed in the Tags tab's search box. */
  browseQuery: string;
  /** The namespace the Tags tab is narrowed to, `/` for tags with none, or empty for all. */
  tagNamespaceFilter: string;
  /** Whether Home is being arranged. */
  editingHome: boolean;
  /**
   * Whether the reader put away the line that said Home could be arranged.
   * That line gave way to Customize Home beside the tabs; the field is kept
   * so a view saved before reads back unchanged.
   */
  homeHintDismissed: boolean;
  /** The widget whose options are open, which stays open across a draw. */
  openWidgetOptions: string | undefined;
  /** A tasks widget's search being typed in its options, by widget. */
  widgetQueryDrafts: Record<string, string>;
  /** How the Types tab's table is sorted: by name, A-Z, until a heading is chosen. */
  typesSort: TypesSort;
  /** The types opened on the Types tab, by key, whose rows are listed in place. */
  openTypes: string[];
}

/** The snapshot as the page draws it: the host's, with the tag columns the page settled on. */
export type DrawnSnapshot = DashboardPageState;

/** What the page's parts are drawn from. */
export interface DashboardDraw {
  readonly snapshot: DrawnSnapshot;
  readonly view: DashboardView;
}
