// Runs the overview end-to-end against the compiled extension sources.
//
// These tests exercise the real panel host, the real webview script, and real
// messages between them. They cannot run inside vscode-test, because the point
// is to substitute a controllable VS Code API and to evaluate the webview
// script directly, so they have their own entry point.
//
//   npm run test:e2e
const Module = require('node:module');
const path = require('node:path');
const { existsSync } = require('node:fs');

const compiled = path.join(__dirname, '..', '..', 'out');
if (!existsSync(compiled)) {
  console.error('Run "npm run compile-tests" first: out/ is missing.');
  process.exit(1);
}

// The extension imports "vscode", which only exists inside the editor.
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function patched(request, ...rest) {
  if (request === 'vscode') {
    return path.join(__dirname, 'vscodeStub.js');
  }
  return resolveFilename.call(this, request, ...rest);
};

require('./overviewQuery.e2e.js');
