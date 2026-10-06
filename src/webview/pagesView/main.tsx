/**
 * The Pages view, in the sidebar: the Deckard pages the reader keeps there,
 * as labeled rows that say what is worth knowing about each now, or as a
 * row of their icons for a reader who knows them. Each opens its page; the
 * arrow keys move between them, as in a tree.
 */
import type { StateMessage } from '../../ui/protocol/messaging';
import type { PagesViewPage, PagesViewSnapshot } from '../../ui/protocol/pagesView';
import { listenForActions, onHostMessage, readEmbeddedState, startPage } from '../shared/page';
import { PAGE_ICONS } from '../shared/pageIcons';
import { post } from '../shared/vscode';

/** What the view draws from: the snapshot the host sent. */
interface PagesState {
  readonly snapshot: PagesViewSnapshot | undefined;
}

/** A page's glyph, hidden from a screen reader, which reads the page's name. */
function PageIcon({ id }: { readonly id: string }) {
  const icon = PAGE_ICONS[id];
  if (!icon) {
    return <span class="pages-glyph" aria-hidden="true" />;
  }
  return (
    <svg class="pages-glyph" viewBox={icon.viewBox} aria-hidden="true" focusable="false">
      <path fill="currentColor" fill-rule="evenodd" d={icon.path} />
    </svg>
  );
}

/** A page as a labeled row: its glyph and name, and what is worth knowing now, at the right. */
function PageRow({ page }: { readonly page: PagesViewPage }) {
  return (
    <li>
      <button type="button" class="pages-row" data-action="go-to-page" data-page={page.id} data-tip={page.detail} aria-label={`${page.label}, ${page.description}`}>
        <PageIcon id={page.id} />
        <span class="pages-label">{page.label}</span>
        <span class="pages-description">{page.description}</span>
      </button>
    </li>
  );
}

/** A page as its icon, named on hover and to a screen reader. */
function PageButton({ page }: { readonly page: PagesViewPage }) {
  return (
    <li>
      <button type="button" class="pages-icon" data-action="go-to-page" data-page={page.id} data-tip={`${page.label}: ${page.description}`} aria-label={`${page.label}, ${page.description}`}>
        <PageIcon id={page.id} />
      </button>
    </li>
  );
}

/** Every page kept, as rows or icons; a line saying where to choose them when none is. */
function PagesView({ snapshot }: { readonly snapshot: PagesViewSnapshot }) {
  if (!snapshot.pages.length) {
    return <p class="pages-empty">No pages chosen. Tick them in Settings, under Deckard › Pages: Shown.</p>;
  }
  const icons = snapshot.style === 'icons';
  return (
    <nav aria-label="Deckard pages">
      <ul class={icons ? 'pages-list is-icons' : 'pages-list'}>
        {snapshot.pages.map((page) => (icons ? <PageButton page={page} /> : <PageRow page={page} />))}
      </ul>
    </nav>
  );
}

const store = startPage<PagesState>({
  initial: { snapshot: readEmbeddedState<PagesViewSnapshot>() },
  ready: (state) => state.snapshot !== undefined,
  view: (state) => <PagesView snapshot={state.snapshot as PagesViewSnapshot} />,
});

listenForActions(document.getElementById('app') as HTMLElement, {
  'go-to-page': (element) => post({ type: 'goToPage', page: String(element.dataset.page) }),
});

/**
 * The arrow keys move between the pages, down and up in the list and right
 * and left in the icons, and Home and End go to either end, as in a tree.
 */
document.addEventListener('keydown', (event) => {
  const current = (event.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-action="go-to-page"]');
  if (!current) {
    return;
  }
  const buttons = Array.from(document.querySelectorAll<HTMLElement>('[data-action="go-to-page"]'));
  const at = buttons.indexOf(current);
  const icons = store.state.snapshot?.style === 'icons';
  const steps: Record<string, number> = icons
    ? { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 }
    : { ArrowDown: 1, ArrowUp: -1 };
  let next: number | undefined;
  if (event.key in steps) {
    next = Math.max(0, Math.min(buttons.length - 1, at + steps[event.key]));
  } else if (event.key === 'Home') {
    next = 0;
  } else if (event.key === 'End') {
    next = buttons.length - 1;
  }
  if (next === undefined) {
    return;
  }
  event.preventDefault();
  buttons[next].focus();
});

onHostMessage<StateMessage<PagesViewSnapshot>>('state', (message) => store.update({ snapshot: message.data }));
