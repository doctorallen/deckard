# Testing

**Status: current and target.** The suites below exist at v1.23.1 unless marked as landing in Phase 0 of [the refactor plan](../implementation/19-refactor.md); each phase rewrites this page to describe what then exists.

Deckard has one suite per kind of failure. Each catches something no other suite can, so a change is verified by the set, not by one suite.

## The suites

| Script | What it runs | What only it can catch |
| --- | --- | --- |
| `npm test` | `vscode-test` runs every `out/test/**/*.test.js` in an Extension Development Host with `--disable-extensions` and a 20-second timeout: 139 files and 1,331 tests | Behavior that needs the real VS Code API: activation, registered commands, settings, editors, and file watchers |
| `npm run test:unit` | Plain mocha over the suites whose modules never reach `vscode`. **Lands in Phase 0.** | Nothing extra. It runs the pure suites in seconds instead of booting Electron, so it is the one to run while working |
| `npm run test:ui` | `verifyWebviews.js`, `checkWebviewScripts.js`, then `checkContrast.js` | A page whose script does not parse, an unknown name or a wrong argument count in page script, a missing design token, a broken nonce, a page redeclaring a shared helper, or a layout rule lost in the cascade |
| `npm run test:contrast` | `checkContrast.js` alone | Text and control contrast below WCAG AA in any theme, including hover, active, and focus states. It resolves tokens from the stylesheet rather than drawing |
| `npm run test:e2e` | `test/e2e/run.js`: eight suites, each in its own process, with `vscode` replaced by `vscodeStub.js` | The real panel host, the real page script, and real messages between them, in one flow |
| `npm run test:layout` | `checkLayout.js` and `checkRenderedContrast.js` in headless Chrome | Geometry: a column that clips its cards, a hover that grows a card past its scroller. Also contrast as drawn, with inherited backgrounds. Skipped with a message when no Chrome is found |
| `npm run test:visual` | `checkVisual.js` screenshots every surface, theme, and zen state, and compares pixels to a baseline | A backdrop, a glow, or a control that moved. Nothing else sees how a page looks |

`npm run check-types` and `npm run lint` are not suites, but they are the per-commit gate. `bench:index` measures indexing speed and asserts nothing.

## Why each exists

Every page script is built from template literals today, so the compiler never sees it. `test:ui` exists to render each page for real and check the document. The e2e suites drive pages through a hand-written DOM with no geometry, so `test:layout` renders in a real browser to measure. The layout check measures and the contrast check reads color pairs, but neither sees a theme's backdrop. Zen mode once shipped with Cooper's dotted grid showing, and it took a screenshot to notice, so `test:visual` compares pixels.

Visual baselines are kept per platform in `test/ui/visual-baseline/<platform>/`, because the operating system rasterizes fonts, and macOS and Linux differ in every glyph's edge. A first run on a platform records its own set. When a change in looks is meant, record it with `npm run test:visual -- --update` and commit the new baselines.

## When to run what

| When | Run |
| --- | --- |
| Every commit | `npm run check-types && npm run lint` |
| While changing pure logic | `npm run test:unit`, from Phase 0 |
| After changing shared webview components or a page | `npm run test:ui` |
| When the change touches a scroll container, a column, or a hover | `npm run test:layout` |
| When the change touches how anything looks | `npm run test:visual` |
| Once before a branch lands | `npm test`, `test:ui`, `test:e2e`, `test:layout`, and `test:visual`, gated on their exit codes |

A refactor phase lands only on a clean full run with no pixel changes. A visual diff during a refactor means behavior changed, which is a bug in the refactor.

## Continuous integration

`ci.yml` runs `npm test` under `xvfb`, then `test:ui`, `test:e2e`, `test:layout`, and `test:visual`, on `ubuntu-latest`. Today two gaps weaken it. Only a `darwin/` baseline set exists, so on Linux `checkVisual.js` records a missing baseline and passes. And `release.yml` runs only `npm test` before publishing.

## What Phase 0 adds

Each addition removes a way the harnesses depend on today's page layout or file paths, before any code moves.

| Addition | What it does | Why |
| --- | --- | --- |
| `test:unit` | Plain mocha over the suites whose modules never reach `vscode`, a set chosen by dependency-cruiser. `pretest` runs it first, and `npm test` keeps the host-only suites | The pure parser, evaluator, and state suites boot Electron today just to test pure functions |
| `test/harness/loadPage.js` | Resolves each `<script src>` and `<link href>` against `dist/webview/` and inlines them | Every harness reads inline assets today, so a page that links its script would pass nothing. With the loader, jsdom, `srcdoc`, and every check see one self-contained page, as now |
| A CSP-carrying `srcdoc` parent | `checkLayout.js`'s parent page carries the page's intended CSP | jsdom does not enforce CSP, so Chrome is the only place a CSP regression can show |
| `test/harness/modules.js` | Names each `out/` module once | The Node harnesses hard-code 30 `out/` paths today, so a file move breaks them |
| `src/test/pages.ts` | Renders each page once, importable by mocha and by `test/ui/pages.js` | One page catalog for every suite |
| A jsdom mount for the e2e suites | Replaces the hand-written DOM in `webviewRuntime.js`, whose `classList` methods do nothing. Each mount owns its window, and `test/e2e/support.js` holds the memento stub and panel mounting | Three DOM implementations become one, and no suite shares globals |
| A Linux visual baseline | Recorded on the CI image and committed | So CI compares instead of recording |
| `checkVisual.js --ci` | Fails when a surface had to be recorded rather than compared | So a missing baseline can never pass |
| A release gate | `release.yml` calls the CI validate job as a reusable workflow | So a release runs every suite, not only `npm test` |

`pretest` also compiles once instead of three times. The nonce rule in `verifyWebviews.js` becomes "every inline style and script carries the page nonce", replacing "one nonce in the text". `openWebviewPage(html, state)` keeps its signature, so the 39 jsdom page tests survive unchanged.

Later phases add host-controller tests: each `PageController` runs against a fake `Webview` that exposes only `postMessage` and `onDidReceiveMessage`.
