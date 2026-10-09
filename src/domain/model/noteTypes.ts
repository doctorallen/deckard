/**
 * Types: the schemas a workspace's `Types/` notes define, so the tags of a
 * namespace, and the notes with a `type:` field, read as rows with fields
 * (docs/implementation/30-databases.md).
 */

/** What a field holds, as its `Kind` cell names it. */
export type FieldKindName =
  | 'text'
  | 'number'
  | 'date'
  | 'checkbox'
  | 'select'
  | 'person'
  | 'relation'
  | 'note'
  | 'link'
  | 'email'
  | 'phone';

/** A field's kind, read from its `Kind` cell: `Select: a, b`, `Area or System, many`. */
export interface FieldKind {
  name: FieldKindName;
  /** Whether the field holds several values: the cell ends `, many`. */
  many: boolean;
  /** A select's options, as the schema spells them. */
  options?: string[];
  /**
   * A relation's types. As a type note writes them, the display names or
   * keys of the cell (`Area`, `System`); once the registry has read every
   * type, their keys.
   */
  targets?: string[];
  /** A relation that also takes people: `Person or Team`. Set by the registry. */
  people?: boolean;
}

/** One row of a type's table: a field its rows can hold. */
export interface TypeField {
  /** The field's name as the table writes it: `on-call`. */
  name: string;
  /** The front-matter key it is read from, lowercased as the parser keys front matter. */
  key: string;
  /** The `Kind` cell as written. */
  kindText: string;
  kind: FieldKind;
  /** The `Reverse` cell as written, when it is not empty. */
  reverse?: string;
  /** The `Also called` cell's words, the names Find and the assistant also know the field by. */
  alsoCalled: string[];
  /** The one-based line of the field's table row. */
  line: number;
  /** The cells of columns Deckard does not read, by their header as written, kept for a rewrite. */
  extra?: Record<string, string>;
}

/**
 * Which notes or tags a type's rows are: every tag under a prefix
 * (`#team/` for `rows: "#team/*"`, `@` for people, which also takes
 * `#person/…`), or every note whose `type:` names the type.
 */
export type TypeRowsRule =
  | { kind: 'tags'; prefix: string; written: string }
  | { kind: 'notes'; written: string };

/** Why a type note, or a row's value, needs a look. */
export type TypeProblemCode =
  | 'no-table'
  | 'no-key'
  | 'bad-rows'
  | 'duplicate-type'
  | 'duplicate-rows'
  | 'missing-field'
  | 'bad-field-name'
  | 'duplicate-field'
  | 'missing-kind'
  | 'unknown-kind'
  | 'reverse-on-non-relation'
  | 'built-in-name'
  | 'field-kinds-differ'
  | 'unresolved-value'
  | 'kind-mismatch'
  | 'relation-conflict';

/** A problem with a type note, or with a value a row's note writes, at its line. */
export interface TypeProblem {
  code: TypeProblemCode;
  /** What is wrong, in a sentence: `No person is named "Omar H" yet.` */
  message: string;
  filePath: string;
  /** One-based line. */
  line: number;
  /** The field the problem is about, by its front-matter key, when it is about one. */
  field?: string;
  /** The value the problem is about, as written, when it is about one. */
  value?: string;
}

/** A type note, as the parser reads one in `Types/`. */
export interface TypeNote {
  /** The type's key: `deckard-type:`, or the file's name slugged when that is missing. */
  key: string;
  /** Its display name: the note's first heading, else the key title-cased. */
  name: string;
  /** Which notes or tags are its rows; undefined when `rows:` is missing or unreadable. */
  rows?: TypeRowsRule;
  /** `notes:`, the folder new rows are written to, when written. */
  notesFolder?: string;
  fields: TypeField[];
  /** The table's header cells as written, in order, when the note has a schema table. */
  columns?: string[];
  /** The one-based first and last lines of the schema table. */
  table?: { startLine: number; endLine: number };
  /** The one-based lines of `deckard-type:` and `rows:`, for problems and edits. */
  keyLine?: number;
  rowsLine?: number;
  /** What the note gets wrong on its own, before it is read with the other types. */
  problems: TypeProblem[];
}
