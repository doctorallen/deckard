/**
 * The keys a page answers, on `?`.
 *
 * A page's own keys, `/` to search, the arrows and single letters on the
 * board, the menu key, were written down nowhere a reader would look. The
 * sheet is a dialog appended to the body, outside `#app`, drawn as a render
 * root of its own, and removed when it closes.
 */
import { render } from 'preact';

/** One section of the sheet: its title, and each key with what it does. */
export interface KeySection {
  readonly title: string;
  readonly keys: ReadonlyArray<readonly [key: string, does: string]>;
}

/** The keys every page shares, listed last. */
const SHARED_KEYS: KeySection = {
  title: 'Everywhere',
  keys: [
    ['/', 'Go to the search box'],
    ['Shift+F10, or the menu key', 'Open the menu of what has focus'],
    ['Esc', 'Close a menu or this sheet'],
    ['?', 'Show these keys'],
  ],
};

/** The open sheet, and what had focus before it opened. */
const sheet: { element?: HTMLElement; opener?: Element | null } = {};

/** The sheet's panel: a heading, each section's keys, and Close. */
function KeySheetPanel({ sections }: { readonly sections: readonly KeySection[] }) {
  return (
    <div class="key-sheet-panel">
      <h2 id="key-sheet-title">Keys on this page</h2>
      {sections.map((section) => [
        <h3>{section.title}</h3>,
        <dl>
          {section.keys.map((entry) => (
            <div>
              <dt><kbd>{entry[0]}</kbd></dt>
              <dd>{entry[1]}</dd>
            </div>
          ))}
        </dl>,
      ])}
      <button type="button" data-action="close-key-sheet">Close</button>
    </div>
  );
}

/** Closes the sheet, if it is open, and gives focus back to what had it. */
export function closeKeySheet(): void {
  const element = sheet.element;
  if (!element) {
    return;
  }
  render(null, element);
  element.remove();
  sheet.element = undefined;
  const opener = sheet.opener as HTMLElement | null | undefined;
  if (opener && opener.focus) {
    opener.focus();
  }
  sheet.opener = undefined;
}

/**
 * Opens the sheet with a page's own sections, then the keys every page
 * shares, and focuses Close, which gives focus back to `opener` when the
 * sheet closes: what had focus, unless the page names another.
 */
export function openKeySheet(sections: readonly KeySection[], opener: Element | null = document.activeElement): void {
  closeKeySheet();
  sheet.opener = opener;
  const element = document.createElement('div');
  element.setAttribute('class', 'key-sheet');
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-modal', 'true');
  element.setAttribute('aria-labelledby', 'key-sheet-title');
  render(<KeySheetPanel sections={[...sections, SHARED_KEYS]} />, element);
  document.body.appendChild(element);
  sheet.element = element;
  element.querySelector<HTMLElement>('[data-action="close-key-sheet"]')?.focus();
}

/**
 * Opens the sheet on `?`, outside a field, or on Keyboard shortcuts in the
 * page's ⋯, and closes it on Escape, on Close, or on a click outside its
 * panel. While it is open, Tab stays on Close, its one control. `sections`
 * is the page's own, or a function that makes them when the sheet opens.
 */
export function installKeySheet(sections: readonly KeySection[] | (() => readonly KeySection[])): void {
  document.addEventListener('keydown', (event) => {
    if (sheet.element && (event.key === 'Escape' || event.key === 'Tab')) {
      event.preventDefault();
      if (event.key === 'Escape') {
        closeKeySheet();
      }
      return;
    }
    if (event.key !== '?' || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const target = event.target as Element | null;
    if (target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]')) {
      return;
    }
    event.preventDefault();
    openKeySheet(typeof sections === 'function' ? sections() : sections);
  });
  document.addEventListener('click', (event) => {
    const target = event.target as Element;
    // From ⋯, whose menu has closed: focus goes back to ⋯ afterwards.
    const row = target.closest ? target.closest('[data-action="open-key-sheet"]') : null;
    if (row) {
      openKeySheet(typeof sections === 'function' ? sections() : sections, row.closest('.view-options')?.querySelector('summary') ?? row);
      return;
    }
    if (!sheet.element) {
      return;
    }
    if (target.closest('[data-action="close-key-sheet"]') || !target.closest('.key-sheet-panel')) {
      closeKeySheet();
    }
  });
}
