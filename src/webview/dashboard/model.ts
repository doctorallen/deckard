/**
 * What the Dashboard draws from besides the host's snapshot: the tab shown,
 * the tag columns, the Tags tab's search and namespace filter, whether Home
 * is being arranged and its hint put away, and what the reader has open or
 * is typing that a draw must keep.
 */
import type { DashboardColumnCount, DashboardMode, DashboardPageState } from '../../ui/protocol/dashboard';

/** The page's own state, as the template's script held it. */
export interface DashboardView {
  /** Home or the Tags tab. */
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
  /** The task being typed into Quick add. */
  quickAddDraft: string;
  /** What became of the last task Quick add sent. */
  quickAddStatus: string;
}

/** The snapshot as the page draws it: the host's, with the tag columns the page settled on. */
export type DrawnSnapshot = DashboardPageState;

/** What the page's parts are drawn from. */
export interface DashboardDraw {
  readonly snapshot: DrawnSnapshot;
  readonly view: DashboardView;
}
