import * as vscode from 'vscode';
import { confirmNotesWrite } from './writeTarget';
import { fileExists } from './fs';

import { pluralize } from '../../shared/text';
import type { IndexControl, IndexReader } from '../../core/workspace/indexReader';
import { readRolloverMode } from '../../domain/notes/carryForward';
import {
  RolloverMode,
  RolloverPlan,
} from '../../domain/notes/rolloverPlan';
import {
  RolloverEdit,
  RolloverNotes,
  RolloverOutcome,
  RolloverService,
  RolloverSource,
  RolloverWriteOutcome,
} from '../../services/rolloverService';
import {
  chooseTargetFolder,
  chooseWorkspaceFolder,
  createDailyNote,
  ensureDailyNote,
  getPeriodicNoteUri,
} from './dailyNote';
import { resolveSourceUri } from './navigation';
import { WorkspaceWriteHistory, WriteHandle } from './workspaceWrites';
import { getCaptureInsertion } from '../../domain/capture/captureLines';
import { findFencedLines, readHeading } from '../../domain/markdown/lineShapes';
import { type DateFormats, DEFAULT_DATE_FORMATS, formatDisplayDay } from '../../domain/markdown/dateFormat';
import { readDateFormats } from './datePrompt';

/**
 * Roll Tasks Forward, and the rollover a new daily note starts with.
 *
 * What a rollover carries, and what it changes in the notes the tasks came
 * from, is RolloverService's decision; these choose the folder, read the
 * settings, and say what came of it, with today's note and the way back.
 */

/** `copy`, the older name, reads as migrate. */
export function getRolloverMode(uri?: vscode.Uri): RolloverMode {
  return readRolloverMode(
    vscode.workspace.getConfiguration('deckard', uri).get<string>('dailyNote.rollover', 'off'),
  );
}

/** The heading carried tasks go under, in today's note. */
export const CARRIED_OVER_HEADING = 'Carried over';

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

/** The rollover service as the commands use it, over VS Code's URIs and writes. */
export type VscodeRolloverService = RolloverService<vscode.Uri, WriteHandle>;

/**
 * The rollover service over VS Code: it opens the notes through their
 * editors, writes through the history as one write, and reads the notes
 * again through `index` once it has.
 */
export function createRolloverService(
  history: WorkspaceWriteHistory,
  index: { refresh(): Promise<void> },
): VscodeRolloverService {
  return new RolloverService<vscode.Uri, WriteHandle>({
    notes: new RolloverDocuments(history),
    place: placeCarriedOver,
    index,
    clock: { now: () => Date.now() },
  });
}

/**
 * The notes a rollover reads and writes, through VS Code. A note is read
 * through its document, so an open note's unsaved text is what is compared
 * and carried, and the write goes through the history, never previewed.
 */
class RolloverDocuments implements RolloverNotes<vscode.Uri, WriteHandle> {
  public constructor(private readonly history: WorkspaceWriteHistory) {}

  /** Today's note's text, as its document holds it. */
  public async readToday(uri: vscode.Uri): Promise<string> {
    return (await vscode.workspace.openTextDocument(uri)).getText();
  }

  /** A note the plan draws from, or undefined when it cannot be found or opened. */
  public async openSource(filePath: string): Promise<RolloverSource<vscode.Uri> | undefined> {
    const uri = await resolveSourceUri(filePath);
    if (!uri) {
      return undefined;
    }
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      return { uri, text: () => document.getText() };
    } catch {
      return undefined;
    }
  }

  /** Writes the rollover as one write, which Undo takes back whole or not at all. */
  public async write(
    edits: readonly RolloverEdit<vscode.Uri>[],
    carried: number,
  ): Promise<RolloverWriteOutcome<WriteHandle>> {
    const edit = new vscode.WorkspaceEdit();
    edits.forEach(({ uri, range, text }) => {
      edit.replace(
        uri,
        new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character),
        text,
      );
    });
    const written = await this.history.write(edit, {
      label: `carrying ${pluralize(carried, 'task', 'tasks')} forward`,
      // A rollover is one gesture over a few notes; showing it every morning
      // would be in the way. Undo is what takes it back.
      preview: 'never',
      // Moving or migrating takes a task out of, or marks it in, the note it
      // came from as it lands in today's, so putting back only some notes
      // would lose the task from both, or leave it in both.
      together: true,
    });
    return written.applied ? { applied: true, handle: written.handle } : { applied: false };
  }
}

/** A rollover's outcome in the shape the commands and their callers report it. */
function toRolloverWrite(result: RolloverOutcome<WriteHandle>): RolloverWrite | undefined {
  switch (result.kind) {
    case 'not-applied':
      return undefined;
    case 'nothing-carried':
      return { carried: 0, skipped: result.skipped, fromDates: result.fromDates, notes: 0 };
    case 'carried':
      return {
        carried: result.carried,
        skipped: result.skipped,
        fromDates: result.fromDates,
        notes: result.notes,
        handle: result.handle,
      };
  }
}

/**
 * Writes the plan's tasks into today's note, and takes them out of the note
 * they came from when moving, as RolloverService decides, through a service
 * made for this one write. Undefined when VS Code did not apply the write.
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
  // Applying a plan on its own never reads the notes again, so the service
  // is given nothing to refresh.
  const rollover = createRolloverService(options.history, { refresh: () => Promise.resolve() });
  return toRolloverWrite(await rollover.apply({ plan, todayUri, mode, todayName: options.todayName }));
}

/**
 * Carries the unfinished tasks of the last daily note into today's, creating
 * today's note when it is not there yet.
 */
export async function rollTasksForward(
  indexer: Pick<IndexReader & IndexControl, 'ready' | 'getSnapshot' | 'refresh'>,
  rollover: VscodeRolloverService,
  options: { mode?: Exclude<RolloverMode, 'off'>; silent?: boolean } = {},
): Promise<RolloverResult | undefined> {
  const folder = await chooseTargetFolder();
  if (!folder) {
    return undefined;
  }
  await indexer.ready;
  const mode =
    options.mode ?? (getRolloverMode(folder.uri) === 'migrate' ? 'migrate' : 'move');
  const result = await rollover.rollForward({
    index: indexer.getSnapshot(),
    mode,
    lookbackDays: ROLLOVER_LOOKBACK_DAYS,
    ensureToday: () => ensureDailyNote(folder),
  });
  if (result.kind === 'nothing-waiting') {
    if (!options.silent) {
      void vscode.window.showInformationMessage(
        'No unfinished tasks are waiting in an earlier daily note.',
      );
    }
    return undefined;
  }
  const written = toRolloverWrite(result);
  if (result.kind === 'not-applied' || !written) {
    return undefined;
  }
  if (!options.silent || written.carried > 0) {
    // A rollover writes into notes nobody opened, so both the note it wrote
    // into and the way back are offered where it is announced.
    void offerRollover(
      describeRollover(written, mode, readDateFormats()),
      result.todayUri,
      written.handle,
      indexer,
    );
  }
  return written;
}

/**
 * Says what a rollover did, and offers what a reader wants next: today's
 * note, which may have just been created, and the way back. `written` is
 * the rollover's handle when it carried anything, and nothing otherwise.
 *
 * Its Undo takes the rollover back only while it is still Deckard's last
 * write: once Deckard has written since, it says to use Undo Last Change
 * and writes nothing.
 */
async function offerRollover(
  message: string,
  todayUri: vscode.Uri,
  written: WriteHandle | undefined,
  indexer: Pick<IndexControl, 'refresh'>,
): Promise<void> {
  if (!written) {
    void vscode.window.showInformationMessage(message);
    return;
  }
  written.offerUndo(
    message,
    {
      guard: 'latest',
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
  formats: DateFormats = DEFAULT_DATE_FORMATS,
): string {
  const oldest = result.fromDates[0] === undefined ? undefined : formatDisplayDay(result.fromDates[0], formats);
  const newest = result.fromDates[result.fromDates.length - 1];
  if (result.carried === 0) {
    return `Nothing was carried forward: the open tasks in your earlier daily notes are already in today's note, or have changed since.`;
  }
  const verb = mode === 'move' ? 'Moved' : 'Migrated';
  // Where from: one day by name, several as the span they cover.
  const from =
    result.notes <= 1
      ? ` from ${newest === undefined ? oldest : formatDisplayDay(newest, formats)}`
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
 *
 * A heading is one as the parser reads it, `#` alone included, and a line
 * in fenced code is never one, so the section ends where the Outline says.
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
  const fenced = findFencedLines(noteLines);
  const headings = noteLines.map((text, line) => (fenced.has(line) ? undefined : readHeading(text)));
  const existing = headings.findIndex(
    (heading) => heading?.text.toLowerCase() === CARRIED_OVER_HEADING.toLowerCase(),
  );
  if (existing >= 0) {
    const level = headings[existing]!.level;
    let endLine = noteLines.length;
    for (let at = existing + 1; at < noteLines.length; at += 1) {
      const next = headings[at];
      if (next && next.level <= level) {
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
  const first = headings.find(Boolean);
  const level = first ? Math.min(first.level + 1, 6) : 2;
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

/** How far back a rollover looks for unfinished tasks, in days: a week. */
export const ROLLOVER_LOOKBACK_DAYS = 7;

/**
 * Opens today's note, creating it from the template, and carries the last
 * daily note's unfinished tasks in when the setting asks for it.
 *
 * Only a note Deckard creates rolls tasks in, so opening today's note again
 * later in the day does not carry the same tasks twice. `rollover` is the
 * service the extension made when it started; a caller that has only the
 * history gets one made from it.
 */
export async function createDailyNoteWithRollover(
  indexer: Pick<IndexReader & IndexControl, 'ready' | 'getSnapshot' | 'refresh'>,
  history: WorkspaceWriteHistory,
  workspaceFolder?: vscode.WorkspaceFolder,
  rollover: VscodeRolloverService = createRolloverService(history, indexer),
): Promise<vscode.Uri | undefined> {
  const folder = workspaceFolder ?? (await chooseWorkspaceFolder());
  // A folder handed in has not been asked about yet; one chosen has.
  if (!folder || (workspaceFolder && !(await confirmNotesWrite(workspaceFolder)))) {
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
    await rollTasksForward(indexer, rollover, { mode, silent: true });
  }
  return opened;
}
