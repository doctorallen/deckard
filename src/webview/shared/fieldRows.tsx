/**
 * A typed row's fields, as the Note page and a tag's page draw them
 * (docs/implementation/30-databases.md § Surfaces 5 and 6,
 * docs/implementation/33-clearer-fields.md): one row per field that holds
 * something, its key in monospace and its values, a person or relation by
 * its row's title, which opens the row as a tag button does. The row's own
 * fields come first; then, under "From other notes", the reverses other
 * rows give it, in italics, each saying where it is set.
 *
 * Nothing is edited here (docs/implementation/34-edit-fields-form.md):
 * where the fields are a note's, a field's name is a quiet link that opens
 * the form on that field, as Edit fields… opens it on the note.
 */
import type { ComponentChild } from 'preact';

import type { DrawnField, DrawnFields, DrawnFieldValue } from '../../ui/protocol/fields';

/** A value as a reader reads it: `[[Atlas]]` as Atlas. */
export function readableValue(text: string): string {
  return text.replace(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/, (_whole, target: string, shown?: string) => shown ?? target);
}

/** One value: a row's title that opens it, a note's that opens it, or the words as written. */
function FieldValue({ value, noteAction }: { readonly value: DrawnFieldValue; readonly noteAction: string }) {
  const classes = ['field-value', value.reverse ? 'is-reverse' : '', value.unresolved ? 'is-unresolved' : ''].filter(Boolean).join(' ');
  let shown: ComponentChild;
  if (value.tag) {
    shown = <button type="button" class={`field-link ${classes}`} data-action="open-tag" data-tag-key={value.tag.key} data-tip={`Open ${value.tag.label}`}>{value.text}</button>;
  } else if (value.filePath) {
    shown = <button type="button" class={`field-link ${classes}`} data-action={noteAction} data-file-path={value.filePath} data-line="1" data-tip={`Open ${value.filePath}`}>{value.text}</button>;
  } else {
    shown = <span class={classes} data-tip={value.unresolved ? 'Names nothing yet' : undefined}>{readableValue(value.text)}</span>;
  }
  return value.detail ? <>{shown}<span class="field-detail">{` (${value.detail})`}</span></> : shown;
}

/** Where a reverse is set, after its values: `Set in each person's manager`; for a field the note writes too, `Also set in`. */
function FieldSources({ field }: { readonly field: DrawnField }) {
  const from = field.from ?? [];
  if (from.length === 0) {
    return null;
  }
  return (
    <span class="field-source">
      {field.source === 'merged' ? 'Also set in ' : 'Set in '}
      {from.map((source, at) => [at > 0 ? ' and ' : null, `${source.owner} `, <code>{source.field}</code>])}
    </span>
  );
}

/** A field's values, joined by commas. */
function FieldValues({ field, noteAction }: { readonly field: DrawnField; readonly noteAction: string }) {
  return <>{field.values.map((value, at) => [at > 0 ? ', ' : null, <FieldValue value={value} noteAction={noteAction} />])}</>;
}

/**
 * A field's name: for a field of the note's type, where the fields are a
 * note's, a quiet link drawn as the key is, which opens the form on it;
 * any other, its key as written.
 */
function FieldName({ field, opens }: { readonly field: DrawnField; readonly opens: boolean }) {
  if (opens && field.key) {
    return (
      <dt class="field-name">
        <button type="button" class="field-name-link" data-action="edit-fields" data-field-key={field.key} data-tip={field.tip ? `Edit ${field.name}. ${field.tip}` : `Edit ${field.name}`}>{field.name}</button>
      </dt>
    );
  }
  return <dt class="field-name" data-tip={field.tip}>{field.name}</dt>;
}

/** One field: its name, its values, and where they are set. */
function FieldRow({ field, noteAction, opens }: { readonly field: DrawnField; readonly noteAction: string; readonly opens: boolean }) {
  return (
    <div class={field.source === 'reverse' ? 'field-row is-reverse' : 'field-row'} data-field-key={field.key}>
      <FieldName field={field} opens={opens} />
      <dd class="field-values">
        <FieldValues field={field} noteAction={noteAction} />
        <FieldSources field={field} />
      </dd>
    </div>
  );
}

/** What a row's fields are drawn with: the action a note value opens by, and whether a field's name opens the form. */
export interface FieldRowsProps {
  readonly fields: DrawnFields;
  /** `open-note` on the Note page, `open-source` on a tag's page. */
  readonly noteAction: string;
  /** Whether the fields are a note's, so a field's name opens the form on it: the Note page, and a hub note's card. */
  readonly namesOpen?: boolean;
}

/**
 * A row's fields: its own that hold something, then the reverses, under
 * "From other notes". `namesOpen` makes each of its own fields' names a
 * link to the form.
 */
export function FieldRows({ fields, noteAction, namesOpen }: FieldRowsProps) {
  const opens = namesOpen === true;
  const own = fields.fields.filter((field) => field.source !== 'reverse');
  const reverses = fields.fields.filter((field) => field.source === 'reverse');
  return (
    <>
      {own.length ? <dl class="field-rows">{own.map((field) => <FieldRow field={field} noteAction={noteAction} opens={opens} />)}</dl> : null}
      {reverses.length
        ? (
          <>
            <p class="field-group-label">From other notes</p>
            <dl class="field-rows field-reverses">{reverses.map((field) => <FieldRow field={field} noteAction={noteAction} opens={opens} />)}</dl>
          </>
        )
        : null}
    </>
  );
}
