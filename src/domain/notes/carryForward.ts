import { findLastDescendantLine } from '../markdown/taskSteps';
import type { Task } from '../model';
import type { RolloverMode } from './rolloverPlan';
import { markMigrated } from '../markdown/taskLineEdits';

/**
 * What carrying a rollover plan's tasks into today's note does to the text:
 * which tasks still go, which lines each takes with it, and what changes in
 * the notes they came from. It reads the notes as text, so the rules can be
 * checked without an editor.
 */

/** A place in a note: a zero-based line and a character on it. */
export interface NotePosition {
  line: number;
  character: number;
}

/** The stretch of a note between two positions. */
export interface NoteRange {
  start: NotePosition;
  end: NotePosition;
}

/** One change to a note a task came from: `range` becomes `text`, and an empty `text` deletes it. */
export interface SourceEdit {
  filePath: string;
  range: NoteRange;
  text: string;
}

/** What a rollover carries, as `planCarriedTasks` works it out. */
export interface CarriedTasks {
  /** The tasks that go, each task followed by the steps that go with it. */
  carried: Task[];
  /** Tasks left behind: already in today's note, or changed since indexing. */
  skipped: number;
  /** The lines written under Carried over, outdented, block after block. */
  lines: string[];
  /** The marks a migrate leaves, or the blocks a move takes out, in order. */
  sourceEdits: SourceEdit[];
  /** How many notes gave a task up. */
  notes: number;
}

/** How to carry: moving or migrating, and the note a migrated line links to. */
export interface CarryOptions {
  mode: Exclude<RolloverMode, 'off'>;
  /** Today's note's name, which a migrated line links to. */
  target: string;
}

/** A task with the steps written under it that go along, and the lines they fill. */
interface CarriedBlock {
  root: Task;
  steps: Task[];
  /** The zero-based lines of the note the block spans. */
  first: number;
  last: number;
  lines: string[];
}

/**
 * The setting's value as a mode: `copy`, the older name, reads as migrate,
 * and anything unknown as off. A map rather than an object, so a value such
 * as `constructor` reads as off too.
 */
const MODES: ReadonlyMap<string, RolloverMode> = new Map([
  ['move', 'move'],
  ['migrate', 'migrate'],
  ['copy', 'migrate'],
]);

/** `deckard.dailyNote.rollover` as a mode, with `copy` read as migrate. */
export function readRolloverMode(setting: unknown): RolloverMode {
  return (typeof setting === 'string' ? MODES.get(setting) : undefined) ?? 'off';
}

/**
 * Works out what carrying the plan's tasks does, from the text of the
 * notes they came from (by index path, as lines) and of today's note.
 *
 * Each task is compared with the line the index recorded, as every other
 * Deckard task edit is, and one whose line has changed, or whose note could
 * not be read, stays where it is. A task today's note already holds stays
 * too, which is what running this twice would do, and its steps with it.
 */
export function planCarriedTasks(
  tasks: readonly Task[],
  sources: ReadonlyMap<string, readonly string[]>,
  todayText: string,
  options: CarryOptions,
): CarriedTasks {
  const unchangedSinceIndexed = tasks.filter((task) => {
    const lines = sources.get(task.filePath);
    const line = task.lineNumber - 1;
    return lines !== undefined && line < lines.length && lines[line] === task.sourceLineText;
  });
  let skipped = tasks.length - unchangedSinceIndexed.length;
  const todayLines = new Set(todayText.split(/\r?\n/).map((line) => line.trim()));
  const kept = groupSteps(unchangedSinceIndexed).filter((group) => {
    if (todayLines.has(group.root.sourceLineText.trim())) {
      skipped += 1 + group.steps.length;
      return false;
    }
    return true;
  });
  const carried = kept.flatMap((group) => [group.root, ...group.steps]);
  if (carried.length === 0) {
    return { carried, skipped, lines: [], sourceEdits: [], notes: 0 };
  }
  const blocks = withoutNestedBlocks(kept.map((group) => toBlock(group, sources, options.mode)));
  return {
    carried,
    skipped,
    lines: blocks.flatMap((block) => block.lines),
    sourceEdits:
      options.mode === 'migrate'
        ? migrateMarks(carried, options.target)
        : blocks.map((block) => moveDeletion(block, sources)),
    notes: new Set(carried.map((task) => task.filePath)).size,
  };
}

/**
 * The tasks grouped under the task each is written beneath. A step goes
 * with the task it is written under when that task goes too; a step whose
 * task stays behind (done, changed, or parked) goes on its own, at the top
 * level, never nested under whatever precedes it.
 */
function groupSteps(tasks: readonly Task[]): { root: Task; steps: Task[] }[] {
  const ids = new Set(tasks.map((task) => task.id));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const rootOf = (task: Task): Task => {
    let root = task;
    while (root.parentTaskId !== undefined && ids.has(root.parentTaskId)) {
      root = byId.get(root.parentTaskId) ?? root;
    }
    return root;
  };
  const groups = new Map<string, { root: Task; steps: Task[] }>();
  tasks.forEach((task) => {
    const root = rootOf(task);
    const group = groups.get(root.id) ?? { root, steps: [] };
    if (root !== task) {
      group.steps.push(task);
    }
    groups.set(root.id, group);
  });
  return [...groups.values()];
}

/**
 * The lines one task takes into today's note. Moving takes everything
 * written under a task along, done steps and notes included, so nothing is
 * left orphaned under another task; a migrate copies the open steps.
 */
function toBlock(
  group: { root: Task; steps: Task[] },
  sources: ReadonlyMap<string, readonly string[]>,
  mode: Exclude<RolloverMode, 'off'>,
): CarriedBlock {
  const lines = sources.get(group.root.filePath) ?? [];
  const first = group.root.lineNumber - 1;
  const last = mode === 'move' ? findLastDescendantLine(lines, first) : first;
  const written =
    mode === 'move'
      ? lines.slice(first, last + 1)
      : [
          group.root.sourceLineText,
          ...[...group.steps]
            .sort((left, right) => left.lineNumber - right.lineNumber)
            .map((step) => step.sourceLineText),
        ];
  return { ...group, first, last, lines: outdent(written) };
}

/**
 * The blocks without those another block already holds: a task written
 * under a plain bullet under another carried task is in that task's block
 * already, and moves with it.
 */
function withoutNestedBlocks(blocks: readonly CarriedBlock[]): CarriedBlock[] {
  return blocks.filter(
    (block, at) =>
      !blocks.some(
        (other, otherAt) =>
          otherAt !== at &&
          other.root.filePath === block.root.filePath &&
          other.first < block.first &&
          other.last >= block.last,
      ),
  );
}

/** The line a migrate leaves behind for each task, saying where it went and linking there. */
function migrateMarks(carried: readonly Task[], target: string): SourceEdit[] {
  return carried.map((task) => {
    const line = task.lineNumber - 1;
    return {
      filePath: task.filePath,
      range: { start: { line, character: 0 }, end: { line, character: task.sourceLineText.length } },
      text: markMigrated(task.sourceLineText, task.checkboxColumn, target),
    };
  });
}

/**
 * The stretch a move takes out of the note a block came from: its lines and
 * the break after them, or, for a block that ends the note, the break before.
 */
function moveDeletion(block: CarriedBlock, sources: ReadonlyMap<string, readonly string[]>): SourceEdit {
  const lines = sources.get(block.root.filePath) ?? [];
  const { first, last } = block;
  const range: NoteRange =
    last + 1 < lines.length
      ? { start: { line: first, character: 0 }, end: { line: last + 1, character: 0 } }
      : {
          start: { line: Math.max(first - 1, 0), character: first > 0 ? lines[first - 1].length : 0 },
          end: { line: last, character: lines[last].length },
        };
  return { filePath: block.root.filePath, range, text: '' };
}

/**
 * A block of lines moved to the top level: the first line's indentation
 * taken off every line that starts with it, so steps stay nested under
 * their task by the same amount.
 */
function outdent(lines: readonly string[]): string[] {
  const indent = lines[0]?.match(/^[ \t]*/)?.[0] ?? '';
  return lines.map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line.trimStart()));
}
