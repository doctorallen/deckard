// Measures contrast in a real browser, as the pages are drawn.
//
// The contrast check reads the stylesheet: it resolves tokens and matches
// rules to the markup a page writes. That misses what only a browser knows:
// a background inherited from three ancestors up, a row drawn by a script,
// the ground an input sits on. This renders the surfaces the layout check
// renders, in every theme, and asks the page itself what color each piece of
// text is drawn in and what is painted behind it, and what an input's edge is
// drawn in against the ground around it.
//
// WCAG 2.2 AA: text needs 4.5:1, large text 3:1, where large is 24px, or
// 18.66px at bold (18pt and 14pt; points, not pixels). A text field needs
// 3:1 between what marks its edge and what is around it (1.4.11).
//
//   npm run test:layout
//   CONTRAST_ONLY=fellowship:taskBoard   one surface, a theme, or a page
const path = require('node:path');
const os = require('node:os');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');

const { renderPagesForTheme, themes } = require('./pages.js');
const { chrome, createSurfaces, buildPage, measure } = require('./checkLayout.js');

if (!chrome) {
  console.log('rendered contrast check skipped: no Chrome found (set CHROME_PATH)');
  process.exit(0);
}

/** What the page measures about its own colors, written for the dump. */
const PROBE = `
(function () {
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
    const own = function (node) { return node.tagName.toLowerCase() + (node.classList.length ? '.' + [...node.classList].slice(0, 3).join('.') : ''); };
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
  // Text: each element that holds words of its own.
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('[aria-hidden="true"], #layout-probe, script, style, svg, [hidden]')) continue;
    // A control that cannot be used is exempt, as WCAG has it.
    if (el.closest('[disabled], [aria-disabled="true"]')) continue;
    const own = [...el.childNodes].some(function (n) { return n.nodeType === 3 && n.textContent.trim(); });
    if (!own || !shown(el)) continue;
    const style = getComputedStyle(el);
    const fg = parse(style.color);
    if (!fg) continue;
    const bg = ground(el);
    const alpha = fg.a * opacity(el);
    const drawn = over({ r: fg.r, g: fg.g, b: fg.b, a: alpha }, bg);
    const size = parseFloat(style.fontSize);
    const weight = Number(style.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const needed = large ? 3 : 4.5;
    const value = ratio(drawn, bg);
    if (value + 0.005 < needed) {
      const key = name(el) + style.color + '|' + bg.r + ',' + bg.g + ',' + bg.b;
      if (seen.has(key)) continue;
      seen.add(key);
      failures.push({ kind: 'text', el: name(el), text: el.textContent.trim().slice(0, 30), ratio: +value.toFixed(2), needed, size, fg: style.color, bg: 'rgb(' + [bg.r, bg.g, bg.b].map(Math.round).join(', ') + ')' });
    }
  }
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
  const pre = document.createElement('pre');
  pre.id = 'layout-probe';
  pre.textContent = JSON.stringify([{ failures: failures }]);
  document.body.appendChild(pre);
})();`;

const dir = mkdtempSync(path.join(os.tmpdir(), 'deckard-contrast-'));
let failed = 0;
try {
  for (const theme of themes.map((entry) => entry.id ?? entry)) {
    for (const zen of [false, true]) {
      const label = zen ? `${theme}+zen` : theme;
      const rendered = new Map(renderPagesForTheme(theme, { zen }));
      for (const surface of createSurfaces(zen)) {
        const only = process.env.CONTRAST_ONLY;
        if (only && only !== `${label}:${surface.page}` && only !== surface.page && only !== label) continue;
        const file = path.join(dir, `${label}-${surface.page}.html`);
        writeFileSync(file, buildPage(rendered.get(surface.page), surface, PROBE));
        let failures;
        try {
          failures = measure(file, surface.viewport)[0].failures
            // Corpo draws a field's edge in VS Code's own input border, the
            // editor theme's choice and the edge its own fields have; its
            // text is still Deckard's to get right.
            .filter((failure) => !(theme === 'corpo' && failure.kind === 'edge'));
        } catch (error) {
          failures = [{ kind: 'error', el: error.message }];
        }
        if (failures.length === 0) {
          console.log(`  ok   ${label.padEnd(16)} ${surface.page}`);
          continue;
        }
        failed += 1;
        console.log(`  FAIL ${label.padEnd(16)} ${surface.page}`);
        for (const failure of failures) {
          console.log(failure.kind === 'error'
            ? `         ${failure.el}`
            : `         ${failure.kind} ${failure.el}${failure.text ? ` "${failure.text}"` : ''} ${failure.ratio} < ${failure.needed}: ${failure.fg} on ${failure.bg}${failure.size ? `, ${failure.size}px` : ''}`);
        }
      }
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
if (failed) {
  console.log(`\n${failed} surface(s) with text or edges below WCAG AA`);
  process.exit(1);
}
console.log('\nevery surface meets WCAG AA contrast as drawn');
