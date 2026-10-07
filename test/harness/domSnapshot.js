// Writes a page's body as normalized text, so two drawings of a page can be
// compared element by element.
//
// Phase 6 of the refactor rewrites every page's markup (docs/implementation/
// 20-webviews.md §2.3). The stylesheets, the layout and contrast checks, and
// the page-driving tests all key on that markup, so a rewritten page must draw
// the same DOM: the same elements in the same order, with the same classes,
// ids, data-* and ARIA attributes, and the same text. What may differ without
// anyone seeing it is left out here, so a diff names only what a reader or a
// selector could tell apart:
//
// - <script>, <style>, <link>, comments, and the layout probe's own output
//   are dropped, and the page's nonce reads NONCE.
// - Attributes are sorted by name, class names are sorted, an empty class or
//   style is dropped, and a boolean attribute has the value "".
// - A style attribute is written from the element's style declarations,
//   sorted, since a template writes a string and a component sets properties.
// - A form control's value, checkedness, and selectedness are read from the
//   control, not its attributes, which a component may never write, and are
//   carried as data-dom-value, data-dom-checked, and data-dom-selected.
// - Adjacent text is merged and each run of whitespace is one space; a text
//   node of only whitespace is kept, because a space between two inline
//   elements is visible.
//
// The result is HTML that parses back to the normalized tree. Every tag and
// attribute starts a line of its own, with the line breaks inside the tags
// where the parser ignores them, so a diff of two drawings reads line by line.
//
// Chrome (test/ui/checkDom.js) cannot hand a live element to Node, so its
// probe copies the control state and styles onto a clone, which is then read
// here as `captured`. jsdom (the recorder in src/test/webviewPage.ts and
// test/e2e/support.js) hands over the live body.

/** Elements whose content is never part of the comparison. */
const DROPPED = new Set(['script', 'style', 'link', 'template']);
/** Elements with no end tag. */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'meta', 'source', 'track', 'wbr']);
/** Attributes whose presence is their meaning; each is written with the value "". */
const BOOLEAN = new Set([
  'allowfullscreen', 'async', 'autofocus', 'autoplay', 'controls', 'default', 'defer', 'disabled',
  'formnovalidate', 'hidden', 'inert', 'ismap', 'itemscope', 'loop', 'multiple', 'muted', 'nomodule',
  'novalidate', 'open', 'playsinline', 'readonly', 'required', 'reversed',
]);
/** The form controls whose state is read from the control rather than its attributes. */
const STATEFUL = new Set(['input', 'select', 'textarea', 'option']);
/** HTML's own whitespace; a no-break space is text, not whitespace. */
const WHITESPACE = /[ \t\n\r\f]+/g;

/**
 * An element's inline style as sorted declarations, from its parsed style
 * rather than the text it was written with.
 *
 * @param {object} style The element's `style`.
 * @returns {string} `name: value` pairs joined by `; `, or '' for none.
 */
function styleText(style) {
  const declarations = [];
  for (let index = 0; index < style.length; index += 1) {
    const name = style[index];
    const priority = style.getPropertyPriority(name);
    declarations.push(`${name}: ${style.getPropertyValue(name)}${priority ? ` !${priority}` : ''}`);
  }
  return declarations.sort().join('; ');
}

/**
 * A form control's state as data-dom-* attributes, read from the control.
 *
 * @param {object} element An input, select, textarea, or option.
 * @returns {Array<[string, string]>} The attributes to write.
 */
function controlState(element) {
  const name = element.localName;
  const state = [];
  if (name !== 'option' || element.hasAttribute('value')) {
    state.push(['data-dom-value', String(element.value)]);
  }
  if (name === 'input' && (element.type === 'checkbox' || element.type === 'radio')) {
    state.push(['data-dom-checked', String(element.checked)]);
  }
  if (name === 'option') {
    state.push(['data-dom-selected', String(element.selected)]);
  }
  return state;
}

/**
 * The attributes an element is written with, normalized and sorted.
 *
 * @param {object} element The element whose attributes are read.
 * @param {{ nonce?: string, captured?: boolean }} options See normalizeBody.
 * @returns {Array<[string, string]>} Name and value pairs.
 */
function normalizedAttributes(element, options) {
  const name = element.localName;
  const stateful = STATEFUL.has(name) && element.namespaceURI === 'http://www.w3.org/1999/xhtml';
  const attributes = [];
  for (const attribute of element.attributes) {
    attributes.push(normalizedAttribute(element, attribute, { ...options, stateful }));
  }
  if (stateful && !options.captured) {
    attributes.push(...controlState(element));
  }
  return attributes.filter(Boolean).sort(([a], [b]) => Number(a > b) - Number(a < b));
}

/**
 * One attribute as it is written, or undefined when it is left out.
 *
 * @param {object} element The element that carries it, whose parsed style a style attribute is read from.
 * @param {object} attribute One of the element's attributes, as `attributes` lists it.
 * @param {{ nonce?: string, captured?: boolean, stateful: boolean }} options See normalizeBody.
 * @returns {[string, string] | undefined} Its name and value.
 */
function normalizedAttribute(element, attribute, options) {
  const { name } = attribute;
  if (options.stateful && (name === 'value' || name === 'checked' || name === 'selected')) {
    return undefined;
  }
  // The Notes Graph says "Simulating…" until its layout settles, which a
  // loaded CI runner reaches later than the moment Chrome is read at.
  if (options.captured && name === 'hidden' && element.id === 'sim-note') {
    return undefined;
  }
  let value = attribute.value;
  if (name === 'class') {
    value = value.split(WHITESPACE).filter(Boolean).sort().join(' ');
  } else if (name === 'style') {
    value = readStyle(element, options.captured);
  } else if (BOOLEAN.has(name)) {
    value = '';
  }
  if ((name === 'class' || name === 'style') && !value) {
    return undefined;
  }
  return [name, options.nonce ? value.split(options.nonce).join('NONCE') : value];
}

/**
 * An element's style as the snapshot writes it: from its declarations,
 * or, drawn by Chrome, as the probe captured it, a popover's place left
 * out, since Chrome places it by fonts that differ by system, where jsdom,
 * which lays nothing out, gives it a fixed number.
 *
 * @param {object} element The element that carries it.
 * @param {boolean | undefined} captured Whether Chrome drew it.
 * @returns {string} Its style.
 */
function readStyle(element, captured) {
  if (!captured) {
    return styleText(element.style);
  }
  const value = element.getAttribute('style') || '';
  return isPopover(element) ? withoutPlace(value) : value;
}

/**
 * Whether an element floats over the page: a menu, which a script places
 * by the size of what it is drawn over and of itself.
 *
 * @param {object} element An element of the drawn page.
 * @returns {boolean} Whether it is a popover.
 */
function isPopover(element) {
  return Boolean(element.classList && element.classList.contains('popover'));
}

/**
 * A style without where it was placed: a popover's left and top follow
 * the system's fonts, as its width and its anchor's do, so the markup would
 * differ between systems that draw the same menu; the layout and visual
 * checks see where it lands.
 *
 * @param {string} value The style as written.
 * @returns {string} The same declarations, left and top aside.
 */
function withoutPlace(value) {
  return value
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration && !/^(left|top)\s*:/.test(declaration))
    .join('; ');
}

/** Text as it is written between tags. */
function escapeText(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
}

/** An attribute value as it is written between double quotes, on one line. */
function escapeAttribute(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/ /g, '&nbsp;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
    .replace(/\t/g, '&#9;');
}

/**
 * The nodes the comparison sees under a parent: elements that are not
 * dropped, and text, with adjacent text merged and whitespace collapsed.
 *
 * @param {object} parent The element whose child nodes are read.
 * @param {{ nonce?: string }} options See normalizeBody.
 * @returns {Array<object | string>} Elements, and text as strings.
 */
function keptChildren(parent, options) {
  const kept = [];
  for (const child of parent.childNodes) {
    if (child.nodeType === 1) {
      if (!DROPPED.has(child.localName) && child.id !== 'layout-probe') {
        kept.push(child);
      }
      continue;
    }
    if (child.nodeType !== 3) {
      continue;
    }
    const text = options.nonce ? child.data.split(options.nonce).join('NONCE') : child.data;
    if (typeof kept[kept.length - 1] === 'string') {
      kept[kept.length - 1] += text;
    } else {
      kept.push(text);
    }
  }
  return kept.map((node) => (typeof node === 'string' ? node.replace(WHITESPACE, ' ') : node)).filter((node) => node !== '');
}

/**
 * Writes an element and everything under it.
 *
 * @param {object} element The element to write, with its subtree.
 * @param {number} depth How deep it sits, for the indent inside its tags.
 * @param {{ nonce?: string, captured?: boolean }} options See normalizeBody.
 * @returns {string} Its normalized HTML.
 */
function writeElement(element, depth, options) {
  const name = element.localName;
  const indent = '  '.repeat(depth);
  const attributes = normalizedAttributes(element, options)
    .map(([attribute, value]) => `\n${indent}  ${attribute}="${escapeAttribute(value)}"`)
    .join('');
  const open = `<${name}${attributes}\n${indent}>`;
  if (VOID.has(name)) {
    return open;
  }
  const children = keptChildren(element, options)
    .map((child) => (typeof child === 'string' ? escapeText(child) : writeElement(child, depth + 1, options)))
    .join('');
  return `${open}${children}</${name}\n${indent}>`;
}

/**
 * A page's body as normalized HTML.
 *
 * @param {object} body The body element, live in jsdom or parsed from a capture.
 * @param {{ nonce?: string, captured?: boolean }} [options] `nonce` is the
 *   page's, written as NONCE. `captured` says the body was cloned by the
 *   Chrome probe, which already carried each control's state as data-dom-*
 *   and wrote each style attribute from its declarations.
 * @returns {string} HTML that parses back to the normalized body.
 */
function normalizeBody(body, options = {}) {
  return `${writeElement(body, 0, options)}\n`;
}

/**
 * The same body with every text node of only whitespace removed and the rest
 * trimmed, for telling a difference of spacing from a difference of markup.
 *
 * @param {string} normalized What normalizeBody wrote.
 * @returns {string} The text without whitespace between tags.
 */
function withoutSpacing(normalized) {
  return normalized.replace(/>\s+</g, '><').replace(/>\s+/g, '>').replace(/\s+</g, '<');
}

/**
 * The script the Chrome probe runs to capture its body: a clone, with each
 * control's state copied onto it as data-dom-* and each style attribute
 * written from the element's declarations, as normalizeBody would write them
 * from a live element.
 *
 * @returns {string} A function expression, `function captureDom() { … }`, that returns the clone's outer HTML.
 */
function captureScript() {
  return `function captureDom() {
  ${styleText.toString()}
  ${controlState.toString()}
  var stateful = ${JSON.stringify([...STATEFUL])};
  var clone = document.body.cloneNode(true);
  var originals = [document.body].concat(Array.prototype.slice.call(document.body.querySelectorAll('*')));
  var copies = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*')));
  originals.forEach(function (original, index) {
    var copy = copies[index];
    if (original.hasAttribute('style')) copy.setAttribute('style', styleText(original.style));
    if (stateful.indexOf(original.localName) < 0 || original.namespaceURI !== 'http://www.w3.org/1999/xhtml') return;
    ['value', 'checked', 'selected'].forEach(function (name) { copy.removeAttribute(name); });
    controlState(original).forEach(function (pair) { copy.setAttribute(pair[0], pair[1]); });
  });
  return clone.outerHTML;
}`;
}

module.exports = { normalizeBody, withoutSpacing, captureScript };
