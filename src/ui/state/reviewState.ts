import { isParkedTask } from '../../domain/index/parked';
import { stripTags } from '../../domain/markdown/parser';
import { SHORT_WEEKDAY_NAMES } from '../../domain/markdown/calendar';
import { formatIsoDate } from '../../domain/markdown/taskMetadata';
import { evaluateQuery } from '../../domain/query/queryEvaluator';
import { QueryContext } from '../../domain/query/queryContext';
import { parseQuery } from '../../domain/query/queryParser';
import { WorkspaceIndex } from '../../core/types';
import { noteTitle } from '../../domain/index/backlinks';

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

/** The comment that marks where a review begins, and where it ends. */
export const REVIEW_START = '<!-- deckard:review -->';
export const REVIEW_END = '<!-- deckard:review:end -->';

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

  const completed = [...index.tasks.values()]
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

  // What the period was meant to finish and did not: due by its end, open now.
  const slipped = [...index.tasks.values()]
    .filter(
      (task) =>
        !task.completed &&
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

  const firstSeen = options.tagFirstSeen ?? {};
  const newTags = Object.entries(firstSeen)
    .filter(([key, at]) => at > 0 && inRange(at) && index.tags.has(key))
    .map(([key]) => index.tags.get(key)?.label ?? key)
    .sort((left, right) => left.localeCompare(right));

  // What is ahead: each open task once, by its earliest date in the next
  // period, led by that day.
  const next = options.next;
  const comingUp = next
    ? [...index.tasks.values()]
        .filter((task) => !task.completed && !isParkedTask(index, task.id))
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
        }))
    : [];

  // Of what was due in the period, how much was done by its day.
  const due = [...index.tasks.values()].filter((task) => inRange(task.dueAt));
  const doneOnTime = due.filter(
    (task) =>
      task.completed &&
      task.doneAt !== undefined &&
      task.dueAt !== undefined &&
      task.doneAt < task.dueAt + DAY_MS,
  ).length;

  const custom = (options.sections ?? []).map((section) => readSection(index, section, options.queryContext));

  return {
    range,
    completed,
    slipped,
    created,
    updated,
    newTags,
    comingUp,
    dueInPeriod: due.length,
    doneOnTime,
    ...(options.nextLabel ? { nextLabel: options.nextLabel } : {}),
    custom,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SECTION_LIMIT = 20;

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
  const parsed = parseQuery(section.query);
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
    [
      `**Done:** ${summary.completed.length}${
        summary.dueInPeriod > 0
          ? ` (${summary.doneOnTime} of ${summary.dueInPeriod} that were due)`
          : ''
      }`,
      `**Still open:** ${summary.slipped.length}`,
      `**Coming up:** ${summary.comingUp.length}`,
      `**Notes:** ${summary.created.length} new, ${summary.updated.length} updated`,
      `**New tags:** ${summary.newTags.length}`,
    ].join(' · '),
  ];

  const list = (heading: string, items: ReviewItem[], empty: string): void => {
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
  };

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

  lines.push('', '### New tags', '');
  if (summary.newTags.length === 0) {
    lines.push('No tags were first seen in this period.');
  } else {
    // A fenced block, because fenced code is the one place Deckard does not
    // read a tag, and this review is about them rather than tagged with them.
    lines.push('```text', ...summary.newTags.slice(0, limit), '```');
    if (summary.newTags.length > limit) {
      lines.push('', `…and ${summary.newTags.length - limit} more.`);
    }
  }
  // The reader's own sections, last, each a plain list of what its search
  // found when the review was written.
  summary.custom.forEach((section) => {
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
  });
  lines.push(REVIEW_END);
  return lines.join('\n');
}

/**
 * Puts a review into a note: over the review already there, or at the end.
 *
 * Everything the note's author wrote is left where it is, which is what lets
 * a review be written again without spending what was written around it.
 */
export function writeReviewInto(content: string, review: string): string {
  const start = content.indexOf(REVIEW_START);
  const end = content.indexOf(REVIEW_END);
  if (start >= 0 && end > start) {
    return (
      content.slice(0, start) + review + content.slice(end + REVIEW_END.length)
    );
  }
  const body = content.replace(/\s+$/, '');
  return body ? `${body}\n\n${review}\n` : `${review}\n`;
}

/** A task or note title as a review names it: its words, without its tags. */
function clean(title: string): string {
  return stripTags(title).trim() || title.trim();
}
