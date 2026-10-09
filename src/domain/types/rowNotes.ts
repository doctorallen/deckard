/**
 * A new row's note: where it goes, what it is called, and what it holds
 * (docs/implementation/30-databases.md § Writes). A quick fix's Create
 * person "Omar H" writes one, and so does a type's search page's
 * Add <type>….
 *
 * A row of a namespace type is a hub note whose `describes:` names its tag;
 * a row of a note type is a note whose `type:` names the type. Its other
 * front matter is the type's template, `templates/<key>.md`, when there is
 * one, or else each schema field's key, empty.
 */
import { findFrontmatterEnd } from '../markdown/frontmatter';
import { getExtractedNoteFileName } from '../markdown/noteNames';
import { fillTemplate, getTemplateVariables } from '../notes/templates';
import type { TypeField, TypeRowsRule } from '../model';

/** What a row's note is written from: its type's key, name, rows, folder, and fields. */
export interface RowNoteType {
  key: string;
  name: string;
  rows?: TypeRowsRule;
  notesFolder?: string;
  fields: readonly Pick<TypeField, 'key'>[];
}

/** A new row's note, as it will be written. */
export interface RowNotePlan {
  /** Its folder under the notes folder, `Teams`, or empty for the notes folder itself. */
  folder: string;
  /** Its file name: the title, `.md`. */
  fileName: string;
  /** The tag it describes, for a namespace type's row: `#team/credit-trading`, `@omar-h`. */
  tag?: string;
  content: string;
}

/** The words a person type's display name is pluralized to. */
const IRREGULAR_PLURALS: ReadonlyMap<string, string> = new Map([
  ['person', 'people'],
  ['child', 'children'],
  ['man', 'men'],
  ['woman', 'women'],
]);

/**
 * A type's display name in the plural, as a folder or a page title names
 * its rows: `Teams`, `People`, `Policies`, `Processes`. Only the last word
 * changes, and its first letter's case is kept.
 */
export function pluralTypeName(name: string): string {
  const match = /^(.*?)(\p{L}+)$/u.exec(name.trim());
  if (!match) {
    return name.trim();
  }
  const [, before, word] = match;
  const lower = word.toLowerCase();
  const irregular = IRREGULAR_PLURALS.get(lower);
  let plural: string;
  if (irregular) {
    plural = irregular;
  } else if (/[^aeiou]y$/.test(lower)) {
    plural = `${word.slice(0, -1)}ies`;
  } else if (/(?:s|x|z|ch|sh)$/.test(lower)) {
    plural = `${word}es`;
  } else {
    plural = `${word}s`;
  }
  const cased = word[0] === word[0].toUpperCase() ? plural[0].toUpperCase() + plural.slice(1) : plural;
  return `${before}${cased}`;
}

/**
 * The folder a type's new rows go in, under the notes folder: its `notes:`,
 * without the slashes around it, or else the display name in the plural,
 * `Teams`. Each row is a note of its own, so a folder of them keeps the
 * notes folder's root for the reader's own notes.
 */
export function rowNotesFolder(type: Pick<RowNoteType, 'name' | 'notesFolder'>): string {
  const written = type.notesFolder?.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (written !== undefined && written !== '' && !written.split('/').includes('..')) {
    return written;
  }
  return pluralTypeName(type.name);
}

/** A title as a tag's last part: lowercased, each run of other characters a hyphen. */
export function slugTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The tag a new row of a namespace type is: `#team/credit-trading` for
 * "Credit Trading", `@omar-h` for "Omar H". Undefined for a note type, or a
 * title with nothing a tag can hold.
 */
export function rowTagOf(type: Pick<RowNoteType, 'rows'>, title: string): string | undefined {
  const rows = type.rows;
  const slug = slugTitle(title);
  if (rows?.kind !== 'tags' || !slug) {
    return undefined;
  }
  return rows.prefix === '@' ? `@${slug}` : `${rows.prefix}${slug}`;
}

/** What filling a type's template takes. */
export interface RowNoteOptions {
  /** The type's template, `templates/<key>.md`, when it has one. */
  template?: string;
  now: Date;
  /** The reader's answers to the template's questions, by question. */
  answers?: ReadonlyMap<string, string>;
}

/**
 * A new row's note: in the type's folder, named for its title, saying what
 * it is a row of, and holding the type's template, or each field's key.
 * Undefined when the title cannot be a file name or, for a namespace type,
 * a tag.
 */
export function planRowNote(type: RowNoteType, title: string, options: RowNoteOptions): RowNotePlan | undefined {
  const fileName = getExtractedNoteFileName(title);
  const rows = type.rows;
  const tag = rowTagOf(type, title);
  if (!fileName || (rows?.kind === 'tags' && !tag)) {
    return undefined;
  }
  // YAML reads a bare `#` as a comment and cannot start a plain value with `@`.
  const identity = tag ? `describes: "${tag}"` : `type: ${type.key}`;
  const identityKey = tag ? 'describes' : 'type';
  const content =
    options.template === undefined
      ? writeRowFrontmatter(identity, type.fields, title)
      : applyRowTemplate(options.template, { identity, identityKey, title, tag, now: options.now, answers: options.answers });
  return { folder: rowNotesFolder(type), fileName, ...(tag ? { tag } : {}), content };
}

/** Front matter with the row's identity and each field's key, empty, then the title. */
function writeRowFrontmatter(identity: string, fields: readonly Pick<TypeField, 'key'>[], title: string): string {
  const keys = fields
    .map((field) => field.key)
    .filter((key) => key !== 'describes' && key !== 'type');
  return ['---', identity, ...keys.map((key) => `${key}:`), '---', `# ${title}`, '', ''].join('\n');
}

/**
 * A type's template filled for one row, `{tag}` included, with the row's
 * identity put first in its front matter unless the template writes its
 * own, as a hub template is applied.
 */
function applyRowTemplate(
  template: string,
  row: {
    identity: string;
    identityKey: string;
    title: string;
    tag?: string;
    now: Date;
    answers?: ReadonlyMap<string, string>;
  },
): string {
  const content = fillTemplate(
    template,
    { ...getTemplateVariables(row.title, row.now), ...(row.tag ? { tag: row.tag } : {}) },
    row.answers,
  );
  const lines = content.split(/\r?\n/);
  const end = findFrontmatterEnd(lines);
  if (end === undefined) {
    return `---\n${row.identity}\n---\n${content}`;
  }
  const writesOwn = new RegExp(`^${row.identityKey}\\s*:`);
  if (lines.slice(1, end).some((line) => writesOwn.test(line))) {
    return content;
  }
  const bodyStart = content.indexOf('\n') + 1;
  const eol = content[bodyStart - 2] === '\r' ? '\r\n' : '\n';
  return `${content.slice(0, bodyStart)}${row.identity}${eol}${content.slice(bodyStart)}`;
}
