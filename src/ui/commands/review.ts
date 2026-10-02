import * as vscode from 'vscode';

import type { IndexControl, IndexReader } from '../../core/workspace/indexReader';
import {
  parsePeriodicNoteName,
  PeriodicNoteName,
  ReviewPeriod,
  reviewPeriodOfNote,
} from '../../domain/notes/reviewPeriods';
import {
  ReviewNote,
  ReviewNotes,
  ReviewResult,
  ReviewService,
  ReviewWriteOutcome,
} from '../../services/reviewService';
import {
  formatReview,
  REVIEW_START,
  ReviewSectionSetting,
  ReviewSummary,
  summarizeReview,
  writeReviewInto,
} from '../state/reviewState';
import { chooseTargetFolder, ensurePeriodicNote, findExistingPeriodicNote } from './dailyNote';
import { readWeekStart } from './datePrompt';
import { readQueryContext } from './queryContext';
import { revealLine } from './navigation';
import { WorkspaceWriteHistory, WriteHandle } from './workspaceWrites';
import { NotePeriod } from '../../domain/notes/periodicNotes';
import { PreferencesReader } from '../../core/storage/preferencesRepository';

/**
 * Write Review, and the review a new weekly or monthly note starts with.
 *
 * Which days a review covers, what it looks ahead at, and whether the note
 * needs writing are ReviewService's decisions; these choose the period and
 * the note, read the settings, and say what was written, with the way to
 * read it and the way back.
 */

/** Whether a newly created periodic note gets its review written into it. */
export function isReviewOnCreateEnabled(uri?: vscode.Uri): boolean {
  return vscode.workspace
    .getConfiguration('deckard', uri)
    .get<boolean>('periodicNote.review', true);
}

/** `deckard.periodicNote.reviewSections`, keeping the ones with a title and a search. */
export function readReviewSections(uri?: vscode.Uri): ReviewSectionSetting[] {
  const value = vscode.workspace
    .getConfiguration('deckard', uri)
    .get<unknown>('periodicNote.reviewSections', []);
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const title = typeof entry?.title === 'string' ? entry.title.trim() : '';
        const query = typeof entry?.query === 'string' ? entry.query.trim() : '';
        return title && query ? [{ title, query }] : [];
      })
    : [];
}

/** The review service as the commands use it, over VS Code's URIs and writes. */
export type VscodeReviewService = ReviewService<vscode.Uri, WriteHandle, ReviewSummary>;

/**
 * The review service over VS Code: it opens the note through its editor,
 * writes through the history as one write, and reads the notes again
 * through `index` once it has.
 */
export function createReviewService(
  history: WorkspaceWriteHistory,
  index: { refresh(): Promise<void> },
): VscodeReviewService {
  return new ReviewService<vscode.Uri, WriteHandle, ReviewSummary>({
    notes: new ReviewDocuments(history),
    report: { summarize: summarizeReview, format: formatReview, writeInto: writeReviewInto },
    index,
  });
}

/** The note a review is written into, opened through VS Code. */
class ReviewDocuments implements ReviewNotes<vscode.Uri, WriteHandle> {
  public constructor(private readonly history: WorkspaceWriteHistory) {}

  /** Opens the note, to be replaced whole through that same document. */
  public async open(uri: vscode.Uri): Promise<ReviewNote<WriteHandle>> {
    const document = await vscode.workspace.openTextDocument(uri);
    return {
      text: document.getText(),
      write: (content, title) => this.write(uri, document, content, title),
    };
  }

  /** Writes the note whole, as one write Undo takes back. */
  private async write(
    uri: vscode.Uri,
    document: vscode.TextDocument,
    content: string,
    title: string,
  ): Promise<ReviewWriteOutcome<WriteHandle>> {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      uri,
      new vscode.Range(
        new vscode.Position(0, 0),
        document.lineAt(Math.max(document.lineCount - 1, 0)).range.end,
      ),
      content,
    );
    const written = await this.history.write(edit, {
      label: `the review of ${title}`,
      // One note, written by asking for it; the reader is watching it happen.
      preview: 'never',
    });
    return written.applied ? { applied: true, handle: written.handle } : { applied: false };
  }
}

/**
 * What a review is written with besides the index: the service that writes
 * it, and the preferences that say when each tag was first seen, when there
 * are any.
 */
export interface ReviewWrites {
  reviews: VscodeReviewService;
  preferences?: Pick<PreferencesReader, 'value'>;
}

/** Which review to write, and whether to say so. */
interface ReviewCommandRequest {
  period: Exclude<NotePeriod, 'day'>;
  /** A day in the period; today when absent. */
  day?: Date;
  silent?: boolean;
  /** The days to review, when a note already says which it covers. */
  range?: ReviewPeriod;
  /** The note to write into, rather than the one for the period. */
  noteUri?: vscode.Uri;
}

/**
 * Writes the review of a period into its note, creating the note when it is
 * not there yet, and replacing the review already in it. Returns the
 * review's title, or undefined when nothing was chosen or written.
 */
async function writeReview(
  indexer: Pick<IndexReader & IndexControl, 'ready' | 'getSnapshot' | 'refresh'>,
  writes: ReviewWrites,
  request: ReviewCommandRequest,
): Promise<string | undefined> {
  const { period, day = new Date() } = request;
  const target = await chooseReviewNote(period, day, request.noteUri);
  if (!target) {
    return undefined;
  }
  await indexer.ready;
  const weekStart = readWeekStart();
  const result = await writes.reviews.write({
    index: indexer.getSnapshot(),
    period,
    day,
    weekStart,
    range: request.range,
    note: target.note,
    sections: readReviewSections(target.scope),
    queryContext: readQueryContext(),
    tagFirstSeen: writes.preferences?.value.tagFirstSeen,
  });
  return reportReview(result, request.silent, indexer);
}

/**
 * The note a review goes into: the one given, or the period's note in the
 * folder the reader is in or picks, created only once the review is read.
 * `scope` is where the review's sections are read from. Undefined when no
 * folder was chosen.
 */
async function chooseReviewNote(
  period: Exclude<NotePeriod, 'day'>,
  day: Date,
  noteUri?: vscode.Uri,
): Promise<{ note: () => Promise<vscode.Uri>; scope: vscode.Uri } | undefined> {
  if (noteUri) {
    return { note: () => Promise.resolve(noteUri), scope: noteUri };
  }
  const folder = await chooseTargetFolder();
  if (!folder) {
    return undefined;
  }
  return { note: () => ensurePeriodicNote(folder, period, day), scope: folder.uri };
}

/**
 * Says a review was written, or that the note already holds it as it would
 * be written, unless `silent`, and returns its title; undefined when nothing
 * was written.
 */
function reportReview(
  result: ReviewResult<vscode.Uri, WriteHandle, ReviewSummary>,
  silent: boolean | undefined,
  indexer: Pick<IndexControl, 'refresh'>,
): string | undefined {
  switch (result.kind) {
    case 'unchanged':
      if (!silent) {
        void vscode.window.showInformationMessage(`The review of ${result.title} is already up to date.`);
      }
      return result.title;
    case 'not-applied':
      return undefined;
    case 'written': {
      const { summary } = result;
      if (!silent) {
        offerReview(
          `Wrote the review of ${result.title}: ${summary.completed.length} done, ${summary.slipped.length} still open, ${summary.comingUp.length} coming up.`,
          result.noteUri,
          result.handle,
          indexer,
        );
      }
      return result.title;
    }
  }
}

/**
 * Says the review is written, and offers the two things a reader wants next:
 * to read it, and to take it back.
 *
 * Its Undo takes back whatever Deckard wrote last, without asking whether
 * that is still the review, as it always has.
 */
function offerReview(
  message: string,
  noteUri: vscode.Uri,
  written: WriteHandle,
  indexer: Pick<IndexControl, 'refresh'>,
): void {
  written.offerUndo(
    message,
    {
      guard: 'none',
      refresh: () => indexer.refresh(),
      done: 'Took the review back out of the note.',
    },
    {
      label: 'Open',
      run: async () => {
        const document = await vscode.workspace.openTextDocument(noteUri);
        const editor = await vscode.window.showTextDocument(document, {
          preview: false,
        });
        // Open it where the review is, which is what the message was about.
        const line = document
          .getText()
          .split(/\r?\n/)
          .findIndex((text) => text.includes(REVIEW_START));
        if (line >= 0) {
          revealLine(editor, line + 1);
        }
      },
    },
  );
}

/**
 * The review command: the period of the note in the editor, or the one the
 * reader picks.
 */
export async function writeReviewCommand(
  indexer: Pick<IndexReader & IndexControl, 'ready' | 'getSnapshot' | 'refresh'>,
  writes: ReviewWrites,
): Promise<string | undefined> {
  const open = findOpenPeriod();
  const period = open ? open.period : await pickReviewPeriod();
  if (!period) {
    return undefined;
  }
  // A note already open is reviewed for the days its own name holds, and
  // written into, whatever week start was set when it was made.
  const noteUri = vscode.window.activeTextEditor?.document.uri;
  const range = open && noteUri ? reviewPeriodOfNote(open, noteFileName(noteUri)) : undefined;
  if (open && range && noteUri) {
    return writeReview(indexer, writes, { period, day: open.day, range, noteUri });
  }
  return writeReview(indexer, writes, { period, day: open?.day ?? new Date() });
}

/** This week or this month, as the reader picks; undefined when they dismiss the pick. */
async function pickReviewPeriod(): Promise<Exclude<NotePeriod, 'day'> | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'This week', period: 'week' as const },
      { label: 'This month', period: 'month' as const },
    ],
    { title: 'Write a review', placeHolder: 'Which period?' },
  );
  return picked?.period;
}

/**
 * Opens the note for a period, writing its review in when the note is new.
 * The folder is chosen once, and the review is written into the note that
 * opens.
 */
export async function openPeriodicNoteWithReview(
  indexer: Pick<IndexReader & IndexControl, 'ready' | 'getSnapshot' | 'refresh'>,
  writes: ReviewWrites,
  period: Exclude<NotePeriod, 'day'>,
): Promise<vscode.Uri | undefined> {
  const folder = await chooseTargetFolder();
  if (!folder) {
    return undefined;
  }
  const day = new Date();
  const isNew = !(await findExistingPeriodicNote(folder, period, day));
  const noteUri = await ensurePeriodicNote(folder, period, day);
  if (isNew && isReviewOnCreateEnabled(folder.uri)) {
    // Handed the note, the review asks for no folder of its own: a second
    // ask in a multi-root workspace could pick another folder's note.
    await writeReview(indexer, writes, { period, day, silent: true, noteUri });
  }
  const document = await vscode.workspace.openTextDocument(noteUri);
  await vscode.window.showTextDocument(document, { preview: false });
  return noteUri;
}

/**
 * The period the note in the editor is for, whichever name it goes by: the
 * days a note holds, or the ISO week and year-month Deckard wrote before.
 */
export function findOpenPeriod(
  fileName = activeNoteFileName(),
): PeriodicNoteName | undefined {
  return fileName ? parsePeriodicNoteName(fileName) : undefined;
}

/** The file name of the note in the editor, without `.md`. */
function activeNoteFileName(): string | undefined {
  const uri = vscode.window.activeTextEditor?.document.uri;
  return uri ? noteFileName(uri) : undefined;
}

/** A note's file name without `.md`. */
function noteFileName(uri: vscode.Uri): string {
  return (uri.path.split('/').pop() ?? '').replace(/\.md$/i, '');
}
