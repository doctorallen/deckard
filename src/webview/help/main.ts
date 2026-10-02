/**
 * Help's page script: Help's body is the guide the host builds from the
 * manifest (decision Q6 of docs/implementation/20-webviews.md), so this only
 * moves around in it. It runs a command named in the guide, opens a guide
 * page in place of Help and comes back, goes to the section the host asks
 * for, and marks the section being read in the rail.
 *
 * Help is not kept running while its tab is hidden, so VS Code loads it
 * again when it is shown. What it saves with `setState` brings it back where
 * it was: the guide page it showed, and how far down it was scrolled.
 */
import type { HelpGuideMessage, HelpHostToPage, HelpMessage } from '../../ui/protocol/help';

/** What VS Code gives a webview's script. */
interface VsCodeApi {
  postMessage(message: HelpMessage): void;
  setState(state: HelpState): void;
  getState(): unknown;
}

declare function acquireVsCodeApi(): VsCodeApi;

/**
 * What Help saves, so that shown again it comes back where it was: the
 * guide page it shows, if any, at the heading it was opened at, and the
 * section of Help it was opened from, for Back; how far down the window
 * was scrolled; and which drawing of the page saved it.
 * VS Code hands the state to the page whenever its HTML loads, and the host
 * draws the HTML anew for a theme or zen change, a section asked for while
 * Help is hidden, and a window reload; each drawing opens where it is asked
 * to, as it always has, so a state saved by another drawing is not read.
 */
interface HelpState {
  guide?: { page: string; anchor?: string };
  /** The section of Help the guide page was opened from, while one is shown. */
  returnTo?: string;
  scrollY: number;
  /** The drawing of the page that saved it, from the nonce the host drew it with. */
  drawn: string;
}

/** How long scrolling must pause before where it stopped is saved, in milliseconds. */
const SAVE_DELAY = 200;

const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
const article = document.querySelector<HTMLElement>('main > article');
const guideView = document.getElementById('guide-view');
const drawn = drawingOf(document.currentScript);
/** The section a guide page was opened from, for Back. */
let returnTo: string | undefined;
/** The guide page shown, while one is. */
let shownGuide: HelpState['guide'];
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
  if (!state || state.drawn !== drawn || typeof state.scrollY !== 'number') {
    return undefined;
  }
  const guide = state.guide && typeof state.guide.page === 'string' ? state.guide : undefined;
  const back = guide && typeof state.returnTo === 'string' ? { returnTo: state.returnTo } : {};
  return { ...(guide ? { guide } : {}), ...back, scrollY: state.scrollY, drawn };
}

/**
 * Saves which guide page is shown, if any, and where Back goes from it,
 * and how far down the window is.
 */
function save(): void {
  const back = shownGuide && returnTo ? { returnTo } : {};
  vscode?.setState({ ...(shownGuide ? { guide: shownGuide } : {}), ...back, scrollY: window.scrollY, drawn });
}

/** Saves where scrolling stopped, once it has paused. */
function saveSoon(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DELAY);
}

/** Scrolls `root`'s element with this id to the top, if it has one. */
function revealIn(root: ParentNode, anchor: string | undefined): void {
  const heading = anchor ? root.querySelector(`[id="${anchor.replace(/"/g, '')}"]`) : null;
  heading?.scrollIntoView?.({ block: 'start' });
}

/**
 * Sets the guide view's markup: the way back, then the page. This is the
 * one place the page sets HTML. The page's HTML is trusted: the host
 * rendered it from the guide the VSIX ships (docs/guide), with VS Code's
 * Markdown engine, and nothing in it comes from the reader's notes. Its
 * scripts, if it had any, would not run: neither does a script set as
 * HTML, nor one without the page's nonce.
 */
function setGuideHtml(view: HTMLElement, page: string, html: string): void {
  const topics = page === 'README' ? '' : '<a href="#" class="guide-back" data-guide-page="README">All guide topics</a>';
  view.innerHTML = `<div class="guide-bar"><a href="#" class="guide-back" data-action="guide-back">← Back to Help</a>${topics}</div>${html}`;
}

/** A guide page in place of Help, with the way back first. */
function showGuide(message: HelpGuideMessage): void {
  if (!article || !guideView) {
    return;
  }
  setGuideHtml(guideView, message.page, message.html);
  article.hidden = true;
  guideView.hidden = false;
  const comingBack = restoring?.page === message.page ? restoring : undefined;
  restoring = undefined;
  if (comingBack) {
    window.scrollTo(0, comingBack.scrollY);
  } else if (message.anchor) {
    revealIn(guideView, message.anchor);
  } else {
    window.scrollTo(0, 0);
  }
  const title = guideView.querySelector<HTMLElement>('h1');
  if (title) {
    title.setAttribute('tabindex', '-1');
    title.focus({ preventScroll: Boolean(message.anchor) || Boolean(comingBack) });
  }
  shownGuide = { page: message.page, ...(message.anchor ? { anchor: message.anchor } : {}) };
  save();
}

/**
 * Help again in place of the guide page, at a section when one is named,
 * else at the top, with the focus on the heading it lands at: the guide
 * page, and whatever had the focus on it, are gone.
 */
function showHelp(anchor?: string): void {
  if (!article || !guideView) {
    return;
  }
  guideView.hidden = true;
  guideView.replaceChildren();
  article.hidden = false;
  if (!reveal(anchor)) {
    window.scrollTo(0, 0);
    focusHeading(article.querySelector<HTMLElement>('h1'));
  }
  shownGuide = undefined;
  save();
}

/** Puts the focus on a heading, which takes it only from a script. */
function focusHeading(heading: HTMLElement | null): void {
  if (!heading) {
    return;
  }
  heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
}

/**
 * Opened on a section, such as What's new, the page goes to it; false
 * when there is no such section.
 */
function reveal(anchor: string | null | undefined): boolean {
  const section = anchor ? document.getElementById(anchor) : null;
  if (!section) {
    return false;
  }
  section.scrollIntoView?.({ block: 'start' });
  focusHeading(section.querySelector<HTMLElement>('h2'));
  return true;
}

/** Asks for a guide page, noting where Help was for Back when it is Help that asked. */
function openGuide(link: Element, page: string, anchor: string | undefined): void {
  if (guideView?.hidden) {
    returnTo = link.closest('section')?.id || undefined;
  }
  vscode?.postMessage(anchor ? { type: 'openGuide', page, anchor } : { type: 'openGuide', page });
}

/** A link to a guide page, or to a heading on the one shown. */
function followGuideLink(event: Event, link: Element): void {
  event.preventDefault();
  const page = link.getAttribute('data-guide-page');
  const anchor = link.getAttribute('data-guide-anchor') || undefined;
  if (page && vscode) {
    openGuide(link, page, anchor);
  } else if (anchor && guideView) {
    revealIn(guideView, anchor);
  }
}

/** A click on a command, the changelog, a guide link, Back, or the rail. */
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
  const guideLink = target.closest('[data-guide-page], [data-guide-anchor]');
  if (guideLink) {
    followGuideLink(event, guideLink);
    return;
  }
  if (target.closest('[data-action="guide-back"]')) {
    event.preventDefault();
    showHelp(returnTo);
    return;
  }
  // The rail leads back to Help from a guide page.
  const railLink = target.closest('nav a[href^="#"]');
  if (!railLink || !guideView || guideView.hidden) {
    return;
  }
  event.preventDefault();
  showHelp(railLink.getAttribute('href')?.slice(1));
}

/** What the host sends: a section to go to, or the guide page asked for. */
function onMessage(event: MessageEvent<HelpHostToPage[keyof HelpHostToPage] | undefined>): void {
  const message = event.data;
  if (message?.type === 'reveal') {
    if (guideView && !guideView.hidden) {
      showHelp();
    }
    reveal(message.anchor);
    save();
  }
  if (message?.type === 'guide') {
    showGuide(message);
  }
}

/**
 * Opens where the page was when it was hidden, if this drawing saved a
 * place: on a guide page, which is asked for again and scrolled to once it
 * comes, or on Help, scrolled as it was. Otherwise it opens on the section
 * the host drew it at, if any.
 */
function open(): void {
  const saved = readState();
  if (!saved) {
    reveal(document.body.getAttribute('data-anchor'));
    return;
  }
  if (saved.guide && vscode) {
    restoring = { page: saved.guide.page, scrollY: saved.scrollY };
    returnTo = saved.returnTo;
    const { page, anchor } = saved.guide;
    vscode.postMessage(anchor ? { type: 'openGuide', page, anchor } : { type: 'openGuide', page });
    return;
  }
  window.scrollTo(0, saved.scrollY);
}

/**
 * The rail marks the section under the top of the window as the reader
 * scrolls, so a long page says where it is. A section counts as read once
 * it crosses the band between a tenth and a third of the way down, and the
 * last one counts when the page cannot scroll any further.
 */
function followRail(): void {
  const links = [...document.querySelectorAll('nav a[href^="#"]')];
  const sections = links
    .map((link) => document.getElementById(link.getAttribute('href')?.slice(1) ?? ''))
    .filter((section): section is HTMLElement => section !== null);
  if (!sections.length) {
    return;
  }
  let current: string | undefined;
  const mark = (id: string): void => {
    if (id === current) {
      return;
    }
    current = id;
    links.forEach((link) => {
      if (link.getAttribute('href') === `#${id}`) {
        link.setAttribute('aria-current', 'location');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  };
  mark(sections[0].id);
  if (typeof IntersectionObserver !== 'function') {
    return;
  }
  const crossing: Record<string, boolean> = {};
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      crossing[entry.target.id] = entry.isIntersecting;
    });
    const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    const first = atEnd ? sections[sections.length - 1] : sections.find((section) => crossing[section.id]);
    if (first) {
      mark(first.id);
    }
  }, { rootMargin: '-10% 0px -67% 0px' });
  sections.forEach((section) => observer.observe(section));
}

document.addEventListener('click', onClick);
window.addEventListener('message', onMessage);
window.addEventListener('scroll', saveSoon, { passive: true });
open();
followRail();
