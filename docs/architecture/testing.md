# Testing

**Status: current.** This page describes the suites as they stand after Phase 1 of [the refactor plan](../implementation/19-refactor.md); each later phase rewrites it to describe what then exists.

Deckard has one suite per kind of failure. Each catches something no other suite can, so a change is verified by the set, not by one suite.

## The suites

| Script | What it runs | What only it can catch |
| --- | --- | --- |
| `npm run test:unit` | Plain mocha over every suite in `src/test` whose imports never reach `vscode`, as the import graph reads them (`test/harness/runUnitSuites.js`) | Nothing extra. It runs the pure suites in a fraction of a second, so it is the one to run while working. `pretest` runs it first |
| `npm test` | `vscode-test` runs every other suite in an Extension Development Host with `--disable-extensions` and a 20-second timeout | Behavior that needs the real VS Code API: activation, registered commands, settings, editors, and file watchers |
| `npm run test:ui` | `verifyWebviews.js`, `checkWebviewScripts.js`, then `checkContrast.js` | A page whose script does not parse, an unknown name or a wrong argument count in page script, a missing design token, an inline style or script without the page's nonce, a page redeclaring a shared helper, or a layout rule lost in the cascade |
| `npm run test:contrast` | `checkContrast.js` alone | Text and control contrast below WCAG AA in any theme, including hover, active, and focus states. It resolves tokens from the stylesheet rather than drawing |
| `npm run test:e2e` | `test/e2e/run.js`: eight mocha suites, each in its own process, with `vscode` replaced by `vscodeStub.js` and each page mounted in a jsdom window of its own | The real panel host, the real page script, and real messages between them, in one flow |
| `npm run test:layout` | `checkLayout.js` and `checkRenderedContrast.js` in headless Chrome, with each page's Content-Security-Policy enforced | Geometry: a column that clips its cards, a hover that grows a card past its scroller. Contrast as drawn, with inherited backgrounds. And a page that needs something its policy blocks, since only Chrome enforces CSP. Skipped with a message when no Chrome is found |
| `npm run test:visual` | `checkVisual.js` screenshots every surface, theme, and zen state, and compares pixels to a baseline | A backdrop, a glow, or a control that moved. Nothing else sees how a page looks |

`npm run check-types` and `npm run lint` are not suites, but they are the per-commit gate. `lint` runs ESLint over the source, the tests, and the scripts, and dependency-cruiser over the imports ([layers.md](layers.md)). `bench:index` measures indexing speed and asserts nothing.

## Which suites run where

A suite runs under `test:unit` when none of the modules it imports reaches `vscode`. `test/harness/importGraph.js` reads that from dependency-cruiser each time, and `.vscode-test.mjs` asks it for the rest, so every test runs exactly once and a suite moves to the fast tier as soon as the refactor cuts its last path to `vscode`. After Phase 1, 30 suites run under plain mocha and 119 in the host; [the import-graph inventory](inventories/import-graph.md) says what keeps the rest there.

## The shared harness

The Node harnesses share three modules in `test/harness/`, so a page or a file can move without each harness changing:

| Module | What it does |
| --- | --- |
| `loadPage.js` | Makes a page self-contained: each `<script src>` and stylesheet `<link>` that names a file of the extension is inlined with the page's nonce. jsdom runs only inline scripts, Chrome opens a page as an iframe's `srcdoc`, and the text checks read one string, so every harness passes its page through here |
| `modules.js` | Names each compiled module the harnesses load once, as a lazy getter, so a file move is one edit |
| `importGraph.js` | Reads the import graph with the project's own dependency-cruiser configuration |

`src/test/pages.ts` is the page catalog: every webview page and how to render it. The mocha suites that walk the pages and `test/ui/pages.js` both take their pages from it. `openWebviewPage(html, state)` in `src/test/webviewPage.ts` runs a page in jsdom for a mocha suite, and `test/e2e/support.js` mounts one for an e2e suite. Both pass messages as JSON, as VS Code does.

Visual baselines are kept per platform in `test/ui/visual-baseline/<platform>/`, because the operating system rasterizes fonts, and macOS and Linux differ in every glyph's edge. Chrome takes each screenshot at a moment it picks, so the harness ends every transition and animation at once and hides the caret: a page is compared where it settles, and an unchanged page draws identically run after run. The one exception is Synthwave's Task Board, by status and by tag, whose columns still come to rest a strip of a card apart now and then; `checkVisual.js` names those two surfaces and lets them differ by 0.1% of the page rather than 0.01% until that is fixed. When a change in looks is meant, record it with `npm run test:visual -- --update` and commit the new baselines.

## When to run what

| When | Run |
| --- | --- |
| Every commit | `npm run check-types && npm run lint` |
| While changing pure logic | `npm run test:unit` |
| After changing shared webview components or a page | `npm run test:ui` |
| When the change touches a scroll container, a column, or a hover | `npm run test:layout` |
| When the change touches how anything looks | `npm run test:visual` |
| Once before a branch lands | `npm test`, `test:ui`, `test:e2e`, `test:layout`, and `test:visual`, gated on their exit codes |

A refactor phase lands only on a clean full run with no pixel changes. A visual diff during a refactor means behavior changed, which is a bug in the refactor.

## Continuous integration

`ci.yml` runs on pushes to `dev`, the release branches, and every `refactor/**` branch, and on pull requests into the release branches. It runs `npm test` under `xvfb`, which runs `test:unit` first, then `test:ui`, `test:e2e`, `test:layout`, and `test:visual -- --ci`. With `--ci`, a surface with no baseline fails the run rather than being recorded, and the screenshots, diffs, and any recorded baseline are uploaded as the run's `visual-<sha>` artifact. Each run also writes the folder-level import graph to its summary.

`release.yml` calls the same job as a reusable workflow before it builds and publishes, so a merge whose CI run was cancelled is not released untested.

Later phases add host-controller tests: each `PageController` runs against a fake `Webview` that exposes only `postMessage` and `onDidReceiveMessage`.
