/**
 * The Related Notes sidebar's protocol: Deckard's pages at its top, the
 * ranked notes, what links to the note being read, the states the sidebar
 * can be in, and the messages it sends.
 */
import type { RelatedNotesSortMode } from '../../domain/model/preferences';
import type { RankedNote, SuggestedTag } from '../../domain/model/relatedNotes';
import type { TagReference } from '../../domain/model/tags';
import type { CalendarDayDetail, CalendarMessage } from './calendar';
import type { MessageAs, MessageOf, StateMessage } from './messaging';
import type { SidebarGraphContext } from './notesGraph';
import type {
  GoToPageMessage,
  OpenHelpMessage,
  OpenSourceMessage,
  OpenTagMessage,
  OpenTaskBoardMessage,
  ParkTagMessage,
  RenameTagMessage,
  SearchRefineState,
  SidebarReadyMessage,
} from './shared';

export type { RankedNote, SuggestedTag } from '../../domain/model/relatedNotes';

/** A line in another note that links to, or names, the note being read. */
export interface NoteLinkEntry {
  filePath: string;
  /** The note the line is in. */
  title: string;
  /** One-based. */
  line: number;
  /** The line as written, for context. */
  text: string;
  /** The headings the line sits under, outermost first. */
  headingPath: string[];
  /**
   * The rest of the section the line is in, as plain text, cut at 15 lines
   * or 1,500 characters, for a link row to unfold.
   */
  sectionText?: string;
}

/** The lines of one note that link to the note being read. */
export interface NoteLinkGroup {
  filePath: string;
  title: string;
  updatedAt?: number;
  /** When the note was last updated, in words: `3 days ago`. */
  updatedLabel?: string;
  /** The lines listed, in the order they are written. */
  entries: NoteLinkEntry[];
  /** How many links the note has here, listed or not. */
  linkCount: number;
  /** The linking note is parked: listed after the rest, and said so. */
  parked?: true;
}

/** A mention of the note's name without a link, which can be made one. */
export interface NoteMention extends NoteLinkEntry {
  startColumn: number;
  endColumn: number;
  /** The name as written, which the link keeps. */
  name: string;
}

/** Related Notes' Link on one mention: make that mention a link. */
export interface LinkMentionMessage {
  type: 'linkMention';
  filePath: string;
  line: number;
  startColumn: number;
}

/** Related Notes' Hide daily notes. */
export interface SetHideDailyNotesMessage {
  type: 'setHideDailyNotes';
  hide: boolean;
}

/** A tag offered to an untagged note: write it where the cursor is. */
export interface AddSuggestedTagMessage {
  type: 'addSuggestedTag';
  tagKey: string;
}

/** Related Notes' gear: how many lines of each result's excerpt to show. */
export interface SetRelatedNotesPreviewLinesMessage {
  type: 'setRelatedNotesPreviewLines';
  lines: 0 | 1 | 2;
}

/** Related Notes' Open as search: every entry that links to the note. */
export interface OpenLinksSearchMessage {
  type: 'openLinksSearch';
}

/** Related Notes' Link all: every mention of the note, as one write. */
export interface LinkAllMentionsMessage {
  type: 'linkAllMentions';
}

/** What points at the note being read. */
export interface NoteLinks {
  /** The notes that link here, newest updated first, each with its lines. */
  linkedFromNotes: NoteLinkGroup[];
  /** How many links there are, listed or not. */
  linkedFromCount: number;
  /** How many notes they are in. */
  linkedFromNoteCount: number;
  /** Daily, weekly, and monthly notes left out of Linked from. */
  hiddenDailyNoteCount?: number;
  mentions: NoteMention[];
  mentionCount: number;
}

/** What the Related Notes sidebar draws, and which of its states it is in. */
export interface SidebarNotesSnapshot {
  /** How far the first scan has got, while the state is loading. */
  progress?: { completed: number; total: number };
  /** What links to the note being read, and what names it without a link. */
  links?: NoteLinks;
  activeFileName?: string;
  activeEntryTitle?: string;
  activeTags: SidebarTag[];
  notes: RankedNote[];
  relatedNotesSortMode?: RelatedNotesSortMode;
  /** Whether daily notes are left out of the list and of Linked from. */
  hideDailyNotes?: boolean;
  /** How many lines of each result's excerpt the cards show, 0 for none. */
  previewLines?: 0 | 1 | 2;
  /**
   * For a note with no tags: entries worded like it, kept apart from the
   * related notes, and the tags those entries use.
   */
  similar?: { notes: RankedNote[]; tags: SuggestedTag[] };
  graph?: SidebarGraphContext;
  /** The active search page's Refine options, shown in its place. */
  refine?: SearchRefineState;
  /** The calendar page's chosen day, while the page is in front. */
  calendarDay?: CalendarDayDetail;
  /** The widgets Home can add, while Home is in front. */
  homeWidgets?: { value: string; label: string; description?: string }[];
  state:
    | 'ready'
    | 'loading'
    | 'notIndexed'
    | 'noMarkdown'
    | 'noTags'
    | 'noMatches'
    | 'graph'
    | 'refine'
    | 'calendarDay'
    | 'customizeHome';
}

/** A tag of the note being read, with its weight in the ranking. */
export interface SidebarTag extends TagReference {
  /** Relative contribution used when ranking Related Notes. */
  weight: number;
  /** How many notes and tasks a search for the tag finds. */
  matches?: { notes: number; tasks: number };
}

/**
 * Write a `[[Note#Heading]]` link to a related note at the cursor of the note
 * being edited.
 */
export interface InsertLinkMessage {
  type: 'insertLink';
  filePath: string;
  line: number;
}

/** Opens the Dashboard. */
export interface OpenDashboardMessage {
  type: 'openDashboard';
}

/** Opens the notes graph. */
export interface OpenNotesGraphMessage {
  type: 'openNotesGraph';
}

/**
 * Selects a node on the notes graph from the sidebar, opening it when `open`
 * is set.
 */
export interface ActivateNotesGraphNodeMessage {
  type: 'activateNotesGraphNode';
  nodeId: string;
  open: boolean;
}

/**
 * Highlights a node on the notes graph while the sidebar row naming it is
 * hovered; none clears it.
 */
export interface HoverNotesGraphNodeMessage {
  type: 'hoverNotesGraphNode';
  nodeId?: string;
}

/** Opens today's daily note, creating it when it does not exist yet. */
export interface CreateDailyNoteMessage {
  type: 'createDailyNote';
}

/** Chooses how Related Notes orders its list. */
export interface SetRelatedNotesSortMessage {
  type: 'setRelatedNotesSort';
  mode: RelatedNotesSortMode;
}

/**
 * Narrows the active search by one of its facet values, from the sidebar's
 * Refine view: `and` keeps only it, `exclude` leaves it out, and `or` allows
 * it beside the value of the same facet already chosen.
 */
export interface RefineActiveSearchMessage {
  type: 'refineActiveSearch';
  facetId: string;
  clause: string;
  mode: 'and' | 'exclude' | 'or';
}

/**
 * Stops ranking by the entry chosen in the sidebar and goes back to
 * following the editor.
 */
export interface ClearEntryRelatedNotesMessage {
  type: 'clearEntryRelatedNotes';
}

/** Home's Customize: add a widget Home offers, by its value. */
export interface HomeAddWidgetMessage {
  type: 'homeAddWidget';
  value: string;
}

/** Home's Customize: put Home's widgets back as they were at first. */
export interface HomeResetWidgetsMessage {
  type: 'homeResetWidgets';
}

/**
 * What the sidebar's copy of the calendar page's day panel asks, passed on
 * for the calendar page to do as its own panel would.
 */
export interface CalendarDayMessage {
  type: 'calendarDay';
  message: CalendarMessage;
}

/** How Context draws Deckard's pages at its top: labeled rows, or one row of their icons. */
export type ContextPagesStyle = 'list' | 'icons';

/** One page as Context draws it at its top. */
export interface ContextPage {
  /** The page's name in the page list, such as `board`, which names its glyph. */
  id: string;
  label: string;
  /** What is worth knowing about it now, such as "3 due today". */
  description: string;
  /** A sentence on what it is, for its tip. */
  detail: string;
}

/**
 * The pages Context draws at its top: the ones the reader keeps there, in
 * order, how, and which of them is in front, drawn pressed.
 */
export interface ContextPages {
  style: ContextPagesStyle;
  pages: ContextPage[];
  /** The page in front, such as `board` while the Task Board is. */
  current?: string;
}

/**
 * What the sidebar is sent as its state: its snapshot, the tags its tag
 * menu offers to unpark, and Deckard's pages, drawn at its top.
 */
export type SidebarNotesPageState = SidebarNotesSnapshot & { parkedTags: string[]; pages?: ContextPages };

/**
 * What the Related Notes sidebar sends its host, by type. The host checks
 * each row a click names against what the sidebar would list now.
 */
export interface SidebarNotesPageToHost {
  ready: SidebarReadyMessage;
  clearEntryRelatedNotes: ClearEntryRelatedNotesMessage;
  openSource: OpenSourceMessage;
  activateNotesGraphNode: ActivateNotesGraphNodeMessage;
  hoverNotesGraphNode: HoverNotesGraphNodeMessage;
  openTag: OpenTagMessage;
  linkMention: LinkMentionMessage;
  linkAllMentions: LinkAllMentionsMessage;
  openLinksSearch: OpenLinksSearchMessage;
  addSuggestedTag: AddSuggestedTagMessage;
  setRelatedNotesPreviewLines: SetRelatedNotesPreviewLinesMessage;
  setHideDailyNotes: SetHideDailyNotesMessage;
  insertLink: InsertLinkMessage;
  renameTag: RenameTagMessage;
  parkTag: MessageAs<ParkTagMessage, 'parkTag'>;
  unparkTag: MessageAs<ParkTagMessage, 'unparkTag'>;
  refineActiveSearch: RefineActiveSearchMessage;
  setRelatedNotesSort: SetRelatedNotesSortMessage;
  openDashboard: OpenDashboardMessage;
  openNotesGraph: OpenNotesGraphMessage;
  openTaskBoard: OpenTaskBoardMessage;
  createDailyNote: CreateDailyNoteMessage;
  openHelp: OpenHelpMessage;
  homeAddWidget: HomeAddWidgetMessage;
  homeResetWidgets: HomeResetWidgetsMessage;
  calendarDay: CalendarDayMessage;
  goToPage: GoToPageMessage;
}

/** What the host sends the Related Notes sidebar, by type. */
export interface SidebarNotesHostToPage {
  state: StateMessage<SidebarNotesPageState>;
}

/** Messages from the Related Notes sidebar. */
export type SidebarMessage = MessageOf<SidebarNotesPageToHost>;
