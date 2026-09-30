import * as vscode from 'vscode';
import { fileExists } from './fs';

import { markMigrated } from '../../core/markdown/taskMetadata';
import { pluralize } from '../../core/text';
import { findLastDescendantLine } from '../../core/markdown/taskSteps';
import { Task } from '../../core/types';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import {
  planRollover,
  RolloverMode,
  RolloverPlan,
} from '../../core/workspace/rolloverPlan';
import { getCaptureInsertion } from './capture';
import {
  chooseTargetFolder,
  chooseWorkspaceFolder,
  createDailyNote,
  ensureDailyNote,
  formatLocalDate,
  getPeriodicNoteUri,
} from './dailyNote';
import { resolveSourceUri } from './navigation';
import { WorkspaceWriteHistory, WriteHandle } from './workspaceWrites';

export { planRollover } from '../../core/workspace/rolloverPlan';
export type { RolloverMode, RolloverPlan } from '../../core/workspace/rolloverPlan';

/**
 * Carries yesterday's unfinished tasks into today's note.
 *
 * A daily note that starts empty every morning loses what was still open the
 * night before, so the tasks are written into today's note, under Carried
 * over, as they were written yesterday, metadata and all. Moving them takes
 * them out of the note they came from; migrating marks the line left behind
 * `[>]` with a link to today.
 */

/** `copy`, the older name, reads as migrate. */
export function getRolloverMode(uri?: vscode.Uri): RolloverMode {
  const setting = vscode.workspace
    .getConfiguration('deckard', uri)
    .get<string>('dailyNote.rollover', 'off');
  return setting === 'move'
    ? 'move'
    : setting === 'migrate' || setting === 'copy'
      ? 'migrate'
      : 'off';
}

/** The heading carried tasks go under, in today's note. */
export const CARRIED_OVER_HEADING = 'Carried over';

/**
 * A block of lines moved to the top level: the first line's indentation
 * taken off every line that starts with it, so steps stay nested under
 * their task by the same amount.
 */
function outdent(lines: readonly string[]): string[] {
  const indent = lines[0]?.match(/^[ \t]*/)?.[0] ?? '';
  return lines.map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line.trimStart()));
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

/** What a rollover did, with the handle its Undo works through. */
export interface RolloverWrite extends RolloverResult {
  /** The rollover's write; absent when nothing was carried, so nothing written. */
  handle?: WriteHandle;
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
  mode: Exclude<RolloverMode, 'off'> | 'copy',
  options: {
    /** The history the rollover is written to, as one write. */
    history: WorkspaceWriteHistory;
    /** Today's note's name, which a migrated line links to. */
    todayName?: string;
  },
): Promise<RolloverWrite | undefined> {
  const { history, todayName } = options;
  if (mode === 'copy') {
    mode = 'migrate';
  }
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

  // A task still reading as it was indexed, from a note that could be read.
  const valid = plan.tasks.filter((task) => {
    const source = sources.get(task.filePath);
    const line = task.lineNumber - 1;
    return (
      source !== undefined &&
      line < source.document.lineCount &&
      source.document.lineAt(line).text === task.sourceLineText
    );
  });
  let skipped = plan.tasks.length - valid.length;
  const validIds = new Set(valid.map((task) => task.id));
  const byId = new Map(valid.map((task) => [task.id, task]));
  // A step goes with the task it is written under when that task goes too;
  // a step whose task stays behind (done, changed, or parked) goes on its
  // own, at the top level, never nested under whatever precedes it.
  const rootOf = (task: Task): Task => {
    let root = task;
    while (root.parentTaskId !== undefined && validIds.has(root.parentTaskId)) {
      root = byId.get(root.parentTaskId) ?? root;
    }
    return root;
  };
  const groups = new Map<string, { root: Task; steps: Task[] }>();
  valid.forEach((task) => {
    const root = rootOf(task);
    const group = groups.get(root.id) ?? { root, steps: [] };
    if (root !== task) {
      group.steps.push(task);
    }
    groups.set(root.id, group);
  });
  // Already in today's note, which is what running this twice would do: the
  // task stays, and its steps with it.
  const kept = [...groups.values()].filter((group) => {
    if (todayLines.has(group.root.sourceLineText.trim())) {
      skipped += 1 + group.steps.length;
      return false;
    }
    return true;
  });
  const carried = kept.flatMap((group) => [group.root, ...group.steps]);
  const drawnFrom = new Set(carried.map((task) => task.filePath));
  if (carried.length === 0) {
    return { carried: 0, skipped, fromDates: plan.fromDates, notes: 0 };
  }

  const edit = new vscode.WorkspaceEdit();
  // Moving takes everything written under a task along, done steps and
  // notes included, so nothing is left orphaned under another task; a
  // migrate copies the open steps and marks each line it leaves behind.
  const blocks = kept.map((group) => {
    const document = sources.get(group.root.filePath)?.document as vscode.TextDocument;
    const first = group.root.lineNumber - 1;
    const last =
      mode === 'move'
        ? findLastDescendantLine(document.getText().split(/\r?\n/), first)
        : first;
    const written =
      mode === 'move'
        ? Array.from({ length: last - first + 1 }, (_, at) => document.lineAt(first + at).text)
        : [
            group.root.sourceLineText,
            ...[...group.steps]
              .sort((left, right) => left.lineNumber - right.lineNumber)
              .map((step) => step.sourceLineText),
          ];
    return { group, first, last, lines: outdent(written) };
  }).filter((block, at, all) =>
    // A task written under a plain bullet under another carried task is in
    // that task's block already, and moves with it.
    !all.some(
      (other, otherAt) =>
        otherAt !== at &&
        other.group.root.filePath === block.group.root.filePath &&
        other.first < block.first &&
        other.last >= block.last,
    ),
  );
  const placed = placeCarriedOver(todayText, blocks.flatMap((block) => block.lines));
  edit.replace(
    todayUri,
    new vscode.Range(placed.start.line, placed.start.character, placed.end.line, placed.end.character),
    placed.text,
  );
  if (mode === 'migrate') {
    // The line left behind says where the task went, and links there.
    const target = todayName ?? todayUri.path.split('/').pop()?.replace(/\.md$/i, '') ?? '';
    carried.forEach((task) => {
      const source = sources.get(task.filePath);
      if (!source) {
        return;
      }
      const line = task.lineNumber - 1;
      edit.replace(
        source.uri,
        source.document.lineAt(line).range,
        markMigrated(task.sourceLineText, task.checkboxColumn, target),
      );
    });
  }
  if (mode === 'move') {
    blocks.forEach(({ group, first, last }) => {
      const source = sources.get(group.root.filePath);
      if (!source) {
        return;
      }
      const document = source.document;
      edit.delete(
        source.uri,
        last + 1 < document.lineCount
          ? new vscode.Range(first, 0, last + 1, 0)
          : new vscode.Range(
              Math.max(first - 1, 0),
              first > 0 ? document.lineAt(first - 1).text.length : 0,
              last,
              document.lineAt(last).text.length,
            ),
      );
    });
  }

  const written = await history.write(edit, {
    label: `carrying ${pluralize(carried.length, 'task', 'tasks')} forward`,
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
        handle: written.handle,
      }
    : undefined;
}

/**
 * Carries the unfinished tasks of the last daily note into today's, creating
 * today's note when it is not there yet.
 */
export async function rollTasksForward(
  indexer: Pick<WorkspaceIndexer, 'ready' | 'getSnapshot' | 'refresh'>,
  history: WorkspaceWriteHistory,
  options: { mode?: Exclude<RolloverMode, 'off'>; silent?: boolean } = {},
): Promise<RolloverResult | undefined> {
  const folder = await chooseTargetFolder();
  if (!folder) {
    return undefined;
  }
  await indexer.ready;
  const mode =
    options.mode ?? (getRolloverMode(folder.uri) === 'migrate' ? 'migrate' : 'move');
  const plan = planRollover(
    indexer.getSnapshot(),
    formatLocalDate(new Date()),
    getRolloverLookbackDays(folder.uri),
    mode,
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
  const result = await applyRollover(plan, todayUri, mode, {
    history,
    todayName: todayUri.path.split('/').pop()?.replace(/\.md$/i, ''),
  });
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
      result.handle,
      indexer,
    );
  }
  return result;
}

/**
 * Says what a rollover did, and offers what a reader wants next: today's
 * note, which may have just been created, and the way back. `written` is
 * the rollover's handle when it carried anything, and nothing otherwise.
 *
 * Its Undo takes back whatever Deckard wrote last, without asking whether
 * that is still the rollover, as it always has.
 */
async function offerRollover(
  message: string,
  todayUri: vscode.Uri,
  written: WriteHandle | undefined,
  indexer: Pick<WorkspaceIndexer, 'refresh'>,
): Promise<void> {
  if (!written) {
    void vscode.window.showInformationMessage(message);
    return;
  }
  written.offerUndo(
    message,
    {
      guard: 'none',
      refresh: () => indexer.refresh(),
      done: (undone) => `Put ${pluralize(undone?.restored ?? 0, 'note')} back.`,
    },
    {
      label: 'Open',
      run: async () => {
        const document = await vscode.workspace.openTextDocument(todayUri);
        await vscode.window.showTextDocument(document, { preview: false });
      },
    },
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
  const verb = mode === 'move' ? 'Moved' : 'Migrated';
  // Where from: one day by name, several as the span they cover.
  const from =
    result.notes <= 1
      ? ` from ${result.fromDates[result.fromDates.length - 1] ?? oldest}`
      : ` from ${result.notes} daily notes, back to ${oldest}`;
  const left =
    result.skipped === 0
      ? ''
      : ` ${pluralize(result.skipped, 'task', 'tasks')} stayed behind, already carried or changed since.`;
  return `${verb} ${pluralize(
    result.carried,
    'unfinished task',
    'unfinished tasks',
  )} forward${from}.${left}`;
}

/**
 * Where carried tasks go in today's note: under its Carried over heading,
 * after what is already there, or under a new one at the end of the note,
 * one level deeper than the note's first heading (`##` under `# {date}`).
 * Returns the stretch of the note to replace and what replaces it.
 */
export function placeCarriedOver(
  content: string,
  lines: readonly string[],
): {
  start: { line: number; character: number };
  end: { line: number; character: number };
  text: string;
} {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const noteLines = content.split(/\r?\n/);
  const heading = (text: string) => /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(text);
  const existing = noteLines.findIndex(
    (text) => heading(text)?.[2].trim().toLowerCase() === CARRIED_OVER_HEADING.toLowerCase(),
  );
  if (existing >= 0) {
    const level = heading(noteLines[existing])![1].length;
    let endLine = noteLines.length;
    for (let at = existing + 1; at < noteLines.length; at += 1) {
      const next = heading(noteLines[at]);
      if (next && next[1].length <= level) {
        endLine = at;
        break;
      }
    }
    const insertion = getCaptureInsertion(content, lines.join(eol), {
      startLine: existing + 1,
      endLine,
    });
    const at = { line: insertion.line, character: insertion.character };
    return { start: at, end: at, text: insertion.text };
  }
  const first = noteLines.map(heading).find(Boolean);
  const level = first ? Math.min(first[1].length + 1, 6) : 2;
  let last = noteLines.length - 1;
  while (last >= 0 && noteLines[last].trim() === '') {
    last -= 1;
  }
  const block = `${'#'.repeat(level)} ${CARRIED_OVER_HEADING}${eol}${eol}${lines.join(eol)}${eol}`;
  if (last < 0) {
    return {
      start: { line: 0, character: 0 },
      end: { line: noteLines.length - 1, character: noteLines[noteLines.length - 1].length },
      text: block,
    };
  }
  return {
    start: { line: last, character: noteLines[last].length },
    end: { line: noteLines.length - 1, character: noteLines[noteLines.length - 1].length },
    text: `${eol}${eol}${block}`,
  };
}

/** How far back a rollover looks, in days; zero reaches as far as the notes. */
export function getRolloverLookbackDays(uri?: vscode.Uri): number {
  const days = vscode.workspace
    .getConfiguration('deckard', uri)
    .get<number>('dailyNote.rolloverDays', 7);
  return Number.isFinite(days) && days > 0 ? Math.floor(days) : 0;
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
  history: WorkspaceWriteHistory,
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
  const isNew = !(await fileExists(getPeriodicNoteUri(folder, 'day', new Date())));
  const opened = await createDailyNote(folder);
  if (opened && isNew) {
    await rollTasksForward(indexer, history, { mode, silent: true });
  }
  return opened;
}
