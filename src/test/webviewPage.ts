import { JSDOM } from 'jsdom';

/**
 * Runs a Deckard webview the way VS Code runs it, so a page can be tested by
 * what it does rather than by what its source says.
 *
 * The pages are JavaScript assembled in template literals, which the compiler
 * never sees, so they have been held to their source text: about 400 checks
 * asserting that a rendered page contains a particular line of script. Those
 * checks pass for a line that never runs, fail for a line that was only
 * reformatted, and stand in the way of moving the scripts into modules,
 * because a bundler rewrites the text they match.
 *
 * Here the page is loaded, given the state the host would send it, and asked
 * what it drew and what it posted back. That survives the move.
 */
export interface WebviewPage {
  window: Window & typeof globalThis;
  document: Document;
  /** Messages the page has posted to the host, oldest first. */
  readonly posted: PostedMessage[];
  /** Delivers a state message and lets the page redraw. */
  send(state: unknown): void;
  /** The last message the page posted of a kind, if any. */
  lastPosted(type: string): PostedMessage | undefined;
  /** Clicks an element, as a reader would. */
  click(selector: string): void;
  /** The element a selector names, or a failure naming the selector. */
  find(selector: string): Element;
  /** Every element a selector names. */
  findAll(selector: string): Element[];
  /** Trimmed text of the element a selector names, or undefined. */
  text(selector: string): string | undefined;
  /** What the page kept for a window reload. */
  savedState(): unknown;
  dispose(): void;
}

export interface PostedMessage {
  type?: string;
  [key: string]: unknown;
}

/** What survives the trip between a page and its host. */
function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/**
 * Loads a page's HTML with a stand-in for the API VS Code gives a webview.
 *
 * `state` is sent as soon as the page is loaded, which is what the host does
 * once the page says it is ready.
 */
export function openWebviewPage(html: string, state?: unknown): WebviewPage {
  const posted: PostedMessage[] = [];
  let kept: unknown;
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      // A page restores its scroll after each render. jsdom has no viewport
      // to scroll, and says so loudly for every render of every test.
      Object.defineProperty(window, 'scrollTo', { value: () => undefined });
      Object.defineProperty(window, 'acquireVsCodeApi', {
        value: () => ({
          // VS Code serializes what a page posts or keeps, and so does this,
          // which is also what makes the values comparable: an object built
          // inside the page is not of the same kind as one built out here,
          // however alike the two read.
          postMessage: (message: PostedMessage) => posted.push(clone(message)),
          setState: (next: unknown) => {
            kept = clone(next);
          },
          getState: () => kept,
        }),
      });
    },
  });
  const window = dom.window as unknown as Window & typeof globalThis;
  const document = window.document;

  const find = (selector: string): Element => {
    const element = document.querySelector(selector);
    if (!element) {
      throw new Error(`The page has no ${selector}.`);
    }
    return element;
  };

  const page: WebviewPage = {
    window,
    document,
    posted,
    send(next: unknown): void {
      window.dispatchEvent(
        new window.MessageEvent('message', {
          data: { type: 'state', data: next },
        }),
      );
    },
    lastPosted(type: string): PostedMessage | undefined {
      return [...posted].reverse().find((message) => message.type === type);
    },
    click(selector: string): void {
      find(selector).dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    },
    find,
    findAll(selector: string): Element[] {
      return [...document.querySelectorAll(selector)];
    },
    text(selector: string): string | undefined {
      return document.querySelector(selector)?.textContent?.trim();
    },
    savedState(): unknown {
      return kept;
    },
    dispose(): void {
      dom.window.close();
    },
  };
  if (state !== undefined) {
    page.send(state);
  }
  return page;
}
