import * as vscode from 'vscode';

import { Task, WorkspaceIndex } from '../../core/types';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { getCaptureInsertion } from './capture';
import {
  chooseTargetFolder,
  chooseWorkspaceFolder,
  createDailyNote,
  ensureDailyNote,
  formatLocalDate,
  getPeriodicNoteUri,
  listDailyNotes,
  parseLocalDate,
} from './dailyNote';
import { resolveSourceUri } from './navigation';
import { applyWorkspaceWrite, workspaceWrites } from './workspaceWrites';

/**
 * Carries yesterday's unfinished tasks into today's note.
 *
 * A daily note that starts empty every morning loses what was still open the
 * night before, so the tasks are written into today's note as they were
 * written yesterday, metadata and all. Moving them takes them out of the note
 * they came from; copying leaves them where they are.
 */

/** What a rollover would carry, and where from. */
export interface RolloverPlan {
  /** The daily notes it draws from, oldest first. */
  fromDates: string[];
  /** Their open tasks: oldest note first, and in the order each writes them. */
  tasks: Task[];
}

/** Whether the tasks leave the note they came from. */
export type RolloverMode = 'off' | 'move' | 'copy';

export function getRolloverMode(uri?: vscode.Uri): RolloverMode {
  const setting = vscode.workspace
    .getConfiguration('deckard', uri)
    .get<string>('dailyNote.rollover', 'off');
  return setting === 'move' || setting === 'copy' ? setting : 'off';
}

/**
 * The unfinished tasks waiting in earlier daily notes, oldest first.
 *
 * Every earlier daily note is read, not only yesterday's: a task left open
 * on Friday is still open on Monday, and a week away leaves a gap wider than
 * that again. `lookbackDays` bounds how far back it reaches, and zero, the
 * default, reaches as far as the daily notes go.
 */
export function planRollover(
  index: WorkspaceIndex,
  today: string,
  lookbackDays = 0,
): RolloverPlan | undefined {
  const earliest =
    lookbackDays > 0
      ? formatLocalDate(
          new Date(
            (parseLocalDate(today)?.getTime() ?? Date.now()) -
              lookbackDays * 24 * 60 * 60 * 1000,
          ),
        )
      : undefined;
  const notes = listDailyNotes(index).filter(
    (note) => note.date < today && (earliest === undefined || note.date >= earliest),
  );
  if (notes.length === 0) {
    return undefined;
  }
  const byPath = new Map(notes.map((note) => [note.filePath, note.date]));
  const tasks = [...index.tasks.values()]
    .filter((task) => !task.completed && byPath.has(task.filePath))
    .sort(
      (left, right) =>
        (byPath.get(left.filePath) ?? '').localeCompare(
          byPath.get(right.filePath) ?? '',
        ) || left.lineNumber - right.lineNumber,
    );
  if (tasks.length === 0) {
    return undefined;
  }
  const carried = new Set(tasks.map((task) => task.filePath));
  return {
    fromDates: notes
      .filter((note) => carried.has(note.filePath))
      .map((note) => note.date),
    tasks,
  };
}

/** What a rollover did, so the command can say it in one sentence. */
export interface RolloverResult {
  carried: number;
  /** Tasks left behind: already in today's note, or changed since indexing. */
  skipped: number;
  /** The days it drew from, oldest first. */
  fromDates: string[];
  /** How many notes it actually took tasks out of. */
  notes: number;
}

/**
 * Writes the plan's tasks into today's note, and takes them out of the note
 * they came from when moving.
 *
 * Each task is compared with the line the index recorded before it is moved,
 * the way every other Deckard task edit is, and a task whose line has changed
 * is left where it is. The whole rollover is one write, so
 * `Deckard: Undo Last Change` takes it back.
 */
export async function applyRollover(
  plan: RolloverPlan,
  todayUri: vscode.Uri,
  mode: Exclude<RolloverMode, 'off'>,
): Promise<RolloverResult | undefined> {
  const today = await vscode.workspace.openTextDocument(todayUri);
  const todayText = today.getText();
  const todayLines = new Set(
    todayText.split(/\r?\n/).map((line) => line.trim()),
  );

  // Each note the plan draws from is read once, and each task is compared
  // with the line the index recorded before it is moved.
  const sources = new Map<string, { uri: vscode.Uri; document: vscode.TextDocument }>();
  for (const filePath of new Set(plan.tasks.map((task) => task.filePath))) {
    const uri = await resolveSourceUri(filePath);
    if (!uri) {
      continue;
    }
    try {
      sources.set(filePath, {
        uri,
        document: await vscode.workspace.openTextDocument(uri),
      });
    } catch {
      continue;
    }
  }

  const carried: Task[] = [];
  let skipped = 0;
  plan.tasks.forEach((task) => {
    const source = sources.get(task.filePath);
    const line = task.lineNumber - 1;
    // The task has to still read as it did when it was indexed, and must not
    // already be in today's note, which is what running this twice would do.
    if (
      !source ||
      line >= source.document.lineCount ||
      source.document.lineAt(line).text !== task.sourceLineText ||
      todayLines.has(task.sourceLineText.trim())
    ) {
      skipped += 1;
      return;
    }
    carried.push(task);
  });
  const drawnFrom = new Set(carried.map((task) => task.filePath));
  if (carried.length === 0) {
    return { carried: 0, skipped, fromDates: plan.fromDates, notes: 0 };
  }

  const eol = todayText.includes('\r\n') ? '\r\n' : '\n';
  const insertion = getCaptureInsertion(
    todayText,
    carried.map((task) => task.sourceLineText).join(eol),
  );
  const edit = new vscode.WorkspaceEdit();
  edit.insert(
    todayUri,
    new vscode.Position(insertion.line, insertion.character),
    insertion.text,
  );
  if (mode === 'move') {
    carried.forEach((task) => {
      const source = sources.get(task.filePath);
      if (!source) {
        return;
      }
      const line = task.lineNumber - 1;
      const document = source.document;
      edit.delete(
        source.uri,
        line + 1 < document.lineCount
          ? new vscode.Range(line, 0, line + 1, 0)
          : new vscode.Range(
              Math.max(line - 1, 0),
              line > 0 ? document.lineAt(line - 1).text.length : 0,
              line,
              document.lineAt(line).text.length,
            ),
      );
    });
  }

  const written = await applyWorkspaceWrite(edit, {
    label: `carrying ${count(carried.length, 'task', 'tasks')} forward`,
    // A rollover is one gesture over a few notes; showing it every morning
    // would be in the way. Undo is what takes it back.
    preview: 'never',
  });
  return written.applied
    ? {
        carried: carried.length,
        skipped,
        fromDates: plan.fromDates,
        notes: drawnFrom.size,
      }
    : undefined;
}

/**
 * Carries the unfinished tasks of the last daily note into today's, creating
 * today's note when it is not there yet.
 */
export async function rollTasksForward(
  indexer: Pick<WorkspaceIndexer, 'ready' | 'getSnapshot' | 'refresh'>,
  options: { mode?: Exclude<RolloverMode, 'off'>; silent?: boolean } = {},
): Promise<RolloverResult | undefined> {
  const folder = await chooseTargetFolder();
  if (!folder) {
    return undefined;
  }
  await indexer.ready;
  const mode =
    options.mode ?? (getRolloverMode(folder.uri) === 'copy' ? 'copy' : 'move');
  const plan = planRollover(
    indexer.getSnapshot(),
    formatLocalDate(new Date()),
    getRolloverLookbackDays(folder.uri),
  );
  if (!plan) {
    if (!options.silent) {
      void vscode.window.showInformationMessage(
        'No unfinished tasks are waiting in an earlier daily note.',
      );
    }
    return undefined;
  }

  const todayUri = await ensureDailyNote(folder);
  const result = await applyRollover(plan, todayUri, mode);
  if (!result) {
    return undefined;
  }
  try {
    await indexer.refresh();
  } catch {
    // The watcher picks the notes up; the tasks themselves are written.
  }
  if (!options.silent || result.carried > 0) {
    // A rollover writes into notes nobody opened, so both the note it wrote
    // into and the way back are offered where it is announced.
    void offerRollover(
      describeRollover(result, mode),
      todayUri,
      result.carried > 0,
      indexer,
    );
  }
  return result;
}

/**
 * Says what a rollover did, and offers what a reader wants next: today's
 * note, which may have just been created, and the way back.
 */
async function offerRollover(
  message: string,
  todayUri: vscode.Uri,
  wrote: boolean,
  indexer: Pick<WorkspaceIndexer, 'refresh'>,
): Promise<void> {
  if (!wrote) {
    void vscode.window.showInformationMessage(message);
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    message,
    'Open',
    'Undo',
  );
  if (choice === 'Open') {
    const document = await vscode.workspace.openTextDocument(todayUri);
    await vscode.window.showTextDocument(document, { preview: false });
    return;
  }
  if (choice !== 'Undo') {
    return;
  }
  const undone = await workspaceWrites.undo();
  try {
    await indexer.refresh();
  } catch {
    // The watcher picks the notes up; the notes themselves are back.
  }
  void vscode.window.showInformationMessage(
    undone && undone.restored > 0
      ? `Put ${undone.restored} ${undone.restored === 1 ? 'note' : 'notes'} back.`
      : 'Deckard could not undo that: the notes have changed since.',
  );
}

/** One sentence for what a rollover did, and which days it drew from. */
export function describeRollover(
  result: RolloverResult,
  mode: Exclude<RolloverMode, 'off'>,
): string {
  const oldest = result.fromDates[0];
  if (result.carried === 0) {
    return `Nothing was carried forward: the open tasks in your earlier daily notes are already in today's note, or have changed since.`;
  }
  const verb = mode === 'move' ? 'Moved' : 'Copied';
  // Where from: one day by name, several as the span they cover.
  const from =
    result.notes <= 1
      ? ` from ${result.fromDates[result.fromDates.length - 1] ?? oldest}`
      : ` from ${result.notes} daily notes, back to ${oldest}`;
  const left =
    result.skipped === 0
      ? ''
      : ` ${count(result.skipped, 'task', 'tasks')} stayed behind, already carried or changed since.`;
  return `${verb} ${count(
    result.carried,
    'unfinished task',
    'unfinished tasks',
  )} forward${from}.${left}`;
}

/** How far back a rollover looks, in days; zero reaches as far as the notes. */
export function getRolloverLookbackDays(uri?: vscode.Uri): number {
  const days = vscode.workspace
    .getConfiguration('deckard', uri)
    .get<number>('dailyNote.rolloverDays', 0);
  return Number.isFinite(days) && days > 0 ? Math.floor(days) : 0;
}

function count(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

/**
 * Opens today's note, creating it from the template, and carries the last
 * daily note's unfinished tasks in when the setting asks for it.
 *
 * Only a note Deckard creates rolls tasks in, so opening today's note again
 * later in the day does not carry the same tasks twice.
 */
export async function createDailyNoteWithRollover(
  indexer: Pick<WorkspaceIndexer, 'ready' | 'getSnapshot' | 'refresh'>,
  workspaceFolder?: vscode.WorkspaceFolder,
): Promise<vscode.Uri | undefined> {
  const folder = workspaceFolder ?? (await chooseWorkspaceFolder());
  if (!folder) {
    return undefined;
  }
  const mode = getRolloverMode(folder.uri);
  if (mode === 'off') {
    return createDailyNote(folder);
  }
  // Only a note Deckard creates rolls tasks in, so the same tasks are not
  // carried twice when today's note is opened again later.
  const isNew = !(await exists(getPeriodicNoteUri(folder, 'day', new Date())));
  const opened = await createDailyNote(folder);
  if (opened && isNew) {
    await rollTasksForward(indexer, { mode, silent: true });
  }
  return opened;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
