import { findCheckboxColumn, findStepFamily, isCheckedTaskLine } from '../markdown/taskSteps';
import { Task } from '../model';
import { parseTaskMetadata, TaskMetadataFormat } from '../markdown/taskFields';

/**
 * Rules about a task's own line in its note: whether it still reads as the
 * index read it, what completing it means for its steps, and how its words
 * are quoted in a message.
 */

/** The lines of a note, as far as checking a task's line needs them. */
export interface NoteLines {
  readonly lineCount: number;
  /** The words of a zero-based line, without its line ending. */
  lineAt(line: number): string;
}

/**
 * A task's line in its note, if it still reads as the index read it: the
 * same text, with the checkbox where it was. A line past the end of the note
 * is a line that changed too. Undefined when it changed.
 */
export function readIndexedTaskLine(
  note: NoteLines,
  task: Pick<Task, 'lineNumber' | 'sourceLineText' | 'checkboxColumn' | 'checkboxValue'>,
): string | undefined {
  if (
    task.lineNumber < 1 ||
    task.lineNumber > note.lineCount ||
    note.lineAt(task.lineNumber - 1) !== task.sourceLineText
  ) {
    return undefined;
  }
  const line = note.lineAt(task.lineNumber - 1);
  if (
    line[task.checkboxColumn] !== task.checkboxValue ||
    line[task.checkboxColumn - 1] !== '[' ||
    line[task.checkboxColumn + 1] !== ']'
  ) {
    return undefined;
  }
  return line;
}

/**
 * What completing a task means for its steps, read from the note as it was
 * before the edit: the task whose last open step this was, or how many of
 * its own steps are still open.
 */
export interface CompletionFamily {
  /**
   * The task this was the last open step of: its line, 0-based, its text,
   * which a later edit is checked against, and its words.
   */
  lastStepOf?: { line: number; text: string; title: string };
  /** The task's own open steps. */
  openSteps: number;
  /** The completed task's line once the edit is written, 0-based. */
  writtenLine: number;
  /** The completed task's line as written, which a later edit is checked against. */
  writtenText: string;
}

/**
 * The step family of the task on `lineIndex` as completing it with `written`
 * leaves it.
 */
export function readCompletionFamily(
  lines: readonly string[],
  lineIndex: number,
  written: string,
): CompletionFamily {
  const family = findStepFamily(lines, lineIndex);
  const openSteps = family.steps.filter((line) => !isCheckedTaskLine(lines[line])).length;
  let lastStepOf: CompletionFamily['lastStepOf'];
  if (family.parent !== undefined && !isCheckedTaskLine(lines[family.parent])) {
    const stillOpen = findStepFamily(lines, family.parent).steps.filter(
      (line) => line !== lineIndex && !isCheckedTaskLine(lines[line]),
    );
    if (stillOpen.length === 0) {
      const text = lines[family.parent];
      lastStepOf = { line: family.parent, text, title: readTaskWords(text) };
    }
  }
  const writtenLines = written.split(/\r?\n/);
  return {
    openSteps,
    // A next occurrence written above moves the completed line down.
    writtenLine: lineIndex + writtenLines.length - 1,
    writtenText: writtenLines[writtenLines.length - 1],
    ...(lastStepOf ? { lastStepOf } : {}),
  };
}

/** A task line's words, its metadata left out. */
export function readTaskWords(line: string): string {
  const words = line.slice(findCheckboxColumn(line) + 2).trim();
  return parseTaskMetadata(words).title || words;
}

/** A task's words, quoted and short enough to sit in a notification. */
export function quoteTitle(text: string): string {
  const title = text.trim();
  return `"${title.length > 60 ? `${title.slice(0, 57)}…` : title}"`;
}

/** How many steps, in words: `1 step`, `3 steps`. */
export function countSteps(count: number): string {
  return `${count} ${count === 1 ? 'step' : 'steps'}`;
}

/**
 * The Tasks format Deckard writes for a task that has no metadata yet, from
 * `deckard.tasks.metadataFormat`. A task that already has some keeps its own
 * format.
 */
export function readMetadataFormat(settings: {
  get<T>(key: string, defaultValue: T): T;
}): TaskMetadataFormat {
  return settings.get<string>('tasks.metadataFormat', 'emoji') === 'dataview'
    ? 'dataview'
    : 'emoji';
}
