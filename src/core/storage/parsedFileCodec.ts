import { ParsedFile, Section, Task } from '../types';

/**
 * A parsed note as text for the local cache, and back, exactly.
 *
 * Plain JSON of a parsed note is about seven times the note, most of it each
 * section's `rawContent` and `bodyContent`, which repeat lines of the note.
 * So a section's text is stored as "lines a to b of the note" when, and only
 * when, those lines give it back exactly (checked here, as it is written),
 * and a `filePath` that is the note's own is left out. A property of the
 * note, a section, or a task that is present but undefined is marked, since
 * JSON would drop it. Whatever the parser adds to a note later is carried as
 * plain JSON.
 *
 * No reviver or replacer is used: one runs for every value, and made reading
 * 5,000 notes four times slower than parsing the JSON alone.
 */

const FORMAT = 1;
/** A section whose `rawContent` is its lines, start to end. */
const RAW_IS_LINES = 1;
/** A section whose `bodyContent` is its lines, start to its body's end. */
const BODY_IS_LINES = 2;
/** An entry whose `filePath` is the note's. */
const PATH_IS_NOTE = 4;

type Encoded = Record<string, unknown>;
/** How to put an object back: the flags above, and its keys set to undefined. */
type Meta = [number, string[]?];

interface EncodedNote {
  v: number;
  /** The note without its sections and tasks. */
  f: Encoded;
  fm: Meta;
  s: Encoded[];
  sm: Meta[];
  t: Encoded[];
  tm: Meta[];
}

const encodedText = new WeakMap<ParsedFile, string>();

/** The note as the cache stores it. A note is encoded once, however often asked. */
export function encodeParsedFile(file: ParsedFile): string {
  const cached = encodedText.get(file);
  if (cached !== undefined) {
    return cached;
  }
  const lines = file.content.split(/\r?\n/);
  const slice = (from: number, to: number) => lines.slice(from - 1, to).join('\n');
  const sectionMeta: Meta[] = [];
  const sections = file.sections.map((section): Encoded => {
    const copy: Encoded = { ...section };
    let flags = 0;
    if (section.rawContent === slice(section.startLine, section.endLine)) {
      delete copy.rawContent;
      flags |= RAW_IS_LINES;
    }
    if (section.bodyContent === slice(section.startLine, section.bodyEndLine)) {
      delete copy.bodyContent;
      flags |= BODY_IS_LINES;
    }
    if (section.filePath === file.filePath) {
      delete copy.filePath;
      flags |= PATH_IS_NOTE;
    }
    sectionMeta.push(describe(copy, flags));
    return copy;
  });
  const taskMeta: Meta[] = [];
  const tasks = file.tasks.map((task): Encoded => {
    const copy: Encoded = { ...task };
    let flags = 0;
    if (task.filePath === file.filePath) {
      delete copy.filePath;
      flags |= PATH_IS_NOTE;
    }
    taskMeta.push(describe(copy, flags));
    return copy;
  });
  const note: Encoded = { ...file };
  delete note.sections;
  delete note.tasks;
  const encoded: EncodedNote = {
    v: FORMAT,
    f: note,
    fm: describe(note, 0),
    s: sections,
    sm: sectionMeta,
    t: tasks,
    tm: taskMeta,
  };
  const text = JSON.stringify(encoded);
  encodedText.set(file, text);
  return text;
}

/** The note the cache stored, as it was parsed. Throws on a text it cannot read. */
export function decodeParsedFile(text: string): ParsedFile {
  const encoded = JSON.parse(text) as Partial<EncodedNote>;
  if (
    encoded.v !== FORMAT ||
    !encoded.f ||
    typeof encoded.f.content !== 'string' ||
    !Array.isArray(encoded.s) ||
    !Array.isArray(encoded.t) ||
    !Array.isArray(encoded.sm) ||
    !Array.isArray(encoded.tm)
  ) {
    throw new Error('Deckard cannot read this cached note.');
  }
  const file = restore(encoded.f, encoded.fm) as unknown as ParsedFile;
  const lines = file.content.split(/\r?\n/);
  const slice = (from: number, to: number) => lines.slice(from - 1, to).join('\n');
  const sectionMeta = encoded.sm;
  const taskMeta = encoded.tm;
  file.sections = encoded.s.map((copy, index) => {
    const meta = sectionMeta[index];
    const section = restore(copy, meta) as unknown as Section;
    const flags = meta?.[0] ?? 0;
    if (flags & PATH_IS_NOTE) {
      section.filePath = file.filePath;
    }
    if (flags & RAW_IS_LINES) {
      section.rawContent = slice(section.startLine, section.endLine);
    }
    if (flags & BODY_IS_LINES) {
      section.bodyContent = slice(section.startLine, section.bodyEndLine);
    }
    return section;
  });
  file.tasks = encoded.t.map((copy, index) => {
    const meta = taskMeta[index];
    const task = restore(copy, meta) as unknown as Task;
    if ((meta?.[0] ?? 0) & PATH_IS_NOTE) {
      task.filePath = file.filePath;
    }
    return task;
  });
  encodedText.set(file, text);
  return file;
}

/** The flags, and the keys whose value is undefined, which JSON would drop. */
function describe(record: Encoded, flags: number): Meta {
  let missing: string[] | undefined;
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) {
      (missing ??= []).push(key);
    }
  }
  return missing ? [flags, missing] : [flags];
}

function restore(record: Encoded, meta: Meta | undefined): Encoded {
  meta?.[1]?.forEach((key) => {
    record[key] = undefined;
  });
  return record;
}
