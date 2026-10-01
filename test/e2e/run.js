// Runs the end-to-end suites against the compiled extension sources.
//
// These tests exercise the real panel host, the real webview script, and real
// messages between them. They cannot run inside vscode-test, because the point
// is to substitute a controllable VS Code API and to run the page in a DOM of
// its own, so they have their own entry point: mocha, with support.js loaded
// first to put the `vscode` stand-in in place.
//
// Each suite runs in its own process, since a suite changes the stand-in to
// suit itself (what opening a document does, what a message box answers), and
// one suite's changes must not reach the next.
//
//   npm run test:e2e
//   node test/e2e/run.js stats.e2e.js      one suite
const path = require('node:path');
const { existsSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

const suites = [
  'searchPage.e2e.js',
  'dashboardHome.e2e.js',
  'taskBoard.e2e.js',
  'stats.e2e.js',
  'sidebarNotes.e2e.js',
  'editorDecorations.e2e.js',
  'calendar.e2e.js',
  'calendarPage.e2e.js',
  'navigation.e2e.js',
];

const compiled = path.join(__dirname, '..', '..', 'out');
if (!existsSync(compiled)) {
  console.error('Run "npm run compile-tests" first: out/ is missing.');
  process.exit(1);
}

const mocha = require.resolve('mocha/bin/mocha.js');
const chosen = process.argv[2] ? [process.argv[2]] : suites;
let failed = false;
for (const name of chosen) {
  console.log(`\n${name}`);
  const result = spawnSync(process.execPath, [
    mocha,
    '--ui', 'tdd',
    '--require', path.join(__dirname, 'support.js'),
    // A suite leaves the stand-in's watchers and timers behind, as the host
    // would; the run ends when its tests do.
    '--exit',
    '--timeout', '20000',
    path.join(__dirname, name),
  ], { stdio: 'inherit' });
  failed = failed || result.status !== 0;
}
process.exit(failed ? 1 : 0);
