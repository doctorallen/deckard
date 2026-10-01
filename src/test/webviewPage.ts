import { JSDOM } from 'jsdom';

import { createDomRecorder } from '../../test/harness/domRecorder';
import { loadPage } from '../../test/harness/loadPage';

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
  /**
   * With `canvas: true`, every call the page made on a canvas's 2D context,
   * oldest first, with the drawing state it was made under.
   */
  readonly canvasCalls: CanvasCall[];
  /**
   * With `canvas: true`, runs the animation frames the page has asked for,
   * up to `count` rounds; a frame that asks for another is run in the next
   * round. Returns how many frames ran.
   */
  flushFrames(count?: number): number;
  dispose(): void;
}

/** One call on a recorded 2D context, and the state it was drawn in. */
export interface CanvasCall {
  op: string;
  args: unknown[];
  lineDash: number[];
  strokeStyle: unknown;
  fillStyle: unknown;
  globalAlpha: number;
  lineWidth: number;
}

export interface WebviewPageOptions {
  /**
   * Gives every canvas a 2D context that draws nothing and records each
   * call, holds animation frames until `flushFrames`, and gives canvases an
   * 800 by 600 size, so a page that paints can be tested by what it paints.
   */
  canvas?: boolean;
  /**
   * What VS Code kept for the page across a reload, which its `getState`
   * returns from the start, as it does in a restored webview.
   */
  savedState?: unknown;
  /**
   * Makes `performance.now()` advance by this many milliseconds each time it
   * is called, starting from 0, so a page that animates by the clock draws
   * the same frames on every run.
   */
  clockStep?: number;
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
 * The page goes through the shared page loader first, so a page that loads
 * its script or style sheet by URI runs here as it would in VS Code.
 * `state` is sent as soon as the page is loaded, which is what the host does
 * once the page says it is ready. `options.savedState` is what the page's
 * `getState` returns until it saves something of its own.
 */
export function openWebviewPage(
  html: string,
  state?: unknown,
  options: WebviewPageOptions = {},
): WebviewPage {
  const posted: PostedMessage[] = [];
  const canvasCalls: CanvasCall[] = [];
  let frames: FrameRequestCallback[] = [];
  let kept: unknown = clone(options.savedState);
  const dom = new JSDOM(loadPage(html), {
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
      if (options.clockStep !== undefined) {
        installSteppedClock(window as unknown as Window & typeof globalThis, options.clockStep);
      }
      if (options.canvas) {
        installRecordingCanvas(window as unknown as Window & typeof globalThis, canvasCalls);
        Object.defineProperty(window, 'requestAnimationFrame', {
          value: (callback: FrameRequestCallback) => {
            frames.push(callback);
            return frames.length;
          },
        });
      }
    },
  });
  const window = dom.window as unknown as Window & typeof globalThis;
  const document = window.document;
  // With DECKARD_DOM_RECORD set, the body is written after each step.
  const recorder = createDomRecorder(document, html);

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
      recorder.record('send state');
    },
    lastPosted(type: string): PostedMessage | undefined {
      return [...posted].reverse().find((message) => message.type === type);
    },
    click(selector: string): void {
      find(selector).dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, cancelable: true }),
      );
      recorder.record(`click ${selector}`);
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
    canvasCalls,
    flushFrames(count = 1): number {
      let ran = 0;
      for (let round = 0; round < count && frames.length > 0; round += 1) {
        const due = frames;
        frames = [];
        due.forEach((callback) => {
          callback(window.performance.now());
          ran += 1;
        });
      }
      return ran;
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

/**
 * Replaces `performance.now()` with a clock that starts at 0 and moves on
 * by `step` milliseconds each time it is read, so a page's timing, and what
 * it draws by it, is the same on every run.
 */
function installSteppedClock(window: Window & typeof globalThis, step: number): void {
  let now = 0;
  Object.defineProperty(window.performance, 'now', {
    configurable: true,
    value: () => {
      now += step;
      return now;
    },
  });
}

/** Drawing state a 2D context keeps between calls. */
const CONTEXT_STATE: Record<string, unknown> = {
  strokeStyle: '#000',
  fillStyle: '#000',
  globalAlpha: 1,
  lineWidth: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  lineDashOffset: 0,
  font: '10px sans-serif',
  textAlign: 'start',
  textBaseline: 'alphabetic',
};

/**
 * Replaces canvases' `getContext` with a 2D context that records every call.
 * Property writes (colors, alpha, width) are kept as state and stamped on
 * each call; `save`/`restore` keep a stack of it, as a real context does.
 */
function installRecordingCanvas(window: Window & typeof globalThis, calls: CanvasCall[]): void {
  const prototype = window.HTMLCanvasElement.prototype;
  Object.defineProperty(prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(prototype, 'clientHeight', { configurable: true, get: () => 600 });
  Object.defineProperty(prototype, 'setPointerCapture', { configurable: true, value: () => undefined });
  Object.defineProperty(prototype, 'releasePointerCapture', { configurable: true, value: () => undefined });
  Object.defineProperty(prototype, 'hasPointerCapture', { configurable: true, value: () => false });
  Object.defineProperty(prototype, 'getContext', {
    configurable: true,
    value: function getContext(this: HTMLCanvasElement) {
      const state: Record<string, unknown> = { ...CONTEXT_STATE };
      let lineDash: number[] = [];
      const stack: { state: Record<string, unknown>; lineDash: number[] }[] = [];
      const record = (op: string, args: unknown[]): void => {
        calls.push({
          op,
          args,
          lineDash: lineDash.slice(),
          strokeStyle: state.strokeStyle,
          fillStyle: state.fillStyle,
          globalAlpha: Number(state.globalAlpha),
          lineWidth: Number(state.lineWidth),
        });
      };
      const methods: Record<string, (...args: unknown[]) => unknown> = {
        setLineDash: (segments: unknown) => {
          lineDash = Array.isArray(segments) ? Array.from(segments as unknown[], Number) : [];
          record('setLineDash', [lineDash.slice()]);
        },
        getLineDash: () => lineDash.slice(),
        save: () => {
          stack.push({ state: { ...state }, lineDash: lineDash.slice() });
          record('save', []);
        },
        restore: () => {
          const top = stack.pop();
          if (top) {
            Object.assign(state, top.state);
            lineDash = top.lineDash;
          }
          record('restore', []);
        },
        measureText: (text: unknown) => {
          record('measureText', [text]);
          return { width: String(text).length * 7 };
        },
      };
      const canvas = this;
      return new Proxy({}, {
        get(_target, property) {
          if (property === 'canvas') {
            return canvas;
          }
          if (typeof property !== 'string') {
            return undefined;
          }
          if (property in methods) {
            return methods[property];
          }
          if (property in state) {
            return state[property];
          }
          return (...args: unknown[]) => record(property, args);
        },
        set(_target, property, value) {
          if (typeof property === 'string') {
            state[property] = value;
          }
          return true;
        },
      });
    },
  });
}
