import {
  HeadingRename,
  LinkRewrite,
  countRewrittenNotes,
  findHeadingTextColumns,
  planHeadingRenameRewrites,
  planNoteRenameRewrites,
  rewriteStillFits,
} from '../domain/links/linkRewrites';
import { getExtractedNoteFileName } from '../domain/markdown/noteNames';
import type { ParsedFile, Section, WorkspaceIndex } from '../domain/model';
import type { FileSystem } from '../ports/fileSystem';
import type { ResourceUri } from '../ports/uri';
import { measure } from '../shared/timing';

/**
 * Keeping `[[links]]` whole: the links a note or heading rename carries
 * along, the mentions of a note turned into links to it, and the notes a
 * link names made, or a heading taken out into one.
 *
 * The services decide which links, which notes, and in what order; they
 * read the notes and the disk through the collaborators they are given, and
 * return what to write, so the commands only ask and report.
 */

/** Where the notes are read as they stand now, open or on disk. */
export interface LiveNotes<U> {
  /** The URI a note's index path names, or undefined when no file has it. */
  uriOf(filePath: string): PromiseLike<U | undefined>;
  /**
   * The note's text now, the editor's copy when it is open. Rejects when it
   * cannot be opened.
   */
  read(uri: U): PromiseLike<string>;
}

/** One replacement on one line of a note, at the URI it is written at. */
export interface NoteEdit<U> {
  uri: U;
  /** Zero-based line, and the columns the text replaces. */
  line: number;
  startColumn: number;
  endColumn: number;
  text: string;
}

/** The planned rewrites that still fit their notes, as the edits that make them. */
export interface CheckedRewrites<U> {
  edits: NoteEdit<U>[];
  /** The rewrites the edits make, in the same order. */
  applied: LinkRewrite[];
}

/** A note leaving one title for another, by its index path. */
export interface NoteRename {
  fromPath: string;
  toTitle: string;
}

/** The link rewrites that follow a set of note renames. */
export interface NoteRenamePlan<U> {
  edits: NoteEdit<U>[];
  /** How many links the edits rewrite, and in how many notes. */
  rewritten: number;
  notes: number;
}

/**
 * The rename of the heading a note's cursor sits in: the index the heading
 * was found in, the note, the heading's line and text now, and its new text.
 */
export interface HeadingRenameRequest<U> {
  index: WorkspaceIndex;
  filePath: string;
  /** The note's URI, where the heading edit and its own links are written. */
  uri: U;
  /** The note's text now, as its editor holds it. */
  text: string;
  section: Pick<Section, 'startLine'>;
  /** The heading as it reads now, and as it is to read, both trimmed. */
  from: string;
  to: string;
}

/**
 * What a heading rename writes: the heading line and every link to it, as
 * one set of edits, or nothing when the heading's line has no `#` marks.
 */
export type HeadingRenamePlan<U> =
  | { kind: 'planned'; edits: NoteEdit<U>[] }
  | { kind: 'no-heading-line' };

/** A mention of a note, written without a link, as the lenses find one. */
export interface Mention {
  filePath: string;
  /** Zero-based line, and the columns of the name as written. */
  line: number;
  startColumn: number;
  endColumn: number;
  /** The name as written, which the link keeps. */
  text: string;
}

/**
 * Linking a note's mentions: the edits, or none left to link. `skipped`
 * counts the notes with a mention that could not be opened, which are left
 * as they are.
 */
export type MentionLinkPlan<U> =
  | { kind: 'planned'; edits: NoteEdit<U>[]; skipped: number }
  | { kind: 'none'; skipped: number };

/** What LinkService reads: the index, the live notes, and the mention finder. */
export interface LinkServiceOptions<U> {
  index: { getSnapshot(): WorkspaceIndex };
  notes: LiveNotes<U>;
  findUnlinkedMentions(file: ParsedFile, index: WorkspaceIndex): readonly Mention[];
}

/**
 * Link maintenance and mentions: which links a rename carries along, and
 * which mentions become links, checked against each note as it is now.
 */
export class LinkService<U extends ResourceUri> {
  /** Reads the index, the notes, and their mentions through `options`. */
  public constructor(private readonly options: LinkServiceOptions<U>) {}

  /**
   * The edits that keep links pointing at notes being renamed. `openText` is
   * a note's text in an open editor, which wins over the indexed text; a
   * rename of a note the index does not have is passed over.
   */
  public async planNoteRenames(
    renames: readonly NoteRename[],
    openText: (filePath: string) => string | undefined,
  ): Promise<NoteRenamePlan<U>> {
    const index = this.options.index.getSnapshot();
    const plan: NoteRenamePlan<U> = { edits: [], rewritten: 0, notes: 0 };
    const contentOf = (filePath: string): string | undefined => {
      const file = index.files.get(filePath);
      return file ? (openText(filePath) ?? file.content) : undefined;
    };
    for (const { fromPath, toTitle } of renames) {
      if (!index.files.has(fromPath)) {
        continue;
      }
      const rewrites = measure(
        'Plan rename link rewrites',
        () => planNoteRenameRewrites(index, fromPath, toTitle, contentOf),
        (planned) => `${planned.length} links, ${index.files.size} notes`,
      );
      // The edit is applied before the file moves, so every rewrite names
      // the note where it is now, the renamed note included.
      const { edits, applied } = await checkRewrites(this.options.notes, rewrites);
      plan.edits.push(...edits);
      plan.rewritten += applied.length;
      plan.notes += countRewrittenNotes(applied);
    }
    return plan;
  }

  /**
   * The heading's new text and every `[[Note#Heading]]` link to it, as one
   * set of edits, so the preview shows all of it and one Undo takes all of
   * it back. The links are found in the index the heading was found in,
   * with the renamed note read as its editor holds it.
   */
  public async planHeadingRename(
    request: HeadingRenameRequest<U>,
  ): Promise<HeadingRenamePlan<U>> {
    const { index, filePath, uri, text } = request;
    const rename: HeadingRename = { filePath, startLine: request.section.startLine, from: request.from, to: request.to };
    const rewrites = planHeadingRenameRewrites(index, rename, (path) =>
      path === filePath ? text : index.files.get(path)?.content,
    );
    const headingLine = request.section.startLine - 1;
    const columns = findHeadingTextColumns(text.split(/\r?\n/)[headingLine] ?? '');
    if (!columns) {
      return { kind: 'no-heading-line' };
    }
    const edits: NoteEdit<U>[] = [{ uri, line: headingLine, ...columns, text: request.to }];
    const checked = await checkRewrites(this.options.notes, rewrites);
    const renamed = uri.toString();
    edits.push(...checked.edits.filter((edit) => edit.uri.toString() !== renamed));
    // A link inside the note being renamed sits in the same document as the
    // heading edit, so it goes in only where it cannot overlap it.
    edits.push(
      ...checked.applied
        .filter((rewrite) => rewrite.filePath === filePath && rewrite.line !== headingLine)
        .map((rewrite) => toEdit(uri, rewrite)),
    );
    return { kind: 'planned', edits };
  }

  /**
   * The edits that turn every unlinked mention of a note into a `[[link]]`
   * to it, keeping the name as it was written. The mentions are found again
   * from the index, and each is compared with what its line says now, so a
   * mention edited since the index read it is left alone. A note that
   * cannot be opened is passed over and counted, as a link rewrite passes
   * one over, so the rest are still linked.
   */
  public async planMentionLinks(file: ParsedFile): Promise<MentionLinkPlan<U>> {
    const mentions = this.options.findUnlinkedMentions(file, this.options.index.getSnapshot());
    const edits: NoteEdit<U>[] = [];
    const notes = new Map<string, { uri: U; lines: string[] } | 'missing' | 'unreadable'>();
    for (const mention of mentions) {
      if (!notes.has(mention.filePath)) {
        notes.set(mention.filePath, await this.readLines(mention.filePath));
      }
      const note = notes.get(mention.filePath);
      if (typeof note !== 'object' || !rewriteStillFits({ ...mention, from: mention.text }, note.lines)) {
        continue;
      }
      edits.push({ ...toEdit(note.uri, mention), text: `[[${mention.text}]]` });
    }
    const skipped = [...notes.values()].filter((note) => note === 'unreadable').length;
    return edits.length === 0 ? { kind: 'none', skipped } : { kind: 'planned', edits, skipped };
  }

  /**
   * A note's URI and its lines now; `missing` when no file has its path,
   * which is not worth saying, and `unreadable` when it cannot be opened.
   */
  private async readLines(filePath: string): Promise<{ uri: U; lines: string[] } | 'missing' | 'unreadable'> {
    try {
      const uri = await this.options.notes.uriOf(filePath);
      if (!uri) {
        return 'missing';
      }
      return { uri, lines: (await this.options.notes.read(uri)).split(/\r?\n/) };
    } catch {
      return 'unreadable';
    }
  }
}

/**
 * The planned rewrites that still fit their notes, read as each stands now
 * rather than as it was indexed, as the edits that make them. A note that
 * cannot be found or opened is passed over, and so is a line that no longer
 * holds the link that was planned, so an edit made between planning and
 * applying is never overwritten.
 */
export async function checkRewrites<U>(
  notes: LiveNotes<U>,
  rewrites: readonly LinkRewrite[],
): Promise<CheckedRewrites<U>> {
  const checked: CheckedRewrites<U> = { edits: [], applied: [] };
  const byFile = new Map<string, LinkRewrite[]>();
  rewrites.forEach((rewrite) => {
    byFile.set(rewrite.filePath, [...(byFile.get(rewrite.filePath) ?? []), rewrite]);
  });

  for (const [filePath, fileRewrites] of byFile) {
    const uri = await notes.uriOf(filePath);
    if (!uri) {
      continue;
    }
    let text: string;
    try {
      text = await notes.read(uri);
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (const rewrite of fileRewrites.filter((each) => rewriteStillFits(each, lines))) {
      checked.edits.push(toEdit(uri, rewrite));
      checked.applied.push(rewrite);
    }
  }
  return checked;
}

/** The edit that writes a rewrite's text over the columns it replaces. */
function toEdit<U>(
  uri: U,
  span: Pick<LinkRewrite, 'line' | 'startColumn' | 'endColumn' | 'text'>,
): NoteEdit<U> {
  return {
    uri,
    line: span.line,
    startColumn: span.startColumn,
    endColumn: span.endColumn,
    text: span.text,
  };
}

/** The part of the file system that making a note for a link needs. */
export type NoteFiles<U extends ResourceUri> = Pick<
  FileSystem<U>,
  'joinPath' | 'stat' | 'createDirectory' | 'writeFile' | 'delete'
>;

/** What asking for a note by a link's name came to. */
export type CreatedNote<U> =
  | { kind: 'created'; uri: U }
  /** A note with that file name was already there, and is kept as it is. */
  | { kind: 'kept'; uri: U }
  | { kind: 'invalid-name' };

/**
 * What became of the source note of an extraction: the link is in and
 * saved; nothing changed (the edit was refused, or rolled back); or the link
 * is in its editor but could not be saved or taken back, so the heading is
 * still in its file.
 */
export type ReplaceOutcome = 'replaced' | 'unchanged' | 'half';

/** Swaps an extracted section for its link in the source note. */
export type SectionReplacer<U> = (
  sourceUri: U,
  section: Section,
  link: string,
  noteUri: U,
) => Promise<ReplaceOutcome>;

/** A heading to take out into a note of its own, and where the note goes. */
export interface Extraction<U> {
  section: Section;
  sourceUri: U;
  notesFolderUri: U;
  name: string;
}

/**
 * What an extraction came to. A tagged line is not a heading, and a name
 * that cannot be a file name makes no note; either is refused with nothing
 * written.
 */
export type ExtractionResult<U> =
  | { kind: 'extracted'; noteUri: U }
  | { kind: 'refused'; reason: 'inline' | 'invalid-name' }
  | { kind: 'exists'; fileName: string; noteUri: U }
  /** The source is as it was, so the new note, the only trace, was deleted. */
  | { kind: 'unchanged' }
  /** The heading is in both notes until the reader decides; see extractHeading. */
  | { kind: 'half' };

/**
 * The notes links name: creating one for a link that names none, and
 * taking a heading out into a note of its own.
 */
export class LinkNoteService<U extends ResourceUri> {
  /** Makes and removes notes through `files`. */
  public constructor(private readonly files: NoteFiles<U>) {}

  /**
   * Creates a note for a link's name in a notes folder, titled with the
   * name, unless a note with that file name is already there.
   */
  public async createNoteNamed(notesFolderUri: U, name: string): Promise<CreatedNote<U>> {
    const fileName = getExtractedNoteFileName(name);
    if (!fileName) {
      return { kind: 'invalid-name' };
    }
    const noteUri = this.files.joinPath(notesFolderUri, fileName);
    if (await this.exists(noteUri)) {
      return { kind: 'kept', uri: noteUri };
    }
    await this.files.createDirectory(notesFolderUri);
    await this.files.writeFile(noteUri, encode(`# ${name}\n\n`));
    return { kind: 'created', uri: noteUri };
  }

  /**
   * Creates a note for each name that could be a file name and has none
   * there yet, leaving any note already there as it is. Returns how many it
   * made.
   */
  public async createMissingNotes(notesFolderUri: U, names: readonly string[]): Promise<number> {
    let created = 0;
    for (const name of names) {
      const fileName = getExtractedNoteFileName(name);
      if (!fileName || (await this.exists(this.files.joinPath(notesFolderUri, fileName)))) {
        continue;
      }
      if ((await this.createNoteNamed(notesFolderUri, name)).kind !== 'invalid-name') {
        created += 1;
      }
    }
    return created;
  }

  /**
   * Writes a heading's section into a new note and swaps it for a link to
   * that note through `replace`, which makes the write to the source and
   * reports its own failures. A note already at the name is never
   * overwritten.
   *
   * When the source is left unchanged the new note is deleted, since it is
   * the only trace; when the swap is only half made it is kept, since the
   * source's file on disk would then be the only other copy of the heading.
   */
  public async extractHeading(
    extraction: Extraction<U>,
    replace: SectionReplacer<U>,
  ): Promise<ExtractionResult<U>> {
    const { section, sourceUri, notesFolderUri } = extraction;
    if (section.isInline) {
      return { kind: 'refused', reason: 'inline' };
    }
    const fileName = getExtractedNoteFileName(extraction.name);
    if (!fileName) {
      return { kind: 'refused', reason: 'invalid-name' };
    }

    const noteUri = this.files.joinPath(notesFolderUri, fileName);
    await this.files.createDirectory(notesFolderUri);
    if (await this.exists(noteUri)) {
      return { kind: 'exists', fileName, noteUri };
    }
    await this.files.writeFile(noteUri, encode(section.rawContent));

    // Wiki links resolve against the file name, so the link names the new file.
    const link = `[[${fileName.slice(0, -'.md'.length)}]]`;
    const replaced = await replace(sourceUri, section, link, noteUri);
    if (replaced === 'unchanged') {
      try {
        await this.files.delete(noteUri);
      } catch {
        // A note that cannot be deleted is left; the source is unchanged.
      }
      return { kind: 'unchanged' };
    }
    if (replaced === 'half') {
      return { kind: 'half' };
    }
    return { kind: 'extracted', noteUri };
  }

  /** Whether anything is at `uri`; a failure to stat it counts as nothing. */
  private async exists(uri: U): Promise<boolean> {
    try {
      await this.files.stat(uri);
      return true;
    } catch {
      return false;
    }
  }
}

/** A note's text as the bytes it is written as. */
function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
