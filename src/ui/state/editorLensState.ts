import { findDailyNoteDate, stripTags } from '../../domain/markdown/parser';
import {
  createNoteTitleMap,
  parseWikiTarget,
  resolveWikiTarget,
} from '../../domain/index/backlinks';
import { findAdjacentDailyNote, listDailyNotes } from '../../domain/notes/periodicNotes';
import { planRollover } from '../../domain/notes/rolloverPlan';
import { createSourceParser, findEmbedLines, resolveEmbed } from '../../domain/notes/embeds';
import { computeTagProgress, describeTagProgress } from '../../domain/tasks/tagProgress';
import type { QueryContext } from '../../domain/query/queryContext';
import { ParsedFile, Task, WorkspaceIndex } from '../../domain/model';

/**
 * What the editor's action lenses decide, apart from VS Code. Each function
 * returns only what is worth a lens, so an empty result means no lens at all.
 */

/** One task's dependency lens: what it waits on, what it names that nothing carries, and what waits on it. */
export interface TaskDependencies {
  /** Zero-based line of the task. */
  line: number;
  /** Open tasks whose `🆔` this task's `⛔` names. */
  waitingOn: Task[];
  /** Names in this task's `⛔` that no task in the workspace carries. */
  missingIds: string[];
  /** Open tasks whose `⛔` names this task's `🆔`, while it is open itself. */
  blocking: Task[];
}

/**
 * The tasks in a note that wait on, or hold up, another open task.
 *
 * `file` is usually parsed from the editor, so its own tasks follow unsaved
 * edits; every other note's tasks come from the index. A done task is neither
 * waited on nor blocking, which is how `is:blocked` and `is:blocking` read
 * the same markers.
 */
export function findTaskDependencies(
  file: ParsedFile,
  index: WorkspaceIndex,
): TaskDependencies[] {
  const own = file.tasks.filter(
    (task) => task.dependencyId || (task.dependsOn?.length ?? 0) > 0,
  );
  if (own.length === 0) {
    return [];
  }

  const tasks = [
    ...[...index.tasks.values()].filter(
      (task) => task.filePath !== file.filePath,
    ),
    ...file.tasks,
  ];
  const carriers = new Map<string, Task[]>();
  const waiters = new Map<string, Task[]>();
  for (const task of tasks) {
    if (task.dependencyId) {
      append(carriers, task.dependencyId, task);
    }
    if (!task.completed) {
      new Set(task.dependsOn).forEach((id) => append(waiters, id, task));
    }
  }

  return own.flatMap((task) => {
    const ids = [...new Set(task.dependsOn ?? [])];
    const waitingOn = task.completed
      ? []
      : ids.flatMap((id) =>
          (carriers.get(id) ?? []).filter(
            (carrier) => carrier !== task && !carrier.completed,
          ),
        );
    // A done task no longer waits, so a name it gives that went nowhere no
    // longer matters either.
    const missingIds = task.completed
      ? []
      : ids.filter((id) => !carriers.has(id));
    const blocking =
      task.completed || !task.dependencyId
        ? []
        : (waiters.get(task.dependencyId) ?? []).filter(
            (waiter) => waiter !== task,
          );
    return waitingOn.length > 0 || missingIds.length > 0 || blocking.length > 0
      ? [{ line: task.lineNumber - 1, waitingOn, missingIds, blocking }]
      : [];
  });
}

/** A daily note's lenses: the notes either side of it, and what a rollover would carry in. */
export interface DailyNoteActions {
  /** The nearest daily notes before and after this one, by date. */
  previous?: string;
  next?: string;
  /**
   * Unfinished tasks in earlier daily notes that a rollover would carry into
   * this one: only on today's note, and without the lines already in it.
   */
  carryIn: Task[];
}

/** A note that may be a daily note, and how far back its tasks are looked for. */
export interface DailyNoteActionsOptions {
  file: ParsedFile;
  index: WorkspaceIndex;
  /** Today, as `YYYY-MM-DD`. */
  today: string;
  /** How many days back open tasks are carried in from; 0, the default, is every day. */
  lookbackDays?: number;
  /** The rollover mode, which decides whether older copies of a task count. */
  mode?: 'move' | 'migrate';
}

/**
 * What a daily note offers: its neighbors, and on today's note, the tasks
 * still open in earlier ones. Undefined for a note that is not a daily note,
 * or a daily note with nothing to offer.
 *
 * A rollover leaves behind a task whose line is already in today's note, so
 * those are not counted; in copy mode they stay in the note they came from,
 * and would otherwise keep offering to carry in what is already there.
 */
export function findDailyNoteActions({
  file,
  index,
  today,
  lookbackDays = 0,
  mode = 'move',
}: DailyNoteActionsOptions): DailyNoteActions | undefined {
  const date = findDailyNoteDate(
    file.filePath,
    file.sections
      .filter((section) => section.headingLevel === 1)
      .map((section) => section.heading),
  );
  if (!date) {
    return undefined;
  }
  const notes = listDailyNotes(index).filter(
    (note) => note.filePath !== file.filePath,
  );
  const previous = findAdjacentDailyNote(notes, date, 'previous')?.date;
  const next = findAdjacentDailyNote(notes, date, 'next')?.date;
  const written = new Set(
    file.content.split(/\r?\n/).map((line) => line.trim()),
  );
  const carryIn =
    date === today
      ? (planRollover(index, today, lookbackDays, mode)?.tasks ?? []).filter(
          (task) =>
            task.filePath !== file.filePath &&
            !written.has(task.sourceLineText.trim()),
        )
      : [];
  if (!previous && !next && carryIn.length === 0) {
    return undefined;
  }
  return {
    ...(previous ? { previous } : {}),
    ...(next ? { next } : {}),
    carryIn,
  };
}

/** An embed the preview cannot draw, with why. */
export interface EmbedProblem {
  /** Zero-based line of the embed. */
  line: number;
  /** What the preview draws in its place, such as a heading gone missing. */
  reason: string;
  /** The note the embed names, when it is another note that exists. */
  filePath?: string;
}

/**
 * The embeds in a note that the preview would draw as a message rather than
 * a note: a heading or a `^marker` the named note does not have. An embed
 * whose note name opens no note is left out, since the link inside it is
 * already a link problem, counted on the note's first line and marked where
 * it is written.
 */
export function findEmbedProblems(
  file: ParsedFile,
  index: WorkspaceIndex,
): EmbedProblem[] {
  const embeds = findEmbedLines(file.content);
  if (embeds.length === 0) {
    return [];
  }
  const titles = createNoteTitleMap(index);
  // The note itself is read once, for every embed of itself it holds.
  const parseSource = createSourceParser();
  return embeds.flatMap(({ line, target }) => {
    const { note } = parseWikiTarget(target);
    const filePath = note
      ? resolveWikiTarget(titles, note, file.filePath)
      : undefined;
    if (note && !filePath) {
      return [];
    }
    const embed = resolveEmbed(target, file.content, index, parseSource);
    if (embed.kind !== 'missing') {
      return [];
    }
    return [
      {
        line,
        reason: embed.reason.replace(/\.$/, ''),
        ...(filePath && filePath !== file.filePath ? { filePath } : {}),
      },
    ];
  });
}

function append<T>(map: Map<string, T[]>, key: string, value: T): void {
  const values = map.get(key);
  if (values) {
    values.push(value);
  } else {
    map.set(key, [value]);
  }
}

/** How far along one tag a hub note describes is, for the lens on its first line. */
export interface HubProgress {
  tagKey: string;
  tagLabel: string;
  /** "2 of 6 done · 1 overdue · next due in 3 days". */
  text: string;
}

/**
 * How far along each tag a hub note's `describes:` names is, in the order it
 * names them; a tag with no task, and a note that describes nothing, has
 * none. The note's own front matter is read from `file`, usually the editor's
 * text; the tasks are the index's.
 */
export function findHubProgress(
  file: ParsedFile,
  index: WorkspaceIndex,
  context: Pick<QueryContext, 'now' | 'taskPolicy'>,
): HubProgress[] {
  return (file.hub?.describes ?? []).flatMap((tag) => {
    const progress = computeTagProgress(index, tag.key, context.now, context.taskPolicy);
    return progress
      ? [{ tagKey: tag.key, tagLabel: tag.label, text: describeTagProgress(progress, context.now, context.taskPolicy) }]
      : [];
  });
}

/** How far along one task's steps are, for the lens above it. */
export interface StepProgress {
  /** Zero-based line of the task. */
  line: number;
  total: number;
  done: number;
  /** Zero-based line of the first open step, when one is open. */
  nextLine?: number;
  /** The first open step's words, without its tags. */
  next?: string;
}

/**
 * Each task in a note that has steps, with how many are done and which is
 * next, in the order written. `file` is usually parsed from the editor, so
 * the counts follow a box ticked a moment ago.
 */
export function findStepProgress(file: ParsedFile): StepProgress[] {
  const byId = new Map(file.tasks.map((task) => [task.id, task]));
  return file.tasks.flatMap((task) => {
    const steps = task.steps;
    if (!steps || steps.total === 0) {
      return [];
    }
    const next = steps.ids.map((id) => byId.get(id)).find((step) => step && !step.completed);
    return [
      {
        line: task.lineNumber - 1,
        total: steps.total,
        done: steps.done,
        ...(next ? { nextLine: next.lineNumber - 1, next: stripTags(next.title).trim() || next.title } : {}),
      },
    ];
  });
}

/**
 * A bar of how far along something is, drawn in text for a lens, which
 * cannot draw anything else: `███░░░░░░░` for 3 of 10, at `width` cells.
 * A start counts one cell, and only all of it fills the bar, so neither
 * none nor nearly all reads as done.
 */
export function formatProgressBar(done: number, total: number, width = 10): string {
  if (total <= 0) {
    return '';
  }
  const ratio = Math.min(1, Math.max(0, done / total));
  let filled = Math.round(ratio * width);
  if (done > 0 && filled === 0) {
    filled = 1;
  }
  if (done < total && filled === width) {
    filled = width - 1;
  }
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}
