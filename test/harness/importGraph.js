// The source tree's import graph, as dependency-cruiser reads it with the
// project's own configuration (.dependency-cruiser.cjs).
//
// test:unit and .vscode-test.mjs ask it which suites run without VS Code, and
// scripts/import-graph-report.js prints the baseline in
// docs/architecture/inventories/import-graph.md from it, so the suites that
// qualify and the numbers the page quotes come from one reading of the tree.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const VSCODE = 'vscode';

/**
 * Cruises `src` and returns every module with the modules it imports.
 *
 * @returns {Map<string, string[]>} Each module's repository-relative path,
 *   such as `src/core/types.ts`, mapped to what it resolves its imports to;
 *   `vscode` and Node's own modules appear by name.
 */
function readImportGraph() {
  const bin = path.join(ROOT, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruiser.mjs');
  const json = execFileSync(process.execPath, [bin, 'src', '--config', '.dependency-cruiser.cjs', '--output-type', 'json', '--no-ignore-known'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const graph = new Map();
  for (const module of JSON.parse(json).modules) {
    graph.set(module.source, module.dependencies.map((dependency) => dependency.resolved));
  }
  return graph;
}

/**
 * Every module that imports `target`, directly or through other modules.
 *
 * @param {Map<string, string[]>} graph From {@link readImportGraph}.
 * @param {string} target A module path, or `vscode`.
 * @returns {Set<string>} The modules that reach it; the target is not included.
 */
function modulesReaching(graph, target) {
  const importers = new Map();
  for (const [source, targets] of graph) {
    for (const imported of targets) {
      if (!importers.has(imported)) {
        importers.set(imported, []);
      }
      importers.get(imported).push(source);
    }
  }
  const reached = new Set();
  const queue = [target];
  while (queue.length) {
    for (const importer of importers.get(queue.shift()) ?? []) {
      if (reached.has(importer)) {
        continue;
      }
      reached.add(importer);
      queue.push(importer);
    }
  }
  return reached;
}

/**
 * The mocha suites whose imports never reach `vscode`, which run under plain
 * mocha rather than in the extension host.
 *
 * @param {Map<string, string[]>} [graph] From {@link readImportGraph}; read
 *   now when not given.
 * @returns {string[]} Compiled paths under `out/test`, relative to the
 *   repository, in name order.
 */
function listUnitSuites(graph = readImportGraph()) {
  const needsHost = modulesReaching(graph, VSCODE);
  return [...graph.keys()]
    .filter((source) => /^src\/test\/[^/]+\.test\.ts$/.test(source) && !needsHost.has(source))
    .map((source) => source.replace(/^src\//, 'out/').replace(/\.ts$/, '.js'))
    .sort();
}

/**
 * The mocha suites that need the extension host: every suite
 * {@link listUnitSuites} leaves out.
 *
 * @param {Map<string, string[]>} [graph] From {@link readImportGraph}; read
 *   now when not given.
 * @returns {string[]} Compiled paths under `out/test`, relative to the
 *   repository, in name order.
 */
function listHostSuites(graph = readImportGraph()) {
  const unit = new Set(listUnitSuites(graph));
  return [...graph.keys()]
    .filter((source) => /^src\/test\/[^/]+\.test\.ts$/.test(source))
    .map((source) => source.replace(/^src\//, 'out/').replace(/\.ts$/, '.js'))
    .filter((file) => !unit.has(file))
    .sort();
}

module.exports = { VSCODE, readImportGraph, modulesReaching, listUnitSuites, listHostSuites };
