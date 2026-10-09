/**
 * The columns a table of notes can show: a query block drawn with
 * `view=table` lists its notes this way, beside its table of tasks.
 *
 * A note's columns are what the index already knows of it: where it is,
 * when it was written, what links to it, how far along its tasks are, and
 * its tags, including one namespace's tags as a column of their own, such as
 * `#status` for a project's `#status/doing`; and, for a note that is a
 * typed row or carries one's tag, any field of its type, a path, a reverse,
 * or a computed field, by the name a query gives it (`lead`, `team.lead`,
 * `open-tasks`), headed as the block writes it.
 */
import { formatKeyWords } from '../markdown/tagKeys';

/** A column every note has. */
export type FixedNoteColumnId = 'title' | 'note' | 'created' | 'updated' | 'links' | 'tasks' | 'tags';

/**
 * A column of a table of notes: a fixed one, one namespace's tags, written
 * `#namespace`, or a type's field by a query's name for it, kept as written
 * after `field:` (`field:team.lead`).
 */
export type NoteColumnId = FixedNoteColumnId | `#${string}` | `field:${string}`;

/** A fixed column, with the names a query may call it by. */
export interface NoteColumn {
  id: FixedNoteColumnId;
  label: string;
  aliases?: readonly string[];
}

/** Every fixed column, in the order the guide lists them. */
export const NOTE_COLUMNS: readonly NoteColumn[] = [
  { id: 'title', label: 'Entry' },
  { id: 'note', label: 'Note', aliases: ['file', 'source'] },
  { id: 'created', label: 'Created' },
  { id: 'updated', label: 'Updated' },
  { id: 'links', label: 'Linked from', aliases: ['backlinks', 'linkedfrom'] },
  { id: 'tasks', label: 'Tasks', aliases: ['progress'] },
  { id: 'tags', label: 'Tags' },
];

/** The columns a table of notes shows until asked for others. */
export const DEFAULT_NOTE_COLUMNS: readonly NoteColumnId[] = ['title', 'note', 'updated', 'links', 'tasks'];

/** A namespace as a column names one: a letter, then letters, digits, `-`, and `_`. */
const NAMESPACE_COLUMN = /^#(\p{L}[\p{L}\p{N}\p{M}_-]*)$/u;
/** A field, path, reverse, or computed field as a query names one: `lead`, `team.lead`, `owned-by`, `field.status`. */
const FIELD_COLUMN = /^\p{L}[\p{L}\p{N}\p{M}_-]*(?:\.\p{L}[\p{L}\p{N}\p{M}_-]*){0,3}$/u;

/** Each fixed column's id and aliases, lowercased, to the column they name. */
const COLUMN_BY_NAME = new Map<string, FixedNoteColumnId>(
  NOTE_COLUMNS.flatMap((column) =>
    [column.id, ...(column.aliases ?? [])].map((name): [string, FixedNoteColumnId] => [name.toLowerCase(), column.id]),
  ),
);

/**
 * The column a name calls for: a fixed column by its id or an alias, or a
 * namespace written `#status`, lowercased; with `fields`, any other name a
 * field could have, as written, which the block checks against its
 * workspace's types. Undefined for any other name.
 */
export function readNoteColumn(name: string, fields = false): NoteColumnId | undefined {
  const written = name.trim();
  const lowered = written.toLowerCase();
  const fixed = COLUMN_BY_NAME.get(lowered);
  if (fixed) {
    return fixed;
  }
  if (NAMESPACE_COLUMN.test(lowered)) {
    return lowered as `#${string}`;
  }
  return fields && FIELD_COLUMN.test(written) ? `field:${written}` : undefined;
}

/**
 * Reads a `noteColumns=` value: names separated by commas, in the order
 * given, the title always first. A name a field could have is a field
 * column, which the block checks against its workspace's types; names that
 * can be no column are returned so the caller can say so without dropping
 * the rest.
 */
export function parseNoteColumns(text: string): { columns: NoteColumnId[]; unknown: string[] } {
  const columns: NoteColumnId[] = ['title'];
  const unknown: string[] = [];
  for (const name of text.split(/[,\s]+/).map((part) => part.trim()).filter(Boolean)) {
    const column = readNoteColumn(name, true);
    if (!column) {
      unknown.push(name);
    } else if (!columns.includes(column)) {
      columns.push(column);
    }
  }
  return { columns, unknown };
}

/** The namespace a `#namespace` column lists, or undefined for any other column. */
export function noteColumnNamespace(id: NoteColumnId): string | undefined {
  return id.startsWith('#') ? id.slice(1) : undefined;
}

/** The field, path, reverse, or computed field a `field:` column reads, as written, or undefined for any other column. */
export function noteColumnField(id: NoteColumnId): string | undefined {
  return id.startsWith('field:') ? id.slice('field:'.length) : undefined;
}

/** A column's heading: a fixed column's label, or a namespace's words, "Status". */
export function noteColumnLabel(id: NoteColumnId): string {
  const field = noteColumnField(id);
  if (field !== undefined) {
    return field;
  }
  const namespace = noteColumnNamespace(id);
  if (namespace === undefined) {
    return NOTE_COLUMNS.find((column) => column.id === id)?.label ?? id;
  }
  const words = formatKeyWords(namespace);
  return words.charAt(0).toUpperCase() + words.slice(1);
}
