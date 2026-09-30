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
const path = require('node:path');
const Mocha = require('mocha');
const { listUnitSuites } = require('./importGraph.js');

const ROOT = path.join(__dirname, '..', '..');
const suites = listUnitSuites();
// The same interface and time limit as the extension-host run, so a suite
// behaves alike under either runner.
const mocha = new Mocha({ ui: 'tdd', timeout: 20000, color: true });
suites.forEach((file) => mocha.addFile(path.join(ROOT, file)));
console.log(`${suites.length} suites that never reach vscode, under plain mocha`);
mocha.run((failures) => {
  process.exitCode = failures ? 1 : 0;
});
