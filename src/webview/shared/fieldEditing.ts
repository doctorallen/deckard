/**
 * Editing a typed row's fields in place, as the Note page and a tag's
 * page's hub card both do (docs/implementation/30-databases.md § Writes,
 * docs/implementation/33-clearer-fields.md): Edit opens a field's editor
 * under its row, a choice or Set sends the edit, Add field… lists the empty
 * fields and Other…, Enter on a focused row opens its Edit, and Escape
 * closes the editor. One copy, so the two pages cannot drift apart; each
 * page says where its fields are and how it draws and sends.
 */
import type { DrawnFields, FieldEditValue, SetNoteFieldMessage } from '../../ui/protocol/fields';
import type { FieldEditing } from './fieldRows';
import { announce } from './status';

/** What a page gives the editing: its fields, its editor's state, how it draws, and how it sends. */
export interface FieldEditingHost {
  /** The selector of the region the fields are drawn in: `.note-fields`, `.hub-fields`. */
  readonly region: string;
  /** The fields drawn now, and the note they are written in; undefined when none can be edited. */
  current(): { readonly fields: DrawnFields; readonly filePath: string } | undefined;
  /** The editor open now. */
  editing(): FieldEditing | undefined;
  /** Draws the page with this editor open, or none, then focuses what `focus` selects. */
  show(editing: FieldEditing | undefined, focus: string): void;
  /** Sends one field edit to the host. */
  send(message: SetNoteFieldMessage): void;
}

/** The page's handlers for its fields: their actions, by `data-action`, and their typing and keys. */
export interface FieldEditingControls {
  readonly actions: Readonly<Record<string, (element: HTMLElement) => void>>;
  /** Keeps what is typed in an editor's input; true when the input was one. */
  handleInput(event: Event): boolean;
  /** Enter opens a focused row's editor or takes what is typed; Escape closes it. True when the key was taken. */
  handleKeydown(event: KeyboardEvent): boolean;
}

/** A free key's shape, as the parser reads one. */
const FREE_KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** A selector inside the host's fields region. */
function within(host: FieldEditingHost, selector: string): string {
  return `${host.region} ${selector}`;
}

/** A field shown, by its key: one that holds something, or an empty one. */
function findField(host: FieldEditingHost, key: string | undefined) {
  const fields = host.current()?.fields;
  return key ? [...(fields?.fields ?? []), ...(fields?.empty ?? [])].find((field) => field.edit?.key === key) : undefined;
}

/** Sends one field edit for the note the fields are written in. */
function sendField(host: FieldEditingHost, key: string, value: FieldEditValue): void {
  const filePath = host.current()?.filePath;
  if (filePath) {
    host.send({ type: 'setNoteField', filePath, key, value });
  }
}

/** Closes the editor, focus going back to the field's Edit, or to Add field…. */
function closeEditor(host: FieldEditingHost, key?: string): void {
  host.show(undefined, within(host, key ? `.field-edit[data-field-key="${key}"]` : '.field-add-button'));
}

/**
 * Opens a field's editor, its input holding what the field holds when it
 * is typed, and its filter empty when it is a list; or closes it when it
 * is open. Focus goes to its input, or its first choice.
 */
function toggleEditor(host: FieldEditingHost, key: string): void {
  const field = findField(host, key);
  if (!field?.edit) {
    return;
  }
  const editing = host.editing();
  if (editing?.key === key && !editing.adding && !editing.other) {
    closeEditor(host, key);
    return;
  }
  const typed = field.edit.input === 'rows' || field.edit.input === 'options' ? '' : (field.edit.current[0] ?? '');
  host.show({ key, text: typed }, within(host, `.field-row[data-field-key="${key}"] .field-editor :is(input, button)`));
}

/** After a choice: a field that holds several keeps its list open for the next; any other closes it. */
function afterChoice(host: FieldEditingHost, key: string): void {
  if (!findField(host, key)?.edit?.many) {
    closeEditor(host, key);
  }
}

/** Add field…'s Other…: the key typed and its value, sent when the key is one front matter can have. */
function setOtherField(host: FieldEditingHost): void {
  const editing = host.editing();
  const key = editing?.key?.trim() ?? '';
  const text = editing?.text.trim() ?? '';
  if (!FREE_KEY.test(key) || !text) {
    announce('Write a key that starts with a letter, then a value.');
    return;
  }
  sendField(host, key, { kind: 'text', text });
  closeEditor(host);
}

/** Each field control's action, by its `data-action`. */
function fieldActions(host: FieldEditingHost): Record<string, (element: HTMLElement) => void> {
  const keyOf = (element: HTMLElement): string => String(element.dataset.fieldKey);
  return {
    'edit-field': (element) => toggleEditor(host, keyOf(element)),
    'choose-field-row': (element) => {
      sendField(host, keyOf(element), { kind: 'row', rowId: String(element.dataset.rowId) });
      afterChoice(host, keyOf(element));
    },
    'choose-field-option': (element) => {
      sendField(host, keyOf(element), { kind: 'option', option: String(element.dataset.option) });
      afterChoice(host, keyOf(element));
    },
    'set-field-text': (element) => {
      const text = host.editing()?.text.trim() ?? '';
      if (!text) {
        return;
      }
      sendField(host, keyOf(element), { kind: 'text', text });
      closeEditor(host, keyOf(element));
    },
    'toggle-field': (element) => sendField(host, keyOf(element), { kind: 'checkbox', checked: (element as HTMLInputElement).checked }),
    'clear-field': (element) => {
      sendField(host, keyOf(element), { kind: 'clear' });
      closeEditor(host, keyOf(element));
    },
    'add-field': () => {
      const editing = host.editing();
      if (editing?.adding || editing?.other) {
        closeEditor(host);
        return;
      }
      host.show({ adding: true, text: '' }, within(host, '.field-add .field-choice'));
    },
    'add-other-field': () => host.show({ other: true, key: '', text: '' }, within(host, '.field-add .field-key-input')),
    'set-other-field': () => setOtherField(host),
  };
}

/**
 * Enter in the fields region: on a focused field, its Edit, which opens
 * its editor or, for a row no note describes, the form; in an editor's
 * input, takes its first choice, or sets what is typed. True when the key
 * was taken.
 */
function enterInFields(target: HTMLElement): boolean {
  if (target.matches('.field-row[data-field-key]')) {
    target.querySelector<HTMLElement>(':scope > .field-values > .field-edit')?.click();
    return true;
  }
  if (!target.matches('input[type="text"], input[type="date"]')) {
    return false;
  }
  const editor = target.closest('.field-editor, .field-add');
  editor?.querySelector<HTMLElement>('[data-action="choose-field-row"], [data-action="set-field-text"], [data-action="set-other-field"]')?.click();
  return true;
}

/** Keeps what is typed in an editor's input in the page's state, so a draw keeps it. */
function keepTyped(host: FieldEditingHost, event: Event): boolean {
  const input = event.target as HTMLInputElement | null;
  const editing = host.editing();
  if (!input?.closest?.(host.region) || !editing) {
    return false;
  }
  if (input.classList.contains('field-input')) {
    host.show({ ...editing, text: input.value }, '');
    return true;
  }
  if (input.classList.contains('field-key-input')) {
    host.show({ ...editing, key: input.value }, '');
    return true;
  }
  return false;
}

/** The fields' keys: Enter opens a field's editor or takes what it holds, and Escape closes it. */
function handleFieldKey(host: FieldEditingHost, event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target?.closest?.(host.region) || event.metaKey || event.ctrlKey || event.altKey) {
    return false;
  }
  const editing = host.editing();
  if (event.key === 'Escape' && editing) {
    event.preventDefault();
    closeEditor(host, editing.adding || editing.other ? undefined : editing.key);
    return true;
  }
  if (event.key === 'Enter' && enterInFields(target)) {
    event.preventDefault();
    return true;
  }
  return false;
}

/** The editing of one page's fields. */
export function createFieldEditing(host: FieldEditingHost): FieldEditingControls {
  return {
    actions: fieldActions(host),
    handleInput: (event) => keepTyped(host, event),
    handleKeydown: (event) => handleFieldKey(host, event),
  };
}
