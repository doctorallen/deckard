// Draws every surface in Chrome and hands back the DOM each drew, in memory.
//
// The contrast check judges the element shapes a page draws, and a compiled
// page leaves no markup to read as text, so it asks Chrome. Each surface is
// drawn as the layout check draws it (test/ui/checkLayout.js): the host's
// HTML, the page's own script, the snapshot and messages the surface names,
// at its size. Its probe captures the body before it touches anything, and
// test/harness/domSnapshot.js normalizes it, so what is read is what a
// selector could tell apart. The theme changes no markup but the gear's
// theme name, so the surfaces are drawn in Replicant only, with zen off and
// on, since zen draws a few elements otherwise (the search box's folded
// facets, closed). Nothing is written but the pages Chrome opens, which go
// in a temporary folder.
//
// These drawings were once kept as goldens, test/ui/dom-baseline, which every
// harmless attribute change rewrote; they are drawn afresh instead.
const path = require('node:path');
const os = require('node:os');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');

const { findChrome, runInOrder } = require('./chromePool.js');
const { renderPagesForTheme } = require('./pages.js');
const { createSurfaces, surfaceHtml } = require('./surfaces.js');
const { readPageNonce } = require('../harness/loadPage.js');
const { normalizeBody } = require('../harness/domSnapshot.js');

/** The one theme the surfaces are drawn in; see the header. */
const THEME = 'replicant';

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

/** Every surface, with zen off and then on, each with its name and pass. */
function* drawJobs() {
  for (const zen of [false, true]) {
    const rendered = new Map(renderPagesForTheme(THEME, { zen }));
    for (const surface of createSurfaces()) {
      yield { surface, zen, rendered, name: `${surface.name || surface.page}${zen ? '+zen' : ''}` };
    }
  }
}

/**
 * Draws every surface in Replicant, with zen off and on, several at once
 * (UI_CONCURRENCY, test/ui/chromePool.js).
 *
 * @returns {Promise<Array<{ name: string, page: string, body: string }> | undefined>}
 *   Each surface's name (`<surface>` or `<surface>+zen`), its page, and its
 *   normalized body; undefined when no Chrome is found.
 */
async function drawSurfaces() {
  if (!findChrome()) {
    return undefined;
  }
  // The layout check exits when it finds no Chrome, so it is loaded only
  // once one is found.
  const { buildPage, measureAsync, probeScript } = require('./checkLayout.js');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'deckard-drawn-'));
  try {
    return await runInOrder(drawJobs(), async ({ surface, zen, rendered, name }, log) => {
      const html = surfaceHtml(surface, rendered, { theme: THEME, zen });
      const file = path.join(dir, `${name}.html`);
      writeFileSync(file, buildPage(html, surface, probeScript(surface, { captureDom: true })));
      const runs = await measureAsync(file, surface.viewport, {}, log);
      if (!runs[0] || typeof runs[0].dom !== 'string') {
        throw new Error(`${name}: the probe reported no DOM`);
      }
      return { name, page: surface.page, body: normalizeCapture(runs[0].dom, readPageNonce(html)) };
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Parses each drawn body and hands it to `visit`, one at a time, closing
 * each window before the next is opened.
 *
 * @param {Array<{ name: string, page: string, body: string }>} drawn What drawSurfaces returned.
 * @param {(entry: { name: string, page: string }, body: object) => void} visit Called with each surface and its parsed body.
 */
function visitDrawn(drawn, visit) {
  for (const { name, page, body } of drawn) {
    const { window } = new JSDOM(`<!DOCTYPE html><html><head></head>${body}</html>`);
    try {
      visit({ name, page }, window.document.body);
    } finally {
      window.close();
    }
  }
}

module.exports = { drawSurfaces, visitDrawn, THEME };
