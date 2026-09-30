import type { Weekday } from '../domain/markdown/dates';
import type { WorkspaceIndex } from '../domain/model';
import type { NotePeriod } from '../domain/notes/periodicNotes';
import { getReviewRange, ReviewPeriod } from '../domain/notes/reviewPeriods';
import type { QueryContext } from '../domain/query/queryContext';
import type { ResourceUri } from '../ports/uri';

/**
 * Writes a week's or a month's review into its periodic note.
 *
 * A periodic note that opens from its template alone gives a reader nothing
 * to read. The review is the report the index can already answer, written
 * into the note as ordinary Markdown so it stays true after the period ends.
 * Which days it covers, what it looks ahead at, and whether the note needs
 * writing at all are decided here; the command chooses the period and says
 * what was written.
 */

/** One section of the reader's own: a title and a Deckard search. */
export interface ReviewSection {
  title: string;
  query: string;
}

/** What a review is summarized with besides the index and its days. */
export interface ReviewSummaryOptions {
  /** When Deckard first saw each tag, from preferences. */
  tagFirstSeen?: Record<string, number>;
  /** The period after this one, which the review looks ahead at. */
  next: ReviewPeriod;
  /** What the next period is called, for its empty text. */
  nextLabel: string;
  sections: readonly ReviewSection[];
  /** The settings and moment the sections' searches are evaluated in. */
  queryContext: QueryContext;
}

/** What the command says of a review: how much was done, still open, and coming up. */
export interface ReviewCounts {
  completed: readonly unknown[];
  slipped: readonly unknown[];
  comingUp: readonly unknown[];
}

/**
 * How a review is read out of the index, written as Markdown, and put into
 * a note between its markers. These are the review view's own functions,
 * which the service is handed rather than imports, since they live with the
 * views until they move to the domain.
 */
export interface ReviewReport<Summary extends ReviewCounts> {
  summarize(index: WorkspaceIndex, range: ReviewPeriod, options: ReviewSummaryOptions): Summary;
  format(summary: Summary): string;
  /** The note with `review` in place of the review it holds, or added when it holds none. */
  writeInto(content: string, review: string): string;
}

/** Whether a review's write landed, and the handle its Undo works through. */
export type ReviewWriteOutcome<Handle> = { applied: false } | { applied: true; handle: Handle };

/** A periodic note, opened to have its review written in. */
export interface ReviewNote<Handle> {
  /** The note's text when it was opened. */
  readonly text: string;
  /** Replaces the whole note, as one write Undo takes back; `title` names the review in it. */
  write(content: string, title: string): Promise<ReviewWriteOutcome<Handle>>;
}

/** Where the review's note is opened. */
export interface ReviewNotes<U extends ResourceUri, Handle> {
  open(uri: U): Promise<ReviewNote<Handle>>;
}

/** What ReviewService works through. */
export interface ReviewCollaborators<U extends ResourceUri, Handle, Summary extends ReviewCounts> {
  notes: ReviewNotes<U, Handle>;
  report: ReviewReport<Summary>;
  /** What reads the notes again once a review is written. */
  index: { refresh(): Promise<void> };
}

/** One review to write: the period, the index it reads, and the settings it is written with. */
export interface ReviewRequest<U extends ResourceUri> {
  index: WorkspaceIndex;
  period: Exclude<NotePeriod, 'day'>;
  /** A day in the period. */
  day: Date;
  weekStart: Weekday;
  /** The days to review, when a note already says which it covers. */
  range?: ReviewPeriod;
  /**
   * The note to write into: the one open, or the period's, created from its
   * template when it is not there yet. It is found only once the review is
   * read out of the index.
   */
  note: () => Promise<U>;
  sections: readonly ReviewSection[];
  queryContext: QueryContext;
  tagFirstSeen?: Record<string, number>;
}

/**
 * What writing a review came to. `unchanged` found the note already holding
 * this review, so nothing was written.
 */
export type ReviewResult<U extends ResourceUri, Handle, Summary> =
  | { kind: 'unchanged'; title: string; noteUri: U }
  | { kind: 'not-applied' }
  | { kind: 'written'; title: string; noteUri: U; summary: Summary; handle: Handle };

/**
 * Writes reviews into periodic notes. One is made where the extension
 * starts; it holds nothing between reviews.
 */
export class ReviewService<U extends ResourceUri, Handle, Summary extends ReviewCounts> {
  /** Takes the notes it writes, the review's own functions, and the index it reads again. */
  public constructor(private readonly collaborators: ReviewCollaborators<U, Handle, Summary>) {}

  /**
   * Writes the review of a period into its note, replacing the review
   * already in it, and reads the notes again once it is written.
   */
  public async write(request: ReviewRequest<U>): Promise<ReviewResult<U, Handle, Summary>> {
    const { notes, report } = this.collaborators;
    const { period, weekStart } = request;
    const range = request.range ?? getReviewRange(period, request.day, weekStart);
    const summary = report.summarize(request.index, range, {
      tagFirstSeen: request.tagFirstSeen,
      // The period after this one, which the review looks ahead at.
      next: getReviewRange(period, new Date(range.end), weekStart),
      nextLabel: period === 'week' ? 'next week' : 'next month',
      sections: request.sections,
      queryContext: request.queryContext,
    });
    const review = report.format(summary);

    const noteUri = await request.note();
    const note = await notes.open(noteUri);
    const updated = report.writeInto(note.text, review);
    if (updated === note.text) {
      return { kind: 'unchanged', title: range.title, noteUri };
    }
    const written = await note.write(updated, range.title);
    if (!written.applied) {
      return { kind: 'not-applied' };
    }
    try {
      await this.collaborators.index.refresh();
    } catch {
      // The watcher picks the note up; the review itself is written.
    }
    return { kind: 'written', title: range.title, noteUri, summary, handle: written.handle };
  }
}
