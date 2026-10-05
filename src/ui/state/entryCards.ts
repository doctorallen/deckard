import { describeSteps } from '../../domain/markdown/taskSteps';
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

/**
 * The cards and task rows every page draws an entry as, and the orders they
 * are listed in: a section's card with its body read once, a front-matter
 * note's card, a tag's hub, a task row with its due date in words, and the
 * note and task sorts the reader chooses between.
 */

/**
 * Sorts tasks by the selected policy and falls back to source location.
 *
 * Missing filesystem dates sort last, and the path/line fallback makes results
 * deterministic when several tasks share the same timestamp or rank.
 */
export function sortTasks(
  tasks: Task[],
  taskOrder: string[],
  taskSortMode: TaskSortMode = 'rank',
): Task[] {
  const order = new Map(taskOrder.map((taskId, index) => [taskId, index]));
  return tasks.sort((left, right) => {
    if (taskSortMode === 'created') {
      const result = compareDatesDescending(left.createdAt, right.createdAt);
      if (result !== 0) {
        return result;
      }
    }

    if (taskSortMode === 'updated') {
      const result = compareDatesDescending(left.updatedAt, right.updatedAt);
      if (result !== 0) {
        return result;
      }
    }

    if (taskSortMode === 'rank') {
      const leftOrder = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
    }

    return (
      left.filePath.localeCompare(right.filePath) ||
      left.lineNumber - right.lineNumber
    );
  });
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
    !task.completed && task.dueAt !== undefined
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
          dueLabel: due.label.charAt(0).toUpperCase() + due.label.slice(1),
          overdue: due.overdue,
          ...(due.stale ? { stale: true } : {}),
          ...(due.days === 0 ? { dueToday: true } : {}),
        }
      : {}),
    ...(task.steps ? { stepsLabel: describeSteps(task.steps) } : {}),
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

/** A front-matter-only note, or a note above its first heading, as a card titled by its file name. */
export function createFileOverviewCard(file: ParsedFile): TagOverviewCard {
  const heading = getFileName(file.filePath) ?? file.filePath;
  const rawContent = getFilePreamble(file);
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
  if (sortMode === 'created') {
    const result = compareDatesDescending(left.createdAt, right.createdAt);
    if (result !== 0) {
      return result;
    }
  }

  if (sortMode === 'updated') {
    const result = compareDatesDescending(left.updatedAt, right.updatedAt);
    if (result !== 0) {
      return result;
    }
  }

  if (sortMode === 'access' && left.accessCount !== right.accessCount) {
    return right.accessCount - left.accessCount;
  }

  return (
    baseCollator.compare(left.heading, right.heading) ||
    defaultCollator.compare(left.filePath, right.filePath) ||
    left.startLine - right.startLine
  );
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

