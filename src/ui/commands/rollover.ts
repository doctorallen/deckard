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
} from './dailyNote';
import { resolveSourceUri } from './navigation';
import { applyWorkspaceWrite } from './workspaceWrites';

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
  /** The nearest daily note before today. */
  fromPath: string;
  fromDate: string;
  /** Its open tasks, in the order they are written. */
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
 * The unfinished tasks of the nearest daily note before today, or nothing
 * when there is no such note or nothing is left open in it.
 */
export function planRollover(
  index: WorkspaceIndex,
  today: string,
): RolloverPlan | undefined {
  const previous = [...listDailyNotes(index)]
    .reverse()
    .find((note) => note.date < today);
  if (!previous) {
    return undefined;
  }
  const tasks = [...index.tasks.values()]
    .filter((task) => task.filePath === previous.filePath && !task.completed)
    .sort((left, right) => left.lineNumber - right.lineNumber);
  return tasks.length === 0
    ? undefined
    : { fromPath: previous.filePath, fromDate: previous.date, tasks };
}

/** What a rollover did, so the command can say it in one sentence. */
export interface RolloverResult {
  carried: number;
  /** Tasks left behind: already in today's note, or changed since indexing. */
  skipped: number;
  fromDate: string;
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
  const fromUri = await resolveSourceUri(plan.fromPath);
  if (!fromUri) {
    return undefined;
  }
  const [today, from] = await Promise.all([
    vscode.workspace.openTextDocument(todayUri),
    vscode.workspace.openTextDocument(fromUri),
  ]);
  const todayText = today.getText();
  const todayLines = new Set(
    todayText.split(/\r?\n/).map((line) => line.trim()),
  );

  const carried: Task[] = [];
  let skipped = 0;
  plan.tasks.forEach((task) => {
    const line = task.lineNumber - 1;
    // The task has to still read as it did when it was indexed, and must not
    // already be in today's note, which is what running this twice would do.
    if (
      line >= from.lineCount ||
      from.lineAt(line).text !== task.sourceLineText ||
      todayLines.has(task.sourceLineText.trim())
    ) {
      skipped += 1;
      return;
    }
    carried.push(task);
  });
  if (carried.length === 0) {
    return { carried: 0, skipped, fromDate: plan.fromDate };
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
      const line = task.lineNumber - 1;
      edit.delete(
        fromUri,
        line + 1 < from.lineCount
          ? new vscode.Range(line, 0, line + 1, 0)
          : new vscode.Range(
              Math.max(line - 1, 0),
              line > 0 ? from.lineAt(line - 1).text.length : 0,
              line,
              from.lineAt(line).text.length,
            ),
      );
    });
  }

  const written = await applyWorkspaceWrite(edit, {
    label: `carrying ${count(carried.length, 'task', 'tasks')} forward from ${plan.fromDate}`,
    // A rollover is one gesture over two notes; showing it every morning
    // would be in the way. Undo is what takes it back.
    preview: 'never',
  });
  return written.applied
    ? { carried: carried.length, skipped, fromDate: plan.fromDate }
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
    void vscode.window.showInformationMessage(describeRollover(result, mode));
  }
  return result;
}

/** One sentence for what a rollover did. */
export function describeRollover(
  result: RolloverResult,
  mode: Exclude<RolloverMode, 'off'>,
): string {
  if (result.carried === 0) {
    return `Nothing was carried forward from ${result.fromDate}: its open tasks are already in today's note or have changed since.`;
  }
  const verb = mode === 'move' ? 'Moved' : 'Copied';
  const left =
    result.skipped === 0
      ? ''
      : ` ${count(result.skipped, 'task', 'tasks')} stayed behind, already carried or changed since.`;
  return `${verb} ${count(
    result.carried,
    'unfinished task',
    'unfinished tasks',
  )} forward from ${result.fromDate}.${left}`;
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
