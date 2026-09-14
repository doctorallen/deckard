import * as vscode from 'vscode';

import { findDailyNoteDate } from '../../core/markdown/parser';
import { WorkspaceIndex } from '../../core/types';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { resolveSourceUri } from './navigation';

/** A daily note in the index, by the day it is for. */
export interface DailyNoteEntry {
  date: string;
  filePath: string;
}

/**
 * The index's daily notes, oldest first: notes named for a day, or whose top
 * heading holds one.
 */
export function listDailyNotes(index: WorkspaceIndex): DailyNoteEntry[] {
  return [...index.files.values()]
    .flatMap((file) => {
      const date = findDailyNoteDate(
        file.filePath,
        file.sections
          .filter((section) => section.headingLevel === 1)
          .map((section) => section.heading),
      );
      return date ? [{ date, filePath: file.filePath }] : [];
    })
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.filePath.localeCompare(right.filePath),
    );
}

/** The nearest daily note before or after a day, skipping days without one. */
export function findAdjacentDailyNote(
  notes: readonly DailyNoteEntry[],
  from: string,
  direction: 'previous' | 'next',
): DailyNoteEntry | undefined {
  return direction === 'previous'
    ? [...notes].reverse().find((note) => note.date < from)
    : notes.find((note) => note.date > from);
}

/**
 * Opens the daily note before or after the one in the editor, or before or
 * after today when the editor is not on a daily note.
 */
export async function openAdjacentDailyNote(
  indexer: Pick<
    WorkspaceIndexer,
    'ready' | 'getSnapshot' | 'getFilePath' | 'isNotesFile'
  >,
  direction: 'previous' | 'next',
): Promise<void> {
  await indexer.ready;
  const notes = listDailyNotes(indexer.getSnapshot());
  const editorUri = vscode.window.activeTextEditor?.document.uri;
  const editorPath =
    editorUri && indexer.isNotesFile(editorUri)
      ? indexer.getFilePath(editorUri)
      : undefined;
  const from =
    notes.find((note) => note.filePath === editorPath)?.date ??
    formatLocalDate(new Date());
  const target = findAdjacentDailyNote(notes, from, direction);
  if (!target) {
    void vscode.window.showInformationMessage(
      `There is no daily note ${direction === 'previous' ? 'before' : 'after'} ${from}.`,
    );
    return;
  }
  const uri = await resolveSourceUri(target.filePath);
  if (uri) {
    await vscode.window.showTextDocument(uri, { preview: false });
  }
}

/**
 * Creates today's note idempotently and opens it in the editor.
 *
 * Existing notes are never overwritten, making the command safe to invoke from
 * both the command palette and the Related Notes shortcut.
 */
export async function createDailyNote(
  workspaceFolder?: vscode.WorkspaceFolder,
): Promise<vscode.Uri | undefined> {
  const targetFolder = workspaceFolder ?? (await chooseWorkspaceFolder());
  if (!targetFolder) {
    return undefined;
  }

  const noteUri = await ensureDailyNote(targetFolder);
  const document = await vscode.workspace.openTextDocument(noteUri);
  await vscode.window.showTextDocument(document, { preview: false });
  return noteUri;
}

/**
 * Creates today's note from the template when it does not exist yet, without
 * opening it, and returns where it is.
 */
export function ensureDailyNote(
  targetFolder: vscode.WorkspaceFolder,
): Promise<vscode.Uri> {
  return ensurePeriodicNote(targetFolder, 'day');
}

/**
 * Opens the note for this week or this month, creating it from its template
 * when it does not exist yet.
 */
export async function openPeriodicNote(
  period: 'week' | 'month',
): Promise<vscode.Uri | undefined> {
  const targetFolder = await chooseTargetFolder();
  if (!targetFolder) {
    return undefined;
  }
  const noteUri = await ensurePeriodicNote(targetFolder, period);
  const document = await vscode.workspace.openTextDocument(noteUri);
  await vscode.window.showTextDocument(document, { preview: false });
  return noteUri;
}

/** A stretch of the calendar a note can be kept for. */
export type NotePeriod = 'day' | 'week' | 'month';

/** The values a periodic note's template can use. */
export type PeriodicNoteVariables = Record<'date' | 'week' | 'month', string>;

const PERIOD_TEMPLATES: Readonly<
  Record<NotePeriod, { setting: string; fallback: string }>
> = {
  day: { setting: 'dailyNoteTemplate', fallback: '# {date}\n\n' },
  week: { setting: 'weeklyNoteTemplate', fallback: '# {week}\n\n' },
  month: { setting: 'monthlyNoteTemplate', fallback: '# {month}\n\n' },
};

/**
 * The note for the period containing a day: its name, and the values its
 * template can use. Weeks are ISO weeks, which start on Monday, so a week's
 * `{date}` is its Monday; a month's is its first day.
 */
export function getPeriodicNote(
  period: NotePeriod,
  day: Date,
): { name: string; variables: PeriodicNoteVariables } {
  const start =
    period === 'week'
      ? new Date(day.getFullYear(), day.getMonth(), day.getDate() - getWeekday(day))
      : period === 'month'
        ? new Date(day.getFullYear(), day.getMonth(), 1)
        : day;
  const { year, week } = getIsoWeek(start);
  const date = formatLocalDate(start);
  const variables = {
    date,
    week: `${year}-W${String(week).padStart(2, '0')}`,
    month: date.slice(0, 7),
  };
  return {
    name: period === 'day' ? date : period === 'week' ? variables.week : variables.month,
    variables,
  };
}

/**
 * The ISO week a day falls in. It is the week of that week's Thursday, so the
 * first days of January can belong to the last week of the year before.
 */
export function getIsoWeek(day: Date): { year: number; week: number } {
  const thursday = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate() - getWeekday(day) + 3,
  );
  const year = thursday.getFullYear();
  const january4 = new Date(year, 0, 4);
  const firstThursday = new Date(year, 0, 4 - getWeekday(january4) + 3);
  // Rounding absorbs the hour a daylight-saving change adds or removes.
  const week =
    1 +
    Math.round(
      (thursday.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000),
    );
  return { year, week };
}

/** Fills `{date}`, `{week}`, and `{month}` in a periodic note's template. */
export function fillPeriodicTemplate(
  template: string,
  variables: PeriodicNoteVariables,
): string {
  return template.replace(
    /\{(date|week|month)\}/g,
    (_placeholder, name: keyof PeriodicNoteVariables) => variables[name],
  );
}

/** A YYYY-MM-DD date as local midnight, or undefined when it is not a real day. */
export function parseLocalDate(date: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    return undefined;
  }
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return formatLocalDate(day) === date ? day : undefined;
}

/**
 * Where the note for the period containing a day belongs: the notes folder,
 * named for the period.
 */
export function getPeriodicNoteUri(
  targetFolder: vscode.WorkspaceFolder,
  period: NotePeriod,
  day: Date,
): vscode.Uri {
  const notesFolder = vscode.workspace
    .getConfiguration('deckard', targetFolder.uri)
    .get<string>('notesFolder', 'notes')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/g, '');
  const notesUri = notesFolder
    ? vscode.Uri.joinPath(
        targetFolder.uri,
        ...notesFolder.split('/').filter(Boolean),
      )
    : targetFolder.uri;
  return vscode.Uri.joinPath(notesUri, `${getPeriodicNote(period, day).name}.md`);
}

/**
 * Creates the note for the period containing a day, today by default, from its
 * template when it does not exist yet, without opening it, and returns where
 * it is.
 */
export async function ensurePeriodicNote(
  targetFolder: vscode.WorkspaceFolder,
  period: NotePeriod,
  day: Date = new Date(),
): Promise<vscode.Uri> {
  const { setting, fallback } = PERIOD_TEMPLATES[period];
  const template = vscode.workspace
    .getConfiguration('deckard', targetFolder.uri)
    .get<string>(setting, fallback);
  const noteUri = getPeriodicNoteUri(targetFolder, period, day);

  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(noteUri, '..'));
  try {
    await vscode.workspace.fs.stat(noteUri);
  } catch {
    const content = fillPeriodicTemplate(
      template,
      getPeriodicNote(period, day).variables,
    );
    await vscode.workspace.fs.writeFile(noteUri, Buffer.from(content, 'utf8'));
  }
  return noteUri;
}

/** Monday is 0 and Sunday is 6, as in an ISO week. */
function getWeekday(day: Date): number {
  return (day.getDay() + 6) % 7;
}

/**
 * Chooses a root only when multi-root ambiguity makes implicit selection unsafe.
 */
export async function chooseWorkspaceFolder(): Promise<
  vscode.WorkspaceFolder | undefined
> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showWarningMessage(
      'Open a workspace before creating a Deckard daily note.',
    );
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0];
  }

  const picked = await vscode.window.showQuickPick(
    folders.map((folder) => ({
      label: folder.name,
      description: folder.uri.fsPath,
      folder,
    })),
    { placeHolder: 'Choose a workspace for the daily note' },
  );
  return picked?.folder;
}

/**
 * The workspace folder of the active editor, or the one the user picks when
 * that does not settle it.
 */
export async function chooseTargetFolder(): Promise<
  vscode.WorkspaceFolder | undefined
> {
  const uri = vscode.window.activeTextEditor?.document.uri;
  return (
    (uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined) ??
    chooseWorkspaceFolder()
  );
}

/**
 * Uses local calendar fields so a daily note is named for the user's day, not
 * the previous or next UTC day around a timezone boundary.
 */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
