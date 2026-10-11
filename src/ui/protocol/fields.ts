/**
 * A typed row's fields as the Note page and a tag's page draw them
 * (docs/implementation/30-databases.md § Surfaces 5 and 6,
 * docs/implementation/33-clearer-fields.md): each field a row of its key
 * and values, and the reverses other rows compute with where each is set.
 * The pages edit none of them: Edit fields… and a field's name send the
 * message that opens the form on the note
 * (docs/implementation/34-edit-fields-form.md).
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
  /**
   * What the row it names holds of people other than the row shown, as a
   * path reads it: `lead Dana Whitfield · on-call Sam Ortiz`, `also
   * decided-by Theo Park`.
   */
  detail?: string;
}

/** Where a reverse is set: a row, or each row of a type, and its field: `Payments'` `lead`, `each person's` `manager`. */
export interface FieldSource {
  /** Who sets it, as owning the field: `Payments'`, `each person's`. */
  owner: string;
  /** The field it is set in, as the schema names it. */
  field: string;
}

/** One field: its name and values, and where they come from. */
export interface DrawnField {
  /** Its name: the key as the schema writes it, or a reverse's name. */
  name: string;
  /** For a field of the row's type its note writes, the schema's key, which its name opens the form on. */
  key?: string;
  /** Where its values come from: the note, other rows' relations, or both. */
  source: 'written' | 'reverse' | 'merged';
  /** For a reverse, or a field merged with one, what it is worked out from: `From each person's team`. */
  tip?: string;
  /** For a reverse, or a field merged with one, where it is set, drawn after its values. */
  from?: FieldSource[];
  values: DrawnFieldValue[];
}

/** A typed row's fields, as a page draws them. */
export interface DrawnFields {
  /** The row's type, by its display name, and the search that lists its rows: `type = team`. */
  typeName: string;
  typeQuery: string;
  /**
   * The fields that hold something, the row's own first: the schema's, then
   * the note's other keys, then the reverses other rows give it. For a row
   * no note describes, the reverses alone.
   */
  fields: DrawnField[];
}

/**
 * Opens the form on a typed row's note, from Edit fields… or a field's
 * name: the note the page drew, and the field to open on, by its key.
 */
export interface EditFieldsMessage {
  type: 'editFields';
  filePath: string;
  field?: string;
}
