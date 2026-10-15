import { formatIsoDate } from '../domain/markdown/calendar';
import { formatAnswerLine, type AnswerText } from '../domain/markdown/questionLines';
import { planStepInsertion } from '../domain/markdown/taskSteps';
import type { Question } from '../domain/model';
import { readMetadataFormat } from '../domain/tasks/taskLines';
import { setTaskStatus } from '../domain/tasks/statusWrites';
import { readTaskStatusSettings } from '../domain/tasks/taskStatuses';
import type { Clock } from '../ports/clock';
import type { Configuration } from '../ports/configuration';
import type { EditApplier, HistoryWriter, NoteText } from '../ports/editApplier';
import type { ResourceUri } from '../ports/uri';

/**
 * Every edit Deckard makes to a question: writing its answer under it, and
 * dropping it (docs/implementation/38-questions.md). Each is one write that
 * Undo Last Change takes back, made only while the question's line still
 * reads as the index read it.
 */

/** What finds a question's line and checks it. */
export type QuestionTarget = Pick<Question, 'filePath' | 'lineNumber' | 'sourceLineText' | 'checkboxColumn' | 'symbol' | 'title'>;

/** What writing to a question did, with the handle its Undo works through. */
export type QuestionWrite<U, H> =
  | { kind: 'written'; handle: H }
  | { kind: 'missing' }
  | { kind: 'stale'; uri: U }
  | { kind: 'rejected'; uri: U }
  | { kind: 'failed'; uri: U; error: unknown };

/** What the question service reads and writes through. */
export interface QuestionServiceOptions<U extends ResourceUri, H> {
  /** The notes, as the editor holds them. */
  notes: EditApplier<U>;
  /** Writes that Undo Last Change can take back, and their handles. */
  history: HistoryWriter<U, H>;
  /** The note an index path names, or undefined when no folder holds it. */
  resolveUri(filePath: string): PromiseLike<U | undefined>;
  /** The `deckard` settings, read as they apply to the note being edited. */
  configuration: Configuration<U>;
  clock: Clock;
}

/** A question's note, opened, with its line as the index read it; or why it could not be. */
type OpenedQuestion<U> =
  | { kind: 'open'; uri: U; note: NoteText }
  | { kind: 'missing' }
  | { kind: 'stale'; uri: U }
  | { kind: 'failed'; uri: U; error: unknown };

/** A question as the start of a sentence: its words, cut to fit, in quotes. */
function quoteQuestion(question: Pick<Question, 'title'>): string {
  const words = question.title.trim();
  return `“${words.length > 48 ? `${words.slice(0, 47)}…` : words}”`;
}

/** Edits to questions, over the notes, history, settings, and clock `options` name. */
export class QuestionService<U extends ResourceUri, H = unknown> {
  /** A service over the notes, history, settings, and clock `options` name. */
  public constructor(private readonly options: QuestionServiceOptions<U, H>) {}

  /**
   * Writes an answer under a question, after whatever is under it already,
   * indented as the note nests its lists, ending with today's date.
   */
  public async answer(question: QuestionTarget, answer: Omit<AnswerText, 'date'>): Promise<QuestionWrite<U, H>> {
    const opened = await this.open(question);
    if (opened.kind !== 'open') {
      return opened;
    }
    const { uri, note } = opened;
    try {
      const plan = planStepInsertion(note.getText().split(/\r?\n/), question.lineNumber - 1);
      const line = formatAnswerLine({ ...answer, date: formatIsoDate(this.options.clock.now()) }, plan.indent, plan.marker);
      const end = { line: plan.afterLine, character: note.lineAt(plan.afterLine).length };
      const result = await this.options.history.write(
        [{ uri, replacements: [{ range: { start: end, end }, text: `${note.eol}${line}` }] }],
        { label: `answering ${quoteQuestion(question)}` },
      );
      return result.applied ? { kind: 'written', handle: result.handle } : { kind: 'rejected', uri };
    } catch (error) {
      return { kind: 'failed', uri, error };
    }
  }

  /**
   * Drops a question: its box becomes the cancelled status's, `[?]`
   * becoming `[-]`, with the cancelled date a cancelled task has.
   */
  public async drop(question: QuestionTarget): Promise<QuestionWrite<U, H>> {
    const opened = await this.open(question);
    if (opened.kind !== 'open') {
      return opened;
    }
    const { uri, note } = opened;
    try {
      const configuration = this.options.configuration.getConfiguration('deckard', uri);
      const cancelled = readTaskStatusSettings(configuration).find((status) => status.type === 'cancelled') ?? {
        symbol: '-',
        name: 'Cancelled',
        type: 'cancelled' as const,
      };
      const line = note.lineAt(question.lineNumber - 1);
      const dropped = setTaskStatus(line, question.checkboxColumn, {
        to: cancelled,
        cancelledDate: formatIsoDate(this.options.clock.now()),
        preferredFormat: readMetadataFormat(configuration),
      });
      const range = { start: { line: question.lineNumber - 1, character: 0 }, end: { line: question.lineNumber - 1, character: line.length } };
      const result = await this.options.history.write([{ uri, replacements: [{ range, text: dropped }] }], {
        label: `dropping ${quoteQuestion(question)}`,
      });
      return result.applied ? { kind: 'written', handle: result.handle } : { kind: 'rejected', uri };
    } catch (error) {
      return { kind: 'failed', uri, error };
    }
  }

  /** Opens a question's note, and checks its line still reads as the index read it, its box where it was. */
  private async open(question: QuestionTarget): Promise<OpenedQuestion<U>> {
    const uri = await this.options.resolveUri(question.filePath);
    if (!uri) {
      return { kind: 'missing' };
    }
    let note: NoteText;
    try {
      note = await this.options.notes.open(uri);
    } catch (error) {
      return { kind: 'failed', uri, error };
    }
    const at = question.lineNumber - 1;
    const line = at >= 0 && at < note.lineCount ? note.lineAt(at) : undefined;
    const column = question.checkboxColumn;
    return line === question.sourceLineText && line[column - 1] === '[' && line[column] === question.symbol && line[column + 1] === ']'
      ? { kind: 'open', uri, note }
      : { kind: 'stale', uri };
  }
}
