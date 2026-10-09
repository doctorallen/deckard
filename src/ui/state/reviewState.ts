import { formatProgressCount } from '../../domain/tasks/progressCount';
import { isOpenTask } from '../../domain/tasks/taskStatuses';
import { isParkedTask } from '../../domain/index/parked';
import { stripTags } from '../../domain/markdown/parser';
import { SHORT_WEEKDAY_NAMES, formatIsoDate } from '../../domain/markdown/calendar';
import { evaluateQuery } from '../../domain/query/queryEvaluator';
import { QueryContext } from '../../domain/query/queryContext';
import { parseWorkspaceQuery } from '../../domain/types/typeQueryFields';
import { noteTitle } from '../../domain/index/backlinks';
import { Task, WorkspaceIndex } from '../../domain/model';

/**
 * What a week or a month came to, written into its periodic note.
 *
 * A weekly note opens from its template and says nothing; its natural
 * content is the report the index can already answer — what was finished,
 * what slipped, which notes were written, which tags are new. The review is
 * written as ordinary Markdown, so it reads in any editor and stays true
 * afterwards: it says what that week was, not what this week is.
 */

/** The stretch of days a review covers. */
export interface ReviewRange {
  /** What the period's note is called, such as `2026-W38` or `2026-09`. */
  name: string;
  /**
   * What the review is called: the days it covers. A week's number says
   * little to anyone reading it back; the days it held say what happened.
   */
  title: string;
  /** Local midnight the period starts, and the midnight after it ends. */
  start: number;
  end: number;
}

/** What a review reads beside the index, and how much each list names. */
export interface ReviewOptions {
  /** When Deckard first saw each tag, from preferences. */
  tagFirstSeen?: Record<string, number>;
  /** How many entries each list names before it says how many are left. */
  limit?: number;
  /** The period after this one, whose due, scheduled, and start dates the review looks ahead at. */
  next?: ReviewRange;
  /** What the next period is called, `next week` or `next month`, for its empty text. */
  nextLabel?: string;
  /** Sections of the reader's own, each a title and a Deckard search. */
  sections?: readonly ReviewSectionSetting[];
  /** The settings and moment the sections' searches are evaluated in. */
  queryContext: QueryContext;
}

/** One section from `deckard.periodicNote.reviewSections`. */
export interface ReviewSectionSetting {
  title: string;
  query: string;
}

/** A section of the reader's own, as it was when the review was written. */
export interface ReviewCustomSection {
  title: string;
  items: ReviewItem[];
  /** Set when the search does not parse; the section says so. */
  error?: string;
}

/** What a review found, before it is written out. */
export interface ReviewSummary {
  range: ReviewRange;
  completed: ReviewItem[];
  slipped: ReviewItem[];
  created: ReviewItem[];
  updated: ReviewItem[];
  newTags: string[];
  /** Open tasks due, scheduled, or starting in the next period, soonest first. */
  comingUp: ReviewItem[];
  /** Tasks due in the period, and how many of those were done by their date. */
  dueInPeriod: number;
  doneOnTime: number;
  nextLabel?: string;
  custom: ReviewCustomSection[];
}

/** One line of a review: what it was, and the note it is in. */
export interface ReviewItem {
  title: string;
  /** The note it belongs to, as a `[[link]]` names it. */
  note: string;
  /** A short fact after the title, such as a due date. */
  detail?: string;
}

/** The comment that marks where a review begins, so writing it again replaces it. */
export const REVIEW_START = '<!-- deckard:review -->';
/** The comment that marks where a review ends, so what follows it is left alone. */
export const REVIEW_END = '<!-- deckard:review:end -->';

/** How many entries each list names when the options do not say. */
const DEFAULT_LIMIT = 20;

/**
 * Reads a period out of the index: what was completed in it, what was due by
 * its end and is still open, the notes written and changed, and the tags that
 * first appeared.
 */
export function summarizeReview(
  index: WorkspaceIndex,
  range: ReviewRange,
  options: ReviewOptions,
): ReviewSummary {
  const inRange = (at: number | undefined): boolean =>
    at !== undefined && at >= range.start && at < range.end;
  const { created, updated } = listNotesWritten(index, inRange);
  const due = [...index.tasks.values()].filter((task) => inRange(task.dueAt));
  return {
    range,
    completed: listCompleted(index, inRange),
    slipped: listSlipped(index, range),
    created,
    updated,
    newTags: listNewTags(index, options.tagFirstSeen ?? {}, inRange),
    comingUp: options.next ? listComingUp(index, options.next) : [],
    dueInPeriod: due.length,
    doneOnTime: countDoneOnTime(due),
    ...(options.nextLabel ? { nextLabel: options.nextLabel } : {}),
    custom: (options.sections ?? []).map((section) => readSection(index, section, options.queryContext)),
  };
}

/** Whether a time falls in the period. */
type InRange = (at: number | undefined) => boolean;

/** The tasks completed in the period, in the order they were done, ties by title. */
function listCompleted(index: WorkspaceIndex, inRange: InRange): ReviewItem[] {
  return [...index.tasks.values()]
    .filter((task) => task.completed && inRange(task.doneAt))
    .sort(
      (left, right) =>
        (left.doneAt ?? 0) - (right.doneAt ?? 0) ||
        left.title.localeCompare(right.title),
    )
    .map((task) => ({
      title: clean(task.title),
      note: noteTitle(task.filePath),
      ...(task.doneAt ? { detail: `done ${formatIsoDate(task.doneAt)}` } : {}),
    }));
}

/**
 * What the period was meant to finish and did not: due by its end and open
 * now, parked tasks aside, soonest due first.
 */
function listSlipped(index: WorkspaceIndex, range: ReviewRange): ReviewItem[] {
  return [...index.tasks.values()]
    .filter(
      (task) =>
        isOpenTask(task) &&
        task.dueAt !== undefined &&
        task.dueAt < range.end &&
        !isParkedTask(index, task.id),
    )
    .sort(
      (left, right) =>
        (left.dueAt ?? 0) - (right.dueAt ?? 0) ||
        left.title.localeCompare(right.title),
    )
    .map((task) => ({
      title: clean(task.title),
      note: noteTitle(task.filePath),
      ...(task.dueAt ? { detail: `due ${formatIsoDate(task.dueAt)}` } : {}),
    }));
}

/**
 * The notes created in the period, and the older notes changed in it; a note
 * created in the period is listed once, as new.
 */
function listNotesWritten(
  index: WorkspaceIndex,
  inRange: InRange,
): { created: ReviewItem[]; updated: ReviewItem[] } {
  const files = [...index.files.values()];
  const created = files
    .filter((file) => inRange(file.createdAt))
    .map((file) => ({ title: noteTitle(file.filePath), note: noteTitle(file.filePath) }))
    .sort((left, right) => left.title.localeCompare(right.title));
  const createdPaths = new Set(
    files.filter((file) => inRange(file.createdAt)).map((file) => file.filePath),
  );
  const updated = files
    .filter(
      (file) => !createdPaths.has(file.filePath) && inRange(file.updatedAt),
    )
    .map((file) => ({ title: noteTitle(file.filePath), note: noteTitle(file.filePath) }))
    .sort((left, right) => left.title.localeCompare(right.title));
  return { created, updated };
}

/** The labels of tags first seen in the period that the index still has, alphabetically. */
function listNewTags(
  index: WorkspaceIndex,
  firstSeen: Record<string, number>,
  inRange: InRange,
): string[] {
  return Object.entries(firstSeen)
    .filter(([key, at]) => at > 0 && inRange(at) && index.tags.has(key))
    .map(([key]) => index.tags.get(key)?.label ?? key)
    .sort((left, right) => left.localeCompare(right));
}

/**
 * What is ahead: each open task once, by its earliest due, scheduled, or
 * start date in the next period, led by that day; parked tasks aside.
 */
function listComingUp(index: WorkspaceIndex, next: ReviewRange): ReviewItem[] {
  return [...index.tasks.values()]
    .filter((task) => isOpenTask(task) && !isParkedTask(index, task.id))
    .flatMap((task) => {
      const dates = (
        [
          [task.dueAt, 'due'],
          [task.scheduledAt, 'scheduled'],
          [task.startAt, 'starts'],
        ] as const
      )
        .filter((entry): entry is readonly [number, 'due' | 'scheduled' | 'starts'] =>
          entry[0] !== undefined && entry[0] >= next.start && entry[0] < next.end,
        )
        .sort((left, right) => left[0] - right[0]);
      return dates.length ? [{ task, at: dates[0][0], detail: dates[0][1] }] : [];
    })
    .sort((left, right) => left.at - right.at || left.task.title.localeCompare(right.task.title))
    .map(({ task, at, detail }) => ({
      title: `${formatDayShort(at)} · ${clean(task.title)}`,
      note: noteTitle(task.filePath),
      detail,
    }));
}

/** Of the tasks due in the period, how many were done by the end of their due day. */
function countDoneOnTime(due: readonly Task[]): number {
  return due.filter(
    (task) =>
      task.completed &&
      task.doneAt !== undefined &&
      task.dueAt !== undefined &&
      task.doneAt < task.dueAt + DAY_MS,
  ).length;
}

/** A day, for the on-time test: done before the end of the due day counts. */
const DAY_MS = 24 * 60 * 60 * 1000;
/** How many entries a section of the reader's own names; it ignores the options' limit. */
const SECTION_LIMIT = 20;

/** A day as the coming-up list leads with it: `Mon 2026-09-14`. */
function formatDayShort(at: number): string {
  return `${SHORT_WEEKDAY_NAMES[new Date(at).getDay()]} ${formatIsoDate(at)}`;
}

/**
 * A section of the reader's own: what its search finds in `context`, written
 * down as a list, so it says what was true when the review was written.
 */
function readSection(
  index: WorkspaceIndex,
  section: ReviewSectionSetting,
  context: QueryContext,
): ReviewCustomSection {
  const parsed = parseWorkspaceQuery(index, section.query);
  const error = parsed.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (!parsed.node || error) {
    return {
      title: section.title,
      items: [],
      error: error?.message ?? 'This search is empty.',
    };
  }
  const results = evaluateQuery(index, parsed.node, context);
  const items: ReviewItem[] = [
    ...results.tasks.map((task) => ({ title: clean(task.title), note: noteTitle(task.filePath) })),
    ...results.sections.map((entry) => ({ title: noteTitle(entry.filePath), note: noteTitle(entry.filePath) })),
    ...results.files.map((file) => ({ title: noteTitle(file.filePath), note: noteTitle(file.filePath) })),
  ];
  const seen = new Set<string>();
  return {
    title: section.title,
    items: items.filter((item) => {
      const key = `${item.title}\u0000${item.note}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    }),
  };
}

/**
 * The review as Markdown, between the comments that let it be written again
 * over the one before it.
 *
 * Tags are listed as plain text rather than written as tags: a review that
 * carried every tag it mentions would become an entry for each of them, and
 * a week's report is about those notes, not one of them. Task and note
 * titles are stripped of their tags for the same reason.
 */
export function formatReview(
  summary: ReviewSummary,
  options: Omit<ReviewOptions, 'queryContext'> = {},
): string {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const { range } = summary;
  const lines = [
    REVIEW_START,
    `## Review of ${range.title}`,
    '',
    `*${range.name}. Written by Deckard; run the review again to bring it up to date.*`,
    '',
    formatTally(summary),
  ];
  const list = (heading: string, items: ReviewItem[], empty: string): void =>
    appendList(lines, { heading, items, empty, limit });

  list('Completed', summary.completed, 'Nothing was completed in this period.');
  list(
    'Still open',
    summary.slipped,
    'Nothing due by the end of this period is still open.',
  );
  list(
    'Coming up',
    summary.comingUp,
    `Nothing is due, scheduled, or starting ${summary.nextLabel ?? 'in the next period'}.`,
  );
  list('Notes written', summary.created, 'No notes were written in this period.');
  list('Notes changed', summary.updated, 'No earlier notes were changed.');
  appendNewTags(lines, summary.newTags, limit);
  // The reader's own sections, last, each a plain list of what its search
  // found when the review was written.
  summary.custom.forEach((section) => appendCustomSection(lines, section));
  lines.push(REVIEW_END);
  return lines.join('\n');
}

/** The one-line tally under the review's heading: done, open, coming up, notes, and tags. */
function formatTally(summary: ReviewSummary): string {
  return [
    `**Done:** ${summary.completed.length}${
      summary.dueInPeriod > 0
        ? ` (${formatProgressCount(summary.doneOnTime, summary.dueInPeriod)} of those due)`
        : ''
    }`,
    `**Still open:** ${summary.slipped.length}`,
    `**Coming up:** ${summary.comingUp.length}`,
    `**Notes:** ${summary.created.length} new, ${summary.updated.length} updated`,
    `**New tags:** ${summary.newTags.length}`,
  ].join(' · ');
}

/** Appends one of the review's own lists: its heading, then up to `limit` entries or its empty text. */
function appendList(
  lines: string[],
  list: { heading: string; items: ReviewItem[]; empty: string; limit: number },
): void {
  const { heading, items, empty, limit } = list;
  lines.push('', `### ${heading}`, '');
  if (items.length === 0) {
    lines.push(empty);
    return;
  }
  items.slice(0, limit).forEach((item) => {
    const detail = item.detail ? ` (${item.detail})` : '';
    // A note is named by its own link; only a task needs the note after it.
    lines.push(
      item.title === item.note
        ? `- [[${item.note}]]${detail}`
        : `- ${item.title} — [[${item.note}]]${detail}`,
    );
  });
  if (items.length > limit) {
    lines.push(`- …and ${items.length - limit} more.`);
  }
}

/** Appends the New tags list, up to `limit` labels. */
function appendNewTags(lines: string[], newTags: readonly string[], limit: number): void {
  lines.push('', '### New tags', '');
  if (newTags.length === 0) {
    lines.push('No tags were first seen in this period.');
    return;
  }
  // A fenced block, because fenced code is the one place Deckard does not
  // read a tag, and this review is about them rather than tagged with them.
  lines.push('```text', ...newTags.slice(0, limit), '```');
  if (newTags.length > limit) {
    lines.push('', `…and ${newTags.length - limit} more.`);
  }
}

/** Appends a section of the reader's own: what it found, or why it found nothing. */
function appendCustomSection(lines: string[], section: ReviewCustomSection): void {
  lines.push('', `### ${section.title}`, '');
  if (section.error) {
    lines.push(`This search does not parse: ${section.error}`);
    return;
  }
  if (section.items.length === 0) {
    lines.push('Nothing matched this search.');
    return;
  }
  section.items.slice(0, SECTION_LIMIT).forEach((item) => {
    lines.push(item.title === item.note ? `- [[${item.note}]]` : `- ${item.title} — [[${item.note}]]`);
  });
  if (section.items.length > SECTION_LIMIT) {
    lines.push(`- …and ${section.items.length - SECTION_LIMIT} more.`);
  }
}

/**
 * Puts a review into a note: over the review already there, or at the end.
 *
 * Everything the note's author wrote is left where it is, which is what lets
 * a review be written again without spending what was written around it.
 * The review is written in the note's own line endings, since VS Code
 * writes it into a CRLF note in CRLF: in LF, a note already holding it
 * would never read as holding it.
 */
export function writeReviewInto(content: string, review: string): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const written = review.replace(/\r?\n/g, eol);
  const start = content.indexOf(REVIEW_START);
  const end = content.indexOf(REVIEW_END);
  if (start >= 0 && end > start) {
    return (
      content.slice(0, start) + written + content.slice(end + REVIEW_END.length)
    );
  }
  const body = content.replace(/\s+$/, '');
  return body ? `${body}${eol}${eol}${written}${eol}` : `${written}${eol}`;
}

/** A task or note title as a review names it: its words, without its tags. */
function clean(title: string): string {
  return stripTags(title).trim() || title.trim();
}
