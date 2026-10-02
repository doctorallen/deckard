// Runs headless Chrome several at a time for the checks that draw surfaces.
//
// The layout, rendered-contrast, and visual checks each open some 336 pages,
// 21 surfaces in 16 theme and zen passes, a Chrome for each page. One at a
// time, test:layout took 24 minutes and test:visual 19 on a 16-thread Mac,
// with most of its cores idle. Here a small pool of Chromes draws pages at
// once, and what each page prints is held until every page before it has
// printed, so a run's output reads line for line as it did when the pages
// were drawn in turn.
//
//   UI_CONCURRENCY=<n>   how many Chromes draw at once; 1 draws one at a
//                        time, as the checks always did. Unset, half the
//                        machine's logical cores, at least 1 and at most 4.
//
// Why at most 4: a Chrome costs some five seconds of CPU to start, draw one
// page, and quit, so the pool runs out of cores before it runs out of pages.
// On the 16-thread Mac four at once drew 48 pages in 55 s against 86 s one
// at a time, and eight in 51 s, no faster, while time in each Chrome, which
// is virtual, ran further ahead of its page: the page's probe, written about
// 0.25 s into the page one at a time, came as late as 2.3 s of the 3 s
// budget with eight, which is too near the end for a screenshot to be sure
// of a finished page. Four kept it under 0.7 s, and the layout check's page
// waits for the probe rather than reading it at 0.4 s (buildPage).
//
// Each Chrome is given a profile of its own under the temporary folder, so
// two never share one, and is started in a process group of its own, so a
// Chrome that wedges is killed with its helpers and only the Chromes a check
// started are ever killed.
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');

/**
 * How many Chromes draw at once: UI_CONCURRENCY, or half the logical
 * cores, at least one and at most four (see above).
 *
 * @returns {number} The pool's size.
 */
function concurrency() {
  const set = process.env.UI_CONCURRENCY;
  if (set !== undefined && set !== '') {
    const size = Number(set);
    if (!Number.isInteger(size) || size < 1) {
      throw new Error(`UI_CONCURRENCY must be a whole number of at least 1, not "${set}"`);
    }
    return size;
  }
  return Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)));
}

/** The Chromes running now, each with its profile, to be killed and cleared if the check is stopped or exits. */
const running = new Map();

/** Kills a Chrome and every process of its group: its helpers. */
function killChrome(child) {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // Its group is gone already, or groups are not kept (Windows).
    child.kill('SIGKILL');
  }
}

/** Kills every Chrome still running when the check exits or is stopped. */
let cleanupInstalled = false;
function installCleanup() {
  if (cleanupInstalled) {
    return;
  }
  cleanupInstalled = true;
  process.on('exit', () => {
    for (const [child, profile] of running) {
      killChrome(child);
      rmSync(profile, { recursive: true, force: true });
    }
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    // A Chrome in a group of its own does not hear the terminal's ^C, so
    // the check stops them as it exits.
    process.on(signal, () => process.exit(signal === 'SIGINT' ? 130 : 143));
  }
}

/**
 * Runs Chrome once with a profile of its own and resolves with what it
 * wrote and how it ended, as spawnSync reports them. A Chrome still running
 * after `timeout` milliseconds is killed with its helpers and ends with
 * signal `SIGKILL`, as spawnSync's timeout ends it.
 *
 * @param {string} chrome The browser.
 * @param {string[]} args Its arguments, less the profile.
 * @param {{ timeout: number }} options How long it may run.
 * @returns {Promise<{ status: number | null, signal: string | null, stdout: string, stderr: string }>}
 */
function runChromeAsync(chrome, args, options) {
  installCleanup();
  const profile = mkdtempSync(path.join(os.tmpdir(), 'deckard-chrome-'));
  return new Promise((resolve) => {
    const stdout = [];
    const stderr = [];
    // With a profile of its own on disk, headless Chrome writes the page out
    // and then never exits; incognito, it exits as it does with none.
    const child = spawn(chrome, [`--user-data-dir=${profile}`, '--incognito', ...args], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    running.set(child, profile);
    const timer = setTimeout(() => killChrome(child), options.timeout);
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    let settled = false;
    const finish = (status, signal, error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      running.delete(child);
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      resolve({
        status,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8') + (error ? error.message : ''),
      });
    };
    child.on('error', (error) => finish(null, null, error));
    child.on('close', (status, signal) => finish(status, signal));
  });
}

/**
 * Runs `work` on each job, `size` at a time, and prints what each job logs
 * in the jobs' order: the job every earlier one has finished before prints
 * as it goes, and the rest are held until their turn. Jobs are taken from
 * `jobs` as a worker is free, so a generator can build each page only when
 * it is drawn. Once a job throws, no new job is started; those running are
 * finished and printed, and the first error is thrown.
 *
 * @template Job, Result
 * @param {Iterable<Job>} jobs The jobs, in the order they print.
 * @param {(job: Job, log: (line: string) => void) => Promise<Result>} work
 *   Runs one job; `log` takes the lines it prints.
 * @param {number} [size] How many run at once.
 * @returns {Promise<Result[]>} What each job returned, in order.
 */
async function runInOrder(jobs, work, size = concurrency()) {
  const iterator = jobs[Symbol.iterator]();
  const results = [];
  const held = new Map();
  let started = 0;
  let printed = 0;
  let failure;
  // Prints the held lines of the job whose turn it is, and of each after it
  // that has finished, and stops at the first still running.
  const flush = () => {
    while (held.has(printed)) {
      const entry = held.get(printed);
      entry.lines.forEach((line) => console.log(line));
      entry.lines = [];
      if (!entry.done) {
        return;
      }
      held.delete(printed);
      printed += 1;
    }
  };
  const worker = async () => {
    while (!failure) {
      let step;
      try {
        step = iterator.next();
      } catch (error) {
        failure = failure || { error };
        return;
      }
      if (step.done) {
        return;
      }
      const index = started;
      started += 1;
      const entry = { lines: [], done: false };
      held.set(index, entry);
      const log = (line) => {
        if (index === printed) {
          console.log(line);
        } else {
          entry.lines.push(line);
        }
      };
      try {
        results[index] = await work(step.value, log);
      } catch (error) {
        failure = failure || { error };
      } finally {
        entry.done = true;
        flush();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, size) }, worker));
  if (failure) {
    throw failure.error;
  }
  return results;
}

module.exports = { concurrency, runChromeAsync, runInOrder };
