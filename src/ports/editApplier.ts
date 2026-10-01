import type { ResourceUri } from './uri';

/**
 * Editing notes as the editor holds them, open on screen or not: reading a
 * note's current text, replacing ranges of it, and saving it, as
 * `workspace.openTextDocument`, `workspace.applyEdit`, and `TextDocument.save`
 * do; and a write kept in Deckard's write history, which Undo can take back.
 *
 * A note is read through the editor rather than from disk, so an unsaved
 * change in an open note is what an edit is checked against and written
 * over, as the reader sees it.
 */

/** A place in a note: a zero-based line, and a character on it. */
export interface TextPosition {
  readonly line: number;
  readonly character: number;
}

/** The text between two positions of a note; an empty range is a point. */
export interface TextRange {
  readonly start: TextPosition;
  readonly end: TextPosition;
}

/** Text written over a range; over an empty range, it is inserted there. */
export interface TextReplacement {
  readonly range: TextRange;
  readonly text: string;
}

/** The replacements one change makes to one note, in the order given. */
export interface NoteEdit<U extends ResourceUri = ResourceUri> {
  readonly uri: U;
  readonly replacements: readonly TextReplacement[];
}

/**
 * A note as the editor holds it now. It is live: read again after an edit,
 * it has the edit in it.
 */
export interface NoteText {
  /** The note's line ending, for an edit that adds a line. */
  readonly eol: '\n' | '\r\n';
  readonly lineCount: number;
  /** The words of a zero-based line, without its line ending. */
  lineAt(line: number): string;
  /** The whole note, or what `range` covers of it. */
  getText(range?: TextRange): string;
  /** How far into the note's text a position is, in characters. */
  offsetAt(position: TextPosition): number;
  /** The position an offset into the note's text falls at. */
  positionAt(offset: number): TextPosition;
}

/** Reading, changing, and saving notes through the editor. */
export interface EditApplier<U extends ResourceUri = ResourceUri> {
  /** The note, opened without being shown. Rejects when it cannot be read. */
  open(uri: U): PromiseLike<NoteText>;
  /**
   * Makes every edit as one change, left unsaved. Settles with whether the
   * editor took it; a refused change writes nothing.
   */
  apply(edits: readonly NoteEdit<U>[]): PromiseLike<boolean>;
  /**
   * Saves the note, through its open editor when it has one. `beforeSave`
   * hears the text form of the saved document's own URI just before it is
   * saved. Settles with whether it was saved.
   */
  save(uri: U, beforeSave?: (documentUri: string) => void): PromiseLike<boolean>;
}

/** When a write is shown in the refactor preview before it lands. */
export type WritePreview = 'always' | 'severalNotes' | 'never';

/** How a write is named, shown, and taken back. */
export interface HistoryWriteOptions {
  /** What the write is, in the preview's heading and the Undo prompt. */
  label: string;
  /** What each changed note's row says in the preview. */
  description?: string;
  preview?: WritePreview;
  /** Puts back what the write changed outside the notes, on an Undo. */
  restore?: () => Promise<void>;
}

/** Whether a write landed, and when it did, the handle its Undo works through. */
export type HistoryWriteResult<H> =
  | { readonly applied: false }
  | { readonly applied: true; readonly handle: H };

/**
 * Writes kept in Deckard's write history: saved once they land, and taken
 * back by Undo. `H` is the handle the history returns for a write, which a
 * service hands back to its command for the Undo button.
 */
export interface HistoryWriter<U extends ResourceUri = ResourceUri, H = unknown> {
  write(edits: readonly NoteEdit<U>[], options: HistoryWriteOptions): PromiseLike<HistoryWriteResult<H>>;
}
