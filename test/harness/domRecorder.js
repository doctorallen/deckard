// Records the DOM a page draws at each step a suite drives it through, so the
// same suites run on two commits can be compared state by state.
//
// The DOM goldens of test:dom cover the states a surface draws. Most of what
// Phase 6 rewrites is only reached by driving a page: a menu opened, a
// builder row added, a column removed. The page-driving suites already reach
// those states, so with DECKARD_DOM_RECORD=<dir> each page they mount writes
// its normalized body (test/harness/domSnapshot.js) after every message it is
// sent and every action a reader takes. Running the suites once on the phase
// base and once on a branch, then `node test/ui/diffDomRecords.js <base>
// <branch>`, lists every state that differs. The records are not committed.
//
// A record is keyed by the suite's file, the page's mount index in that file,
// and the step: <dir>/<suite file>/<mount>-<step>.html. Its first line names
// the step, so a diff shows what was done as well as what was drawn.
const path = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');
const { normalizeBody } = require('./domSnapshot.js');
const { readPageNonce } = require('./loadPage.js');

/** How many pages each suite file has mounted so far in this process. */
const mounts = new Map();

/** The suite file that mounted the page, read from the call stack. */
function suiteFile() {
  for (const line of String(new Error().stack).split('\n')) {
    const match = /([^\s()/\\]+\.(?:test|e2e)\.js):\d+:\d+/.exec(line);
    if (match) {
      return match[1];
    }
  }
  return 'unknown-suite';
}

/** A number padded so the records sort in the order they were taken. */
function pad(value) {
  return String(value).padStart(4, '0');
}

/**
 * A recorder for one mounted page, which does nothing unless
 * DECKARD_DOM_RECORD names a folder.
 *
 * @param {object} document The page's document.
 * @param {string} html The page as its host rendered it, for its nonce.
 * @returns {{ record(step: string): void }} Writes the body as it is now, named by the step that led to it.
 */
function createDomRecorder(document, html) {
  const root = process.env.DECKARD_DOM_RECORD;
  if (!root) {
    return { record: () => undefined };
  }
  const file = suiteFile();
  const mount = (mounts.get(file) ?? 0) + 1;
  mounts.set(file, mount);
  const folder = path.join(root, file);
  mkdirSync(folder, { recursive: true });
  const nonce = readPageNonce(html);
  let step = 0;
  return {
    record(name) {
      step += 1;
      const body = normalizeBody(document.body, { nonce });
      writeFileSync(path.join(folder, `${pad(mount)}-${pad(step)}.html`), `<!-- ${name.replace(/--/g, '- -')} -->\n${body}`);
    },
  };
}

module.exports = { createDomRecorder };
