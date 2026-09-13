// Runs the end-to-end suites against the compiled extension sources.
//
// These tests exercise the real panel host, the real webview script, and real
// messages between them. They cannot run inside vscode-test, because the point
// is to substitute a controllable VS Code API and to evaluate the webview
// script directly, so they have their own entry point.
//
// Each suite runs in its own process, since a suite ends by exiting with its
// own result.
//
//   npm run test:e2e
const Module = require('node:module');
const path = require('node:path');
const { existsSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

const suites = ['overviewQuery.e2e.js', 'dashboardSearch.e2e.js', 'stats.e2e.js'];

const compiled = path.join(__dirname, '..', '..', 'out');
if (!existsSync(compiled)) {
  console.error('Run "npm run compile-tests" first: out/ is missing.');
  process.exit(1);
}

const suite = process.argv[2];
if (!suite) {
  let failed = false;
  for (const name of suites) {
    console.log(`\n${name}`);
    const result = spawnSync(process.execPath, [__filename, name], {
      stdio: 'inherit',
    });
    failed = failed || result.status !== 0;
  }
  process.exit(failed ? 1 : 0);
}

// The extension imports "vscode", which only exists inside the editor.
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function patched(request, ...rest) {
  if (request === 'vscode') {
    return path.join(__dirname, 'vscodeStub.js');
  }
  return resolveFilename.call(this, request, ...rest);
};

require(`./${suite}`);
