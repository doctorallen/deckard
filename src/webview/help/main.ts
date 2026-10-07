/**
 * Help's page script: Help is the guide, docs/guide, with its contents down
 * the side (decision Q6 of docs/implementation/20-webviews.md has the host
 * draw it). This asks the host for the guide page to show and shows it,
 * shows What's new, which the host drew in the page, runs a command named
 * in the guide, goes to the place the host asks for, and marks the page
 * being read in the contents.
 *
 * Help is not kept running while its tab is hidden, so VS Code loads it
 * again when it is shown. What it saves with `setState` brings it back where
 * it was: the page it showed, and how far down it was scrolled.
 */
import type { HelpGuideMessage, HelpHostToPage, HelpMessage } from '../../ui/protocol/help';
import { installGoToMenu } from '../shared/goToMenu';

/** What VS Code gives a webview's script. */
interface VsCodeApi {
  postMessage(message: HelpMessage): void;
  setState(state: HelpState): void;
  getState(): unknown;
}

declare function acquireVsCodeApi(): VsCodeApi;

/** A place in Help: a guide page by its file name, or What's new, at a heading when one is named. */
interface Place {
  page: string;
  anchor?: string;
}

/**
 * What Help saves, so that shown again it comes back where it was: the
 * page it shows, at the heading it was opened at; how far down the window
 * was scrolled; and which drawing of the page saved it.
 * VS Code hands the state to the page whenever its HTML loads, and the host
 * draws the HTML anew for a theme or zen change, a place asked for while
 * Help is hidden, and a window reload; each drawing opens where it is asked
 * to, so a state saved by another drawing is not read.
 */
interface HelpState {
  place: Place;
  scrollY: number;
  /** The drawing of the page that saved it, from the nonce the host drew it with. */
  drawn: string;
}

/** What's new: drawn by the host in the page, not a page of the guide. */
const WHATS_NEW = 'whats-new';
/** The guide's own contents, which Help opens at when asked for no other place. */
const CONTENTS = 'README';
/** How long scrolling must pause before where it stopped is saved, in milliseconds. */
const SAVE_DELAY = 200;

const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
const guideView = document.getElementById('guide-view');
const whatsNew = document.getElementById(WHATS_NEW);
const drawn = drawingOf(document.currentScript);
/** The place shown, once one is. */
let shown: Place | undefined;
/** The guide page asked for to come back to, and where it was scrolled. */
let restoring: { page: string; scrollY: number } | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * This drawing of the page, from its script's nonce: the host draws each
 * HTML with a new one, and VS Code loads the same HTML again when it shows
 * a hidden page. The nonce itself is not kept, only a hash of it.
 */
function drawingOf(script: HTMLOrSVGScriptElement | null): string {
  const nonce = (script && (script.nonce || script.getAttribute('nonce'))) || '';
  let hash = 0x811c9dc5;
  for (let at = 0; at < nonce.length; at += 1) {
    hash = Math.imul(hash ^ nonce.charCodeAt(at), 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** What this drawing of the page saved, or undefined when it saved nothing. */
function readState(): HelpState | undefined {
  const state = vscode?.getState() as Partial<HelpState> | undefined;
  if (!state || state.drawn !== drawn || typeof state.scrollY !== 'number' || typeof state.place?.page !== 'string') {
    return undefined;
  }
  const { page, anchor } = state.place;
  return { place: { page, ...(typeof anchor === 'string' ? { anchor } : {}) }, scrollY: state.scrollY, drawn };
}

/** Saves which page is shown, and how far down the window is. */
function save(): void {
  if (shown) {
    vscode?.setState({ place: shown, scrollY: window.scrollY, drawn });
  }
}

/** Saves where scrolling stopped, once it has paused. */
function saveSoon(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DELAY);
}

/** Puts the focus on a heading, which takes it only from a script. */
function focusHeading(heading: HTMLElement | null, preventScroll: boolean): void {
  if (!heading) {
    return;
  }
  heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll });
}

/** Scrolls the guide page's heading with this id to the top; false when it has none. */
function revealHeading(anchor: string | undefined): boolean {
  const heading = anchor && guideView ? guideView.querySelector(`[id="${anchor.replace(/"/g, '')}"]`) : null;
  heading?.scrollIntoView?.({ block: 'start' });
  return heading !== null;
}

/** Marks the page shown in the contents, and only that one. */
function markContents(page: string): void {
  document.querySelectorAll('nav [data-guide-page]').forEach((link) => {
    if (link.getAttribute('data-guide-page') === page) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

/**
 * Sets the guide view's markup to a guide page. This is the one place the
 * page sets HTML. The page's HTML is trusted: the host rendered it from the
 * guide the VSIX ships (docs/guide), with VS Code's Markdown engine, and
 * nothing in it comes from the reader's notes. Its scripts, if it had any,
 * would not run: neither does a script set as HTML, nor one without the
 * page's nonce.
 */
function setGuideHtml(view: HTMLElement, html: string): void {
  view.innerHTML = html;
}

/**
 * A guide page the host sent, in place of the page shown before: scrolled
 * where it was when Help is coming back to it, else at the heading asked
 * for, else at the top, with the focus on its title.
 */
function showGuide(message: HelpGuideMessage): void {
  if (!guideView) {
    return;
  }
  setGuideHtml(guideView, message.html);
  guideView.hidden = false;
  if (whatsNew) {
    whatsNew.hidden = true;
  }
  const comingBack = restoring?.page === message.page ? restoring : undefined;
  restoring = undefined;
  let scrolled = Boolean(comingBack);
  if (comingBack) {
    window.scrollTo(0, comingBack.scrollY);
  } else {
    scrolled = revealHeading(message.anchor);
    if (!scrolled) {
      window.scrollTo(0, 0);
    }
  }
  focusHeading(guideView.querySelector<HTMLElement>('h1'), scrolled);
  shown = { page: message.page, ...(message.anchor ? { anchor: message.anchor } : {}) };
  markContents(message.page);
  save();
}

/** What's new, which the host drew in the page, in place of the guide page shown before. */
function showWhatsNew(scrollY = 0): void {
  if (!guideView || !whatsNew) {
    return;
  }
  guideView.hidden = true;
  guideView.replaceChildren();
  whatsNew.hidden = false;
  window.scrollTo(0, scrollY);
  focusHeading(whatsNew.querySelector<HTMLElement>('h1'), scrollY > 0);
  shown = { page: WHATS_NEW };
  markContents(WHATS_NEW);
  save();
}

/** Goes to a place: What's new at once, or a guide page once the host sends it. */
function go({ page, anchor }: Place): void {
  if (page === WHATS_NEW) {
    showWhatsNew();
    return;
  }
  if (page === shown?.page && anchor && revealHeading(anchor)) {
    shown = { page, anchor };
    save();
    return;
  }
  vscode?.postMessage(anchor ? { type: 'openGuide', page, anchor } : { type: 'openGuide', page });
}

/** A link to a guide page, or to a heading on the page shown. */
function followGuideLink(event: Event, link: Element): void {
  event.preventDefault();
  const page = link.getAttribute('data-guide-page');
  const anchor = link.getAttribute('data-guide-anchor') || undefined;
  if (page) {
    go({ page, ...(anchor ? { anchor } : {}) });
  } else {
    revealHeading(anchor);
  }
}

/** A click on a command, the changelog, a guide link, or the contents' button. */
function onClick(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) {
    return;
  }
  // A command named in the guide runs from it; the host checks the id.
  const button = target.closest('.command-link');
  if (button && vscode) {
    vscode.postMessage({ type: 'runCommand', command: button.getAttribute('data-command') ?? '' });
  }
  if (target.closest('[data-action="open-changelog"]') && vscode) {
    event.preventDefault();
    vscode.postMessage({ type: 'openChangelog' });
  }
  const toggle = target.closest('.nav-toggle');
  if (toggle) {
    setContentsOpen(toggle.getAttribute('aria-expanded') !== 'true');
    return;
  }
  const guideLink = target.closest('[data-guide-page], [data-guide-anchor]');
  if (!guideLink) {
    return;
  }
  // A link in the contents folds them again once it has led somewhere.
  if (guideLink.closest('nav')) {
    setContentsOpen(false);
  }
  followGuideLink(event, guideLink);
}

/**
 * Opens or folds the contents where they sit above the page, behind their
 * Contents button. Beside the page the button is not shown and the
 * contents are always open, whatever this says.
 */
function setContentsOpen(open: boolean): void {
  document.querySelector('nav')?.classList.toggle('is-open', open);
  document.querySelector('.nav-toggle')?.setAttribute('aria-expanded', String(open));
}

/** What the host sends: a place to go to, or the guide page asked for. */
function onMessage(event: MessageEvent<HelpHostToPage[keyof HelpHostToPage] | undefined>): void {
  const message = event.data;
  if (message?.type === 'reveal') {
    go({ page: message.page, ...(message.anchor ? { anchor: message.anchor } : {}) });
  }
  if (message?.type === 'guide') {
    showGuide(message);
  }
}

/**
 * Opens where the page was when it was hidden, if this drawing saved a
 * place, scrolled as it was: What's new at once, or a guide page, asked for
 * again and scrolled once it comes. Otherwise it opens at the place the
 * host drew it at, or at the guide's contents.
 */
function open(): void {
  const saved = readState();
  if (saved?.place.page === WHATS_NEW) {
    showWhatsNew(saved.scrollY);
    return;
  }
  if (saved) {
    restoring = { page: saved.place.page, scrollY: saved.scrollY };
    go(saved.place);
    return;
  }
  const page = document.body.getAttribute('data-page') || CONTENTS;
  const anchor = document.body.getAttribute('data-anchor') || undefined;
  go({ page, ...(anchor ? { anchor } : {}) });
}

document.addEventListener('click', onClick);
// DECKARD ▾ at the top drops the menu of every other page, as on every page.
if (vscode) {
  const host = vscode;
  installGoToMenu((message) => host.postMessage(message));
}
window.addEventListener('message', onMessage);
window.addEventListener('scroll', saveSoon, { passive: true });
open();
