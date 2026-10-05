/**
 * The Dashboard's protocol: what Home and the Tags tab draw, and the messages
 * the page sends.
 */
import type {
  DashboardColumnCount,
  DashboardMode,
  DashboardSearchField,
  DashboardViewState,
  DashboardWidgetConfig,
  TagSortMode,
} from '../../domain/model/preferences';
import type { QueryViewState } from '../../domain/model/query';
import type { EntityKind, TagReference } from '../../domain/model/tags';
import type { IndexingMessage, MessageAs, MessageOf, StateMessage } from './messaging';

export type {
  DashboardColumnCount,
  DashboardMode,
  DashboardWidgetConfig,
  DashboardWidgetKind,
  TagSortMode,
} from '../../domain/model/preferences';
import type {
  ChooseThemeMessage,
  DashboardTask,
  GoToPageMessage,
  ListGoToMessage,
  OpenGoToMessage,
  OpenSearchMessage,
  OpenSourceMessage,
  OpenTagMessage,
  OpenTaskBoardMessage,
  ParkTagMessage,
  PinNoteMessage,
  RenameTagMessage,
  ResultPaging,
  DisplayCommandMessage,
  SetDisplayMessage,
  SetZenModeMessage,
  TagOverviewCard,
  TagTitleDisplayMode,
  ToggleTaskMessage,
} from './shared';

/**
 * A saved filter after its persisted keys have been resolved against the index.
 */
export interface DashboardSavedFilter {
  id: string;
  name: string;
  tags: TagReference[];
  /** Whether Home already has a widget listing what it finds. */
  onHome?: boolean;
  /** Present when reopening this view should restore an advanced query. */
  query?: string;
  /** Set when the search reopens on the Task Board. */
  page?: 'taskBoard';
}

/** A note card on the Dashboard, with the name of the file it is in. */
export interface DashboardNote extends TagOverviewCard {
  fileName: string;
}

/** A tag as the Dashboard draws it: its name, count, and heart. */
export interface DashboardTag {
  key: string;
  label: string;
  count: number;
  isFavorite: boolean;
  /**
   * The namespace the Tags tab groups and names the tag by, as the parser
   * reads an entity's: `person` for an @ tag, empty for none.
   */
  namespace: string;
}

/** An entity as the Dashboard ranks it. */
export interface DashboardEntity {
  key: string;
  label: string;
  kind: EntityKind;
  count: number;
  isFavorite: boolean;
}

/**
 * What the Dashboard draws: its tags and entities, its saved searches, and
 * Home's widgets.
 */
export interface DashboardSnapshot {
  tags: DashboardTag[];
  entities: DashboardEntity[];
  totalSectionCount: number;
  totalNoteCount: number;
  totalTaskCount: number;
  /**
   * Home's three tiles: the Tasks view's Overdue and Today counts and every
   * open task, of what `deckard.agenda.query` lists, each with the search
   * it opens, so a tile's number and its search agree.
   */
  taskGlance?: TaskGlance;
  tagColumns: DashboardColumnCount;
  tagTitleDisplayMode: TagTitleDisplayMode;
  tagSortMode: TagSortMode;
  entitySortMode: TagSortMode;
  selectedTag?: string;
  viewState: DashboardViewState;
  savedFilters: DashboardSavedFilter[];
  /** Home's widgets as arranged, sent with every state. */
  widgetConfig: DashboardWidgetConfig[];
  /** What each widget shows, sent while Home is the tab shown. */
  widgets?: DashboardWidget[];
  /**
   * Whether Home's widgets differ from the ones it started with. While they
   * do not, Home says it can be arranged; once they do, the reader knows.
   */
  homeArranged?: boolean;
  /** After a feature update, the version Home says it was updated to, such as `1.23`. */
  whatsNew?: { version: string };
}

/** A tag a Home widget lists, with what searching for it finds. */
export interface DashboardWidgetTag extends TagReference {
  detail: string;
  /** For Progress, how many of the tag's tasks are done, of how many. */
  progress?: { done: number; total: number };
}

/** A note a Home widget lists, which opens at its line. */
export interface DashboardWidgetNote {
  filePath: string;
  line: number;
  title: string;
  detail: string;
  /** For a pinned note, the pin its row lets go of. */
  pinKey?: string;
}

/** Two tags written together, as Home lists them. */
export interface DashboardWidgetTagPair {
  tags: [TagReference, TagReference];
  /** How many times they were written together. */
  count: number;
  /** The share of the rarer tag's entries that also carry the other, 0–1. */
  overlap: number;
  detail: string;
}

/** Today's daily note, as Home shows it. */
export interface DashboardWidgetToday {
  /** Today, as YYYY-MM-DD. */
  date: string;
  /** The note, when it exists. */
  filePath?: string;
  /** Its open tasks, listed or not. */
  openTaskCount: number;
}

/** One agenda group, as Home's agenda widget shows it. */
export interface DashboardWidgetAgendaGroup {
  id: string;
  label: string;
  count: number;
  tasks: DashboardTask[];
}

/** What one Home widget shows. Each kind fills only its own fields. */
export interface DashboardWidget extends DashboardWidgetConfig {
  title: string;
  /** How many entries there are, listed or not. */
  total?: number;
  /** Which page of its entries it carries, for a widget that is paged. */
  paging?: ResultPaging;
  tasks?: DashboardTask[];
  tags?: DashboardWidgetTag[];
  notes?: DashboardWidgetNote[];
  queries?: string[];
  savedFilters?: DashboardSavedFilter[];
  agenda?: DashboardWidgetAgendaGroup[];
  /** The namespaces Gone quiet or Progress can list, for its gear. */
  namespaces?: string[];
  /** Open tasks past `needsNewDateAfterDays`, which the agenda leaves out. */
  needsNewDate?: number;
  /** Tasks completed today, said under the Tasks view widget's list. */
  doneToday?: number;
  /** The search that lists them, scoped by `deckard.agenda.query`. */
  needsNewDateQuery?: string;
  stats?: Array<{ label: string; value: number }>;
  /** A saved-search widget's search. */
  savedQuery?: string;
  /** Set when that search was saved on the Task Board, which opens it. */
  savedPage?: 'taskBoard';
  /** The notes a saved-search widget's search finds, listed or not. */
  noteTotal?: number;
  /** Set when the widget names a saved search that no longer exists. */
  missing?: boolean;
  /** Why a tasks widget's search could not run. */
  error?: string;
  /** The search widget's box: its completions and recent searches. */
  searchState?: QueryViewState;
  tagPairs?: DashboardWidgetTagPair[];
  today?: DashboardWidgetToday;
  /** The note a related-notes widget ranks by. */
  sourceNote?: DashboardWidgetNote;
  /** Try next's one suggestion; absent, the widget draws nothing outside Customize. */
  tryNext?: DashboardTryNext;
}

/** One thing Home suggests trying, and the button that does it. */
export interface DashboardTryNext {
  id: string;
  /** What the page posts back to run, put off, or retire it. */
  key: string;
  text: string;
  action: { label: string };
}

/** Hearts a tag, or takes its heart away. */
export interface ToggleFavoriteMessage {
  type: 'toggleFavorite';
  tagKey: string;
}

/** Hearts an entity, or takes its heart away. */
export interface ToggleFavoriteEntityMessage {
  type: 'toggleFavoriteEntity';
  entityKey: string;
}

/** Chooses how the Dashboard orders its tags. */
export interface SetTagSortMessage {
  type: 'setTagSort';
  mode: TagSortMode;
}

/** Chooses how the Dashboard orders its entities. */
export interface SetEntitySortMessage {
  type: 'setEntitySort';
  mode: TagSortMode;
}

/** Switches the Dashboard between Home and Tags. */
export interface SetDashboardModeMessage {
  type: 'setDashboardMode';
  mode: DashboardMode;
}

/** Filters a Dashboard list by what is typed in its search box. */
export interface SetDashboardSearchMessage {
  type: 'setDashboardSearch';
  field: DashboardSearchField;
  query: string;
}

/** Sets how many columns the Dashboard lays its tags out in. */
export interface SetDashboardColumnsMessage {
  type: 'setDashboardColumns';
  section: 'tags';
  columns: DashboardColumnCount;
}

/** Replaces Home's widgets, in order. */
export interface SetDashboardWidgetsMessage {
  type: 'setDashboardWidgets';
  widgets: DashboardWidgetConfig[];
}

/** Puts Home's widgets back as they first were. */
export interface ResetDashboardWidgetsMessage {
  type: 'resetDashboardWidgets';
}

/** What Home's + Add widget offers, for Related Notes to offer too. */
export interface DashboardWidgetChoicesMessage {
  type: 'widgetChoices';
  choices: { value: string; label: string; description?: string }[];
}

/** Opens today's daily note, creating it when it does not exist yet. */
export interface OpenDailyNoteMessage {
  type: 'openDailyNote';
}

/** Adds a task to today's daily note. */
export interface QuickAddMessage {
  type: 'quickAdd';
  text: string;
}

/** Creates a tag's hub note. */
export interface CreateTagHubMessage {
  type: 'createTagHub';
  tagKey: string;
}

/** Captures a next action for a tag that has nothing open. */
export interface AddNextActionMessage {
  type: 'addNextAction';
  tagKey: string;
}

/** Opens a note at its top. */
export interface OpenNoteMessage {
  type: 'openNote';
  filePath: string;
  /** Shift was held: open it where `deckard.openNotesIn` does not. */
  opposite?: boolean;
}

/** Runs, puts off for a week, or retires Try next's suggestion. */
export interface TryNextMessage {
  type: 'runTryNext' | 'snoozeTryNext' | 'retireTryNext';
  key: string;
}

/** Opens Help's What's new, or stops Home saying there is something new. */
export interface WhatsNewMessage {
  type: 'openWhatsNew' | 'dismissWhatsNew';
}

/** Opens a Deckard view Home links to. */
export interface OpenDeckardViewMessage {
  type: 'openView';
  view: 'agenda' | 'stats' | 'sampleWorkspace' | 'checkSetup' | 'walkthrough';
}

/**
 * Keeps the order tags were dragged into, and whether the dragged one is a
 * favorite.
 */
export interface ReorderTagsMessage {
  type: 'reorderTags';
  tagKeys: string[];
  tagKey: string;
  isFavorite: boolean;
}

/** Keeps the order entities were dragged into. */
export interface ReorderEntitiesMessage {
  type: 'reorderEntities';
  entityKeys: string[];
}

/** Opens a saved search. */
export interface OpenSavedFilterMessage {
  type: 'openSavedFilter';
  filterId: string;
}

/** Deletes a saved search. */
export interface RemoveSavedFilterMessage {
  type: 'removeSavedFilter';
  filterId: string;
}

/** Adds a Home widget that lists what a saved search finds. */
export interface AddSavedSearchWidgetMessage {
  type: 'addSavedSearchWidget';
  filterId: string;
}

/** Remembers a search that was run, for Find and the search boxes. */
export interface RecordRecentQueryMessage {
  type: 'recordRecentQuery';
  query: string;
}

/**
 * What the Dashboard sends its host, by type. A message several types share,
 * such as Park Tag and Unpark Tag, is listed once under each, narrowed to
 * that type. The host checks each tag, line, and saved search a message
 * names against the index and preferences as they are now, since the page
 * may hold a snapshot from before they changed.
 */
export interface DashboardPageToHost {
  setZenMode: SetZenModeMessage;
  setDisplay: SetDisplayMessage;
  displayCommand: DisplayCommandMessage;
  chooseTheme: ChooseThemeMessage;
  openGoTo: OpenGoToMessage;
  listGoTo: ListGoToMessage;
  goToPage: GoToPageMessage;
  openSource: OpenSourceMessage;
  toggleTask: ToggleTaskMessage;
  toggleFavorite: ToggleFavoriteMessage;
  toggleFavoriteEntity: ToggleFavoriteEntityMessage;
  setTagSort: SetTagSortMessage;
  setEntitySort: SetEntitySortMessage;
  setDashboardMode: SetDashboardModeMessage;
  setDashboardSearch: SetDashboardSearchMessage;
  setDashboardColumns: SetDashboardColumnsMessage;
  reorderTags: ReorderTagsMessage;
  reorderEntities: ReorderEntitiesMessage;
  openTag: OpenTagMessage;
  renameTag: RenameTagMessage;
  parkTag: MessageAs<ParkTagMessage, 'parkTag'>;
  unparkTag: MessageAs<ParkTagMessage, 'unparkTag'>;
  openSavedFilter: OpenSavedFilterMessage;
  addSavedSearchWidget: AddSavedSearchWidgetMessage;
  removeSavedFilter: RemoveSavedFilterMessage;
  recordRecentQuery: RecordRecentQueryMessage;
  setDashboardWidgets: SetDashboardWidgetsMessage;
  resetDashboardWidgets: ResetDashboardWidgetsMessage;
  widgetChoices: DashboardWidgetChoicesMessage;
  openWhatsNew: MessageAs<WhatsNewMessage, 'openWhatsNew'>;
  dismissWhatsNew: MessageAs<WhatsNewMessage, 'dismissWhatsNew'>;
  runTryNext: MessageAs<TryNextMessage, 'runTryNext'>;
  snoozeTryNext: MessageAs<TryNextMessage, 'snoozeTryNext'>;
  retireTryNext: MessageAs<TryNextMessage, 'retireTryNext'>;
  openSearch: OpenSearchMessage;
  openTaskBoard: OpenTaskBoardMessage;
  openView: OpenDeckardViewMessage;
  openDailyNote: OpenDailyNoteMessage;
  quickAdd: QuickAddMessage;
  createTagHub: CreateTagHubMessage;
  addNextAction: AddNextActionMessage;
  openNote: OpenNoteMessage;
  pinNote: MessageAs<PinNoteMessage, 'pinNote'>;
  unpinNote: MessageAs<PinNoteMessage, 'unpinNote'>;
}

/** Messages from the Dashboard. */
export type DashboardMessage = MessageOf<DashboardPageToHost>;

/**
 * What the Dashboard is sent to draw: its snapshot, and the tags the
 * workspace parks, which the page leaves out of its lists.
 */
export interface DashboardPageState extends DashboardSnapshot {
  parkedTags: string[];
}

/** A widget chosen in Related Notes, which Home adds while customizing. */
export interface AddWidgetMessage {
  type: 'addWidget';
  /** The widget's kind, as + Add widget names it. */
  value: string;
}

/**
 * The answer to a quick add: the text the page sent, untrimmed, so the page
 * can keep it as a draft when the task was not added.
 */
export interface QuickAddResultMessage {
  type: 'quickAddResult';
  text: string;
  added: boolean;
}

/** What the host sends the Dashboard, by type. */
export interface DashboardHostToPage {
  state: StateMessage<DashboardPageState>;
  indexing: IndexingMessage;
  addWidget: AddWidgetMessage;
  quickAddResult: QuickAddResultMessage;
}

/** Home's tiles: what is overdue, due today, and open, each a search. */
export interface TaskGlance {
  overdue: number;
  today: number;
  /** Tasks finished since the week began, parked ones aside. */
  doneThisWeek: number;
  overdueQuery: string;
  todayQuery: string;
  doneQuery: string;
}
