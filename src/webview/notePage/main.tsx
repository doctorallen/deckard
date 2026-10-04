/**
 * The note page: one note, read in a Deckard page. Its links, tags, tasks,
 * and query blocks post what they ask for, and the host checks each against
 * the index as it is now. Shift on a click opens the note the other way, in
 * the editor, and Cmd/Ctrl with Shift opens it there beside; a note opened
 * on this page replaces the one shown.
 */
import type { NoteBreadcrumb, NotePageMessage, NotePageSnapshot, NoteProperty } from '../../ui/protocol/notePage';
import type { StateMessage } from '../../ui/protocol/messaging';
import { ProgressBar } from '../shared/progressBar';
import { type ActionHandler, listenForActions, onHostMessage, readEmbeddedState, startPage } from '../shared/page';
import { announce } from '../shared/status';
import { TagButton } from '../shared/tagButton';
import { keepState, post } from '../shared/vscode';
import { Blocks } from './body';

/** Sends the host one of the messages the note page may send. */
function send(message: NotePageMessage): void {
  post(message);
}

/** What the page draws from. */
interface NotePageState {
  readonly snapshot: NotePageSnapshot | undefined;
}

/** Back, Forward, and Open in Editor, above the note. */
function Toolbar({ snapshot }: { readonly snapshot: NotePageSnapshot }) {
  return (
    <div class="note-toolbar" role="toolbar" aria-label="Note">
      <button type="button" class="icon-button" data-action="history-back" disabled={!snapshot.history.back} aria-label="Back" data-tip="Back to the note before">‹</button>
      <button type="button" class="icon-button" data-action="history-forward" disabled={!snapshot.history.forward} aria-label="Forward" data-tip="Forward to the next note">›</button>
      <button type="button" data-action="open-in-editor" disabled={snapshot.missing} data-tip="Open this note in the editor · Cmd/Ctrl-click: beside">Open in Editor</button>
    </div>
  );
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

/** The note's front matter, a tag among the values a button that opens it. */
function Properties({ properties }: { readonly properties: readonly NoteProperty[] }) {
  if (!properties.length) {
    return null;
  }
  return (
    <dl class="note-properties">
      {properties.map((property) => (
        <div>
          <dt>{property.name}</dt>
          <dd>
            {property.values.map((value, at) => [
              at > 0 ? ', ' : null,
              value.tagKey ? <TagButton tag={{ key: value.tagKey, label: value.text }} className="inline-tag" /> : value.text,
            ])}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** For a hub note, how far along its tag's tasks are, wherever they are written, and the way to its page. */
function HubLine({ hub }: { readonly hub: NonNullable<NotePageSnapshot['hub']> }) {
  return (
    <div class="note-progress">
      <span class="eyebrow" data-tip={`Every task ${hub.tagLabel} finds, in any note`}>{hub.kind}</span>
      <ProgressBar done={hub.done} total={hub.total} />
      <span class="note-progress-label">{hub.label}</span>
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
      <span class="note-progress-label">{progress.label}</span>
    </div>
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
            <button type="button" class="note-backlink-title" data-action="open-note" data-file-path={link.filePath}>{link.title}</button>
            {link.count > link.lines.length ? <span class="note-backlink-more">{` ${link.count} lines`}</span> : null}
            <ul class="note-backlink-lines">
              {link.lines.map((line) => (
                <li><button type="button" class="note-backlink-line" data-action="open-note" data-file-path={link.filePath} data-line={line.line}>{line.text}</button></li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The whole page: the toolbar, the header, the note, and what links to it. */
function NotePage({ snapshot }: { readonly snapshot: NotePageSnapshot }) {
  if (snapshot.missing) {
    return (
      <>
        <Toolbar snapshot={snapshot} />
        <header><p class="eyebrow">DECKARD / NOTE</p><h1>{snapshot.title}</h1></header>
        <p class="note-missing">Deckard has no note at {snapshot.filePath} now. It may have been moved, renamed, or deleted.</p>
      </>
    );
  }
  return (
    <>
      <Toolbar snapshot={snapshot} />
      <header class="note-header">
        <p class="eyebrow">{snapshot.folder ? `DECKARD / NOTE / ${snapshot.folder.toUpperCase()}` : 'DECKARD / NOTE'}</p>
        <h1>{snapshot.title}</h1>
        <Breadcrumbs crumbs={snapshot.breadcrumbs} />
        {snapshot.hub ? <HubLine hub={snapshot.hub} /> : null}
        {snapshot.taskProgress ? <TaskLine progress={snapshot.taskProgress} /> : null}
        <Properties properties={snapshot.properties} />
      </header>
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
/** The snapshot last drawn, which the first draw needs before the store exists. */
let drawn: NotePageSnapshot | undefined;
const store = startPage<NotePageState>({
  initial: { snapshot: readEmbeddedState<NotePageSnapshot>() },
  ready: (state) => Boolean(state.snapshot),
  view: (state) => {
    drawn = state.snapshot;
    return <NotePage snapshot={state.snapshot as NotePageSnapshot} />;
  },
  afterDraw: () => {
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
};

const app = document.getElementById('app') as HTMLElement;
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

onHostMessage<StateMessage<NotePageSnapshot>>('state', (message) => store.update({ snapshot: message.data }));
