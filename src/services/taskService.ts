import { parseMarkdown } from '../domain/markdown/parser';
import { isOpenTask } from '../domain/tasks/taskStatuses';
import {
  findCheckboxColumn,
  findStepFamily,
  formatStepLines,
  isClosedTaskLine,
  planStepInsertion,
  readStepsForNextOccurrence,
} from '../domain/markdown/taskSteps';
import { Task } from '../domain/model';
import {
  CompletionFamily,
  countSteps,
  quoteTitle,
  readCompletionFamily,
  readIndexedTaskLine,
  readMetadataFormat,
} from '../domain/tasks/taskLines';
import { RankMove, rankMoveAfterEdit, rankMoveAfterRevert, rankMovesAfterEdits } from '../domain/tasks/taskRank';
import { ToggledLine, toggleTaskLines, ToggleResult } from '../domain/tasks/toggleLines';
import type { Clock } from '../ports/clock';
import type { Configuration } from '../ports/configuration';
import type { EditApplier, HistoryWriter, NoteText, TextRange } from '../ports/editApplier';
import type { ResourceUri } from '../ports/uri';
import { createNextOccurrence, setTaskLineCompletion, writeCompletion } from '../domain/markdown/taskLineEdits';
import { formatIsoDate } from '../domain/markdown/calendar';
import { nextStatus, setTaskStatus } from '../domain/tasks/statusWrites';
import { readTaskStatusSettings, type TaskStatusDefinition } from '../domain/tasks/taskStatuses';

/** One of the two statuses every list has, ` ` Todo or `x` Done, by its character. */
function coreStatus(statuses: readonly TaskStatusDefinition[], symbol: ' ' | 'x'): TaskStatusDefinition {
  return statuses.find((status) => status.symbol === symbol) ?? { symbol, name: symbol === 'x' ? 'Done' : 'Todo', type: symbol === 'x' ? 'done' : 'todo' };
}

/**
 * Every edit Deckard makes to a task: rewriting its line, from its checkbox
 * to a board move; putting a line back for Undo; completing its steps; and
 * writing new steps under it.
 *
 * What the edit is, whether the note still says what the index read, and
 * which task keeps which place in the rank order are decided here; each
 * method returns what happened as a value, and the command that asked says
 * it and offers the Undo.
 */

/**
 * Carries a task's place in the rank order from the id it had to the id it
 * has. A task's id comes from its own text, so an edit Deckard writes makes
 * it a new task to anything keyed by id; the extension's keeper moves its
 * place in the preferences to the new id.
 */
export type TaskRankKeeper = (previousId: string, nextId: string) => void;

/** What the task service reads and writes through. */
export interface TaskServiceOptions<U extends ResourceUri, H> {
  /** The notes, as the editor holds them. */
  notes: EditApplier<U>;
  /** Writes that Undo Last Change can take back, and their handles. */
  history: HistoryWriter<U, H>;
  /** Marks a note's save as Deckard's own, so the index reads it back at once. */
  ownWrites: { note(uri: string): void };
  keepRank: TaskRankKeeper;
  /** The note an index path names, or undefined when no folder holds it. */
  resolveUri(filePath: string): PromiseLike<U | undefined>;
  /** The `deckard` settings, read as they apply to the note being edited. */
  configuration: Configuration<U>;
  clock: Clock;
}

/** What an edit to a task line may need to know about its document. */
export interface TaskLineContext<U> {
  uri: U;
  /** The document's line ending, for an edit that adds a line. */
  eol: string;
  /** The note's lines as they are before the edit. */
  lines: readonly string[];
  /** The task's own line among them, 0-based. */
  lineIndex: number;
}

/** A task line's new text, and what writing it found out on the way. */
interface Rewrite<T> {
  text: string;
  outcome?: T;
}

/** The fields of a task that find and check its line. */
export type TaskLineTarget = Pick<
  Task,
  'filePath' | 'lineNumber' | 'sourceLineText' | 'checkboxColumn' | 'status'
>;

/**
 * An indexed task's note, opened: its line as the index read it; or why it
 * could not be: no folder holds its path, its line has changed since, or
 * the note could not be read at all.
 */
export type OpenedTask<U> =
  | { kind: 'open'; uri: U; note: NoteText; line: string }
  | { kind: 'missing' }
  | { kind: 'stale'; uri: U }
  | { kind: 'unreadable'; uri: U; error: unknown };

/**
 * A task line as an edit left it, and as it was: its note, its one-based
 * line, what was written, and what was there. `filePath` is the index's path
 * for the note, which the rank order is keyed by.
 */
export interface WrittenTaskLine<U> {
  uri: U;
  lineNumber: number;
  replacement: string;
  original: string;
  filePath?: string;
}

/**
 * What rewriting a task's line did. `unchanged` wrote nothing because the
 * edit changed nothing; `rejected` is the editor refusing the change;
 * `unsaved` is an edit the editor took but the note did not save; `failed`
 * wrote nothing.
 */
export type LineUpdate<U, T = never> =
  | { kind: 'updated'; written: WrittenTaskLine<U>; outcome?: T }
  | { kind: 'unchanged' }
  | { kind: 'missing' }
  | { kind: 'stale'; uri: U }
  | { kind: 'rejected'; uri: U }
  | { kind: 'unsaved'; uri: U; error?: unknown }
  | { kind: 'failed'; uri: U; error: unknown };

/**
 * What completing a task started, found out as its line was written: the
 * next occurrence of a repeating task, a repeat rule that could not be read,
 * and what the note says about its steps. Empty for a reopening.
 */
export interface Completion {
  next?: string;
  unreadRule?: string;
  family?: CompletionFamily;
}

/**
 * What putting a task line back did: `stale` when the written range changed
 * since, and is left alone; `rejected` when the editor refused the change.
 */
export type LineRevert<U> =
  | { kind: 'reverted' }
  | { kind: 'stale'; uri: U }
  | { kind: 'rejected'; uri: U }
  | { kind: 'failed'; uri: U; error: unknown };

/** What a write kept in the history did, with the handle its Undo works through. */
export type StepsWrite<U, H> =
  | { kind: 'written'; count: number; handle: H }
  | { kind: 'nothing' }
  | { kind: 'missing' }
  | { kind: 'stale'; uri: U }
  | { kind: 'rejected'; uri: U }
  | { kind: 'failed'; uri: U; error: unknown };

/** The lines of an editor toggled together, and where the task ranks are kept. */
export interface ToggleRequest<U> {
  /** The note, whose settings say whether a done date is written, and how. */
  uri: U;
  /** The lines the cursors are on, zero-based, top to bottom. */
  lines: readonly { line: number; text: string }[];
  /** The whole note, so a repeating task's next occurrence takes its steps. */
  documentLines: readonly string[];
  eol: string;
  now: number;
  /** The index's path for the note, when its tasks keep a rank; none for an untitled note. */
  filePath?: string;
}

/** What Toggle Task Done did: no task under the cursors, a refused edit, or the toggle. */
export type ToggleOutcome =
  | { kind: 'none' }
  | { kind: 'rejected' }
  | { kind: 'toggled'; result: ToggleResult };

/**
 * Every edit Deckard makes to a task, over the notes as the editor holds
 * them. Made once, where the extension starts; see the module comment.
 */
export class TaskService<U extends ResourceUri, H = unknown> {
  /** A service over the notes, history, settings, and clock `options` name. */
  public constructor(private readonly options: TaskServiceOptions<U, H>) {}

  /**
   * Opens an indexed task's note and checks that its line still reads as the
   * index read it, so a delayed action never overwrites an edit made since.
   */
  public async openIndexedTask(task: TaskLineTarget): Promise<OpenedTask<U>> {
    const uri = await this.options.resolveUri(task.filePath);
    if (!uri) {
      return { kind: 'missing' };
    }
    let note: NoteText;
    try {
      note = await this.options.notes.open(uri);
    } catch (error) {
      return { kind: 'unreadable', uri, error };
    }
    const line = readIndexedTaskLine(note, task);
    return line === undefined ? { kind: 'stale', uri } : { kind: 'open', uri, note, line };
  }

  /**
   * Rewrites a task's line after proving the indexed source is unchanged,
   * saves the note as Deckard's own write, and carries the task's rank to the
   * line's new id. Every edit Deckard makes to a task line goes through here.
   */
  public updateLine(
    task: Task,
    transform: (line: string, context: TaskLineContext<U>) => string,
  ): Promise<LineUpdate<U>> {
    return this.rewrite(task, (line, context) => ({ text: transform(line, context) }));
  }

  /**
   * Completes or reopens a task. Besides the checkbox, the edit keeps the
   * Obsidian Tasks metadata in step: a done date is added on completion and
   * removed on reopening, and completing a task with a repeat rule writes its
   * next occurrence on the line above, where Tasks puts it. A task reopened
   * is `[ ]`, whatever status it had.
   */
  public toggle(task: Task, completed: boolean): Promise<LineUpdate<U, Completion>> {
    return this.writeStatus(task, (statuses) => (completed ? coreStatus(statuses, 'x') : coreStatus(statuses, ' ')));
  }

  /**
   * Sets a task's status, as its character, with the dates its type keeps: a change to done is a completion,
   * next occurrence and all, and a change to cancelled writes ❌.
   */
  public setStatus(task: Task, to: TaskStatusDefinition): Promise<LineUpdate<U, Completion>> {
    return this.writeStatus(task, () => to);
  }

  /**
   * What a click on a task's box does when `deckard.tasks.checkboxClick` is
   * `workflow`: moves the task to its status's next status. Undefined when
   * its status names no next one, or the setting is `done`, so the caller
   * completes or reopens it as a click always has.
   */
  public readNextStatus(task: Task, uri?: U): TaskStatusDefinition | undefined {
    const configuration = this.options.configuration.getConfiguration('deckard', uri);
    if (configuration.get<string>('tasks.checkboxClick', 'done') !== 'workflow') {
      return undefined;
    }
    const statuses = readTaskStatusSettings(configuration);
    return nextStatus(task.status, statuses);
  }

  /** Writes the status `pick` chooses from the note's statuses, and completes the task when it becomes done. */
  private writeStatus(
    task: Task,
    pick: (statuses: readonly TaskStatusDefinition[]) => TaskStatusDefinition,
  ): Promise<LineUpdate<U, Completion>> {
    return this.rewrite<Completion>(task, (line, { uri, eol, lines, lineIndex }) => {
      const now = this.options.clock.now();
      const configuration = this.options.configuration.getConfiguration('deckard', uri);
      const statuses = readTaskStatusSettings(configuration);
      const to = pick(statuses);
      const replacement = setTaskStatus(line, task.checkboxColumn, {
        to,
        doneDate: formatIsoDate(now),
        cancelledDate: formatIsoDate(now),
        preferredFormat: readMetadataFormat(configuration),
      });
      if (to.type !== 'done' || task.completed) {
        return { text: replacement };
      }
      const completion = writeCompletion(replacement, task.checkboxColumn, {
        now,
        eol,
        steps: readStepsForNextOccurrence(lines, lineIndex),
      });
      return {
        text: completion.text,
        outcome: {
          next: completion.next,
          unreadRule: completion.unreadRule,
          family: readCompletionFamily(lines, lineIndex, completion.text, statuses),
        },
      };
    });
  }

  /**
   * Puts a task line back the way it was. The edit may have added a line,
   * such as the next occurrence of a repeating task, so the whole written
   * range goes back. Anything that has changed the range since is left alone
   * rather than overwritten.
   *
   * This is the Undo of one task edit, which the write history never kept:
   * it is written and saved directly, and not marked as Deckard's own save.
   */
  public async revertLine(written: WrittenTaskLine<U>): Promise<LineRevert<U>> {
    const { uri, lineNumber, replacement, original, filePath } = written;
    try {
      const note = await this.options.notes.open(uri);
      const range = findWrittenRange(note, lineNumber, replacement);
      if (!range || note.getText(range) !== replacement) {
        return { kind: 'stale', uri };
      }
      if (!(await this.options.notes.apply([{ uri, replacements: [{ range, text: original }] }]))) {
        return { kind: 'rejected', uri };
      }
      await this.options.notes.save(uri);
      // The line is the one it was, so the task is too: give it back the
      // place in the rank order the edit carried away.
      if (filePath) {
        this.keep(rankMoveAfterRevert(filePath, lineNumber, { original, replacement }));
      }
      return { kind: 'reverted' };
    } catch (error) {
      return { kind: 'failed', uri, error };
    }
  }

  /**
   * The open task written on a zero-based line of a note, read from the note
   * as it is now; undefined when the line no longer reads `lineText`, which
   * a line added or taken away above it would do, or holds no open task.
   * Rejects when the note cannot be read.
   */
  public async findOpenTaskAt(uri: U, filePath: string, line: number, lineText: string): Promise<Task | undefined> {
    const task = await this.findTaskAt(uri, filePath, line);
    return task && isOpenTask(task) && task.sourceLineText === lineText ? task : undefined;
  }

  /** The task on a zero-based line of a note as it is now, read with the note's statuses. */
  private async findTaskAt(uri: U, filePath: string, line: number): Promise<Task | undefined> {
    const note = await this.options.notes.open(uri);
    const taskStatuses = readTaskStatusSettings(this.options.configuration.getConfiguration('deckard', uri));
    return parseMarkdown(filePath, note.getText(), undefined, { taskStatuses }).tasks.find(
      (candidate) => candidate.lineNumber === line + 1,
    );
  }

  /**
   * Starts the next occurrence of the repeating task on a zero-based line,
   * on the line above with its steps unchecked, as completing it would: for
   * a task cancelled that is to keep repeating. `stale` when the line no
   * longer reads `text`.
   */
  public async startNextOccurrence(uri: U, filePath: string, at: { line: number; text: string }): Promise<LineUpdate<U, Completion>> {
    let task: Task | undefined;
    try {
      task = await this.findTaskAt(uri, filePath, at.line);
    } catch (error) {
      return { kind: 'failed', uri, error };
    }
    if (!task || task.sourceLineText !== at.text) {
      return { kind: 'stale', uri };
    }
    const { checkboxColumn } = task;
    return this.rewrite<Completion>(task, (line, { eol, lines, lineIndex }) => {
      const next = createNextOccurrence(line, checkboxColumn, this.options.clock.now());
      return next === undefined
        ? { text: line }
        : { text: [next, ...readStepsForNextOccurrence(lines, lineIndex), line].join(eol), outcome: { next } };
    });
  }

  /**
   * Completes the open steps written directly under the task on a zero-based
   * line, in one write that Undo takes back. `stale` when the line no longer
   * reads `lineText`, which a line added or taken away above it would do, or
   * when none of its steps is open any more; `failed` when the note cannot
   * be read or written.
   */
  public async completeSteps(
    uri: U,
    task: { line: number; lineText: string; title: string },
  ): Promise<StepsWrite<U, H>> {
    try {
      return await this.writeCompletedSteps(uri, task);
    } catch (error) {
      return { kind: 'failed', uri, error };
    }
  }

  /** {@link completeSteps}, rejecting when the note cannot be read or written. */
  private async writeCompletedSteps(
    uri: U,
    { line: taskLine, lineText, title }: { line: number; lineText: string; title: string },
  ): Promise<StepsWrite<U, H>> {
    const note = await this.options.notes.open(uri);
    const lines = note.getText().split(/\r?\n/);
    if (lines[taskLine] !== lineText) {
      return { kind: 'stale', uri };
    }
    const configuration = this.options.configuration.getConfiguration('deckard', uri);
    const statuses = readTaskStatusSettings(configuration);
    const open = findStepFamily(lines, taskLine).steps.filter((line) => !isClosedTaskLine(lines[line], statuses));
    if (open.length === 0) {
      return { kind: 'stale', uri };
    }
    const doneDate = formatIsoDate(this.options.clock.now());
    const format = readMetadataFormat(configuration);
    const replacements = open.map((line) => {
      const text = lines[line];
      return {
        range: lineRange(line, note.lineAt(line)),
        text: setTaskLineCompletion(text, findCheckboxColumn(text), {
          completed: true,
          doneDate,
          preferredFormat: format,
        }),
      };
    });
    const result = await this.options.history.write([{ uri, replacements }], {
      label: `completing ${countSteps(open.length)} of ${quoteTitle(title)}`,
    });
    return result.applied
      ? { kind: 'written', count: open.length, handle: result.handle }
      : { kind: 'rejected', uri };
  }

  /**
   * Writes steps under a task, after whatever is under it already, in one
   * write that Undo Last Change takes back too. Nothing is written for no
   * steps, or when the task's line changed since the index read it.
   */
  public async addSteps(
    target: TaskLineTarget & Pick<Task, 'title'>,
    steps: readonly string[],
  ): Promise<StepsWrite<U, H>> {
    if (steps.length === 0) {
      return { kind: 'nothing' };
    }
    const opened = await this.openIndexedTask(target);
    if (opened.kind === 'unreadable') {
      return { kind: 'failed', uri: opened.uri, error: opened.error };
    }
    if (opened.kind !== 'open') {
      return opened;
    }
    const { uri, note } = opened;
    try {
      const plan = planStepInsertion(note.getText().split(/\r?\n/), target.lineNumber - 1);
      const written = formatStepLines(steps, plan.indent, plan.marker);
      const end = { line: plan.afterLine, character: note.lineAt(plan.afterLine).length };
      const result = await this.options.history.write(
        [{ uri, replacements: [{ range: { start: end, end }, text: note.eol + written.join(note.eol) }] }],
        { label: `writing ${countSteps(steps.length)} under ${quoteTitle(target.title)}` },
      );
      return result.applied
        ? { kind: 'written', count: steps.length, handle: result.handle }
        : { kind: 'rejected', uri };
    } catch (error) {
      return { kind: 'failed', uri, error };
    }
  }

  /**
   * Completes or reopens every task among an editor's lines in one edit, so
   * one Undo takes it all back, then carries each task's rank when the note
   * has a place in the index. `apply` writes the lines into the editor.
   */
  public async toggleLines(
    request: ToggleRequest<U>,
    apply: (lines: readonly ToggledLine[]) => PromiseLike<boolean>,
  ): Promise<ToggleOutcome> {
    const configuration = this.options.configuration.getConfiguration('deckard', request.uri);
    const result = toggleTaskLines(request.lines, request.now, {
      format: readMetadataFormat(configuration),
      eol: request.eol,
      documentLines: request.documentLines,
      statuses: readTaskStatusSettings(configuration),
    });
    if (result.lines.length === 0) {
      return { kind: 'none' };
    }
    if (!(await apply(result.lines))) {
      return { kind: 'rejected' };
    }
    if (request.filePath !== undefined) {
      rankMovesAfterEdits(request.filePath, result.lines).forEach((move) => this.keep(move));
    }
    return { kind: 'toggled', result };
  }

  /** Carries a rank, when the edit left the task one to carry. */
  public keep(move: RankMove | undefined): void {
    if (move) {
      this.options.keepRank(move[0], move[1]);
    }
  }

  /** The shared path of every line rewrite; see {@link updateLine}. */
  private async rewrite<T>(
    task: Task,
    transform: (line: string, context: TaskLineContext<U>) => Rewrite<T>,
  ): Promise<LineUpdate<U, T>> {
    const opened = await this.openIndexedTask(task);
    if (opened.kind === 'unreadable') {
      return { kind: 'failed', uri: opened.uri, error: opened.error };
    }
    if (opened.kind !== 'open') {
      return opened;
    }
    const { uri, note, line } = opened;
    // Once the editor has taken the edit, a failure is only a failure to save.
    let applied = false;
    try {
      const rewritten = transform(line, {
        uri,
        eol: note.eol,
        lines: note.getText().split(/\r?\n/),
        lineIndex: task.lineNumber - 1,
      });
      const replacement = rewritten.text;
      if (replacement === line) {
        return { kind: 'unchanged' };
      }
      const range = lineRange(task.lineNumber - 1, line);
      if (!(await this.options.notes.apply([{ uri, replacements: [{ range, text: replacement }] }]))) {
        return { kind: 'rejected', uri };
      }
      applied = true;
      if (!(await this.options.notes.save(uri, (documentUri) => this.options.ownWrites.note(documentUri)))) {
        return { kind: 'unsaved', uri };
      }
      this.keep(rankMoveAfterEdit(task, replacement));
      return {
        kind: 'updated',
        written: { uri, lineNumber: task.lineNumber, replacement, original: line, filePath: task.filePath },
        ...(rewritten.outcome === undefined ? {} : { outcome: rewritten.outcome }),
      };
    } catch (error) {
      return applied ? { kind: 'unsaved', uri, error } : { kind: 'failed', uri, error };
    }
  }
}

/** A whole zero-based line, from its first character to its last. */
function lineRange(line: number, text: string): TextRange {
  return { start: { line, character: 0 }, end: { line, character: text.length } };
}

/**
 * The lines an edit wrote from one-based `lineNumber`, as many as
 * `replacement` has; undefined when the note no longer reaches that far.
 */
function findWrittenRange(note: NoteText, lineNumber: number, replacement: string): TextRange | undefined {
  const lastLine = lineNumber - 2 + replacement.split(/\r?\n/).length;
  if (lineNumber < 1 || lastLine >= note.lineCount) {
    return undefined;
  }
  return {
    start: { line: lineNumber - 1, character: 0 },
    end: { line: lastLine, character: note.lineAt(lastLine).length },
  };
}
