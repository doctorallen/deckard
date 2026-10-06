import { describeSteps } from '../../domain/markdown/taskSteps';
import { drawTaskStatus } from './drawnStatus';
import type { DrawnStatus } from '../protocol/shared';
import { isOpenTask } from '../../domain/tasks/taskStatuses';
import { QueryContext } from '../../domain/query/queryContext';
import { getFileName } from '../../shared/paths';
import { buildBlockExcerpt } from '../../domain/markdown/blockExcerpt';
import { tokenizeInline } from '../../domain/markdown/inline';
import type { BlockToken } from '../../domain/model/blocks';
import type { InlineToken } from '../../domain/model/inline';
import {
  getHeadingPath,
  getInlineSource,
  getNoteTitle,
  getTitleTags,
} from '../../domain/ranking/entryLabels';
import { describeDueDate } from '../../domain/markdown/dueWording';
import { findFrontmatterEnd } from '../../domain/markdown/frontmatter';
import { TagOverviewHub } from '../protocol/searchPage';
import { ParsedFile, Section, Task, TagTitleDisplayMode, TagOverviewSortMode, TaskSortMode } from '../../domain/model';
import { DashboardTask, TagOverviewCard } from '../protocol/shared';
import { DashboardNote } from '../protocol/dashboard';
import { stripTags } from '../../domain/markdown/parser';
import { fileEntryId } from '../../domain/markdown/noteEntries';
import type { EntryLine } from '../../domain/index/noteEntryIndex';

/**
 * The cards and task rows every page draws an entry as, and the orders they
 * are listed in: a section's card with its body read once, a front-matter
 * note's card, a tag's hub, a task row with its due date in words, and the
 * note and task sorts the reader chooses between.
 */

/**
 * Sorts tasks by the selected policy and falls back to source location.
 *
 * Missing filesystem dates sort last either way, and the path/line fallback
 * makes results deterministic when several tasks share the same timestamp,
 * title, or rank.
 */
export function sortTasks(
  tasks: Task[],
  taskOrder: string[],
  taskSortMode: TaskSortMode = 'rank',
): Task[] {
  const compare = createTaskComparator(taskOrder, taskSortMode);
  return tasks.sort((left, right) =>
    compare(left, right) ||
    left.filePath.localeCompare(right.filePath) ||
    left.lineNumber - right.lineNumber,
  );
}

/**
 * How two tasks compare by the selected policy alone, 0 when it can't tell
 * them apart, so a caller can fall back to an order of its own, as the
 * board's columns fall back to due date and priority.
 */
export function createTaskComparator(
  taskOrder: readonly string[],
  taskSortMode: TaskSortMode,
): (left: Task, right: Task) => number {
  switch (taskSortMode) {
    case 'created':
      return (left, right) => compareDatesDescending(left.createdAt, right.createdAt);
    case 'createdOldest':
      return (left, right) => compareDatesAscending(left.createdAt, right.createdAt);
    case 'updated':
      return (left, right) => compareDatesDescending(left.updatedAt, right.updatedAt);
    case 'updatedOldest':
      return (left, right) => compareDatesAscending(left.updatedAt, right.updatedAt);
    case 'alphabetical':
      return (left, right) => baseCollator.compare(left.title, right.title);
    case 'alphabeticalReverse':
      return (left, right) => baseCollator.compare(right.title, left.title);
    case 'rank': {
      const order = new Map(taskOrder.map((taskId, index) => [taskId, index]));
      return (left, right) =>
        (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER);
    }
  }
}

/**
 * Sorts overview cards without mutating the webview's source snapshot.
 */
export function sortTagOverviewCards(
  cards: TagOverviewCard[],
  sortMode: TagOverviewSortMode,
): TagOverviewCard[] {
  return [...cards].sort((left, right) =>
    compareTagOverviewCards(left, right, sortMode),
  );
}

/**
 * Sorts dashboard note entries without mutating the index projection.
 */
export function sortDashboardNotes(
  notes: DashboardNote[],
  sortMode: TagOverviewSortMode,
): DashboardNote[] {
  return [...notes].sort((left, right) =>
    compareTagOverviewCards(left, right, sortMode),
  );
}

/** Words with their first letter in capitals, as a row starts its due date. */
function capitalize(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Adds the title as tokens and the source context without changing the domain task.
 * An open task's due date is worded against the context's today and policy.
 */
export function createDashboardTask(
  task: Task,
  sections: Map<string, Section>,
  context: Pick<QueryContext, 'now' | 'taskPolicy'>,
): DashboardTask {
  const due =
    isOpenTask(task) && task.dueAt !== undefined
      ? describeDueDate(task.dueAt, context.now, context.taskPolicy, task.dueText)
      : undefined;
  return {
    task,
    titleTokens: tokenizeTaskTitle(task),
    titleTags: getTitleTags(task.tags, task.tagLabels, task.title),
    sectionHeading: task.sectionId
      ? sections.get(task.sectionId)?.heading
      : undefined,
    headingPath: (() => {
      const section = task.sectionId ? sections.get(task.sectionId) : undefined;
      return section ? getHeadingPath(section, sections) : [];
    })(),
    fileName: task.filePath.split('/').pop() ?? task.filePath,
    ...(due
      ? {
          dueLabel: capitalize(due.label),
          dueParts: { ...due.parts, state: capitalize(due.parts.state) },
          overdue: due.overdue,
          ...(due.stale ? { stale: true } : {}),
          ...(due.days === 0 ? { dueToday: true } : {}),
        }
      : {}),
    ...(task.steps ? { stepsLabel: describeSteps(task.steps) } : {}),
    ...withDrawnStatus(drawTaskStatus(task, context.taskPolicy)),
  };
}

/**
 * Removes the heading from the overview body and prepares both render modes.
 * The heading path is carried only when `sections` is given to read it from.
 */
export function createTagOverviewCard(
  section: Section,
  {
    sectionAccessCounts,
    tagTitleDisplayMode,
    pinned = false,
    sections,
    content,
  }: {
    sectionAccessCounts: Record<string, number>;
    tagTitleDisplayMode: TagTitleDisplayMode;
    pinned?: boolean;
    sections?: ReadonlyMap<string, Section>;
    /** The entry's text, read through the untagged headings it owns; its own text when not given. */
    content?: string;
  },
): TagOverviewCard {
  return {
    id: section.id,
    ...(sections ? { headingPath: getHeadingPath(section, sections) } : {}),
    filePath: section.filePath,
    heading: getNoteTitle(section.heading, tagTitleDisplayMode),
    ...(pinned ? { pinned } : {}),
    titleTags: getTitleTags(
      section.tags,
      section.tagLabels,
      getInlineSource(section),
    ),
    tags: section.tags.map((key) => ({
      key,
      label: section.tagLabels[key] ?? `#${key}`,
    })),
    rawContent: getSectionBody(content ?? section.rawContent),
    bodyTokens: tokenizeSectionBody(section, content),
    startLine: section.startLine,
    createdAt: section.createdAt,
    updatedAt: section.updatedAt,
    accessCount: sectionAccessCounts[section.id] ?? 0,
  };
}

/**
 * The heading a note tagged in its front matter is titled by when it is a
 * note as a whole (noteEntries.ts): its first heading, when that is a `#`
 * heading the note owns, as a note's title is. Undefined otherwise.
 */
function findFileEntryTitle(file: ParsedFile): Section | undefined {
  const lead = file.sections.find((section) => !section.isInline);
  return lead && lead.headingLevel === 1 && lead.entryId === fileEntryId(file.filePath) ? lead : undefined;
}

/**
 * The lines a front-matter note's card draws, from its entry's lines
 * (`getFileEntryLines`): without its title, which is the card's heading, and
 * without blank lines at either end. The heading a card's lines are under is
 * named beside a match, unless it is the title.
 */
export function getFileCardLines(file: ParsedFile, lines: readonly EntryLine[]): { lines: EntryLine[]; titleId?: string } {
  const lead = findFileEntryTitle(file);
  const kept = lines.filter((line) => !(lead && line.line === lead.startLine));
  let first = 0;
  let last = kept.length;
  while (first < last && !kept[first].text.trim()) {
    first += 1;
  }
  while (last > first && !kept[last - 1].text.trim()) {
    last -= 1;
  }
  return { lines: kept.slice(first, last), ...(lead ? { titleId: lead.id } : {}) };
}

/** A note's title as a list shows it: its own `#` heading when it is a note as a whole, else its file name. */
export function getFileEntryTitle(file: ParsedFile): string {
  const lead = findFileEntryTitle(file);
  const title = lead ? stripTags(lead.heading).trim() : '';
  return title || (getFileName(file.filePath) ?? file.filePath);
}

/**
 * A front-matter note, or a note above its first heading, as a card: titled
 * by its own `#` heading when it is a note as a whole, else by its file name.
 */
export function createFileOverviewCard(file: ParsedFile, lines?: readonly EntryLine[]): TagOverviewCard {
  const heading = getFileEntryTitle(file);
  const lead = findFileEntryTitle(file);
  let rawContent: string;
  if (lines) {
    rawContent = lines.map((line) => line.text).join('\n');
  } else {
    // The title is the card's heading, so its line is not repeated in the body.
    rawContent = lead
      ? getFrontmatterBody(file.content.split(/\r?\n/).filter((_line, at) => at !== lead.startLine - 1).join('\n')).replace(/^\n+/, '')
      : getFilePreamble(file);
  }
  return {
    id: `frontmatter:${file.filePath}`,
    filePath: file.filePath,
    heading,
    titleTags: [],
    tags: file.frontmatterTags.map((tag) => ({ ...tag })),
    rawContent,
    bodyTokens: buildBlockExcerpt(rawContent),
    startLine: 1,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    accessCount: 0,
  };
}

/**
 * The note that describes a tag, shown above the tag's overview entries.
 */
export function createTagOverviewHub(
  file: ParsedFile,
  otherFilePaths: string[],
): TagOverviewHub {
  const rawContent = getFrontmatterBody(file.content);
  return {
    filePath: file.filePath,
    fileName: getFileName(file.filePath) ?? file.filePath,
    rawContent,
    bodyTokens: buildBlockExcerpt(rawContent),
    properties: (file.hub?.properties ?? []).map((property) => ({
      name: property.name,
      values: property.values.map((value) => ({ ...value })),
    })),
    otherFilePaths,
  };
}

/** Reads the tag-title setting: `separate` when it says so, `inline` for anything else. */
export function normalizeTagTitleDisplayMode(
  value: unknown,
): TagTitleDisplayMode {
  return value === 'separate' ? 'separate' : 'inline';
}

/**
 * `localeCompare` with options builds a collator on every call, which made
 * sorting thousands of cards the slowest part of the Dashboard. These compare
 * as `localeCompare` with and without `{ sensitivity: 'base' }` does, except
 * that a run of digits is read as a number, so `entry 2` comes before
 * `entry 10` rather than after `entry 1`.
 */
export const baseCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** `localeCompare` without options, as a collator built once; see baseCollator. */
export const defaultCollator = new Intl.Collator(undefined, { numeric: true });

/** What the note order reads, whether of a key or a drawn card. */
type SortableNote = Pick<
  TagOverviewCard,
  'heading' | 'filePath' | 'startLine' | 'createdAt' | 'updatedAt' | 'accessCount'
>;

/**
 * Applies the requested overview mode and a stable heading/path/line fallback.
 */
export function compareTagOverviewCards(
  left: SortableNote,
  right: SortableNote,
  sortMode: TagOverviewSortMode,
): number {
  const result = compareNotesBy(left, right, sortMode);
  if (result !== 0) {
    return result;
  }

  return (
    baseCollator.compare(left.heading, right.heading) ||
    defaultCollator.compare(left.filePath, right.filePath) ||
    left.startLine - right.startLine
  );
}

/** How two notes compare by the selected mode alone, 0 when it can't tell them apart. */
function compareNotesBy(left: SortableNote, right: SortableNote, sortMode: TagOverviewSortMode): number {
  switch (sortMode) {
    case 'created':
      return compareDatesDescending(left.createdAt, right.createdAt);
    case 'createdOldest':
      return compareDatesAscending(left.createdAt, right.createdAt);
    case 'updated':
      return compareDatesDescending(left.updatedAt, right.updatedAt);
    case 'updatedOldest':
      return compareDatesAscending(left.updatedAt, right.updatedAt);
    case 'access':
      return right.accessCount - left.accessCount;
    case 'alphabeticalReverse':
      return baseCollator.compare(right.heading, left.heading);
    case 'alphabetical':
      return 0;
  }
}

/** Oldest first, with unknown dates after known ones, as compareDatesDescending keeps them. */
function compareDatesAscending(
  left: number | undefined,
  right: number | undefined,
): number {
  if (left === undefined || right === undefined) {
    return compareDatesDescending(left, right);
  }
  return left - right;
}

/**
 * Places unknown dates after known dates for useful date sorting.
 */
function compareDatesDescending(
  left: number | undefined,
  right: number | undefined,
): number {
  if (left === undefined && right === undefined) {
    return 0;
  }
  if (left === undefined) {
    return 1;
  }
  if (right === undefined) {
    return -1;
  }
  return right - left;
}

/**
 * Reading Markdown is the costliest part of a card, and an entry's text
 * never changes after it is parsed, so each body and title is read once. A
 * reparsed note brings new entries, and the old ones are let go with them.
 */
const sectionBodyTokens = new WeakMap<Section, BlockToken[]>();
/** An entry's text as block tokens, read once; see sectionBodyTokens. */
const entryBodyTokens = new WeakMap<Section, BlockToken[]>();

/** Each task's title as inline tokens, read once; see sectionBodyTokens. */
const taskTitleTokens = new WeakMap<Task, InlineToken[]>();

/**
 * A section's body as block tokens, read once per section: its entry's text
 * when given, which is the same for a section as long as its note is.
 */
function tokenizeSectionBody(section: Section, content?: string): BlockToken[] {
  const cache = content === undefined ? sectionBodyTokens : entryBodyTokens;
  let tokens = cache.get(section);
  if (tokens === undefined) {
    tokens = buildBlockExcerpt(getSectionBody(content ?? section.rawContent));
    cache.set(section, tokens);
  }
  return tokens;
}

/** A task's title as inline tokens, read once per task. */
function tokenizeTaskTitle(task: Task): InlineToken[] {
  let tokens = taskTitleTokens.get(task);
  if (tokens === undefined) {
    tokens = tokenizeInline(task.title);
    taskTitleTokens.set(task, tokens);
  }
  return tokens;
}

/**
 * Keeps overview cards focused on body content instead of repeating their title.
 */
export function getSectionBody(rawContent: string): string {
  const lines = rawContent.split(/\r?\n/);
  return lines.length > 1 ? lines.slice(1).join('\n').replace(/^\n/, '') : '';
}

/**
 * What a note's own card shows. A note listed for its front matter tags shows
 * its body; one listed only because a search by link found a link above its
 * first heading shows the text above that heading, since each heading below
 * is an entry of its own.
 */
function getFilePreamble(file: ParsedFile): string {
  const body = getFrontmatterBody(file.content);
  const firstHeading = file.sections.find((section) => !section.isInline);
  if (file.frontmatterTags.length > 0 || !firstHeading) {
    return body;
  }
  const lines = file.content.split(/\r?\n/).slice(0, firstHeading.startLine - 1);
  return getFrontmatterBody(lines.join('\n')).trim();
}

/** A note's text below its front matter; all of it when the front matter is missing or never closed. */
export function getFrontmatterBody(content: string): string {
  const lines = content.split(/\r?\n/);
  const endLine = findFrontmatterEnd(lines);
  return endLine === undefined ? content : lines.slice(endLine + 1).join('\n').replace(/^\n/, '');
}


/** A drawn status, as a field a row carries only when there is one. */
export function withDrawnStatus(status: DrawnStatus | undefined): { status?: DrawnStatus } {
  return status ? { status } : {};
}
