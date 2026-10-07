import * as vscode from 'vscode';
import { reportNeedsFolder } from './notify';
import { readFolderSetting } from '../../shared/paths';

import type { IndexReader } from '../../core/workspace/indexReader';
import { Weekday } from '../../domain/markdown/dates';
import {
  findAdjacentDailyNote,
  findPeriodicNoteNames,
  formatLocalDate,
  getPeriodicNote,
  listDailyNotes,
  NotePeriod,
  PeriodicNoteVariables,
} from '../../domain/notes/periodicNotes';
import { readWeekStart } from './datePrompt';
import { resolveSourceUri } from './navigation';
import { confirmNotesWrite } from './writeTarget';

/**
 * Opens the daily note before or after the one in the editor, or before or
 * after today when the editor is not on a daily note.
 */
export async function openAdjacentDailyNote(
  indexer: Pick<
    IndexReader,
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
  const targetFolder = workspaceFolder
    ? await writableOrNothing(workspaceFolder)
    : await chooseWorkspaceFolder();
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

const PERIOD_TEMPLATES: Readonly<
  Record<NotePeriod, { setting: string; fallback: string }>
> = {
  day: { setting: 'dailyNoteTemplate', fallback: '# {date}\n\n' },
  week: { setting: 'weeklyNoteTemplate', fallback: '# {week}\n\n' },
  month: { setting: 'monthlyNoteTemplate', fallback: '# {month}\n\n' },
};

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

/**
 * `deckard.periodicNotes.folder` for a day, inside the notes folder:
 * `journal/{yyyy}` as `journal/2026`; empty for the notes folder itself.
 */
export function readPeriodicFolder(targetFolder: vscode.WorkspaceFolder, day: Date): string {
  const pattern = readFolderSetting(
    vscode.workspace.getConfiguration('deckard', targetFolder.uri).get<unknown>('periodicNotes.folder', ''),
    '',
  );
  return fillPeriodicFolder(pattern, day);
}

/** A folder pattern's `{yyyy}` and `{mm}` as a day's year and month. */
export function fillPeriodicFolder(pattern: string, day: Date): string {
  return pattern
    .replace(/\{yyyy\}/g, String(day.getFullYear()))
    .replace(/\{mm\}/g, String(day.getMonth() + 1).padStart(2, '0'));
}

/**
 * Where the note for the period containing a day belongs: the notes folder,
 * and `deckard.periodicNotes.folder` inside it, named for the period.
 */
export function getPeriodicNoteUri(
  targetFolder: vscode.WorkspaceFolder,
  period: NotePeriod,
  day: Date,
  {
    name = getPeriodicNote(period, day, readWeekStart()).name,
    folder = readPeriodicFolder(targetFolder, day),
  }: {
    /** A name to use instead of the one this period would be given. */
    name?: string;
    /** The folder inside the notes folder; the setting's by default, '' for the notes folder itself. */
    folder?: string;
  } = {},
): vscode.Uri {
  // A value that is not text reads as the setting's default, the workspace
  // folder, as the scanner reads it.
  const notesFolder = readFolderSetting(
    vscode.workspace.getConfiguration('deckard', targetFolder.uri).get<unknown>('notesFolder', 'notes'),
    '',
  );
  const notesUri = notesFolder
    ? vscode.Uri.joinPath(
        targetFolder.uri,
        ...notesFolder.split('/').filter(Boolean),
      )
    : targetFolder.uri;
  return vscode.Uri.joinPath(notesUri, ...folder.split('/').filter(Boolean), `${name}.md`);
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
  weekStart: Weekday = readWeekStart(),
): Promise<vscode.Uri> {
  const { setting, fallback } = PERIOD_TEMPLATES[period];
  const template = await readPeriodicTemplate(
    targetFolder,
    vscode.workspace.getConfiguration('deckard', targetFolder.uri).get<string>(setting, fallback),
  );
  // A note the workspace already keeps for this period is the note, whichever
  // name it goes by; only a period with none gets a new one.
  const noteUri =
    (await findExistingPeriodicNote(targetFolder, period, day, weekStart)) ??
    getPeriodicNoteUri(targetFolder, period, day, { name: getPeriodicNote(period, day, weekStart).name });

  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(noteUri, '..'));
  try {
    await vscode.workspace.fs.stat(noteUri);
  } catch {
    const content = fillPeriodicTemplate(
      template,
      getPeriodicNote(period, day, weekStart).variables,
    );
    await vscode.workspace.fs.writeFile(noteUri, Buffer.from(content, 'utf8'));
  }
  return noteUri;
}

/** The note a period already has, under any name Deckard has ever written. */
export async function findExistingPeriodicNote(
  targetFolder: vscode.WorkspaceFolder,
  period: NotePeriod,
  day: Date,
  weekStart: Weekday = readWeekStart(),
): Promise<vscode.Uri | undefined> {
  // In the periodic notes folder, then the notes folder itself, where every
  // note was written before the folder could be set.
  const folders = [...new Set([readPeriodicFolder(targetFolder, day), ''])];
  for (const folder of folders) {
    for (const name of findPeriodicNoteNames(period, day, weekStart)) {
      const candidate = getPeriodicNoteUri(targetFolder, period, day, { name, folder });
      try {
        await vscode.workspace.fs.stat(candidate);
        return candidate;
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

/**
 * A periodic template as its setting holds it: the text itself, or the name
 * of a Markdown file in the templates folder, such as `Daily.md`, read from
 * there. A file that cannot be read is used as text, so the note is still
 * made and says what was asked for.
 */
async function readPeriodicTemplate(targetFolder: vscode.WorkspaceFolder, value: string): Promise<string> {
  const name = value.trim();
  if (name.includes('\n') || !/\.md$/i.test(name)) {
    return value;
  }
  const templatesFolder = readFolderSetting(
    vscode.workspace.getConfiguration('deckard', targetFolder.uri).get<unknown>('templatesFolder', 'templates'),
    'templates',
  );
  try {
    const uri = vscode.Uri.joinPath(targetFolder.uri, ...templatesFolder.split('/').filter(Boolean), ...name.split('/'));
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return value;
  }
}

/**
 * Chooses a root only when multi-root ambiguity makes implicit selection unsafe.
 */
export async function chooseWorkspaceFolder(): Promise<
  vscode.WorkspaceFolder | undefined
> {
  return writableOrNothing(await pickWorkspaceFolder());
}

/** A folder Deckard may make notes in, asking where it should when that is unsettled; undefined otherwise. */
async function writableOrNothing(
  folder: vscode.WorkspaceFolder | undefined,
): Promise<vscode.WorkspaceFolder | undefined> {
  return folder && (await confirmNotesWrite(folder)) ? folder : undefined;
}

/** The only workspace folder, or the one the reader picks. */
async function pickWorkspaceFolder(): Promise<
  vscode.WorkspaceFolder | undefined
> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void reportNeedsFolder();
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
  return writableOrNothing(
    (uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined) ??
      (await pickWorkspaceFolder()),
  );
}
