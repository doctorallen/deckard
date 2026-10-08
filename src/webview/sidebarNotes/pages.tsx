/**
 * Deckard's pages, at the top of Context in every state it is in, held
 * there while the rest scrolls: the pages the reader keeps, as labeled rows
 * that say what is worth knowing about each now, or as one row of their
 * icons for a reader who knows them, named on hover and to a screen reader.
 * The page in front is drawn pressed. They are one toolbar, one Tab stop:
 * the arrow keys move between them, and Home and End go to either end.
 */
import type { ContextPage, ContextPageChoice, ContextPages } from '../../ui/protocol/sidebarNotes';
import { EmptyState } from '../shared/emptyState';
import { PAGE_ICONS } from '../shared/pageIcons';
import { ViewOptionChoices, ViewOptions } from '../shared/viewOptions';

/** Every page's button, which the toolbar's keys move between. */
const PAGE_BUTTON = '.context-pages [data-action="go-to-page"]';

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

/** What a page's button says, whichever way it is drawn: which page, its name and hint, and whether it is in front. */
function pageButtonProps(page: ContextPage, current: boolean) {
  return {
    type: 'button' as const,
    'data-action': 'go-to-page',
    'data-page': page.id,
    'aria-label': `${page.label}, ${page.description}`,
    'aria-current': current ? ('page' as const) : undefined,
  };
}

/** A page as a labeled row: its glyph and name, and what is worth knowing now, at the right. */
function PageRow({ page, current }: { readonly page: ContextPage; readonly current: boolean }) {
  return (
    <button class="pages-row" data-tip={page.detail} {...pageButtonProps(page, current)}>
      <PageIcon id={page.id} />
      <span class="pages-label">{page.label}</span>
      <span class="pages-description">{page.description}</span>
    </button>
  );
}

/** A page as its icon, named on hover and to a screen reader. */
function PageButton({ page, current }: { readonly page: ContextPage; readonly current: boolean }) {
  return (
    <button class="pages-icon" data-tip={`${page.label}: ${page.description}`} {...pageButtonProps(page, current)}>
      <PageIcon id={page.id} />
    </button>
  );
}

/** A pressed button for each page, which keeps it at the top of Context or leaves it out. */
function PageChoices({ choices }: { readonly choices: readonly ContextPageChoice[] }) {
  return (
    <div class="pages-choices" role="group" aria-label="Pages kept">
      {choices.map((choice) => (
        <button type="button" class={choice.shown ? 'active' : ''} data-action="set-page-shown" data-page={choice.id} aria-pressed={choice.shown}>
          {choice.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The gear beside the pages: draw them as a list or as icons, and which to
 * keep. Zen shows it while the band is pointed at or holds focus, and keeps
 * it drawn while no page is chosen, since it is the way to choose one.
 */
function PagesOptions({ pages }: { readonly pages: ContextPages }) {
  return (
    <ViewOptions
      name="pages"
      label="Pages: how they look, and which"
      attributes={{ 'data-zen-reveal': '', 'data-reveal-keep': pages.pages.length ? undefined : '' }}
      groups={[
        { label: 'Look', content: <ViewOptionChoices action="set-pages-style" choices={[['list', 'List'], ['icons', 'Icons']]} selected={pages.style} label="How the pages look" /> },
        ...(pages.choices ? [{ label: 'Pages', stacked: true, content: <PageChoices choices={pages.choices} /> }] : []),
      ]}
    />
  );
}

/**
 * The pages kept, as rows or icons, or a line saying where to choose them
 * when none is, with the gear that chooses them beside; nothing before the
 * host has said which.
 */
export function ContextPagesBar({ pages }: { readonly pages: ContextPages | undefined }) {
  if (!pages) {
    return null;
  }
  if (!pages.pages.length) {
    return (
      <div class="context-pages-band" data-zen-region="">
        <EmptyState class="pages-empty" state="No pages chosen." teach="Choose them from the gear." />
        <PagesOptions pages={pages} />
      </div>
    );
  }
  const icons = pages.style === 'icons';
  return (
    <div class="context-pages-band" data-zen-region="">
      <div
        class={icons ? 'context-pages is-icons' : 'context-pages'}
        role="toolbar"
        aria-label="Deckard pages"
        aria-orientation={icons ? 'horizontal' : 'vertical'}
      >
        {pages.pages.map((page) => (icons
          ? <PageButton page={page} current={page.id === pages.current} />
          : <PageRow page={page} current={page.id === pages.current} />))}
      </div>
      <PagesOptions pages={pages} />
    </div>
  );
}

/** The page whose button holds the toolbar's Tab stop, once the reader has moved it. */
let stop: string | undefined;

/**
 * After each draw, the toolbar is one Tab stop: the page the reader last
 * moved to, else the page in front, else the first. Every other button is
 * reached with the arrow keys.
 */
export function settlePagesTabStop(): void {
  const buttons = Array.from(document.querySelectorAll<HTMLElement>(PAGE_BUTTON));
  const at = buttons.find((button) => button.dataset.page === stop) ??
    buttons.find((button) => button.getAttribute('aria-current') === 'page') ??
    buttons[0];
  for (const button of buttons) {
    button.tabIndex = button === at ? 0 : -1;
  }
}

/** The keys that move along the toolbar, by which way it runs, and how far each moves. */
const STEPS: Readonly<Record<'horizontal' | 'vertical', Readonly<Record<string, number>>>> = {
  horizontal: { ArrowRight: 1, ArrowLeft: -1 },
  vertical: { ArrowDown: 1, ArrowUp: -1 },
};

/** Where a key sends the focus from the button at `at` of `count`, or undefined for a key the toolbar leaves alone. */
function stepFrom(at: number, count: number, key: string, steps: Readonly<Record<string, number>>): number | undefined {
  if (key in steps) {
    return Math.max(0, Math.min(count - 1, at + steps[key]));
  }
  if (key === 'Home') {
    return 0;
  }
  return key === 'End' ? count - 1 : undefined;
}

/**
 * The arrow keys move between the pages, right and left in the icons and
 * down and up in the list, and Home and End go to either end; the Tab stop
 * moves with the focus, by a key or a click.
 */
export function installPagesKeys(): void {
  document.addEventListener('keydown', (event) => {
    const current = (event.target as HTMLElement | null)?.closest?.<HTMLElement>(PAGE_BUTTON);
    if (!current) {
      return;
    }
    const buttons = Array.from(document.querySelectorAll<HTMLElement>(PAGE_BUTTON));
    const horizontal = current.closest('[role="toolbar"]')?.getAttribute('aria-orientation') === 'horizontal';
    const next = stepFrom(buttons.indexOf(current), buttons.length, event.key, STEPS[horizontal ? 'horizontal' : 'vertical']);
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    buttons[next].focus();
  });
  document.addEventListener('focusin', (event) => {
    const button = (event.target as HTMLElement | null)?.closest?.<HTMLElement>(PAGE_BUTTON);
    if (!button || button.dataset.page === stop) {
      return;
    }
    stop = button.dataset.page;
    settlePagesTabStop();
  });
}
