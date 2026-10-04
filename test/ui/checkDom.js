// Draws each surface in Chrome and compares the DOM it drew with the one
// recorded, element by element.
//
// Phase 6 of the refactor rewrites every page's markup, and the stylesheets,
// the layout and contrast checks, and the page-driving tests all key on it
// (docs/implementation/20-webviews.md §2.1). The visual check sees a change
// only once it moves a pixel, and only on the first screen; this sees a class,
// an attribute, an element, or a text node that changed anywhere on the page,
// before any pixel is compared. The goldens were recorded from the pages as
// they were before the rewrite began, so a difference is a change the rewrite
// made, to be undone or named in its commit.
//
// The layout check's probe captures the body before it measures anything
// (test/ui/checkLayout.js), and test/harness/domSnapshot.js normalizes it, so
// what is compared is what a selector or a reader could tell apart. The
// theme changes no markup but the gear's theme name, so the pages are drawn
// in Replicant only, with and without zen. The DOM is Chrome's, laid out at
// the surface's size, because the Task Board draws only the cards on screen.
//
//
// A page that reads its first snapshot from inert JSON in its shell
// (readsInertState in src/test/pages.ts) is drawn twice: with the snapshot
// posted, as every page is, and with it embedded in the shell. The two must
// be the same DOM, so a page draws alike however its state reached it
// (docs/implementation/20-webviews.md §2.3).
//
//   npm run test:dom
//   npm run test:dom -- --update   record what is drawn now as the goldens
//   DOM_ONLY=taskBoard+zen         one surface, or every surface of a page
//   DOM_KEEP=<dir>                 leave the pages and what each drew there
const path = require('node:path');
const os = require('node:os');
const { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');

const { renderPage, renderPagesForTheme } = require('./pages.js');
const modules = require('../harness/modules.js');
const { buildPage, measure, probeScript } = require('./checkLayout.js');
const { createSurfaces, surfaceHtml } = require('./surfaces.js');
const { readPageNonce } = require('../harness/loadPage.js');
const { normalizeBody, withoutSpacing } = require('../harness/domSnapshot.js');

const GOLDENS = path.join(__dirname, 'dom-baseline');
/** The one theme the pages are drawn in; see the header. */
const THEME = 'replicant';
/** How many lines of a difference are printed before the rest is left out. */
const SHOWN_LINES = 12;

/**
 * The body Chrome drew, normalized.
 *
 * @param {string} captured The body's outer HTML, as the probe cloned it.
 * @param {string | undefined} nonce The page's nonce.
 * @returns {string} What normalizeBody writes for it.
 */
function normalizeCapture(captured, nonce) {
  const { window } = new JSDOM(`<!DOCTYPE html><html><head></head>${captured}</html>`);
  try {
    return normalizeBody(window.document.body, { nonce, captured: true });
  } finally {
    window.close();
  }
}

/**
 * Where two drawings part, as lines to print: the first line that differs,
 * with a little of what came before it.
 *
 * @param {string} expected The golden.
 * @param {string} actual What was drawn now.
 * @returns {string[]} Lines marked `-` for the golden and `+` for now.
 */
function describeDifference(expected, actual) {
  const before = expected.split('\n');
  const after = actual.split('\n');
  let first = 0;
  while (first < before.length && before[first] === after[first]) {
    first += 1;
  }
  const context = before.slice(Math.max(0, first - 3), first).map((line) => `  ${line}`);
  const removed = before.slice(first, first + SHOWN_LINES / 2).map((line) => `- ${line}`);
  const added = after.slice(first, first + SHOWN_LINES / 2).map((line) => `+ ${line}`);
  return [`at line ${first + 1}:`, ...context, ...removed, ...added];
}

/**
 * Draws one surface and captures its body.
 *
 * @param {object} surface The surface, from surfaces.js.
 * @param {string} html The page it draws, as the host renders it.
 * @param {string} file Where to write the page Chrome opens.
 * @returns {string} The normalized body.
 */
function drawSurface(surface, html, file) {
  writeFileSync(file, buildPage(html, surface, probeScript(surface, { captureDom: true })));
  const runs = measure(file, surface.viewport);
  if (!runs[0] || typeof runs[0].dom !== 'string') {
    throw new Error('the probe reported no DOM');
  }
  return normalizeCapture(runs[0].dom, readPageNonce(html));
}

/**
 * Compares one surface with its golden, or records it.
 *
 * @param {string} name The surface's name, with +zen for the zen pass.
 * @param {string} drawn Its normalized body.
 * @param {{ updating: boolean, keep?: string }} options Whether to record, and where to leave what was drawn.
 * @returns {'ok' | 'recorded' | 'failed'} What happened.
 */
function compareSurface(name, drawn, options) {
  const golden = path.join(GOLDENS, `${name}.html`);
  if (options.keep) {
    writeFileSync(path.join(options.keep, `${name}.dom.html`), drawn);
  }
  if (options.updating) {
    writeFileSync(golden, drawn);
    console.log(`  recorded ${name}`);
    return 'recorded';
  }
  if (!existsSync(golden)) {
    console.log(`  FAIL ${name}: no golden; record one with "npm run test:dom -- --update"`);
    return 'failed';
  }
  const expected = readFileSync(golden, 'utf8');
  if (expected === drawn) {
    console.log(`  ok   ${name}`);
    return 'ok';
  }
  // A space between two inline elements is visible, so a difference of
  // spacing alone still fails, but it is named as one.
  const kind = withoutSpacing(expected) === withoutSpacing(drawn) ? 'spacing only' : 'markup';
  console.log(`  FAIL ${name}: the DOM differs (${kind})`);
  describeDifference(expected, drawn).forEach((line) => console.log(`         ${line}`));
  return 'failed';
}

/**
 * Whether a surface's page reads its first snapshot from its shell, so it is
 * drawn with the snapshot embedded as well as posted.
 *
 * @param {{ page: string, snapshot?: () => unknown }} surface Which page it draws, and the snapshot it is drawn from.
 * @returns {boolean} Whether to draw it embedded too.
 */
function readsInertState(surface) {
  const page = modules.pageCatalog.PAGES.find((entry) => entry.id === surface.page);
  return Boolean(page && page.readsInertState && surface.snapshot);
}

/**
 * Draws a surface with its snapshot embedded in the shell rather than
 * posted, and says whether it drew what the posted state drew.
 *
 * @param {{ surface: object, name: string }} entry The surface and its golden's name.
 * @param {string} posted What the surface drew with its snapshot posted.
 * @param {{ chrome: { theme: string, zen: boolean }, dir: string }} options The theme and zen state, and where to write the page.
 * @returns {boolean} Whether the two drew the same DOM.
 */
function checkEmbedded(entry, posted, options) {
  const { surface, name } = entry;
  const pageOptions = { ...(surface.pageOptions ? surface.pageOptions() : {}), state: surface.snapshot() };
  const html = renderPage(surface.page, { ...options.chrome, ...(surface.display ? { display: surface.display } : {}), pageOptions });
  let embedded;
  try {
    embedded = drawSurface({ ...surface, snapshot: undefined }, html, path.join(options.dir, `${name}.embedded.html`));
  } catch (error) {
    console.log(`  FAIL ${name}, embedded: ${error.message}`);
    return false;
  }
  if (embedded === posted) {
    console.log(`  ok   ${name}, embedded and posted alike`);
    return true;
  }
  console.log(`  FAIL ${name}: the DOM drawn from the shell's inert JSON differs from the DOM drawn from the posted state`);
  describeDifference(posted, embedded).forEach((line) => console.log(`         ${line}`));
  return false;
}

/**
 * The surfaces to draw in one zen state, each with its golden's name.
 *
 * @param {boolean} zen Whether zen mode is on.
 * @returns {Array<{ surface: object, name: string }>} The surfaces DOM_ONLY leaves in.
 */
function surfacesFor(zen) {
  const only = process.env.DOM_ONLY;
  return createSurfaces()
    .map((surface) => ({ surface, name: `${surface.name || surface.page}${zen ? '+zen' : ''}` }))
    .filter(({ surface, name }) => !only || only === name || only === (surface.name || surface.page) || only === surface.page);
}

/**
 * Fails, or with --update removes, a golden no surface draws any more.
 *
 * @param {Set<string>} seen The goldens this run drew.
 * @param {boolean} updating Whether to remove rather than fail.
 * @returns {number} How many failed.
 */
function checkStale(seen, updating) {
  let failed = 0;
  for (const stale of readdirSync(GOLDENS).filter((file) => file.endsWith('.html') && !seen.has(file))) {
    if (updating) {
      rmSync(path.join(GOLDENS, stale));
      console.log(`  removed ${stale}: nothing draws it now`);
    } else {
      failed += 1;
      console.log(`  FAIL ${stale}: a golden nothing draws now; run with --update to drop it`);
    }
  }
  return failed;
}

/**
 * Draws and compares every surface of one zen state.
 *
 * @param {boolean} zen Whether zen mode is on.
 * @param {{ updating: boolean, keep?: string, dir: string, seen: Set<string> }} options
 *   Whether to record, where to leave what was drawn, where to write the
 *   pages, and the goldens drawn so far, which this adds to.
 * @returns {number} How many surfaces failed.
 */
function checkZenState(zen, options) {
  const rendered = new Map(renderPagesForTheme(THEME, { zen }));
  let failed = 0;
  for (const { surface, name } of surfacesFor(zen)) {
    options.seen.add(`${name}.html`);
    let drawn;
    try {
      drawn = drawSurface(surface, surfaceHtml(surface, rendered, { theme: THEME, zen }), path.join(options.dir, `${name}.html`));
    } catch (error) {
      failed += 1;
      console.log(`  FAIL ${name}: ${error.message}`);
      continue;
    }
    failed += compareSurface(name, drawn, options) === 'failed' ? 1 : 0;
    if (readsInertState(surface) && !checkEmbedded({ surface, name }, drawn, { chrome: { theme: THEME, zen }, dir: options.dir })) {
      failed += 1;
    }
  }
  return failed;
}

/** Draws every surface, compares each, and exits non-zero on any difference. */
function run() {
  const updating = process.argv.includes('--update');
  const keep = process.env.DOM_KEEP;
  const dir = keep || mkdtempSync(path.join(os.tmpdir(), 'deckard-dom-'));
  mkdirSync(dir, { recursive: true });
  mkdirSync(GOLDENS, { recursive: true });
  const seen = new Set();
  let failed = 0;
  try {
    for (const zen of [false, true]) {
      failed += checkZenState(zen, { updating, keep, dir, seen });
    }
    failed += process.env.DOM_ONLY ? 0 : checkStale(seen, updating);
  } finally {
    if (!keep) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  if (failed) {
    console.log(`\n${failed} surface(s) drew a different DOM`);
    console.log('If the change is meant, name it in the commit and record it with "npm run test:dom -- --update".');
    process.exit(1);
  }
  console.log(updating ? '\nrecorded the DOM of every surface' : '\nevery surface draws the DOM it did');
}

run();
