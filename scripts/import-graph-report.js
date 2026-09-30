// Prints the numbers behind docs/architecture/inventories/import-graph.md:
// which folders reach `vscode`, which folders import which, the cycles, the
// search-store worker's closure, which mocha suites can run without VS Code
// and what keeps the rest in the extension host, and how many files read each
// piece of module-level state the refactor replaces.
//
//   node scripts/import-graph-report.js
//
// It reads the graph through test/harness/importGraph.js, with the rules'
// own configuration, so a phase that moves code reruns this and diffs the
// page rather than recounting by hand.
const path = require('node:path');
const { readFileSync } = require('node:fs');
const { VSCODE, readImportGraph, modulesReaching, listUnitSuites } = require('../test/harness/importGraph.js');

const ROOT = path.join(__dirname, '..');
const graph = readImportGraph();
const sources = [...graph.keys()].filter((source) => source.startsWith('src/'));
const shipped = sources.filter((source) => !source.startsWith('src/test/'));
const tests = sources.filter((source) => /^src\/test\/[^/]+\.test\.ts$/.test(source));
const reachesVscode = modulesReaching(graph, VSCODE);
const importsVscode = (source) => graph.get(source).includes(VSCODE);

/**
 * The folder a module belongs to at the level the layer rules speak at:
 * `src/core/<area>` and `src/ui/<area>`, or `src/extension.ts` on its own.
 */
function folderOf(source) {
  const match = /^src\/(core|ui)\/([^/]+)\//.exec(source);
  if (match) {
    return `src/${match[1]}/${match[2]}`;
  }
  return source.startsWith('src/test/') ? 'src/test' : source;
}

/** A Markdown table from a header row and body rows. */
function table(header, rows) {
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

/**
 * The shortest import chain from `from` to `target`, as module paths, or
 * undefined when it does not reach it.
 */
function shortestChain(from, target) {
  const previous = new Map([[from, undefined]]);
  const queue = [from];
  while (queue.length) {
    const current = queue.shift();
    if (current === target) {
      const chain = [];
      for (let at = current; at !== undefined; at = previous.get(at)) {
        chain.unshift(at);
      }
      return chain;
    }
    for (const next of graph.get(current) ?? []) {
      if (previous.has(next)) {
        continue;
      }
      previous.set(next, current);
      queue.push(next);
    }
  }
  return undefined;
}

/** Strongly connected groups of two or more modules: every import cycle. */
function findCycles(modules) {
  const within = new Set(modules);
  const indexOf = new Map();
  const lowLink = new Map();
  const stack = [];
  const onStack = new Set();
  const cycles = [];
  let counter = 0;
  const visit = (module) => {
    indexOf.set(module, counter);
    lowLink.set(module, counter);
    counter += 1;
    stack.push(module);
    onStack.add(module);
    for (const next of graph.get(module) ?? []) {
      if (!within.has(next)) {
        continue;
      }
      if (!indexOf.has(next)) {
        visit(next);
        lowLink.set(module, Math.min(lowLink.get(module), lowLink.get(next)));
      } else if (onStack.has(next)) {
        lowLink.set(module, Math.min(lowLink.get(module), indexOf.get(next)));
      }
    }
    if (lowLink.get(module) !== indexOf.get(module)) {
      return;
    }
    const group = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      group.push(member);
    } while (member !== module);
    if (group.length > 1) {
      cycles.push(group.sort());
    }
  };
  modules.forEach((module) => indexOf.has(module) || visit(module));
  return cycles;
}

const out = [];

// ----- Folders and vscode ---------------------------------------------------
const folders = [...new Set(shipped.map(folderOf))].sort();
out.push('## Folders and `vscode`\n');
out.push(table(
  ['Folder', 'Files', 'Import `vscode`', 'Reach `vscode`'],
  folders.map((folder) => {
    const files = shipped.filter((source) => folderOf(source) === folder);
    return [
      `\`${folder}\``,
      files.length,
      files.filter(importsVscode).length,
      files.filter((source) => reachesVscode.has(source)).length,
    ];
  }).concat([[
    '**All shipped source**',
    shipped.length,
    shipped.filter(importsVscode).length,
    shipped.filter((source) => reachesVscode.has(source)).length,
  ]]),
));

// ----- Folder to folder -----------------------------------------------------
const edges = new Map();
for (const source of shipped) {
  for (const target of graph.get(source)) {
    if (!target.startsWith('src/')) {
      continue;
    }
    const key = `${folderOf(source)} -> ${folderOf(target)}`;
    if (folderOf(source) === folderOf(target)) {
      continue;
    }
    if (!edges.has(key)) {
      edges.set(key, { imports: 0, targets: new Set() });
    }
    edges.get(key).imports += 1;
    edges.get(key).targets.add(target);
  }
}
out.push('\n## Imports between folders\n');
out.push(table(
  ['From', 'To', 'Imports', 'Distinct modules imported'],
  [...edges].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => {
    const [from, to] = key.split(' -> ');
    return [`\`${from}\``, `\`${to}\``, value.imports, value.targets.size];
  }),
));
const mutual = [...edges.keys()]
  .map((key) => key.split(' -> '))
  .filter(([from, to]) => from < to && edges.has(`${to} -> ${from}`))
  .map(([from, to]) => `- \`${from}\` and \`${to}\` import each other.`);
out.push(`\nFolders that import each other:\n\n${mutual.join('\n') || '- none'}`);

// ----- Cycles ---------------------------------------------------------------
const cycles = findCycles(shipped);
out.push('\n## Module cycles\n');
out.push(cycles.length
  ? cycles.map((group) => `- ${group.map((member) => `\`${member}\``).join(', ')}`).join('\n')
  : 'None.');

// ----- The worker -----------------------------------------------------------
const worker = 'src/core/storage/searchStoreWorker.ts';
const closure = new Set([worker]);
const pending = [worker];
while (pending.length) {
  for (const next of graph.get(pending.shift()) ?? []) {
    if (closure.has(next) || !next.startsWith('src/')) {
      continue;
    }
    closure.add(next);
    pending.push(next);
  }
}
out.push('\n## The search-store worker\n');
out.push(`\`${worker}\` is its own esbuild entry. Its closure within \`src\`:\n`);
out.push([...closure].sort().map((member) => `- \`${member}\``).join('\n'));
const external = [...new Set([...closure].flatMap((member) => graph.get(member)).filter((target) => !target.startsWith('src/')))].sort();
out.push(`\nWhat it imports from outside \`src\`: ${external.map((name) => `\`${name}\``).join(', ')}.`);

// ----- Tests ----------------------------------------------------------------
const unit = listUnitSuites(graph);
const blocked = tests.filter((test) => reachesVscode.has(test));
out.push('\n## Which suites need the extension host\n');
out.push(table(['Suites', 'Count'], [
  ['All mocha suites in `src/test`', tests.length],
  ['Import `vscode` themselves', tests.filter(importsVscode).length],
  ['Import no `vscode` themselves, but reach it', blocked.filter((test) => !importsVscode(test)).length],
  ['Never reach `vscode`, so run under `test:unit`', unit.length],
]));
out.push(`\nThe suites under \`test:unit\`: ${unit.map((file) => `\`${path.basename(file, '.test.js')}\``).join(', ')}.`);
const gateways = new Map();
for (const test of blocked.filter((candidate) => !importsVscode(candidate))) {
  const chain = shortestChain(test, VSCODE);
  const gateway = chain[chain.length - 2];
  if (!gateways.has(gateway)) {
    gateways.set(gateway, []);
  }
  gateways.get(gateway).push(path.basename(test, '.test.ts'));
}
out.push('\nFor the suites that reach `vscode` only through what they test, the module on the shortest path that imports `vscode` itself:\n');
out.push(table(
  ['Imports `vscode`', 'Suites that reach it first', 'Examples'],
  [...gateways]
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([gateway, names]) => [`\`${gateway}\``, names.length, names.slice(0, 4).join(', ')]),
));

// ----- Module-level state -----------------------------------------------------
// Each piece of hidden state the refactor replaces (19-refactor.md §1.3):
// where it was declared, how to recognize the declaration, and which
// functions read or write it while it exists.
const globals = [
  ['`queryIdentity`, `queryWeekStart`', ['src/core/query/queryEvaluator.ts', 'src/core/query/queryDates.ts'], /^let query(Identity|WeekStart)\b/m, /\b(set|get)Query(Identity|WeekStart)\b/],
  ['`policy`', ['src/core/taskPolicy.ts'], /^let policy\b/m, /\b(setTaskPolicy|getTaskPolicy)\b/],
  ['`log`', ['src/core/timing.ts'], /^let log\b/m, /\b(setTimingLog|reportError|measure|measureAsync|logTrace)\b/],
  ['`keepTaskRank`', ['src/ui/commands/taskActions.ts'], /^let keepTaskRank\b/m, /\bsetTaskRankKeeper\b/],
  ['`workspaceWrites`', ['src/ui/commands/workspaceWrites.ts'], /^export const workspaceWrites\b/m, /\bworkspaceWrites\.(lastWrite|undo|apply)/],
  ['`ownWrites`', ['src/core/workspace/ownWrites.ts'], /^(export )?const ownWrites\b/m, /\b(noteOwnWrite|takeOwnWrite)\b/],
  ['`previewTheme`', ['src/ui/webview/themes.ts'], /^let previewTheme\b/m, /\bpreviewDeckardTheme\b/],
  ['`focusedIn`', ['src/ui/commands/focusSection.ts'], /^let focusedIn\b/m, /\b(focusSectionCommand|unfoldAllSectionsCommand|trackSectionFocus)\b/],
];
const readSource = (file) => {
  try {
    return readFileSync(path.join(ROOT, file), 'utf8');
  } catch {
    return '';
  }
};
out.push('\n## Module-level state\n');
out.push('Whether each piece of hidden state is still declared at module level, and, while it is, how many other files use a function that reads or writes it:\n');
out.push(table(['State', 'Declared in', 'Still module-level', 'Source files', 'Test files'], globals.map(([name, owners, declaration, pattern]) => {
  const owner = owners.find((file) => declaration.test(readSource(file)));
  if (!owner) {
    return [name, owners.map((file) => `\`${file}\``).join(', '), 'no', '—', '—'];
  }
  const users = sources.filter((source) => source !== owner && pattern.test(readFileSync(path.join(ROOT, source), 'utf8')));
  return [name, `\`${owner}\``, 'yes', users.filter((user) => !user.startsWith('src/test/')).length, users.filter((user) => user.startsWith('src/test/')).length];
})));

// ----- Known violations -------------------------------------------------------
const known = JSON.parse(readFileSync(path.join(ROOT, '.dependency-cruiser-known-violations.json'), 'utf8'));
const byRule = new Map();
known.forEach((violation) => byRule.set(violation.rule.name, [...(byRule.get(violation.rule.name) ?? []), violation]));
out.push('\n## Known violations\n');
out.push(table(['Rule', 'Count', 'Imports'], [...byRule].map(([rule, list]) => [
  `\`${rule}\``,
  list.length,
  list.map((violation) => (violation.cycle
    ? `cycle through ${violation.cycle.map((step) => `\`${path.basename(step.name ?? step)}\``).join(', ')}`
    : `\`${violation.from.replace(/^src\//, '')}\` to \`${violation.to.replace(/^src\//, '')}\``)).join('; '),
])));

console.log(out.join('\n'));
