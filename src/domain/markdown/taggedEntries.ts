import { ParsedFile } from '../model';

/**
 * The tagged entries of a note that the editor marks: each tagged section,
 * inline block, and task, and which of them holds a line. The tag
 * decorations in `ui/providers` draw the band and the hovers from these.
 */

/** A tagged section or task in the editor: what the band and hover cover. */
export interface EditorEntry {
  startLine: number;
  endLine: number;
  title: string;
  /** Whether the entry is a task, which its hover offers to edit. */
  isTask?: boolean;
}

/**
 * The entries a note's hovers and band cover: sections with heading tags,
 * tagged inline blocks, and tagged tasks.
 */
export function collectTaggedEntries(
  parsed: Pick<ParsedFile, 'sections' | 'tasks'>,
): EditorEntry[] {
  const entries: EditorEntry[] = [];
  parsed.sections
    .filter(
      (section) =>
        (section.headingTags?.length ?? 0) > 0 ||
        (section.isInline && (section.associationTagGroups?.length ?? 0) > 0),
    )
    .forEach((section) =>
      entries.push({
        startLine: section.startLine,
        endLine: section.endLine,
        title: section.heading,
      }),
    );
  parsed.tasks
    .filter((task) => (task.associationTagGroups?.length ?? 0) > 0)
    .forEach((task) =>
      entries.push({
        startLine: task.lineNumber,
        endLine: task.lineNumber,
        title: task.title,
        isTask: true,
      }),
    );
  return entries;
}

/**
 * The innermost entry holding a line (1-based): the one with the smallest
 * span, and of two alike, the one that starts later.
 */
export function findBandEntry(
  entries: readonly EditorEntry[],
  line: number,
): EditorEntry | undefined {
  let best: EditorEntry | undefined;
  for (const entry of entries) {
    if (line < entry.startLine || line > entry.endLine) {
      continue;
    }
    const span = entry.endLine - entry.startLine;
    const bestSpan = best ? best.endLine - best.startLine : Infinity;
    if (!best || span < bestSpan || (span === bestSpan && entry.startLine > best.startLine)) {
      best = entry;
    }
  }
  return best;
}

/** A run of lines (1-based, inclusive) that belong to one entry alone. */
export interface EntryLines {
  entry: EditorEntry;
  startLine: number;
  endLine: number;
}

/**
 * Each entry's own lines: the lines where it is the innermost entry, as
 * `findBandEntry` chooses, in runs. A heading's hover so leaves out the
 * tasks under it, which have hovers of their own, and a hover is only ever
 * about the line under the pointer.
 */
export function splitEntryLines(entries: readonly EditorEntry[]): EntryLines[] {
  // Widest first, and of two alike the earlier first, so an inner entry,
  // painted later, takes its lines from the entry around it.
  const painted = [...entries].sort(
    (a, b) => b.endLine - b.startLine - (a.endLine - a.startLine) || a.startLine - b.startLine,
  );
  const owner = new Map<number, EditorEntry>();
  for (const entry of painted) {
    for (let line = entry.startLine; line <= entry.endLine; line++) {
      owner.set(line, entry);
    }
  }
  const runs: EntryLines[] = [];
  [...owner.keys()]
    .sort((a, b) => a - b)
    .forEach((line) => {
      const entry = owner.get(line) as EditorEntry;
      const last = runs[runs.length - 1];
      if (last && last.entry === entry && last.endLine === line - 1) {
        last.endLine = line;
      } else {
        runs.push({ entry, startLine: line, endLine: line });
      }
    });
  return runs;
}

/** What a hover over some lines (1-based, inclusive) offers. */
export interface EntryHover {
  startLine: number;
  endLine: number;
  /** The line of the entry Pin to Home pins, when the lines are an entry's. */
  pinLine?: number;
  /** The task line Edit task edits, when the lines are one task. */
  taskLine?: number;
}

/**
 * The hovers a note's lines get: an entry's own lines offer to pin it, and a
 * task's line offers to edit it, tagged or not. A tagged task offers both;
 * a task with no tag of its own, under a tagged heading, offers only Edit
 * task, since pinning there would pin the heading, not the task.
 */
export function planEntryHovers(
  entries: readonly EditorEntry[],
  taskLines: readonly number[],
): EntryHover[] {
  const tasks = new Set(taskLines);
  const hovers: EntryHover[] = [];
  const covered = new Set<number>();
  for (const run of splitEntryLines(entries)) {
    hovers.push(...planRunHovers(run, tasks));
    for (let line = run.startLine; line <= run.endLine; line++) {
      covered.add(line);
    }
  }
  tasks.forEach((line) => {
    if (!covered.has(line)) {
      hovers.push({ startLine: line, endLine: line, taskLine: line });
    }
  });
  return hovers.sort((a, b) => a.startLine - b.startLine);
}

/**
 * One entry's run of lines, cut at each task line with no tag of its own,
 * which offers only Edit task; the rest offer to pin the entry, and a
 * task entry's own line to edit it as well.
 */
function planRunHovers(run: EntryLines, tasks: ReadonlySet<number>): EntryHover[] {
  const hovers: EntryHover[] = [];
  const pin = {
    pinLine: run.entry.startLine,
    ...(run.entry.isTask ? { taskLine: run.entry.startLine } : {}),
  };
  let start = run.startLine;
  for (let line = run.startLine; line <= run.endLine; line++) {
    if (run.entry.isTask || !tasks.has(line)) {
      continue;
    }
    if (start < line) {
      hovers.push({ startLine: start, endLine: line - 1, ...pin });
    }
    hovers.push({ startLine: line, endLine: line, taskLine: line });
    start = line + 1;
  }
  if (start <= run.endLine) {
    hovers.push({ startLine: start, endLine: run.endLine, ...pin });
  }
  return hovers;
}
