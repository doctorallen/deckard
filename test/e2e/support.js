// What every end-to-end suite shares: the `vscode` stand-in, the memento
// stand-in, and a real DOM to run a page in.
//
// Mocha loads this before a suite (`--require`, from run.js), so the suite's
// own `require('vscode')` already gets test/e2e/vscodeStub.js.
//
// A page runs in its own jsdom window, built from the HTML its host rendered
// and passed through the shared page loader, so the page script runs against
// the markup the host produced, with real events that bubble through real
// listeners. Nothing is swapped onto the test's own globals, so no suite and
// no mount shares state with another.
const Module = require('node:module');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { loadPage } = require('../harness/loadPage.js');

// The extension imports "vscode", which only exists inside the editor.
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function patched(request, ...rest) {
  if (request === 'vscode') {
    return path.join(__dirname, 'vscodeStub.js');
  }
  return resolveFilename.call(this, request, ...rest);
};

/**
 * A stand-in for VS Code's Memento: an in-memory map with `get` and an
 * `update` that resolves at once.
 */
function createGlobalState() {
  const store = new Map();
  return {
    get: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
    update: (key, value) => {
      store.set(key, value);
      return Promise.resolve();
    },
  };
}

/**
 * A message as it arrives on the other side. VS Code carries messages between
 * a page and its host as JSON, so each side gets its own copy, built in its
 * own realm: the host's objects are the test's, and the page's are the
 * page's, so `deepStrictEqual` and `instanceof` behave as they would there.
 */
function carry(message, json = JSON) {
  return message === undefined ? message : json.parse(JSON.stringify(message));
}

/** Where a test's pointer is, for the events that carry a position. */
const POINTER = { clientX: 10, clientY: 10 };

/**
 * The geometry a page reads, fixed, since jsdom lays nothing out: every
 * element is 100 by 20 at the top left, and the window 1200 by 800, which is
 * what the suites were written against.
 */
function installGeometry(window) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: () => undefined });
  Object.defineProperty(window.Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 }),
  });
  Object.defineProperty(window.Element.prototype, 'scrollIntoView', { configurable: true, value: () => undefined });
  // A test says which element is under the pointer.
  Object.defineProperty(window.document, 'elementFromPoint', {
    configurable: true,
    value() {
      return this.pointerTarget ?? null;
    },
  });
}

/**
 * An event of the kind a reader's action raises, bubbling and cancelable,
 * with any extra fields a test gives it, such as `key` or `dataTransfer`.
 */
function createEvent(window, type, values = {}) {
  let event;
  if (/^key/.test(type)) {
    event = new window.KeyboardEvent(type, { bubbles: true, cancelable: true, key: values.key });
  } else if (/^(click|dblclick|mouse|contextmenu|pointer)/.test(type)) {
    event = new window.MouseEvent(type, { bubbles: true, cancelable: true, ...POINTER });
  } else {
    event = new window.Event(type, { bubbles: true, cancelable: true });
  }
  for (const [name, value] of Object.entries({ ...POINTER, ...values })) {
    if (event[name] === value) {
      continue;
    }
    Object.defineProperty(event, name, { configurable: true, value });
  }
  return event;
}

/**
 * The actions a reader takes on a page, each raised as real events on the
 * element it names, bubbling through the page's listeners.
 */
function createActions(window) {
  const { document } = window;
  const dispatch = (type, target, values) => {
    const event = createEvent(window, type, values);
    target.dispatchEvent(event);
    return event;
  };
  return {
    /** A real pointer press: mousedown, the focus change it causes, then click. */
    press: (element) => {
      const down = dispatch('mousedown', element);
      if (!down.defaultPrevented) {
        const focused = document.activeElement;
        if (focused && focused !== element && focused !== document.body) {
          dispatch('change', focused);
          focused.blur();
        }
        element.focus();
      }
      dispatch('click', element);
      return { defaultPrevented: down.defaultPrevented };
    },
    click: (element) => {
      dispatch('click', element);
    },
    type: (element, value) => {
      element.focus();
      element.value = value;
      if (typeof element.setSelectionRange === 'function') {
        element.setSelectionRange(value.length, value.length);
      }
      dispatch('input', element);
    },
    change: (element, value) => {
      if (value !== undefined) {
        element.value = value;
      }
      dispatch('change', element);
    },
    submit: (form) => {
      dispatch('submit', form);
    },
    /** Any other event, such as a pointer or context menu event. */
    fire: (type, target, values = {}) => {
      dispatch(type, target, values);
    },
    keydown: (element, key) => {
      dispatch('keydown', element, { key });
    },
  };
}

/**
 * Boots one webview: loads the host's HTML into its own window, runs the page
 * script, and wires postMessage in both directions.
 *
 * @param {string} html The page as the host rendered it.
 * @param {object} panel The stub panel whose `_onWebviewMessage` the page's
 *   messages reach; it gains `_deliver`, which posts to the page.
 * @returns {object} The mounted page: its elements, what it posted, what it
 *   saved, and the reader's actions.
 */
function mountWebview(html, panel) {
  const posted = [];
  let savedState;
  const dom = new JSDOM(loadPage(html), {
    runScripts: 'dangerously',
    beforeParse(window) {
      installGeometry(window);
      Object.defineProperty(window, 'acquireVsCodeApi', {
        value: () => ({
          postMessage: (message) => {
            posted.push(carry(message));
            panel._onWebviewMessage(carry(message));
          },
          setState: (value) => {
            savedState = carry(value);
          },
          getState: () => carry(savedState, window.JSON),
        }),
      });
    },
  });
  const { window } = dom;
  const { document } = window;

  // The host pushes state into this webview.
  panel._deliver = (message) => {
    window.dispatchEvent(new window.MessageEvent('message', { data: carry(message, window.JSON) }));
  };

  return {
    app: document.getElementById('app'),
    root: document.body,
    posted,
    document,
    window,
    get state() {
      return savedState;
    },
    find: (selector) => document.body.querySelector(selector),
    findAll: (selector) => [...document.body.querySelectorAll(selector)],
    ...createActions(window),
    dispose: () => window.close(),
  };
}

module.exports = { createGlobalState, mountWebview };
