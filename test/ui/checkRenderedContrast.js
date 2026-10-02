// Measures contrast in a real browser, as the pages are drawn.
//
// The contrast check reads the stylesheet: it resolves tokens and matches
// rules to the markup a page writes. That misses what only a browser knows:
// a background inherited from three ancestors up, a row drawn by a script,
// the ground an input sits on. This renders the surfaces the layout check
// renders, in every theme, and asks the page itself what color each piece of
// text is drawn in and what is painted behind it, and what an input's edge is
// drawn in against the ground around it, and what draws the icon of a
// control that has no words against the ground under it.
//
// WCAG 2.2 AA: text needs 4.5:1, large text 3:1, where large is 24px, or
// 18.66px at bold (18pt and 14pt; points, not pixels). A text field needs
// 3:1 between what marks its edge and what is around it, and an icon that
// is a control's only content 3:1 against what it is drawn on (1.4.11).
//
//   npm run test:layout
//   CONTRAST_ONLY=fellowship:taskBoardByTag   one surface, a theme, or a page
//   UI_CONCURRENCY=<n>                        how many Chromes draw at once
//
// The pages are drawn by several Chromes at once, half the logical cores'
// worth and at most four unless UI_CONCURRENCY says otherwise (chromePool.js),
// and each surface is reported in the same order, with the same lines, as
// when they were drawn one at a time; UI_CONCURRENCY=1 draws them so.
const path = require('node:path');
const os = require('node:os');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');

const { renderPagesForTheme } = require('./pages.js');
const { surfaceHtml } = require('./surfaces.js');
const { chrome, createSurfaces, buildPage, measureAsync, passes } = require('./checkLayout.js');
const { runInOrder } = require('./chromePool.js');
const { pickSurfaces } = require('../harness/surfacePicks.js');

if (!chrome) {
  console.log('rendered contrast check skipped: no Chrome found (set CHROME_PATH)');
  process.exit(0);
}

/**
 * Text drawn below AA that is known and not yet fixed, by theme, surface,
 * and element, zen or not, as `<theme>:<surface> <kind> <element>`. It is
 * empty: anything below AA fails.
 */
const KNOWN = new Set([]);

/**
 * Controls whose only content is an icon, by selector. WCAG asks 3:1 of
 * the icon against what it is drawn on (1.4.11), and the text check never
 * sees it. Each is measured at rest and hovered: the calendar's week mark,
 * whose icon LCARS once drew in its buttons' black on the calendar's own
 * black; the Task Board's move menu, which takes the hover ink while its
 * menu is open; Related Notes' link button, shown when its row is hovered;
 * and the Notes Graph's zoom buttons.
 */
const ICON_CONTROLS = ['.week-label', '.board-move', '.insert-link', '.zoom-controls button'];

/**
 * Controls whose words are measured hovered as well as at rest, by
 * selector: the sidebar calendar's days, where the theme's hover ground
 * meets the muted ink of a day outside the month.
 */
const HOVERED_TEXT = ['.day'];

/**
 * Text a page holds hidden and shows only for a moment, by selector, which
 * is shown to be measured: the Notes Graph's note that it is simulating.
 */
const REVEALED = ['#sim-note'];

/** What the page measures about its own colors, written for the dump. */
const PROBE = `
(function () {
  // The class a hovered run puts in place of :hover; see below.
  const hoverClass = 'contrast-probe-hover';
  function parse(value) {
    const m = /rgba?\\(([^)]+)\\)/.exec(value || '');
    if (!m) return null;
    const p = m[1].split(/[\\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  }
  function over(top, bottom) {
    const a = top.a;
    return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 };
  }
  function luminance(c) {
    return [c.r, c.g, c.b].map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
      .reduce(function (sum, v, i) { return sum + v * [0.2126, 0.7152, 0.0722][i]; }, 0);
  }
  function ratio(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  // What is painted behind an element: its own background and every one
  // above it, laid over each other down to the first that is opaque.
  function ground(el) {
    const layers = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const color = parse(getComputedStyle(node).backgroundColor);
      if (color && color.a > 0) {
        layers.push(color);
        if (color.a >= 1) break;
      }
    }
    let result = { r: 0, g: 0, b: 0, a: 1 };
    for (let i = layers.length - 1; i >= 0; i -= 1) result = over(layers[i], result);
    return result;
  }
  function opacity(el) {
    let value = 1;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) value *= Number(getComputedStyle(node).opacity);
    return value;
  }
  function name(el) {
    // The class that stands in for :hover is the probe's, not the page's.
    const own = function (node) {
      const classes = [...node.classList].filter(function (c) { return c !== hoverClass; });
      return node.tagName.toLowerCase() + (classes.length ? '.' + classes.slice(0, 3).join('.') : '');
    };
    // Two ancestors say where it is: a tag in a card, a count in a facet.
    const above = [el.parentElement, el.parentElement && el.parentElement.parentElement].filter(function (node) { return node && node !== document.body; });
    return above.reverse().map(own).concat(own(el)).join(' > ');
  }
  function shown(el) {
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  const failures = [];
  const seen = new Set();
  // The colors of an element's own words against what is behind them, in a
  // state: 'rest', 'hovered' with the pointer over the element, or 'shown'
  // for text a page holds hidden until it has something to say.
  function checkText(el, state) {
    if (el.closest('[aria-hidden="true"], #layout-probe, script, style, svg, [hidden]')) return;
    // A control that cannot be used is exempt, as WCAG has it.
    if (el.closest('[disabled], [aria-disabled="true"]')) return;
    const own = [...el.childNodes].some(function (n) { return n.nodeType === 3 && n.textContent.trim(); });
    if (!own || !shown(el)) return;
    const style = getComputedStyle(el);
    const fg = parse(style.color);
    if (!fg) return;
    const bg = ground(el);
    const alpha = fg.a * opacity(el);
    const drawn = over({ r: fg.r, g: fg.g, b: fg.b, a: alpha }, bg);
    const size = parseFloat(style.fontSize);
    const weight = Number(style.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const needed = large ? 3 : 4.5;
    const value = ratio(drawn, bg);
    if (value + 0.005 < needed) {
      const key = state + name(el) + style.color + '|' + bg.r + ',' + bg.g + ',' + bg.b;
      if (seen.has(key)) return;
      seen.add(key);
      failures.push({ kind: 'text', state, el: name(el), text: el.textContent.trim().slice(0, 30), ratio: +value.toFixed(2), needed, size, fg: style.color, bg: 'rgb(' + [bg.r, bg.g, bg.b].map(Math.round).join(', ') + ')' });
    }
  }
  // An icon that is a control's only content: what draws its shape, its
  // stroke or else its fill, against the ground under the control. A
  // control drawn at no opacity is not shown yet, as a row's link button is
  // until its row is hovered, so it is measured where it shows.
  function checkIcon(el, state) {
    const shape = el.querySelector('svg');
    if (!shape || !shown(el) || el.closest('[aria-hidden="true"], [hidden]')) return;
    if (opacity(shape) === 0) return;
    const style = getComputedStyle(shape);
    const paint = parse(style.stroke) || parse(style.fill);
    if (!paint) return;
    const bg = ground(el);
    const value = ratio(over({ r: paint.r, g: paint.g, b: paint.b, a: paint.a * opacity(shape) }, bg), bg);
    if (value + 0.005 < 3) {
      const key = state + name(el) + (style.stroke || style.fill) + '|' + bg.r + ',' + bg.g + ',' + bg.b;
      if (seen.has(key)) return;
      seen.add(key);
      failures.push({ kind: 'icon', state, el: name(el), ratio: +value.toFixed(2), needed: 3, fg: parse(style.stroke) ? style.stroke : style.fill, bg: 'rgb(' + [bg.r, bg.g, bg.b].map(Math.round).join(', ') + ')' });
    }
  }
  // Text: each element that holds words of its own.
  for (const el of document.querySelectorAll('body *')) checkText(el, 'rest');
  // Text fields: the edge, or the fill, must stand out from the ground.
  for (const el of document.querySelectorAll('input[type="text"], input[type="search"], select, textarea, .query-bar-shell')) {
    if (!shown(el) || el.closest('[aria-hidden="true"], [hidden]')) continue;
    // A field drawn inside a shell has the shell for its edge.
    if (el.closest('.query-bar-shell') && !el.matches('.query-bar-shell')) continue;
    const style = getComputedStyle(el);
    const outside = ground(el.parentElement);
    const fill = over(parse(style.backgroundColor) || { r: 0, g: 0, b: 0, a: 0 }, outside);
    const width = parseFloat(style.borderBottomWidth) || 0;
    const edge = width > 0 && style.borderBottomStyle !== 'none' ? over(parse(style.borderBottomColor), outside) : fill;
    const best = Math.max(ratio(edge, outside), ratio(edge, fill), ratio(fill, outside));
    if (best + 0.005 < 3) {
      const key = name(el) + style.borderBottomColor;
      if (seen.has(key)) continue;
      seen.add(key);
      failures.push({ kind: 'edge', el: name(el), ratio: +best.toFixed(2), needed: 3, fg: style.borderBottomColor, bg: 'rgb(' + [outside.r, outside.g, outside.b].map(Math.round).join(', ') + ')' });
    }
  }
  const icons = ${JSON.stringify(ICON_CONTROLS.join(', '))};
  for (const el of document.querySelectorAll(icons)) checkIcon(el, 'rest');
  // Hovered: :hover cannot be forced from a script, so every :hover rule is
  // rewritten to match a class, as the layout check does, and the class is
  // put on one control at a time and on everything it sits in, since the
  // pointer over a control is over those too.
  (function rewrite(rules) {
    for (const rule of rules) {
      if (rule.selectorText && rule.selectorText.includes(':hover')) {
        rule.selectorText = rule.selectorText.split(':hover').join('.' + hoverClass);
      }
      if (rule.cssRules) rewrite(rule.cssRules);
    }
  })([...document.styleSheets].flatMap(function (sheet) { try { return [...sheet.cssRules]; } catch (error) { return []; } }));
  const hovered = ${JSON.stringify([...HOVERED_TEXT, ...ICON_CONTROLS].join(', '))};
  for (const el of document.querySelectorAll(hovered)) {
    if (el.closest('[disabled], [aria-disabled="true"]')) continue;
    const path = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) path.push(node);
    path.forEach(function (node) { node.classList.add(hoverClass); });
    if (el.matches(icons)) checkIcon(el, 'hovered');
    else [el, ...el.querySelectorAll('*')].forEach(function (node) { checkText(node, 'hovered'); });
    path.forEach(function (node) { node.classList.remove(hoverClass); });
  }
  // Shown: what a page draws only for a moment is put in view, measured,
  // and hidden again.
  for (const el of document.querySelectorAll(${JSON.stringify(REVEALED.join(', '))})) {
    if (!el.hidden) continue;
    el.hidden = false;
    [el, ...el.querySelectorAll('*')].forEach(function (node) { checkText(node, 'shown'); });
    el.hidden = true;
  }
  const pre = document.createElement('pre');
  pre.id = 'layout-probe';
  pre.textContent = JSON.stringify([{ failures: failures }]);
  document.body.appendChild(pre);
})();`;

/**
 * What a surface draws below AA, less what Corpo's field edges and the known
 * list excuse; a Chrome that fails is one failure of kind `error`.
 */
async function surfaceFailures(file, surface, theme, log) {
  try {
    return (await measureAsync(file, surface.viewport, {}, log))[0].failures
      // Corpo draws a field's edge in VS Code's own input border, the
      // editor theme's choice and the edge its own fields have; its
      // text is still Deckard's to get right.
      .filter((failure) => !(theme === 'corpo' && failure.kind === 'edge'))
      .filter((failure) => !KNOWN.has(`${theme}:${surface.name || surface.page} ${failure.kind} ${failure.el}`));
  } catch (error) {
    return [{ kind: 'error', el: error.message }];
  }
}

/** One failure as the report prints it: the element, its ratio, and the colors. */
function describeFailure(failure) {
  return failure.kind === 'error'
    ? `         ${failure.el}`
    : `         ${failure.kind}${failure.state && failure.state !== 'rest' ? ` (${failure.state})` : ''} ${failure.el}${failure.text ? ` "${failure.text}"` : ''} ${failure.ratio} < ${failure.needed}: ${failure.fg} on ${failure.bg}${failure.size ? `, ${failure.size}px` : ''}`;
}

/**
 * Every surface CONTRAST_ONLY picks in every theme, with zen off and on, in
 * the order they are reported. A pass's pages are rendered only when its
 * first surface is taken.
 */
function* contrastJobs() {
  for (const [theme, zen] of passes()) {
    const label = zen ? `${theme}+zen` : theme;
    // Named by surface, not page: the Task Board's two surfaces share a page.
    const picked = pickSurfaces(createSurfaces(), process.env.CONTRAST_ONLY, label);
    if (picked.length === 0) {
      continue;
    }
    const rendered = new Map(renderPagesForTheme(theme, { zen }));
    for (const { surface, name } of picked) {
      yield { surface, name, label, theme, zen, rendered };
    }
  }
}

/**
 * Draws every surface CONTRAST_ONLY picks in every theme, with zen off and
 * on, writing each page into `dir`, several at once (UI_CONCURRENCY), and
 * prints what each draws below AA, in turn.
 *
 * @returns {Promise<number>} How many surfaces failed.
 */
async function checkSurfaces(dir) {
  const verdicts = await runInOrder(contrastJobs(), async ({ surface, name, label, theme, zen, rendered }, log) => {
    const file = path.join(dir, `${label}-${name}.html`);
    writeFileSync(file, buildPage(surfaceHtml(surface, rendered, { theme, zen }), surface, PROBE));
    const failures = await surfaceFailures(file, surface, theme, log);
    if (failures.length === 0) {
      log(`  ok   ${label.padEnd(16)} ${name}`);
      return false;
    }
    log(`  FAIL ${label.padEnd(16)} ${name}`);
    for (const failure of failures) {
      log(describeFailure(failure));
    }
    return true;
  });
  return verdicts.filter(Boolean).length;
}

/** The check: every surface drawn and measured, exiting 1 when any fails. */
async function run() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'deckard-contrast-'));
  let failed = 0;
  try {
    failed = await checkSurfaces(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (failed) {
    console.log(`\n${failed} surface(s) with text, edges, or icons below WCAG AA`);
    process.exit(1);
  }
  console.log('\nevery surface meets WCAG AA contrast as drawn');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
