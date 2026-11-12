import {
  applySplices,
  blockSplice,
  dedentBlock,
  leaveBehind,
  MoveBlock,
  readMoveBlock,
  TextSplice,
} from '../domain/markdown/moveLines';
import { formatSectionLink, nestingShift, placeSection, shiftHeadings } from '../domain/notes/moveSection';
import type { NoteLinkStyle } from '../domain/markdown/wikiLinks';
import { readTaskStatusSettings } from '../domain/tasks/taskStatuses';
import { Section, Task } from '../domain/model';
import { rankMoveTo } from '../domain/tasks/taskRank';
import type { Configuration } from '../ports/configuration';
import type { EditApplier, HistoryWriter, NoteEdit, NoteText } from '../ports/editApplier';
import type { FileSystem } from '../ports/fileSystem';
import type { ResourceUri } from '../ports/uri';
import type { TaskRankKeeper } from './taskService';

/**
 * Move to…: a line, a task and its steps, a selection, or a heading and
 * everything under it, taken from where it is and put under another
 * heading, at the end of a note, into today's note, or into a new note,
 * with a link left behind.
 *
 * What moves is read again once the destination is chosen; if it changed in
 * between, nothing is written. The move is one write that Undo takes back,
 * in both notes, and a note it created is deleted again by that Undo. Which
 * destination is the reader's choice, made before the move; saying what
 * moved is the command's, after it.
 */

/** One block to move, from one note. */
export interface MoveSource<U> {
  uri: U;
  filePath: string;
  block: MoveBlock;
  /** From the index: the line must still be the task it knows. */
  task?: Task;
}

/** Where a move writes, once chosen and found again. */
export interface MoveTarget<U> {
  uri: U;
  /** What the link left behind names, without its brackets. */
  link: string;
  /** How a message names the place. */
  name: string;
  /**
   * Under a heading: its own lines, or for a section moved there, the
   * heading's lines with everything nested under it, and its level, which
   * the section's headings are nested one deeper than. Absent: the end of
   * the note.
   */
  section?: Pick<Section, 'startLine' | 'endLine'> & Partial<Pick<Section, 'headingLevel'>>;
  /**
   * A note to create, with what it starts with before the moved lines. It is
   * written in the move's line ending, whichever it is given in.
   */
  create?: string;
}

/** Where the moved lines go in a note, as Add Task places a line. */
export interface Insertion {
  line: number;
  character: number;
  text: string;
  /** The zero-based line of the first moved line once the text is inserted. */
  taskLine: number;
}

/** What the move service reads and writes through. */
export interface MoveServiceOptions<U extends ResourceUri, H> {
  notes: EditApplier<U>;
  history: HistoryWriter<U, H>;
  /** Writes, reads, and deletes a note the move creates. */
  files: Pick<FileSystem<U>, 'readFile' | 'writeFile' | 'delete'>;
  /** The `deckard` settings: what is left behind, and whether the write is previewed. */
  configuration: Configuration<U>;
  /** The index's path for a note, which the rank order is keyed by. */
  getFilePath(uri: U): string;
  keepRank: TaskRankKeeper;
  /** The note an index path names, or undefined when no folder holds it. */
  resolveUri(filePath: string): PromiseLike<U | undefined>;
  /** Where lines added to a note or a section of it go, as Add Task adds a line. */
  placeInsertion(
    content: string,
    line: string,
    section?: Pick<Section, 'startLine' | 'endLine'>,
  ): Insertion;
}

/**
 * What a move did: `moved`, with the handle its Undo works through and
 * whether it created the note; `stale` when what moves changed while the
 * destination was chosen; `failed` when the write did not land.
 */
export type MoveResult<H> =
  | { kind: 'moved'; handle: H; created: boolean }
  | { kind: 'stale' }
  | { kind: 'failed' };

/** Tasks the index knows, read as blocks to move; `stale` when one changed. */
export type TaskSources<U> =
  | { kind: 'sources'; sources: MoveSource<U>[] }
  | { kind: 'stale' };

/** A note's text, and the splices one move makes to it. */
interface NoteSplices<U> {
  uri: U;
  text: string;
  splices: TextSplice[];
}

/**
 * The sources without any whose block lies inside another's in the same
 * note, as a step's does inside its task's: taking both out would splice the
 * note twice over the same lines. Of two equal blocks, the first is kept.
 */
function dropNested<U extends ResourceUri>(sources: readonly MoveSource<U>[]): MoveSource<U>[] {
  const holds = (outer: MoveSource<U>, inner: MoveSource<U>): boolean =>
    outer.uri.toString() === inner.uri.toString() &&
    outer.block.start <= inner.block.start &&
    inner.block.end <= outer.block.end;
  return sources.filter((source, index) =>
    sources.every(
      (other, otherIndex) =>
        otherIndex === index ||
        !holds(other, source) ||
        (holds(source, other) && index < otherIndex),
    ),
  );
}

/**
 * Moves blocks of lines between notes, over the notes as the editor holds
 * them. Made once, where the extension starts; see the module comment.
 */
export class MoveService<U extends ResourceUri, H = unknown> {
  /** A service over the notes, history, files, and settings `options` name. */
  public constructor(private readonly options: MoveServiceOptions<U, H>) {}

  /**
   * Reads tasks the index knows, each with its steps, as blocks to move from
   * wherever they are written. A task whose note no folder holds is left
   * out; one whose line changed since the index read it makes the move stale.
   * A task chosen with the task it is a step of moves with that task, so it
   * is read once, as part of that task's block.
   */
  public async readTasks(tasks: readonly Task[]): Promise<TaskSources<U>> {
    const sources: MoveSource<U>[] = [];
    for (const task of tasks) {
      const uri = await this.options.resolveUri(task.filePath);
      if (!uri) {
        continue;
      }
      const note = await this.options.notes.open(uri);
      const line = task.lineNumber - 1;
      const read = readMoveBlock(note.getText().split(/\r?\n/), {
        start: { line, character: 0 },
        end: { line, character: 0 },
        isEmpty: true,
      }, readTaskStatusSettings(this.options.configuration.getConfiguration('deckard', uri)));
      if ('refused' in read || read.lines[0] !== task.sourceLineText) {
        return { kind: 'stale' };
      }
      sources.push({ uri, filePath: task.filePath, block: read, task });
    }
    return { kind: 'sources', sources: dropNested(sources) };
  }

  /**
   * Moves the sources, together and in the order given, to the target: read
   * again, taken out with a link left behind as the settings say, and put in
   * as one write. A task moved to another note keeps its place on the board.
   */
  public async move(
    sources: readonly MoveSource<U>[],
    target: MoveTarget<U>,
  ): Promise<MoveResult<H>> {
    const texts = await this.readSourcesAgain(sources);
    if (!texts) {
      return { kind: 'stale' };
    }
    const targetNote = target.create === undefined ? await this.options.notes.open(target.uri) : undefined;
    const targetText = targetNote?.getText() ?? '';
    const eol = (targetNote ? targetText : texts.get(sources[0].uri.toString()) ?? '').includes('\r\n') ? '\r\n' : '\n';
    const moved = sources.flatMap((source) => this.linesToWrite(source, target)).join(eol);

    const splicesBy = this.takeOut(sources, texts, target);
    const insertedAt = targetNote
      ? this.putIn(splicesBy, {
          note: targetNote,
          text: targetText,
          moved,
          target,
          section: sources.some((source) => source.block.section !== undefined),
        })
      : undefined;
    const edits = await this.toEdits(splicesBy);

    const created =
      target.create === undefined
        ? undefined
        : await this.create(target.uri, `${target.create.replace(/\r?\n/g, eol)}${moved}${eol}`);
    const deleteCreated = (): Promise<void> => this.deleteCreated(created);
    const write = await this.options.history.write(edits, {
      label: 'Move to…',
      description: `Moved to ${target.name}`,
      // One move the reader already chose, however many notes it touches.
      preview: 'never',
      restore: deleteCreated,
      // Undoing only the note the task left, or only the one it went to,
      // would leave it in both or in neither.
      together: true,
    });
    if (!write.applied) {
      await deleteCreated();
      return { kind: 'failed' };
    }
    if (insertedAt !== undefined && sources.every((source) => source.uri.toString() !== target.uri.toString())) {
      this.carryRanks(sources, target.uri, insertedAt);
    }
    return { kind: 'moved', handle: write.handle, created: created !== undefined };
  }

  /**
   * Each source's note as it is now, by URI, when every block is still what
   * was chosen; undefined when one changed.
   */
  private async readSourcesAgain(sources: readonly MoveSource<U>[]): Promise<Map<string, string> | undefined> {
    const texts = new Map<string, string>();
    for (const source of sources) {
      const text = (await this.options.notes.open(source.uri)).getText();
      texts.set(source.uri.toString(), text);
      const now = text.split(/\r?\n/).slice(source.block.start, source.block.end + 1);
      if (
        now.join('\n') !== source.block.lines.join('\n') ||
        (source.task && now[0] !== source.task.sourceLineText)
      ) {
        return undefined;
      }
    }
    return texts;
  }

  /**
   * A block's lines as the target holds them: a section's with its headings
   * nested under the target's heading, or kept at their levels at the end of
   * a note; anything else dedented to the first line's indentation.
   */
  private linesToWrite(source: MoveSource<U>, target: MoveTarget<U>): string[] {
    const section = source.block.section;
    if (!section) {
      return dedentBlock(source.block.lines);
    }
    const under = target.section?.headingLevel;
    return shiftHeadings(source.block.lines, under === undefined ? 0 : nestingShift(section.level, under));
  }

  /**
   * What a block leaves where it was: for a section, one line linking to its
   * heading in the target, in `deckard.links.style`; for anything else, what
   * leaveBehind says, linking to the target as `link` names it.
   */
  private leftBehind(source: MoveSource<U>, lines: readonly string[], target: MoveTarget<U>): string[] {
    if (!source.block.section) {
      return leaveBehind(source.block, lines, target.link);
    }
    const style = this.options.configuration
      .getConfiguration('deckard', source.uri)
      .get<NoteLinkStyle>('links.style', 'wiki');
    return [
      formatSectionLink({
        heading: source.block.section.heading,
        sourcePath: source.filePath,
        targetPath: this.options.getFilePath(target.uri),
        style: style === 'markdown' ? 'markdown' : 'wiki',
      }),
    ];
  }

  /** The splice that takes each block out of its note, leaving a link to where it went. */
  private takeOut(
    sources: readonly MoveSource<U>[],
    texts: ReadonlyMap<string, string>,
    target: MoveTarget<U>,
  ): Map<string, NoteSplices<U>> {
    const splicesBy = new Map<string, NoteSplices<U>>();
    for (const source of sources) {
      const key = source.uri.toString();
      const text = texts.get(key) ?? '';
      const lines = text.split(/\r?\n/);
      const entry = splicesBy.get(key) ?? { uri: source.uri, text, splices: [] };
      entry.splices.push(blockSplice(text, source.block, this.leftBehind(source, lines, target)));
      splicesBy.set(key, entry);
    }
    return splicesBy;
  }

  /**
   * Adds the splice that puts the moved lines into the target note, where
   * Add Task would put a line, or a section at the end of the target's, and
   * returns the zero-based line they start on.
   */
  private putIn(
    splicesBy: Map<string, NoteSplices<U>>,
    into: { note: NoteText; text: string; moved: string; target: MoveTarget<U>; section: boolean },
  ): number {
    const insertion = into.section
      ? placeSection(into.text, into.moved, into.target.section)
      : this.options.placeInsertion(into.text, into.moved, into.target.section);
    const offset = into.note.offsetAt({ line: insertion.line, character: insertion.character });
    const key = into.target.uri.toString();
    const entry = splicesBy.get(key) ?? { uri: into.target.uri, text: into.text, splices: [] };
    entry.splices.push({ start: offset, end: offset, text: insertion.text });
    splicesBy.set(key, entry);
    return insertion.taskLine;
  }

  /**
   * Each note as one whole replace, so a take and a put in the same note can
   * never overlap.
   */
  private async toEdits(splicesBy: ReadonlyMap<string, NoteSplices<U>>): Promise<NoteEdit<U>[]> {
    const edits: NoteEdit<U>[] = [];
    for (const entry of splicesBy.values()) {
      const note = await this.options.notes.open(entry.uri);
      edits.push({
        uri: entry.uri,
        replacements: [
          {
            range: { start: note.positionAt(0), end: note.positionAt(entry.text.length) },
            text: applySplices(entry.text, entry.splices),
          },
        ],
      });
    }
    return edits;
  }

  /** Writes the new note the move goes into, and remembers what it wrote. */
  private async create(uri: U, text: string): Promise<{ uri: U; text: string }> {
    await this.options.files.writeFile(uri, new TextEncoder().encode(text));
    return { uri, text };
  }

  /** Deletes the note the move created, unless it has changed since or is gone. */
  private async deleteCreated(created: { uri: U; text: string } | undefined): Promise<void> {
    if (!created) {
      return;
    }
    try {
      const now = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await this.options.files.readFile(created.uri));
      if (now === created.text) {
        await this.options.files.delete(created.uri);
      }
    } catch {
      // Already gone.
    }
  }

  /** Each moved task's rank, carried to the line it now starts on in the target. */
  private carryRanks(sources: readonly MoveSource<U>[], targetUri: U, insertedAt: number): void {
    const targetPath = this.options.getFilePath(targetUri);
    let line = insertedAt;
    for (const source of sources) {
      const first = dedentBlock(source.block.lines)[0];
      const move = source.task
        ? rankMoveTo(source.task.id, { filePath: targetPath, lineNumber: line + 1, lineText: first })
        : undefined;
      if (move) {
        this.options.keepRank(move[0], move[1]);
      }
      line += source.block.lines.length;
    }
  }
}
