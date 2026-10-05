// Runs the mocha suites that never reach `vscode` under plain mocha, without
// starting VS Code.
//
//   npm run test:unit
//
// Which suites qualify is read from the import graph each time, by
// test/harness/importGraph.js, so a suite joins as soon as the refactor cuts
// its last path to `vscode`, and leaves the moment one comes back; the
// extension-host run (.vscode-test.mjs) takes every suite this leaves out.
// The suites are compiled first, as for `npm test`.
//
// The suite files run at once, each in one of a few worker processes
// (mocha's parallel mode), so a file never shares its process's state with
// a file running beside it, though a worker runs several files in turn:
//
//   UNIT_JOBS=<n>    how many workers; unset, one fewer than the logical
//                    cores, at least 2 and at most 4 on CI, at most 8 here
//   UNIT_SERIAL=1    every file in this one process, one after another, as
//                    the nightly run does, so a suite that leans on what
//                    another left behind, or on running in a given order,
//                    still shows
const os = require('node:os');
const path = require('node:path');
const Mocha = require('mocha');
const { listUnitSuites } = require('./importGraph.js');

const ROOT = path.join(__dirname, '..', '..');

/**
 * How many workers run the suites: UNIT_JOBS, or one fewer than the logical
 * cores, at most four on CI, whose runners have four, and eight elsewhere,
 * past which a 16-thread Mac ran no faster.
 *
 * @returns {number} The worker count; 1 runs every file in this process.
 */
function workerCount() {
  if (process.env.UNIT_SERIAL === '1') {
    return 1;
  }
  const set = process.env.UNIT_JOBS;
  if (set !== undefined && set !== '') {
    const count = Number(set);
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`UNIT_JOBS must be a whole number of at least 1, not "${set}"`);
    }
    return count;
  }
  const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Math.max(2, Math.min(cores - 1, process.env.CI ? 4 : 8));
}

const suites = listUnitSuites();
const workers = workerCount();
// The same interface and time limit as the extension-host run, so a suite
// behaves alike under either runner. On CI a `.only` left in a suite fails
// the run rather than quietly skipping every other test (forbidOnly).
const mocha = new Mocha({
  ui: 'tdd',
  timeout: 20000,
  color: true,
  forbidOnly: Boolean(process.env.CI),
  ...(workers > 1 ? { parallel: true, jobs: workers } : {}),
});
suites.forEach((file) => mocha.addFile(path.join(ROOT, file)));
console.log(`${suites.length} suites that never reach vscode, under plain mocha, ${workers > 1 ? `${workers} workers at once` : 'one after another'}`);
mocha.run((failures) => {
  process.exitCode = failures ? 1 : 0;
});
