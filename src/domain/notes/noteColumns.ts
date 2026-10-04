/**
 * The columns a table of notes can show: a query block drawn with
 * `view=table` lists its notes this way, beside its table of tasks.
 *
 * A note's columns are what the index already knows of it: where it is,
 * when it was written, what links to it, how far along its tasks are, and
 * its tags, including one namespace's tags as a column of their own, such as
 * `#status` for a project's `#status/doing`.
 */
import { formatKeyWords } from '../markdown/tagKeys';

/** A column every note has. */
export type FixedNoteColumnId = 'title' | 'note' | 'created' | 'updated' | 'links' | 'tasks' | 'tags';

/** A column of a table of notes: a fixed one, or one namespace's tags, written `#namespace`. */
export type NoteColumnId = FixedNoteColumnId | `#${string}`;

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

/** Each fixed column's id and aliases, lowercased, to the column they name. */
const COLUMN_BY_NAME = new Map<string, FixedNoteColumnId>(
  NOTE_COLUMNS.flatMap((column) =>
    [column.id, ...(column.aliases ?? [])].map((name): [string, FixedNoteColumnId] => [name.toLowerCase(), column.id]),
  ),
);

/**
 * The column a name calls for: a fixed column by its id or an alias, or a
 * namespace written `#status`, lowercased; undefined for any other name.
 */
export function readNoteColumn(name: string): NoteColumnId | undefined {
  const lowered = name.trim().toLowerCase();
  const fixed = COLUMN_BY_NAME.get(lowered);
  if (fixed) {
    return fixed;
  }
  return NAMESPACE_COLUMN.test(lowered) ? (lowered as `#${string}`) : undefined;
}

/**
 * Reads a `noteColumns=` value: names separated by commas, in the order
 * given, the title always first. Names that are not columns are returned so
 * the caller can say so without dropping the rest.
 */
export function parseNoteColumns(text: string): { columns: NoteColumnId[]; unknown: string[] } {
  const columns: NoteColumnId[] = ['title'];
  const unknown: string[] = [];
  for (const name of text.split(/[,\s]+/).map((part) => part.trim()).filter(Boolean)) {
    const column = readNoteColumn(name);
    if (!column) {
      unknown.push(name);
    } else if (!columns.includes(column)) {
      columns.push(column);
    }
  }
  return { columns, unknown };
}

/** The namespace a `#namespace` column lists, or undefined for a fixed column. */
export function noteColumnNamespace(id: NoteColumnId): string | undefined {
  return id.startsWith('#') ? id.slice(1) : undefined;
}

/** A column's heading: a fixed column's label, or a namespace's words, "Status". */
export function noteColumnLabel(id: NoteColumnId): string {
  const namespace = noteColumnNamespace(id);
  if (namespace === undefined) {
    return NOTE_COLUMNS.find((column) => column.id === id)?.label ?? id;
  }
  const words = formatKeyWords(namespace);
  return words.charAt(0).toUpperCase() + words.slice(1);
}
