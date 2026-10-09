/**
 * The note page: one note, read in a Deckard page. Its links, tags, tasks,
 * and query blocks post what they ask for, and the host checks each against
 * the index as it is now. Shift on a click opens the note the other way, in
 * the editor, and Cmd/Ctrl with Shift opens it there beside; a note opened
 * on this page replaces the one shown.
 */
import type { ComponentChildren } from 'preact';

import type { NoteBreadcrumb, NotePageMessage, NotePageSnapshot, NoteProperty } from '../../ui/protocol/notePage';
import type { StateMessage } from '../../ui/protocol/messaging';
import { IconButton } from '../shared/buttons';
import { ProgressBar } from '../shared/progressBar';
import { ProgressWords } from '../shared/progressWords';
import { type ActionHandler, listenForActions, onHostMessage, readEmbeddedState, startPage } from '../shared/page';
import { PageBar } from '../shared/pageBar';
import { announce } from '../shared/status';
import { TagButton } from '../shared/tagButton';
import { installViewOptions, type ViewOptionItem } from '../shared/viewOptions';
import { keepState, post } from '../shared/vscode';
import { Blocks } from '../shared/noteBlocks';
import { AddField, FieldRows, type FieldEditing, readableValue } from '../shared/fieldRows';
import type { FieldEditValue } from '../../ui/protocol/fields';

/** Sends the host one of the messages the note page may send. */
function send(message: NotePageMessage): void {
  post(message);
}

/** What the page draws from: the note, and which of its fields' editors is open. */
interface NotePageState {
  readonly snapshot: NotePageSnapshot | undefined;
  readonly editing?: FieldEditing;
}

/**
 * The bar's secondaries, Back, Forward and Open in Editor, a plain button
 * since it goes somewhere rather than commits anything; ⋯ follows them.
 */
function NoteControls({ snapshot }: { readonly snapshot: NotePageSnapshot }) {
  return (
    <>
      <span class="history-buttons" role="group" aria-label="Note history">
        <IconButton action="history-back" label="Back to the note before" icon="‹" disabledReason={snapshot.history.back ? '' : 'No note before this one'} />
        <IconButton action="history-forward" label="Forward to the next note" icon="›" disabledReason={snapshot.history.forward ? '' : 'No note after this one'} />
      </span>
      <button type="button" data-action="open-in-editor" disabled={snapshot.missing} data-tip="Open this note in the editor · Cmd/Ctrl-click: beside">Open in Editor</button>
    </>
  );
}

/**
 * ⋯'s first rows: what can be done with the note outside the editor, from
 * the one note-action table that Note Actions and the editor's Deckard
 * submenu list too, as the host sends them.
 */
function noteActionRows(snapshot: NotePageSnapshot): ViewOptionItem[] {
  return (snapshot.actions ?? []).map((action) => ({ action: 'run-note-action', text: action.title, attributes: { 'data-command': action.command } }));
}

/** The bar every page draws: the note's place and title at the left, its controls and ⋯ at the right, which holds the note's actions, Appearance and Help. */
function NoteBar({ snapshot, trail, lead }: { readonly snapshot: NotePageSnapshot; readonly trail: string; readonly lead: ComponentChildren }) {
  return <PageBar trail={trail} leadClass="note-lead" label="Note" lead={lead} controls={<NoteControls snapshot={snapshot} />} menu={{ actions: noteActionRows(snapshot), pageWidth: true }} />;
}

/** Each way up from the note to its hubs, a step that is a note a button that opens it. */
function Breadcrumbs({ crumbs }: { readonly crumbs: readonly NoteBreadcrumb[] }) {
  if (!crumbs.length) {
    return null;
  }
  return (
    <nav class="note-breadcrumbs" aria-label="Where this note sits">
      {crumbs.map((crumb) => {
        const offset = crumb.labels.length - crumb.notes.length;
        return (
          <p class="note-breadcrumb">
            {crumb.labels.map((label, at) => {
              const note = at >= offset ? crumb.notes[at - offset] : undefined;
              const last = at === crumb.labels.length - 1;
              const step = note && !last
                ? <button type="button" class="note-crumb" data-action="open-note" data-file-path={note}>{label}</button>
                : <span class={last ? 'note-crumb is-current' : 'note-crumb'}>{label}</span>;
              return [at > 0 ? <span class="note-crumb-join" aria-hidden="true"> › </span> : null, step];
            })}
          </p>
        );
      })}
    </nav>
  );
}

/**
 * The front-matter keys Deckard gives a meaning, by the name a reader knows
 * them by; any other key reads as written. A Map, since the key is the
 * reader's text.
 */
const PROPERTY_NAMES: ReadonlyMap<string, string> = new Map([
  ['describes', 'About'],
  ['up', 'Filed under'],
  ['aliases', 'Also called'],
  ['alias', 'Also called'],
  ['tags', 'Tags'],
]);

/** The note's front matter, a tag among the values a button that opens it. */
function Properties({ properties }: { readonly properties: readonly NoteProperty[] }) {
  if (!properties.length) {
    return null;
  }
  return (
    <dl class="note-properties">
      {properties.map((property) => (
        <div>
          <dt>{PROPERTY_NAMES.get(property.name.toLowerCase()) ?? property.name}</dt>
          <dd>
            {property.values.map((value, at) => [
              at > 0 ? ', ' : null,
              value.tagKey ? <TagButton tag={{ key: value.tagKey, label: value.text }} className="inline-tag" /> : readableValue(value.text),
            ])}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A typed row's type, a link that opens the search for its rows. It reads
 * as a label but is no eyebrow: it carries data, so Zen keeps it.
 */
function TypeLink({ name, query }: { readonly name: string; readonly query: string }) {
  return <button type="button" class="type-link" data-action="open-search" data-query={query} data-tip={`Search every ${name.toLowerCase()}: ${query}`}>{name}</button>;
}

/**
 * For a hub note, how far along its tag's tasks are, wherever they are
 * written, and the way to its page; a typed row's type names the line and
 * opens its rows.
 */
function HubLine({ hub }: { readonly hub: NonNullable<NotePageSnapshot['hub']> }) {
  return (
    <div class="note-progress">
      {hub.typeQuery
        ? <TypeLink name={hub.kind} query={hub.typeQuery} />
        : <span class="eyebrow" data-tip={`Every task ${hub.tagLabel} finds, in any note`}>{hub.kind}</span>}
      <ProgressBar done={hub.done} total={hub.total} />
      <span class="note-progress-label"><ProgressWords parts={hub.parts} action="open-search" attributes={(part) => ({ 'data-query': part.query ?? '' })} /></span>
      <button type="button" class="tag-note-action" data-action="open-tag" data-tag-key={hub.tagKey} data-tip={`Open ${hub.tagLabel}'s page`}>{`Open ${hub.tagLabel}`}</button>
    </div>
  );
}

/** How far along the note's own tasks are. */
function TaskLine({ progress }: { readonly progress: NonNullable<NotePageSnapshot['taskProgress']> }) {
  return (
    <div class="note-progress">
      <span class="eyebrow" data-tip="The tasks written in this note, steps aside">Tasks</span>
      <ProgressBar done={progress.done} total={progress.total} />
      <span class="note-progress-label"><ProgressWords parts={progress.parts} action="open-search" attributes={(part) => ({ 'data-query': part.query ?? '' })} /></span>
    </div>
  );
}

/**
 * Under the bar's divider, the note's front matter: for a typed row, its
 * fields, each it writes with its Edit, the empty ones folded, and Add
 * field…, with its type named above them unless its hub line names it;
 * for any other note, its properties as written. Zen quiets Edit and Add
 * field… here until the region is pointed at or holds focus.
 */
function NoteFields({ snapshot, editing }: { readonly snapshot: NotePageSnapshot; readonly editing: FieldEditing | undefined }) {
  const fields = snapshot.fields;
  if (!fields) {
    return snapshot.properties.length
      ? <section class="note-fields" data-zen-region="" aria-label="Properties"><Properties properties={snapshot.properties} /></section>
      : null;
  }
  return (
    <section class="note-fields" data-zen-region="" aria-label={`${fields.typeName} fields`}>
      {snapshot.hub?.typeQuery ? null : <p class="note-fields-type"><TypeLink name={fields.typeName} query={fields.typeQuery} /></p>}
      <FieldRows fields={fields} noteAction="open-note" editable editing={editing} />
      <AddField fields={fields} editing={editing} />
    </section>
  );
}

/** The notes that link here, each with the lines that do, which open where they link. */
function LinkedFrom({ snapshot }: { readonly snapshot: NotePageSnapshot }) {
  if (!snapshot.backlinkCount) {
    return null;
  }
  return (
    <section class="note-backlinks" aria-labelledby="note-backlinks-heading">
      <h2 id="note-backlinks-heading">{'Linked from '}<span class="tag-count">{snapshot.backlinkCount}</span></h2>
      <ul>
        {snapshot.backlinks.map((link) => (
          <li class="note-backlink">
            <button type="button" class="note-backlink-title note-text" data-action="open-note" data-file-path={link.filePath}>{link.title}</button>
            {link.count > link.lines.length ? <span class="note-backlink-more">{` ${link.count} lines`}</span> : null}
            <ul class="note-backlink-lines">
              {link.lines.map((line) => (
                <li><button type="button" class="note-backlink-line note-text" data-action="open-note" data-file-path={link.filePath} data-line={line.line}>{line.text}</button></li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The whole page: the header with its toolbar, the note's fields, the note, and what links to it. */
function NotePage({ snapshot, editing }: { readonly snapshot: NotePageSnapshot; readonly editing: FieldEditing | undefined }) {
  if (snapshot.missing) {
    return (
      <>
        <NoteBar snapshot={snapshot} trail="NOTE" lead={<h1 class="note-text">{snapshot.title}</h1>} />
        <p class="note-missing">Deckard has no note at {snapshot.filePath} now. It may have been moved, renamed, or deleted.</p>
      </>
    );
  }
  return (
    <>
      <NoteBar
        snapshot={snapshot}
        trail={snapshot.folder ? `NOTE / ${snapshot.folder.toUpperCase()}` : 'NOTE'}
        lead={(
          <>
            <h1 class="note-text">{snapshot.title}</h1>
            <Breadcrumbs crumbs={snapshot.breadcrumbs} />
            {snapshot.hub ? <HubLine hub={snapshot.hub} /> : null}
            {snapshot.taskProgress ? <TaskLine progress={snapshot.taskProgress} /> : null}
          </>
        )}
      />
      <NoteFields snapshot={snapshot} editing={editing} />
      <article class="note-body" aria-label={snapshot.title}>
        {snapshot.blocks.length
          ? <Blocks blocks={snapshot.blocks} context={{ tags: snapshot.tags }} />
          : <p class="note-empty">This note has nothing under its title yet.</p>}
      </article>
      <LinkedFrom snapshot={snapshot} />
    </>
  );
}

let shownVisit: number | undefined;
/** What takes focus once the page is drawn again, such as an editor just opened. */
let focusAfterDraw: string | undefined;
/** The snapshot last drawn, which the first draw needs before the store exists. */
let drawn: NotePageSnapshot | undefined;
const store = startPage<NotePageState>({
  initial: { snapshot: readEmbeddedState<NotePageSnapshot>() },
  ready: (state) => Boolean(state.snapshot),
  view: (state) => {
    drawn = state.snapshot;
    return <NotePage snapshot={state.snapshot as NotePageSnapshot} editing={state.editing} />;
  },
  afterDraw: () => {
    if (focusAfterDraw) {
      document.querySelector<HTMLElement>(focusAfterDraw)?.focus();
      focusAfterDraw = undefined;
    }
    const snapshot = drawn;
    if (!snapshot || snapshot.visit === shownVisit) {
      return;
    }
    shownVisit = snapshot.visit;
    keepState({ filePath: snapshot.filePath, ...(snapshot.focusLine ? { line: snapshot.focusLine } : {}) });
    showLine(snapshot.focusLine);
  },
});

/**
 * A note newly asked for opens at the line it was asked for, which is
 * marked for a moment, or at its top; a redraw of the same note stays
 * where the reader is.
 */
function showLine(line: number | undefined): void {
  if (!line) {
    window.scrollTo(0, 0);
    return;
  }
  const blocks = [...document.querySelectorAll<HTMLElement>('.note-body [data-line]:not([data-file-path])')];
  const target = blocks.filter((block) => Number(block.dataset.line) <= line).pop();
  if (!target) {
    // The line is the title or the front matter, above every block.
    window.scrollTo(0, 0);
    return;
  }
  target.scrollIntoView?.({ block: 'center' });
  target.classList.add('is-focused');
  setTimeout(() => target.classList.remove('is-focused'), 1600);
}

/**
 * The line of the first of the note's own blocks in view, for Open in
 * Editor to open where the reader is; none at the top, where the line the
 * note was asked for is in view.
 */
function lineInView(): number | undefined {
  if (window.scrollY <= 0) {
    return undefined;
  }
  const blocks = [...document.querySelectorAll<HTMLElement>('.note-body [data-line]:not([data-file-path])')];
  const line = Number(blocks.find((block) => block.getBoundingClientRect().bottom > 0)?.dataset.line);
  return line > 0 ? line : undefined;
}

/** The modifiers a click carries: Shift the other way, Cmd/Ctrl beside. */
function modifiers(event: MouseEvent | KeyboardEvent): { opposite?: true; beside?: true } {
  return {
    ...(event.shiftKey ? { opposite: true } : {}),
    ...(event.metaKey || event.ctrlKey ? { beside: true } : {}),
  };
}

/** A field the note shown has, by its key: one that holds something, or an empty one. */
function findField(key: string | undefined) {
  const fields = store.state.snapshot?.fields;
  return key ? [...(fields?.fields ?? []), ...(fields?.empty ?? [])].find((field) => field.edit?.key === key) : undefined;
}

/** Sends a field edit for the note shown. */
function sendField(key: string, value: FieldEditValue): void {
  const filePath = store.state.snapshot?.filePath;
  if (filePath) {
    send({ type: 'setNoteField', filePath, key, value });
  }
}

/**
 * Opens a field's editor, its input holding what the field holds when it
 * is typed, and its filter empty when it is a list; or closes it when it is
 * open. Focus goes to its input, or its first choice.
 */
function toggleEditor(key: string): void {
  const field = findField(key);
  if (!field?.edit) {
    return;
  }
  if (store.state.editing?.key === key && !store.state.editing.adding && !store.state.editing.other) {
    closeEditor(key);
    return;
  }
  const typed = field.edit.input === 'rows' || field.edit.input === 'options' ? '' : (field.edit.current[0] ?? '');
  focusAfterDraw = `.field-row[data-field-key="${key}"] .field-editor :is(input, button)`;
  store.update({ editing: { key, text: typed } });
}

/** Closes the editor, focus going back to the field's Edit, or to Add field…. */
function closeEditor(key?: string): void {
  focusAfterDraw = key ? `.field-edit[data-field-key="${key}"]` : '.field-add-button';
  store.update({ editing: undefined });
}

/** After a choice: a field that holds several keeps its list open for the next; any other closes it. */
function afterChoice(key: string): void {
  if (!findField(key)?.edit?.many) {
    closeEditor(key);
  }
}

/** Every control's action, by its `data-action`. */
const ACTIONS: Readonly<Record<string, ActionHandler>> = {
  'history-back': () => send({ type: 'navigateNoteHistory', direction: 'back' }),
  'history-forward': () => send({ type: 'navigateNoteHistory', direction: 'forward' }),
  'open-in-editor': (_element, event) => {
    const line = lineInView();
    send({ type: 'openInEditor', ...(line ? { line } : {}), ...(event.metaKey || event.ctrlKey ? { beside: true } : {}) });
  },
  'open-note': (element, event) => {
    const line = Number(element.dataset.line);
    send({ type: 'openNote', filePath: String(element.dataset.filePath), ...(line > 0 ? { line } : {}), ...modifiers(event) });
  },
  'open-link': (element, event) => send({
    type: 'openWikiLink',
    target: String(element.dataset.target),
    ...(element.dataset.from ? { from: element.dataset.from } : {}),
    ...modifiers(event),
  }),
  'open-tag': (element) => send({ type: 'openTag', tagKey: String(element.dataset.tagKey) }),
  'run-note-action': (element) => send({ type: 'runNoteAction', command: String(element.dataset.command) }),
  // An image shows fitted to the column; selecting it shows it whole, and back.
  'toggle-image-size': (element) => {
    const whole = element.classList.toggle('is-whole');
    const alt = element.querySelector('img')?.getAttribute('alt') || 'Image';
    element.setAttribute('aria-label', `${alt}, shown ${whole ? 'at full size' : 'fitted'}; select to show it ${whole ? 'fitted' : 'at full size'}`);
  },
  'edit-field': (element) => toggleEditor(String(element.dataset.fieldKey)),
  'choose-field-row': (element) => {
    const key = String(element.dataset.fieldKey);
    sendField(key, { kind: 'row', rowId: String(element.dataset.rowId) });
    afterChoice(key);
  },
  'choose-field-option': (element) => {
    const key = String(element.dataset.fieldKey);
    sendField(key, { kind: 'option', option: String(element.dataset.option) });
    afterChoice(key);
  },
  'set-field-text': (element) => {
    const key = String(element.dataset.fieldKey);
    const text = store.state.editing?.text.trim() ?? '';
    if (!text) {
      return;
    }
    sendField(key, { kind: 'text', text });
    closeEditor(key);
  },
  'toggle-field': (element) => sendField(String(element.dataset.fieldKey), { kind: 'checkbox', checked: (element as HTMLInputElement).checked }),
  'clear-field': (element) => {
    const key = String(element.dataset.fieldKey);
    sendField(key, { kind: 'clear' });
    closeEditor(key);
  },
  'add-field': () => {
    if (store.state.editing?.adding || store.state.editing?.other) {
      closeEditor();
      return;
    }
    focusAfterDraw = '.field-add .field-choice';
    store.update({ editing: { adding: true, text: '' } });
  },
  'add-other-field': () => {
    focusAfterDraw = '.field-add .field-key-input';
    store.update({ editing: { other: true, key: '', text: '' } });
  },
  'set-other-field': () => {
    const editing = store.state.editing;
    const key = editing?.key?.trim() ?? '';
    const text = editing?.text.trim() ?? '';
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key) || !text) {
      announce('Write a key that starts with a letter, then a value.');
      return;
    }
    sendField(key, { kind: 'text', text });
    closeEditor();
  },
  'open-search': (element) => {
    if (element.dataset.query) {
      send({ type: 'openSearch', query: element.dataset.query });
    }
  },
};

const app = document.getElementById('app') as HTMLElement;
// The gear's theme and Zen rows, ahead of the page's own listeners.
installViewOptions();
listenForActions(app, ACTIONS);

// A box completes or reopens its task, as on every page, with Undo in the message.
document.addEventListener('change', (event) => {
  const box = event.target as HTMLInputElement | null;
  if (!box || box.dataset?.action !== 'toggle-task' || !box.dataset.taskId) {
    return;
  }
  send({ type: 'toggleTask', taskId: box.dataset.taskId, completed: box.checked });
  announce(`${box.checked ? 'Completed' : 'Reopened'} ${box.getAttribute('aria-label')?.replace(/^(Complete|Reopen) /, '') ?? 'the task'}.`);
});

// A double-click on a block opens the editor at its line: the note's own,
// or, inside an embed, the line of the note it came from.
app.addEventListener('dblclick', (event) => {
  const target = event.target as Element | null;
  if (target?.closest?.('button, a, input')) {
    return;
  }
  const block = target?.closest?.<HTMLElement>('[data-line]');
  const line = Number(block?.dataset.line);
  if (!block || !(line > 0)) {
    return;
  }
  window.getSelection?.()?.removeAllRanges();
  if (block.dataset.filePath) {
    send({ type: 'openNote', filePath: block.dataset.filePath, line, opposite: true });
    return;
  }
  send({ type: 'openInEditor', line });
});

// The mouse's back and forward buttons step through the notes, as in a browser.
document.addEventListener('mouseup', (event) => {
  if (event.button !== 3 && event.button !== 4) {
    return;
  }
  event.preventDefault();
  send({ type: 'navigateNoteHistory', direction: event.button === 3 ? 'back' : 'forward' });
});

// What is typed in a field's editor is kept in the page's state, so a draw keeps it.
app.addEventListener('input', (event) => {
  const input = event.target as HTMLInputElement | null;
  const editing = store.state.editing;
  if (!input || !editing || !input.closest?.('.note-fields')) {
    return;
  }
  if (input.classList.contains('field-input')) {
    store.update({ editing: { ...editing, text: input.value } });
  } else if (input.classList.contains('field-key-input')) {
    store.update({ editing: { ...editing, key: input.value } });
  }
});

/**
 * Enter in the fields region: on a focused field, opens its editor; in an
 * editor's input, takes its first choice, or sets what is typed. True when
 * the key was taken.
 */
function enterInFields(target: HTMLElement): boolean {
  if (target.matches('.field-row[data-field-key]')) {
    toggleEditor(String(target.dataset.fieldKey));
    return true;
  }
  if (!target.matches('input[type="text"], input[type="date"]')) {
    return false;
  }
  const editor = target.closest('.field-editor, .field-add');
  editor?.querySelector<HTMLElement>('[data-action="choose-field-row"], [data-action="set-field-text"], [data-action="set-other-field"]')?.click();
  return true;
}

// The fields' keys: Enter opens a field's editor or takes what it holds, and Escape closes it.
app.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  if (!target?.closest?.('.note-fields') || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  const editing = store.state.editing;
  if (event.key === 'Escape' && editing) {
    event.preventDefault();
    closeEditor(editing.adding || editing.other ? undefined : editing.key);
  } else if (event.key === 'Enter' && enterInFields(target)) {
    event.preventDefault();
  }
});

onHostMessage<StateMessage<NotePageSnapshot>>('state', (message) => {
  // Another note closes any editor; the same note, drawn again after a write, keeps a list open.
  const sameNote = message.data.visit === store.state.snapshot?.visit;
  store.update({ snapshot: message.data, ...(sameNote ? {} : { editing: undefined }) });
});
