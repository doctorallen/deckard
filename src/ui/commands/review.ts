import * as vscode from 'vscode';

import { PreferencesStore } from '../../core/storage/preferences';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import {
  formatReview,
  REVIEW_START,
  ReviewRange,
  summarizeReview,
  writeReviewInto,
} from '../state/reviewState';
import { formatIsoDate } from '../../core/markdown/taskMetadata';
import {
  chooseTargetFolder,
  ensurePeriodicNote,
  getPeriodicNote,
  getPeriodicNoteUri,
  NotePeriod,
} from './dailyNote';
import { revealLine } from './navigation';
import { applyWorkspaceWrite, workspaceWrites } from './workspaceWrites';

/**
 * Writes a week's or a month's review into its periodic note.
 *
 * A periodic note that opens from its template alone gives a reader nothing
 * to read. The review is the report the index can already answer, written
 * into the note as ordinary Markdown so it stays true after the period ends.
 */

/** Whether a newly created periodic note gets its review written into it. */
export function isReviewOnCreateEnabled(uri?: vscode.Uri): boolean {
  return vscode.workspace
    .getConfiguration('deckard', uri)
    .get<boolean>('periodicNote.review', true);
}

/** The days a period covers: its first midnight, and the midnight after it. */
export function getReviewRange(
  period: Exclude<NotePeriod, 'day'>,
  day: Date,
): ReviewRange {
  const { name, variables } = getPeriodicNote(period, day);
  const [year, month, date] = variables.date.split('-').map(Number);
  const start = new Date(year, month - 1, date);
  const end =
    period === 'week'
      ? new Date(year, month - 1, date + 7)
      : new Date(year, month, 1);
  return {
    name,
    title: `${formatIsoDate(start.getTime())} to ${formatIsoDate(end.getTime() - DAY)}`,
    start: start.getTime(),
    end: end.getTime(),
  };
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Writes the review of a period into its note, creating the note when it is
 * not there yet, and replacing the review already in it.
 */
export async function writeReview(
  indexer: Pick<WorkspaceIndexer, 'ready' | 'getSnapshot' | 'refresh'>,
  preferences: Pick<PreferencesStore, 'value'> | undefined,
  period: Exclude<NotePeriod, 'day'>,
  day: Date = new Date(),
  options: { silent?: boolean } = {},
): Promise<string | undefined> {
  const folder = await chooseTargetFolder();
  if (!folder) {
    return undefined;
  }
  await indexer.ready;
  const range = getReviewRange(period, day);
  const summary = summarizeReview(indexer.getSnapshot(), range, {
    tagFirstSeen: preferences?.value.tagFirstSeen,
  });
  const review = formatReview(summary);

  const noteUri = await ensurePeriodicNote(folder, period, day);
  const document = await vscode.workspace.openTextDocument(noteUri);
  const updated = writeReviewInto(document.getText(), review);
  if (updated === document.getText()) {
    return range.title;
  }

  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    noteUri,
    new vscode.Range(
      new vscode.Position(0, 0),
      document.lineAt(Math.max(document.lineCount - 1, 0)).range.end,
    ),
    updated,
  );
  const written = await applyWorkspaceWrite(edit, {
    label: `the review of ${range.title}`,
    // One note, written by asking for it; the reader is watching it happen.
    preview: 'never',
  });
  if (!written.applied) {
    return undefined;
  }
  try {
    await indexer.refresh();
  } catch {
    // The watcher picks the note up; the review itself is written.
  }
  if (!options.silent) {
    void offerReview(
      `Wrote the review of ${range.title}: ${summary.completed.length} done, ${summary.slipped.length} still open.`,
      noteUri,
      indexer,
    );
  }
  return range.title;
}

/**
 * Says the review is written, and offers the two things a reader wants next:
 * to read it, and to take it back.
 */
async function offerReview(
  message: string,
  noteUri: vscode.Uri,
  indexer: Pick<WorkspaceIndexer, 'refresh'>,
): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    message,
    'Open',
    'Undo',
  );
  if (choice === 'Open') {
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
    return;
  }
  if (choice !== 'Undo') {
    return;
  }
  const undone = await workspaceWrites.undo();
  try {
    await indexer.refresh();
  } catch {
    // The watcher picks the note up; the note itself is back.
  }
  void vscode.window.showInformationMessage(
    undone && undone.restored > 0
      ? 'Took the review back out of the note.'
      : 'Deckard could not undo that: the note has changed since.',
  );
}

/**
 * The review command: the period of the note in the editor, or the one the
 * reader picks.
 */
export async function writeReviewCommand(
  indexer: Pick<WorkspaceIndexer, 'ready' | 'getSnapshot' | 'refresh'>,
  preferences?: Pick<PreferencesStore, 'value'>,
): Promise<string | undefined> {
  const open = findOpenPeriod();
  const period =
    open?.period ??
    (
      await vscode.window.showQuickPick(
        [
          { label: 'This week', period: 'week' as const },
          { label: 'This month', period: 'month' as const },
        ],
        { title: 'Write a review', placeHolder: 'Which period?' },
      )
    )?.period;
  if (!period) {
    return undefined;
  }
  return writeReview(indexer, preferences, period, open?.day ?? new Date());
}

/**
 * Opens the note for a period, writing its review in when the note is new.
 */
export async function openPeriodicNoteWithReview(
  indexer: Pick<WorkspaceIndexer, 'ready' | 'getSnapshot' | 'refresh'>,
  preferences: Pick<PreferencesStore, 'value'> | undefined,
  period: Exclude<NotePeriod, 'day'>,
): Promise<vscode.Uri | undefined> {
  const folder = await chooseTargetFolder();
  if (!folder) {
    return undefined;
  }
  const noteUri = getPeriodicNoteUri(folder, period, new Date());
  const isNew = !(await exists(noteUri));
  await ensurePeriodicNote(folder, period, new Date());
  if (isNew && isReviewOnCreateEnabled(folder.uri)) {
    await writeReview(indexer, preferences, period, new Date(), {
      silent: true,
    });
  }
  const document = await vscode.workspace.openTextDocument(noteUri);
  await vscode.window.showTextDocument(document, { preview: false });
  return noteUri;
}

/** The period the note in the editor is for, when it is a periodic note. */
function findOpenPeriod():
  | { period: Exclude<NotePeriod, 'day'>; day: Date }
  | undefined {
  const name = vscode.window.activeTextEditor?.document.uri.path
    .split('/')
    .pop()
    ?.replace(/\.md$/i, '');
  if (!name) {
    return undefined;
  }
  const week = /^(\d{4})-W(\d{2})$/.exec(name);
  if (week) {
    return { period: 'week', day: getIsoWeekStart(Number(week[1]), Number(week[2])) };
  }
  const month = /^(\d{4})-(\d{2})$/.exec(name);
  return month
    ? {
        period: 'month',
        day: new Date(Number(month[1]), Number(month[2]) - 1, 1),
      }
    : undefined;
}

/** The Monday of an ISO week, which is the day its note is named for. */
export function getIsoWeekStart(year: number, week: number): Date {
  const january4 = new Date(year, 0, 4);
  const weekday = (january4.getDay() + 6) % 7;
  return new Date(year, 0, 4 - weekday + (week - 1) * 7);
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
