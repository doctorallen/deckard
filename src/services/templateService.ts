import { fillTemplate, getTemplateVariables } from '../domain/notes/templates';
import type { Clock } from '../ports/clock';
import type { FileSystem } from '../ports/fileSystem';
import type { ResourceUri } from '../ports/uri';

/**
 * Creating a note from a template: filling the template in and writing the
 * note, never over one that is already there. The command chooses the
 * template, the title, and the answers; this makes the note.
 */

/** What TemplateService works through. */
export interface TemplateCollaborators<U extends ResourceUri> {
  files: Pick<FileSystem<U>, 'joinPath' | 'stat' | 'createDirectory' | 'writeFile'>;
  /** Whether Deckard indexes a note, so a note made where it does not look can be said so. */
  index: { isNotesFile(uri: U): boolean };
  /** The moment `{date}` and `{time}` are filled with. */
  clock: Clock;
}

/** One note to make: from which template, called what, where, and with which answers. */
export interface TemplateNoteRequest<U extends ResourceUri> {
  /** The template's text. */
  template: string;
  /** The note's file name, `.md` included. */
  fileName: string;
  /** The answers to the template's `{ask:…}` questions, by question. */
  answers: ReadonlyMap<string, string>;
  /** The folder the note is written in, created when it is missing. */
  folder: U;
}

/**
 * What creating a note came to. `exists` wrote nothing, since a note is
 * never overwritten; `created` says whether Deckard indexes where it went.
 */
export type TemplateNoteResult<U extends ResourceUri> =
  | { kind: 'exists'; uri: U }
  | { kind: 'created'; uri: U; indexed: boolean };

/**
 * Makes notes from templates. One is made where the extension starts; it
 * holds nothing between notes.
 */
export class TemplateService<U extends ResourceUri> {
  /** Takes the file system it writes through, the index, and the clock. */
  public constructor(private readonly collaborators: TemplateCollaborators<U>) {}

  /**
   * Fills the template, with `{title}` the file name without `.md`, and
   * writes it as a new note, unless something is already at that name.
   */
  public async createNote(request: TemplateNoteRequest<U>): Promise<TemplateNoteResult<U>> {
    const { files, index, clock } = this.collaborators;
    const uri = files.joinPath(request.folder, request.fileName);
    if (await this.exists(uri)) {
      return { kind: 'exists', uri };
    }
    const content = fillTemplate(
      request.template,
      getTemplateVariables(request.fileName.replace(/\.md$/i, ''), new Date(clock.now())),
      request.answers,
    );
    await files.createDirectory(request.folder);
    await files.writeFile(uri, new TextEncoder().encode(content));
    return { kind: 'created', uri, indexed: index.isNotesFile(uri) };
  }

  /**
   * Whether anything is at `uri`. Any failure to stat it counts as nothing
   * there: the question is only asked to refuse to overwrite.
   */
  private async exists(uri: U): Promise<boolean> {
    try {
      await this.collaborators.files.stat(uri);
      return true;
    } catch {
      return false;
    }
  }
}
