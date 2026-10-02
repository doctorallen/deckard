// The import rules of docs/architecture/layers.md, checked by `npm run lint`.
//
// Every rule is an error. The graph as it stood when these rules arrived is
// recorded in .dependency-cruiser-known-violations.json, and `--ignore-known`
// lets those imports through, so a rule fails only on an import that is new:
// a new file in a target layer, or a new wrong-way import in an old one. Each
// phase of the refactor that removes a known violation regenerates the file
// with `npm run lint:deps:baseline`, so the list only shrinks.
//
// The rules come in two sets. The first holds the folders that existed when
// the rules arrived to the directions docs/implementation/19-refactor.md §1.2
// calls wrong. The second describes the layers of §2.1, which the refactor
// created, so nothing is known against them: a file placed there follows them
// from its first commit.

/** The extension host's API, which exists only inside VS Code. */
const VSCODE = '^vscode$';
/** Node modules that touch the disk, the network, or other processes. */
const IO_MODULES = '^(node:)?(fs|fs/promises|child_process|net|http|https|worker_threads|sqlite|os)$';
/**
 * The pure domain modules page code may import, by name (decision D1 of
 * docs/implementation/20-webviews.md): what a page computes for itself, the
 * graph's communities, calendar date stepping, the board's status columns,
 * and the Home widget catalog and the tag-key reader both sides read.
 * `domain-is-pure` already keeps them free of `vscode` and I/O.
 */
const PAGE_DOMAIN_MODULES =
  '^src/domain/(graph/communities|markdown/calendar|markdown/tagKeys|tasks/taskColumns|dashboard/widgetCatalog)\\.ts$';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ----- Everywhere -------------------------------------------------------
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'A cycle makes two modules one module that cannot be moved or tested apart.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-unresolvable',
      severity: 'error',
      comment: 'An import that resolves to nothing fails at run time, or in the bundle.',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'shipped-code-uses-no-dev-dependency',
      severity: 'error',
      comment:
        'esbuild inlines whatever src imports into the VSIX, so a devDependency imported ' +
        'outside the tests would ship without being declared as shipped.',
      from: { path: '^src/', pathNot: '^src/test/' },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'search-worker-never-reaches-vscode',
      severity: 'error',
      comment:
        'The search-store worker is its own esbuild entry and runs in a worker thread, ' +
        'where `vscode` does not exist; an import that reaches it fails only at run time.',
      from: { path: '^src/core/storage/searchStoreWorker\\.ts$' },
      to: { path: VSCODE, reachable: true },
    },

    // ----- Today's folders (19-refactor.md §1.2) ----------------------------
    {
      name: 'core-not-to-ui',
      severity: 'error',
      comment: 'core is the model and its rules; the UI depends on it, never the other way.',
      from: { path: '^src/core/' },
      to: { path: '^src/ui/' },
    },
    {
      name: 'core-not-to-vscode',
      severity: 'error',
      comment: 'core must run without the extension host, under test:unit.',
      from: { path: '^src/core/' },
      to: { path: VSCODE },
    },
    {
      name: 'state-not-to-vscode',
      severity: 'error',
      comment: 'ui/state builds view models from the index and is tested without VS Code.',
      from: { path: '^src/ui/state/' },
      to: { path: VSCODE },
    },
    {
      name: 'state-not-to-commands-views-or-webview',
      severity: 'error',
      comment: 'A view model that imports a command or a page host reaches `vscode` through it.',
      from: { path: '^src/ui/state/' },
      to: { path: '^src/ui/(commands|views|webview)/' },
    },
    {
      name: 'commands-not-to-webview',
      severity: 'error',
      comment: 'A command imports the services a page uses, not the page host.',
      from: { path: '^src/ui/commands/' },
      to: { path: '^src/ui/webview/' },
    },
    {
      name: 'query-parser-not-to-evaluator',
      severity: 'error',
      comment: 'Parsing a query must not depend on evaluating one; shared date rules go in a module of their own.',
      from: { path: '^src/domain/query/queryParser\\.ts$' },
      to: { path: '^src/domain/query/queryEvaluator\\.ts$' },
    },
    {
      name: 'query-format-not-to-parser',
      severity: 'error',
      comment: 'Formatting a query must not depend on parsing one.',
      from: { path: '^src/domain/query/queryFormat\\.ts$' },
      to: { path: '^src/domain/query/queryParser\\.ts$' },
    },

    // ----- Target layers (19-refactor.md §2.1) ------------------------------
    {
      name: 'domain-is-pure',
      severity: 'error',
      comment: 'domain holds the model and its rules: no vscode, no I/O, and nothing above it.',
      from: { path: '^src/domain/' },
      to: {
        path: [VSCODE, IO_MODULES, '^src/(services|ports|platform|ui|webview|core)/', '^src/extension\\.ts$'],
      },
    },
    {
      name: 'services-use-ports',
      severity: 'error',
      comment: 'A service reaches VS Code, the disk, and the clock only through a port, so it is unit-testable.',
      from: { path: '^src/services/' },
      to: { path: [VSCODE, IO_MODULES, '^src/(platform|ui|webview)/', '^src/extension\\.ts$'] },
    },
    {
      name: 'ports-are-interfaces',
      severity: 'error',
      comment: 'A port is an interface over domain types and depends on nothing else.',
      from: { path: '^src/ports/' },
      to: { pathNot: '^src/(domain|ports)/' },
    },
    {
      name: 'platform-implements-ports',
      severity: 'error',
      comment: 'platform holds the vscode implementations of the ports and knows nothing of what uses them.',
      from: { path: '^src/platform/' },
      to: { path: ['^src/(services|ui|webview)/', '^src/extension\\.ts$'] },
    },
    {
      name: 'only-the-composition-root-imports-platform',
      severity: 'error',
      comment: 'Everything above the ports receives its implementations; only extension.ts builds them.',
      from: {
        path: '^src/',
        pathNot: [
          '^src/platform/',
          '^src/extension\\.ts$',
          // The composition root's other half: createServices builds the
          // ports and services there, and extension.ts calls it.
          '^src/composition/services\\.ts$',
          '^src/test/',
        ],
      },
      to: { path: '^src/platform/' },
    },
    {
      name: 'protocol-is-shared-types',
      severity: 'error',
      comment: 'ui/protocol is imported by the host and by the pages, so it can hold only types both can see.',
      from: { path: '^src/ui/protocol/' },
      to: { pathNot: '^src/(ui/protocol|domain/model)/' },
    },
    {
      name: 'pages-import-protocol-and-shared',
      severity: 'error',
      comment:
        'Page code runs in the webview sandbox: it imports its own folder, webview/shared, ' +
        'the protocol, the pure domain modules named for it, and Preact, and never host code.',
      from: { path: '^src/webview/' },
      to: { pathNot: ['^src/webview/', '^src/ui/protocol/', PAGE_DOMAIN_MODULES, '^node_modules/'] },
    },
    {
      name: 'pages-ship-only-preact',
      severity: 'error',
      comment:
        'Whatever a page imports from node_modules is bundled into it and ships: Preact is ' +
        'the one package the pages may take in (decision 0011, scripts/check-bundle-inputs.js).',
      from: { path: '^src/webview/' },
      to: { path: '^node_modules/', pathNot: '^node_modules/preact/' },
    },
    {
      name: 'pages-not-to-other-pages',
      severity: 'error',
      comment: 'What two pages share lives in webview/shared.',
      from: { path: '^src/webview/([^/]+)/' },
      to: { path: '^src/webview/', pathNot: ['^src/webview/$1/', '^src/webview/shared/'] },
    },
    {
      name: 'host-not-to-page-code',
      severity: 'error',
      comment: 'Page code is bundled for the browser; the host reaches it only by URI, never by import.',
      from: { path: '^src/', pathNot: ['^src/webview/', '^src/test/'] },
      to: { path: '^src/webview/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // A package is named by its path under node_modules, as the rules for
    // the pages read it, even where node_modules is a link to a shared
    // folder, as in a worktree.
    preserveSymlinks: true,
    // `vscode` has no implementation on disk, only @types/vscode; naming it a
    // built-in keeps it one node the rules can point at.
    builtInModules: { add: ['vscode'] },
    // Type-only imports count: a type imported the wrong way is a wrong-way
    // dependency that a later value import would follow.
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['types', 'typings', 'main'],
    },
    reporterOptions: {
      archi: {
        // One node per folder under src and src/ui or src/core, which is the
        // level the layer rules speak at.
        collapsePattern: '^src/(ui|core|domain)/[^/]+|^src/[^/]+',
      },
      dot: {
        collapsePattern: '^src/(ui|core|domain)/[^/]+|^src/[^/]+',
      },
    },
  },
};
