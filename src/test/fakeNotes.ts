// Notes in memory for the services' suites: an editor that opens, edits,
// and saves them as VS Code's does for the parts the services use, and a
// write history that records each write, so those suites run under plain
// mocha.
import type {
  EditApplier,
  HistoryWriteOptions,
  HistoryWriter,
  HistoryWriteResult,
  NoteEdit,
  NoteText,
  TextPosition,
  TextRange,
} from '../ports/editApplier';
import type { ResourceUri } from '../ports/uri';
import { fileUri } from './fakeWorkspace';

/**
 * One URI per path for every fake here, so a URI a service hands back is the
 * very one a suite compares it with.
 */
const uris = new Map<string, ResourceUri>();

/** The URI of the note at `path`, the same object each time. */
export function noteUri(path: string): ResourceUri {
  const known = uris.get(path) ?? fileUri(path);
  uris.set(path, known);
  return known;
}

/** A note's text as the editor would hold it, read live from `read`. */
function noteText(read: () => string): NoteText {
  const lines = (): string[] => read().split(/\r?\n/);
  const eolLength = (): number => (read().includes('\r\n') ? 2 : 1);
  const offsetAt = (position: TextPosition): number => {
    const all = lines();
    let offset = 0;
    for (let line = 0; line < position.line && line < all.length; line += 1) {
      offset += all[line].length + eolLength();
    }
    return offset + position.character;
  };
  return {
    get eol() {
      return read().includes('\r\n') ? '\r\n' : '\n';
    },
    get lineCount() {
      return lines().length;
    },
    lineAt: (line) => {
      const all = lines();
      if (line < 0 || line >= all.length) {
        throw new Error(`Illegal value for line: ${line}`);
      }
      return all[line];
    },
    getText: (range) => (range ? read().slice(offsetAt(range.start), offsetAt(range.end)) : read()),
    offsetAt,
    positionAt: (offset) => {
      const all = lines();
      let left = offset;
      for (let line = 0; line < all.length; line += 1) {
        if (left <= all[line].length) {
          return { line, character: left };
        }
        left -= all[line].length + eolLength();
      }
      return { line: all.length - 1, character: all[all.length - 1].length };
    },
  };
}

/** A replacement's range as offsets into `text`. */
function offsets(note: NoteText, range: TextRange): [number, number] {
  return [note.offsetAt(range.start), note.offsetAt(range.end)];
}

/**
 * Notes by their URI's text form. `apply` makes every replacement, later
 * ones first so offsets hold, and each note starts saved; `save` records it.
 * `refuse`, `failOpen`, and `failSave` make the next such call refuse or
 * throw, so a suite can reach each outcome.
 */
export class FakeNotes implements EditApplier<ResourceUri> {
  public readonly texts = new Map<string, string>();
  /** Every note saved, by URI, in order. */
  public readonly saved: string[] = [];
  public refuse = false;
  public failOpen: Error | undefined;
  public failSave: Error | 'refuse' | undefined;

  /** Starts with `notes`, keyed by path. */
  public constructor(notes: Record<string, string> = {}) {
    Object.entries(notes).forEach(([path, text]) => this.texts.set(noteUri(path).toString(), text));
  }

  /** The note at `path`, as a URI the fakes agree on. */
  public uri(path: string): ResourceUri {
    return noteUri(path);
  }

  /** What the note at `path` says now. */
  public text(path: string): string | undefined {
    return this.texts.get(noteUri(path).toString());
  }

  /** The note, live; rejects for `failOpen` or a note there is none of. */
  public async open(uri: ResourceUri): Promise<NoteText> {
    if (this.failOpen) {
      throw this.failOpen;
    }
    const key = uri.toString();
    if (!this.texts.has(key)) {
      throw new Error(`cannot open ${key}`);
    }
    return noteText(() => this.texts.get(key) ?? '');
  }

  /** Makes the edits, unless `refuse` is set. */
  public async apply(edits: readonly NoteEdit<ResourceUri>[]): Promise<boolean> {
    if (this.refuse) {
      return false;
    }
    for (const { uri, replacements } of edits) {
      const key = uri.toString();
      const note = noteText(() => this.texts.get(key) ?? '');
      const spans = replacements
        .map((replacement) => ({ at: offsets(note, replacement.range), text: replacement.text }))
        .sort((left, right) => right.at[0] - left.at[0]);
      let text = this.texts.get(key) ?? '';
      spans.forEach(({ at, text: written }) => {
        text = text.slice(0, at[0]) + written + text.slice(at[1]);
      });
      this.texts.set(key, text);
    }
    return true;
  }

  /** Records the save, after `beforeSave`, unless `failSave` says otherwise. */
  public async save(uri: ResourceUri, beforeSave?: (documentUri: string) => void): Promise<boolean> {
    beforeSave?.(uri.toString());
    if (this.failSave instanceof Error) {
      throw this.failSave;
    }
    if (this.failSave === 'refuse') {
      return false;
    }
    this.saved.push(uri.toString());
    return true;
  }
}

/** One write the fake history kept. */
export interface KeptWrite {
  edits: readonly NoteEdit<ResourceUri>[];
  options: HistoryWriteOptions;
}

/**
 * A write history over {@link FakeNotes}: a write applies its edits there and
 * is kept, with a numbered handle, unless `refuse` is set.
 */
export class FakeHistory implements HistoryWriter<ResourceUri, number> {
  public readonly writes: KeptWrite[] = [];
  public refuse = false;

  /** A history that writes into `notes`. */
  public constructor(private readonly notes: FakeNotes) {}

  /** Applies and keeps the write, unless `refuse` is set or the notes refuse. */
  public async write(
    edits: readonly NoteEdit<ResourceUri>[],
    options: HistoryWriteOptions,
  ): Promise<HistoryWriteResult<number>> {
    if (this.refuse || !(await this.notes.apply(edits))) {
      return { applied: false };
    }
    this.writes.push({ edits, options });
    return { applied: true, handle: this.writes.length };
  }
}
