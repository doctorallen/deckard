/**
 * A typed row's fields as the Note page and a tag's page draw them
 * (docs/implementation/30-databases.md § Surfaces 5 and 6): each field a
 * row of its key and values, the reverses other rows compute, the empty
 * schema fields folded into one line, and, on the Note page, how each
 * field the note writes is edited, and the message an edit sends.
 */
import type { TagReference } from './shared';

/** One value of a field, as a page draws it. */
export interface DrawnFieldValue {
  /** What it reads as: the title of the row or note it names, else the value as written. */
  text: string;
  /** The tag of the row it names, which opens as a tag button does. */
  tag?: TagReference;
  /** The note it names, a note row's or a Note field's, which opens on the Note page. */
  filePath?: string;
  /** Set when the value names nothing its kind reads; drawn as written. */
  unresolved?: true;
  /** Set on a value another row's relation gives, drawn as a reverse is. */
  reverse?: true;
  /** What the row it names holds, as a path reads it: `lead Dana Whitfield · on-call Sam Ortiz`. */
  detail?: string;
}

/** How a field's value is chosen on the Note page, by its kind. */
export type FieldInput = 'rows' | 'options' | 'date' | 'number' | 'text' | 'note' | 'checkbox';

/** How one field the note writes is edited. */
export interface FieldEditor {
  /** The front-matter key it is written under, as the schema names it. */
  key: string;
  input: FieldInput;
  /** Whether it holds several values, so a choice adds or takes one away. */
  many: boolean;
  /** For `rows`: which list of the fields' `choices` its rows are in. */
  choices?: string;
  /** For `options`: the select's options, as the schema spells them. */
  options?: string[];
  /** What it holds now: the ids of the rows it names, its options, or its values as written. */
  current: string[];
}

/** One field: its name and values, where they come from, and, when the note writes it, its editor. */
export interface DrawnField {
  /** Its name: the key as the schema writes it, or a reverse's name. */
  name: string;
  /** Where its values come from: the note, other rows' relations, or both. */
  source: 'written' | 'reverse' | 'merged';
  /** For a reverse, or a field merged with one, what it is worked out from: `From each person's team`. */
  tip?: string;
  values: DrawnFieldValue[];
  edit?: FieldEditor;
}

/** A row another row's relation can name, as an edit's list offers it. */
export interface FieldChoice {
  id: string;
  title: string;
  /** Its type and first relation: `Team · lead Omar Haddad`. */
  detail: string;
  /** The other names a typed value can match it by, lowercased: its tag, slug, and aliases. */
  names: string[];
}

/** A typed row's fields, as a page draws them. */
export interface DrawnFields {
  /** The row's type, by its display name, and the search that lists its rows: `type = team`. */
  typeName: string;
  typeQuery: string;
  /** The fields that hold something: the schema's, its reverses, then the note's other keys. */
  fields: DrawnField[];
  /** The schema's fields that hold nothing, folded into one line: `1 empty: email`. */
  empty: DrawnField[];
  /** On the Note page, the rows each relation's list offers, by the editors' `choices`. */
  choices?: Record<string, FieldChoice[]>;
}

/** What an edit writes: a row, an option, typed text, a box, or nothing. */
export type FieldEditValue =
  | { kind: 'row'; rowId: string }
  | { kind: 'option'; option: string }
  | { kind: 'text'; text: string }
  | { kind: 'checkbox'; checked: boolean }
  | { kind: 'clear' };

/**
 * Writes one field of the note shown: a choice from its list, typed text,
 * or Clear. A field that holds several values adds a row or option it
 * does not hold, and takes away one it does.
 */
export interface SetNoteFieldMessage {
  type: 'setNoteField';
  filePath: string;
  key: string;
  value: FieldEditValue;
}
