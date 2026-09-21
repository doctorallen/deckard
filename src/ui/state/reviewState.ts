import { stripTags } from '../../core/markdown/parser';
import { formatIsoDate } from '../../core/markdown/taskMetadata';
import { WorkspaceIndex } from '../../core/types';
import { noteTitle } from '../../core/workspace/backlinks';

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
}

/** What a review found, before it is written out. */
export interface ReviewSummary {
  range: ReviewRange;
  completed: ReviewItem[];
  slipped: ReviewItem[];
  created: ReviewItem[];
  updated: ReviewItem[];
  newTags: string[];
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
  options: ReviewOptions = {},
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
        !task.completed && task.dueAt !== undefined && task.dueAt < range.end,
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

  return { range, completed, slipped, created, updated, newTags };
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
  options: ReviewOptions = {},
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
      `**Done:** ${summary.completed.length}`,
      `**Still open:** ${summary.slipped.length}`,
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
