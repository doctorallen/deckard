// A small DOM good enough to run the overview's own script against the HTML
// the host actually renders.
//
// Elements come from parsing that HTML rather than from hand-written stubs, so
// a click lands on the element a user would really click, with the attributes
// the renderer really produced.

let nextId = 1;

class Element {
  constructor(tagName, attributes = {}, parent = undefined) {
    this.tagName = String(tagName).toUpperCase();
    this.attributes = attributes;
    this.children = [];
    this.parentElement = parent;
    this.text = '';
    this._id = nextId++;
    this.dataset = {};
    Object.keys(attributes).forEach((name) => {
      if (name.startsWith('data-')) {
        this.dataset[toCamel(name.slice(5))] = attributes[name];
      }
    });
    this.hidden = Object.prototype.hasOwnProperty.call(attributes, 'hidden');
    this.value = attributes.value ?? '';
    this.checked = Object.prototype.hasOwnProperty.call(attributes, 'checked');
    this.selectionStart = String(this.value).length;
    this.style = {};
    this.open = Object.prototype.hasOwnProperty.call(attributes, 'open');
  }

  get classList() {
    const classes = String(this.attributes.class ?? '').split(/\s+/).filter(Boolean);
    return {
      contains: (name) => classes.includes(name),
      add: () => undefined,
      remove: () => undefined,
    };
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith('data-')) {
      this.dataset[toCamel(name.slice(5))] = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  setSelectionRange(start) {
    this.selectionStart = start;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  appendChild(child) {
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  get innerHTML() {
    return this._innerHTML ?? '';
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = parseFragment(String(value), this, this.ownerDocument);
  }

  get textContent() {
    return this.text + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this.text = String(value);
    this.children = [];
  }

  descendants() {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  querySelector(selector) {
    return this.descendants().find((element) => element.matches(selector)) ?? null;
  }

  querySelectorAll(selector) {
    return this.descendants().filter((element) => element.matches(selector));
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches && current.matches(selector)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  getBoundingClientRect() {
    return { width: 100, height: 20, top: 0, left: 0 };
  }

  matches(selector) {
    return selector
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .some((part) => this.matchesCompound(part));
  }

  /** Supports the selector forms the overview script actually uses. */
  matchesCompound(selector) {
    // Descendant combinator: match the right-most part, then an ancestor.
    const parts = selector.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      const last = parts[parts.length - 1];
      if (!this.matchesSimple(last)) {
        return false;
      }
      let ancestor = this.parentElement;
      const rest = parts.slice(0, -1).join(' ');
      while (ancestor) {
        if (ancestor.matchesCompound(rest)) {
          return true;
        }
        ancestor = ancestor.parentElement;
      }
      return false;
    }
    return this.matchesSimple(selector);
  }

  matchesSimple(selector) {
    let rest = selector;
    let matched = true;
    // Tag
    const tagMatch = rest.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
    if (tagMatch) {
      matched = matched && this.tagName === tagMatch[0].toUpperCase();
      rest = rest.slice(tagMatch[0].length);
    }
    for (;;) {
      if (rest.startsWith('#')) {
        const name = rest.slice(1).match(/^[^.#[\]]+/)[0];
        matched = matched && this.attributes.id === name;
        rest = rest.slice(1 + name.length);
        continue;
      }
      if (rest.startsWith('.')) {
        const name = rest.slice(1).match(/^[^.#[\]]+/)[0];
        matched = matched && this.classList.contains(name);
        rest = rest.slice(1 + name.length);
        continue;
      }
      if (rest.startsWith('[')) {
        const end = rest.indexOf(']');
        const body = rest.slice(1, end);
        const eq = body.indexOf('=');
        if (eq === -1) {
          matched =
            matched && Object.prototype.hasOwnProperty.call(this.attributes, body);
        } else {
          const name = body.slice(0, eq);
          const want = body.slice(eq + 1).replace(/^["']|["']$/g, '');
          matched = matched && this.attributes[name] === want;
        }
        rest = rest.slice(end + 1);
        continue;
      }
      break;
    }
    return matched && rest.length === 0;
  }
}

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Parses the subset of HTML the overview renders. */
function parseFragment(html, parent, ownerDocument) {
  const roots = [];
  const stack = [];
  const tokenPattern = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s">]+))?)*)\s*(\/?)>|([^<]+)/g;
  let token;
  while ((token = tokenPattern.exec(html)) !== null) {
    const [raw, tagName, attributeText, selfClosing, textRun] = token;
    if (textRun !== undefined) {
      const current = stack[stack.length - 1];
      if (current) {
        current.text += decodeEntities(textRun);
      }
      continue;
    }
    if (raw.startsWith('</')) {
      const closingIndex = stack.map((e) => e.tagName).lastIndexOf(tagName.toUpperCase());
      if (closingIndex >= 0) {
        stack.length = closingIndex;
      }
      continue;
    }
    const element = new Element(tagName, parseAttributes(attributeText));
    element.ownerDocument = ownerDocument;
    const current = stack[stack.length - 1];
    if (current) {
      element.parentElement = current;
      current.children.push(element);
    } else {
      element.parentElement = parent;
      roots.push(element);
    }
    if (!selfClosing && !VOID_TAGS.has(tagName.toLowerCase())) {
      stack.push(element);
    }
  }
  return roots;
}

function parseAttributes(text) {
  const attributes = {};
  const pattern = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+)))?/g;
  let match;
  while ((match = pattern.exec(text ?? '')) !== null) {
    const name = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attributes[name] = decodeEntities(value);
  }
  return attributes;
}

function decodeEntities(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_all, character) => character.toUpperCase());
}

/**
 * Boots one webview: parses the host's HTML, evaluates its script, and wires
 * postMessage in both directions.
 */
function mountWebview(html, panel) {
  const document = {
    listeners: {},
    activeElement: undefined,
    addEventListener(type, handler) {
      (this.listeners[type] = this.listeners[type] ?? []).push(handler);
    },
    createElement: (tagName) => {
      const element = new Element(tagName);
      element.ownerDocument = document;
      return element;
    },
  };
  const root = new Element('body', {});
  root.ownerDocument = document;
  const app = new Element('main', { id: 'app' });
  app.ownerDocument = document;
  root.appendChild(app);
  document.body = root;
  document.getElementById = (id) =>
    id === 'app' ? app : root.querySelector(`#${id}`);
  document.querySelector = (selector) => root.querySelector(selector);
  document.querySelectorAll = (selector) => root.querySelectorAll(selector);

  const posted = [];
  const windowStub = {
    listeners: {},
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener(type, handler) {
      (this.listeners[type] = this.listeners[type] ?? []).push(handler);
    },
  };

  const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  const context = {
    document,
    window: windowStub,
    NodeFilter: { SHOW_TEXT: 4 },
    acquireVsCodeApi: () => ({
      postMessage: (message) => {
        posted.push(message);
        panel._onWebviewMessage(message);
      },
      setState: (value) => {
        context.savedState = value;
      },
      getState: () => context.savedState,
    }),
  };

  const scope = globalThis;
  const saved = {};
  const install = () => {
    Object.keys(context).forEach((key) => {
      if (key === 'savedState') return;
      saved[key] = scope[key];
      scope[key] = context[key];
    });
  };
  const restore = () => {
    Object.keys(saved).forEach((key) => {
      scope[key] = saved[key];
    });
  };

  install();
  try {
    // eslint-disable-next-line no-new-func
    new Function(script)();
  } finally {
    restore();
  }

  const run = (fn) => {
    install();
    try {
      return fn();
    } finally {
      restore();
    }
  };

  const dispatch = (type, event) =>
    run(() => {
      [...(document.listeners[type] ?? [])].forEach((handler) => handler(event));
    });

  // The host pushes state into this webview.
  panel._deliver = (message) =>
    run(() => {
      [...(windowStub.listeners.message ?? [])].forEach((handler) =>
        handler({ data: message }),
      );
    });

  const makeEvent = (target) => {
    let defaultPrevented = false;
    return {
      event: {
        target,
        currentTarget: target,
        clientX: 10,
        clientY: 10,
        preventDefault: () => {
          defaultPrevented = true;
        },
        get defaultPrevented() {
          return defaultPrevented;
        },
      },
      wasPrevented: () => defaultPrevented,
    };
  };

  return {
    app,
    root,
    posted,
    document,
    get state() {
      return context.savedState;
    },
    find: (selector) => root.querySelector(selector),
    findAll: (selector) => root.querySelectorAll(selector),
    /** A real pointer press: mousedown, the focus change it causes, then click. */
    press: (element) => {
      const down = makeEvent(element);
      dispatch('mousedown', down.event);
      if (!down.wasPrevented()) {
        const focused = document.activeElement;
        if (focused && focused !== element) {
          document.activeElement = element;
          dispatch('change', { target: focused, preventDefault: () => undefined });
        }
      }
      dispatch('click', makeEvent(element).event);
      return { defaultPrevented: down.wasPrevented() };
    },
    click: (element) => dispatch('click', makeEvent(element).event),
    type: (element, value) => {
      element.focus();
      element.value = value;
      element.selectionStart = value.length;
      dispatch('input', makeEvent(element).event);
    },
    change: (element, value) => {
      if (value !== undefined) element.value = value;
      dispatch('change', makeEvent(element).event);
    },
    keydown: (element, key) =>
      dispatch('keydown', Object.assign(makeEvent(element).event, { key })),
  };
}

module.exports = { mountWebview, Element };
