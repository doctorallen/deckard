/**
 * A typed row's fields, as the Note page and a tag's page draw them
 * (docs/implementation/30-databases.md § Surfaces 5 and 6): one row per
 * field that holds something, its key in monospace and its values, a
 * person or relation by its row's title, which opens the row as a tag
 * button does; a reverse in italics, saying what it is worked out from;
 * and the empty fields folded into one line, "1 empty: email", which opens
 * to list them.
 *
 * On the Note page each field the note writes has an Edit button, revealed
 * on its row's hover or focus (shared/reveal.css), and Enter on the row
 * opens the same editor under it: a list by kind, filtered as you type, an
 * input, or a box, then Clear. A tag's page draws the rows read-only.
 */
import type { ComponentChild } from 'preact';

import type { DrawnField, DrawnFields, DrawnFieldValue, FieldChoice, FieldEditor } from '../../ui/protocol/fields';

/** How many rows a relation's list draws before it asks for more typing. */
const CHOICE_LIMIT = 40;

/** Which field's editor is open on the Note page, and what has been typed in it. */
export interface FieldEditing {
  /** The key of the field being edited; absent while Add field… lists the empty fields. */
  key?: string;
  /** What is typed in its filter or input. */
  text: string;
  /** Set while Add field… is open. */
  adding?: true;
  /** Set while Other… asks for a free key; `key` is then the key typed. */
  other?: true;
}

/** `1 empty: email`, `3 empty: email, phone, start`: the line a row's empty fields fold into. */
export function describeEmptyFields(empty: readonly Pick<DrawnField, 'name'>[]): string {
  return `${empty.length} empty: ${empty.map((field) => field.name).join(', ')}`;
}

/** A value as a reader reads it: `[[Atlas]]` as Atlas. */
export function readableValue(text: string): string {
  return text.replace(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/, (_whole, target: string, shown?: string) => shown ?? target);
}

/**
 * Whether a row in a relation's list holds what is typed: its title, a
 * word of its title, or one of its names starts with it, any case, its
 * marker and namespace aside. Nothing typed holds every row.
 */
export function matchesChoice(choice: FieldChoice, typed: string): boolean {
  const query = typed.trim().toLowerCase().replace(/^["'[]+|["'\]]+$/g, '').replace(/^[#@]/, '').replace(/^person\//, '');
  if (!query) {
    return true;
  }
  const title = choice.title.toLowerCase();
  return (
    title.startsWith(query) ||
    title.split(/\s+/).some((word) => word.startsWith(query)) ||
    choice.names.some((name) => name.replace(/^[#@]/, '').startsWith(query) || (name.split('/').pop() ?? '').startsWith(query))
  );
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

/**
 * A field's Edit: shown on its row's hover or focus at any step, and
 * under Zen only once the fields region is pointed at or holds focus; it
 * stays drawn while its editor is open.
 */
function EditButton({ name, edit, open }: { readonly name: string; readonly edit: FieldEditor; readonly open: boolean }) {
  return (
    <button type="button" class="field-edit" data-action="edit-field" data-field-key={edit.key} aria-expanded={open} aria-label={`Edit ${name}`} data-reveal="" data-zen-reveal="">
      Edit
    </button>
  );
}

/** What one field row is drawn with besides its field. */
interface FieldRowOptions {
  readonly noteAction: string;
  /** Whether each field the note writes has its Edit button: on the Note page. */
  readonly editable: boolean;
  /** The editor open now, and the rows each relation's list offers. */
  readonly editing?: FieldEditing;
  readonly choices?: DrawnFields['choices'];
}

/** Whether a field's own editor is open: not Add field…'s list, nor Other…. */
function isEditing(editing: FieldEditing | undefined, key: string): editing is FieldEditing {
  return editing?.key === key && !editing.other && !editing.adding;
}

/** One field: its key, its values, and on the Note page its Edit button and, when open, its editor. */
function FieldRow({ field, options }: { readonly field: DrawnField; readonly options: FieldRowOptions }) {
  const edit = options.editable ? field.edit : undefined;
  const editing = edit && isEditing(options.editing, edit.key) ? options.editing : undefined;
  const open = editing !== undefined;
  return (
    <div
      class={['field-row', field.source === 'reverse' ? 'is-reverse' : '', open ? 'is-editing' : ''].filter(Boolean).join(' ')}
      data-reveal-region=""
      data-field-key={edit?.key}
      tabIndex={edit ? 0 : undefined}
    >
      <dt class="field-name" data-tip={field.tip}>{field.name}</dt>
      <dd class="field-values">
        {field.values.length
          ? field.values.map((value, at) => [at > 0 ? ', ' : null, <FieldValue value={value} noteAction={options.noteAction} />])
          : <span class="field-none">empty</span>}
        {edit ? <EditButton name={field.name} edit={edit} open={open} /> : null}
      </dd>
      {edit && editing ? <dd class="field-editor-cell"><FieldEditorPanel field={field} edit={edit} typed={editing.text} choices={options.choices} /></dd> : null}
    </div>
  );
}

/** A choice in a list: pressed when the field holds it. */
function ChoiceButton({ edit, value, pressed, children }: { readonly edit: FieldEditor; readonly value: { rowId?: string; option?: string }; readonly pressed: boolean; readonly children: ComponentChild }) {
  return (
    <li>
      <button
        type="button"
        class="field-choice"
        data-action={value.rowId === undefined ? 'choose-field-option' : 'choose-field-row'}
        data-field-key={edit.key}
        data-row-id={value.rowId}
        data-option={value.option}
        aria-pressed={pressed}
      >
        {children}
      </button>
    </li>
  );
}

/** The list a relation offers, filtered as you type, at most a screenful. */
function RowChoices({ edit, typed, choices }: { readonly edit: FieldEditor; readonly typed: string; readonly choices: readonly FieldChoice[] }) {
  const found = choices.filter((choice) => matchesChoice(choice, typed));
  const shown = found.slice(0, CHOICE_LIMIT);
  return (
    <>
      <input type="text" class="field-input" data-field-key={edit.key} value={typed} placeholder="Type to filter" aria-label="Filter the list" autoComplete="off" />
      <ul class="field-choices" aria-label="Choices">
        {shown.map((choice) => (
          <ChoiceButton edit={edit} value={{ rowId: choice.id }} pressed={edit.current.includes(choice.id)}>
            <span class="field-choice-title">{choice.title}</span>
            <span class="field-choice-detail">{choice.detail}</span>
          </ChoiceButton>
        ))}
      </ul>
      {found.length > shown.length ? <p class="field-more">{`${found.length - shown.length} more; type to narrow them.`}</p> : null}
      {found.length === 0 ? <p class="field-more">Nothing matches.</p> : null}
    </>
  );
}

/** An input for typed text, a number, a note's title, or a date, and its Set button. */
function TextInput({ edit, typed }: { readonly edit: FieldEditor; readonly typed: string }) {
  const placeholder: Record<string, string> = { number: 'A number', note: 'A note’s title', text: 'A value' };
  return (
    <div class="field-text">
      <input
        type={edit.input === 'date' ? 'date' : 'text'}
        class="field-input"
        data-field-key={edit.key}
        value={typed}
        placeholder={placeholder[edit.input]}
        aria-label={edit.input === 'date' ? 'Date' : 'Value'}
        inputMode={edit.input === 'number' ? 'decimal' : undefined}
        autoComplete="off"
      />
      <button type="button" data-action="set-field-text" data-field-key={edit.key}>Set</button>
    </div>
  );
}

/** A field's editor, by its kind: a list, an input, or a box; then Clear when it holds something. */
function FieldEditorPanel({ field, edit, typed, choices }: { readonly field: DrawnField; readonly edit: FieldEditor; readonly typed: string; readonly choices: DrawnFields['choices'] }) {
  let body: ComponentChild;
  if (edit.input === 'rows') {
    body = <RowChoices edit={edit} typed={typed} choices={(edit.choices && choices?.[edit.choices]) || []} />;
  } else if (edit.input === 'options') {
    body = (
      <ul class="field-choices" aria-label="Options">
        {(edit.options ?? []).map((option) => (
          <ChoiceButton edit={edit} value={{ option }} pressed={edit.current.some((current) => current.toLowerCase() === option.toLowerCase())}>{option}</ChoiceButton>
        ))}
      </ul>
    );
  } else if (edit.input === 'checkbox') {
    body = (
      <label class="field-check">
        <input type="checkbox" data-action="toggle-field" data-field-key={edit.key} checked={edit.current[0] === 'true'} />
        {` ${field.name}`}
      </label>
    );
  } else {
    body = <TextInput edit={edit} typed={typed} />;
  }
  return (
    <div class="field-editor" role="group" aria-label={`Edit ${field.name}${edit.many ? '; each choice adds or takes away one' : ''}`}>
      {body}
      {edit.current.length ? <button type="button" class="field-clear" data-action="clear-field" data-field-key={edit.key}>{`Clear ${field.name}`}</button> : null}
    </div>
  );
}

/** What a row's fields are drawn with: the action a note value opens by, and on the Note page, the editing. */
export interface FieldRowsProps {
  readonly fields: DrawnFields;
  /** `open-note` on the Note page, `open-source` on a tag's page. */
  readonly noteAction: string;
  /** Whether each field the note writes has its Edit button. */
  readonly editable?: boolean;
  readonly editing?: FieldEditing;
}

/**
 * A row's fields: those that hold something, then the empty ones folded
 * into one line that opens to list them. On the Note page, `editable` gives
 * each field the note writes its Edit button, and `editing` draws the
 * editor open.
 */
export function FieldRows({ fields, noteAction, editable, editing }: FieldRowsProps) {
  const options: FieldRowOptions = { noteAction, editable: editable === true, editing, choices: fields.choices };
  const emptyOpen = Boolean(editing?.key && !editing.other && fields.empty.some((field) => field.edit?.key === editing.key));
  return (
    <>
      {fields.fields.length ? <dl class="field-rows">{fields.fields.map((field) => <FieldRow field={field} options={options} />)}</dl> : null}
      {fields.empty.length
        ? (
          <details class="field-empty" open={emptyOpen || undefined}>
            <summary>{describeEmptyFields(fields.empty)}</summary>
            <dl class="field-rows">{fields.empty.map((field) => <FieldRow field={field} options={options} />)}</dl>
          </details>
        )
        : null}
    </>
  );
}

/**
 * Add field…: the type's empty fields, each opening its editor, then
 * Other… for a key the type does not name; or, once Other… is chosen, the
 * key and its value.
 */
export function AddField({ fields, editing }: { readonly fields: DrawnFields; readonly editing: FieldEditing | undefined }) {
  const open = Boolean(editing?.adding || editing?.other);
  return (
    <div class="field-add">
      <button type="button" class="field-add-button" data-action="add-field" aria-expanded={open} data-zen-reveal="">Add field…</button>
      {editing?.adding
        ? (
          <ul class="field-choices" aria-label="Fields to add">
            {fields.empty.flatMap((field) => (field.edit ? [<li><button type="button" class="field-choice" data-action="edit-field" data-field-key={field.edit.key}>{field.name}</button></li>] : []))}
            <li><button type="button" class="field-choice" data-action="add-other-field">Other…</button></li>
          </ul>
        )
        : null}
      {editing?.other
        ? (
          <div class="field-editor field-text" role="group" aria-label="Add a field">
            <input type="text" class="field-key-input" value={editing.key ?? ''} placeholder="key" aria-label="Key" autoComplete="off" />
            <input type="text" class="field-input" value={editing.text} placeholder="A value" aria-label="Value" autoComplete="off" />
            <button type="button" data-action="set-other-field">Add</button>
          </div>
        )
        : null}
    </div>
  );
}
