// Reads the DOM goldens back as documents, for the checks that ask what the
// pages draw rather than what their source text says.
//
// The contrast check's element shapes, the content-row rule, and the rule
// that no control carries a native title all used to read markup out of the
// page scripts' string literals. Once a page is compiled TSX there is no such
// text, and those checks would pass because they found nothing. The goldens
// in test/ui/dom-baseline are what each surface draws in Chrome, and
// `npm run test:dom` fails whenever a page stops drawing what its golden
// holds, so a check that reads them reads the pages as drawn.
const path = require('node:path');
const { readdirSync, readFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');

/** Where test:dom keeps the goldens. */
const GOLDENS = path.join(__dirname, '..', 'ui', 'dom-baseline');

/**
 * Parses each golden and hands its body to `visit`, one at a time, closing
 * each window before the next is opened.
 *
 * @param {(name: string, body: object) => void} visit Called with the golden's
 *   name, `<surface>` or `<surface>+zen`, and its parsed body element.
 * @returns {number} How many goldens were read.
 */
function readGoldens(visit) {
  const files = readdirSync(GOLDENS).filter((file) => file.endsWith('.html')).sort();
  for (const file of files) {
    const { window } = new JSDOM(`<!DOCTYPE html><html><head></head>${readFileSync(path.join(GOLDENS, file), 'utf8')}</html>`);
    try {
      visit(file.slice(0, -'.html'.length), window.document.body);
    } finally {
      window.close();
    }
  }
  return files.length;
}

module.exports = { readGoldens, GOLDENS };
