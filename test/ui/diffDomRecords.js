// Lists every state that two runs of the page-driving suites drew
// differently.
//
// With DECKARD_DOM_RECORD=<dir>, openWebviewPage and test/e2e/support.js
// write each mounted page's normalized body after every message and every
// reader action (test/harness/domRecorder.js). Run the suites once on the
// phase base and once on a branch, each into its own folder, then compare:
//
//   DECKARD_DOM_RECORD=/tmp/base npm run test:unit      (and npm test, test:e2e)
//   DECKARD_DOM_RECORD=/tmp/branch npm run test:unit
//   node test/ui/diffDomRecords.js /tmp/base /tmp/branch
//
// It prints a summary and the first lines that differ in each state, and
// exits 1 when any state differs or exists in one run only. The summary goes
// in the page's pull request (docs/implementation/20-webviews.md §2.3).
//
// Some states draw the wall clock: Stats writes when the index was last
// refreshed into a title, so two runs of one commit already differ there.
// Record the base twice and pass the second run as a third folder; a state
// the two base runs drew differently is listed as unstable rather than as a
// difference, and is left for a reader to compare by eye.
//
//   node test/ui/diffDomRecords.js /tmp/base /tmp/branch /tmp/base-again
const path = require('node:path');
const { existsSync, readdirSync, readFileSync, statSync } = require('node:fs');
const { withoutSpacing } = require('../harness/domSnapshot.js');

/** How many lines of each difference are printed. */
const SHOWN_LINES = 6;

/**
 * Every record under a run's folder, by its path from the folder.
 *
 * @param {string} root The run's folder.
 * @returns {string[]} Paths such as `stats.test.js/0001-0002.html`, sorted.
 */
function listRecords(root) {
  const records = [];
  for (const suite of readdirSync(root).sort()) {
    const folder = path.join(root, suite);
    if (!statSync(folder).isDirectory()) {
      continue;
    }
    for (const file of readdirSync(folder).filter((name) => name.endsWith('.html')).sort()) {
      records.push(`${suite}/${file}`);
    }
  }
  return records;
}

/**
 * The first lines where two records part.
 *
 * @param {string} before The base's record.
 * @param {string} after The branch's record.
 * @returns {string[]} The line number, then the base's lines marked `-` and the branch's marked `+`.
 */
function firstDifference(before, after) {
  const left = before.split('\n');
  const right = after.split('\n');
  let line = 0;
  while (line < left.length && left[line] === right[line]) {
    line += 1;
  }
  return [
    `at line ${line + 1}:`,
    ...left.slice(line, line + SHOWN_LINES).map((text) => `- ${text}`),
    ...right.slice(line, line + SHOWN_LINES).map((text) => `+ ${text}`),
  ];
}

/**
 * Compares two runs' records and prints what differs.
 *
 * @param {string} baseRoot The base run's folder.
 * @param {string} branchRoot The branch run's folder.
 * @param {Set<string>} unstable The states two runs of the base drew differently, which are not compared.
 * @returns {number} How many states differ or are in one run only.
 */
function compareRuns(baseRoot, branchRoot, unstable) {
  const base = listRecords(baseRoot);
  const branch = new Set(listRecords(branchRoot));
  const counts = { same: 0, markup: 0, spacing: 0, unstable: 0, onlyBase: 0, onlyBranch: 0 };
  for (const record of base) {
    if (unstable.has(record)) {
      counts.unstable += 1;
      branch.delete(record);
      continue;
    }
    if (!branch.has(record)) {
      counts.onlyBase += 1;
      console.log(`  only in the base: ${record}`);
      continue;
    }
    branch.delete(record);
    const before = readFileSync(path.join(baseRoot, record), 'utf8');
    const after = readFileSync(path.join(branchRoot, record), 'utf8');
    if (before === after) {
      counts.same += 1;
      continue;
    }
    // A space between two inline elements is visible, so spacing alone
    // still counts, but it is named as its own kind.
    const kind = withoutSpacing(before) === withoutSpacing(after) ? 'spacing' : 'markup';
    counts[kind] += 1;
    console.log(`  differs (${kind}): ${record} ${before.split('\n')[0]}`);
    firstDifference(before, after).forEach((line) => console.log(`      ${line}`));
  }
  for (const record of branch) {
    counts.onlyBranch += 1;
    console.log(`  only in the branch: ${record}`);
  }
  console.log(`\n${base.length} states in the base: ${counts.same} the same, ${counts.markup} with different markup, ${counts.spacing} with different spacing only, ${counts.unstable} unstable; ${counts.onlyBase} only in the base, ${counts.onlyBranch} only in the branch.`);
  return counts.markup + counts.spacing + counts.onlyBase + counts.onlyBranch;
}

/**
 * The states two runs of one commit drew differently.
 *
 * @param {string} firstRoot One run's folder.
 * @param {string | undefined} secondRoot Another run's folder, if one was given.
 * @returns {Set<string>} Their records that differ.
 */
function unstableRecords(firstRoot, secondRoot) {
  if (!secondRoot) {
    return new Set();
  }
  const second = new Set(listRecords(secondRoot));
  return new Set(listRecords(firstRoot).filter((record) => second.has(record)
    && readFileSync(path.join(firstRoot, record), 'utf8') !== readFileSync(path.join(secondRoot, record), 'utf8')));
}

const [baseRoot, branchRoot, baseAgainRoot] = process.argv.slice(2);
if (!baseRoot || !branchRoot || ![baseRoot, branchRoot, baseAgainRoot].filter(Boolean).every((root) => existsSync(root))) {
  console.error('Usage: node test/ui/diffDomRecords.js <base records> <branch records> [<base records again>]');
  process.exit(2);
}
process.exit(compareRuns(baseRoot, branchRoot, unstableRecords(baseRoot, baseAgainRoot)) ? 1 : 0);
