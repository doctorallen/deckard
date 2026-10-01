# 20. Phase 6: the webview pages

Planned against `refactor/05-composition` at `fe96912`, the tip of the refactor after Phase 5. Source: [19-refactor.md](19-refactor.md) §5 row 6, which asks for this sub-plan before the phase starts. The target is §2.4 and §2.7 of that plan, and decisions [0001](../architecture/decisions/0001-load-page-bundles-through-aswebviewuri.md), [0002](../architecture/decisions/0002-preact-in-the-light-dom.md), [0004](../architecture/decisions/0004-hand-written-message-narrowing.md), [0005](../architecture/decisions/0005-inert-json-for-initial-state.md), [0006](../architecture/decisions/0006-retain-context-only-for-live-editing-state.md), [0011](../architecture/decisions/0011-host-bundle-ships-no-third-party-code.md), and [0012](../architecture/decisions/0012-help-renders-through-markdown-api.md).

Like every phase, Phase 6 must not change what users see or do. It is also the one phase that rewrites markup instead of moving it. So most of this plan is about how to show that a rewritten page draws the same page.

## 1. What this plan has to account for

### 1.1 Facts the parent plan does not state, or states differently

| Fact at `fe96912` | Consequence here |
| --- | --- |
| There are ten webviews, not nine. Eight are panels: Dashboard, Search page (`deckard.tagOverview`), Task Board, Calendar page, Stats, Help, Notes Graph, and Related Notes debug. Two are views: Related Notes (`deckard.relatedNotes`) and Calendar (`deckard.calendar`). The debug page has no script. | The debug page gets the shell, the CSS files, and the CSP helper. It gets no bundle. |
| The query editor (`getQueryEditorScript`) is on three pages: Dashboard, Search, and Task Board. | Open question 3 is about three pages, not four. |
| Help's manifest interpreter (`describeHelpCommands`, `isRunnableFromHelp`, `linkCommandNames`) is already host TypeScript in `helpHtml.ts`. Help's page script is about 5 KB of navigation. Its body is static HTML the host builds from the manifest. | Help moves its host code and its small script. Behavior question Q6 asks whether its body is rewritten at all. |
| The visual and layout suites cover five of the ten webviews. There are 11 surfaces: Task Board ×2, Calendar view ×2, Calendar page ×2, Related Notes ×3, Stats, and Search. Each is drawn in 8 themes, with and without zen, for 176 Linux baselines. The Dashboard, Notes Graph, Help, and debug page have no surface. | A pixel change on those four pages passes today. Surfaces for them are recorded from the current code before anything moves (step 1). |
| Three checks find elements by reading markup out of the page script's string literals: `checkContrast.js` (`elementShapes`), the content-row rule in `verifyWebviews.js`, and "no control on any page carries a native title" in `components-primitives.test.ts`. | Compiled TSX contains no `<button class="…">` text. After a page moves, these checks would pass because they find nothing. They are rebuilt on the rendered DOM first (step 1). |
| The §2.7 card comparison was not made in Phase 0. That comparison renders every sample card both with `markdown-it` and with the token tree. Only the two checks recorded in 0012 and 0013 were made. `domain/markdown/inline.ts` does not exist. | The token tree and its comparison are a step-1 item. Open question 5 is answered there. |
| `src/ui/preview/queryBlockHtml.ts` calls `renderMarkdownInline` at runtime for query-block titles in the Markdown preview. | `rendering.ts` has a host-side user besides the pages. That user needs a host-side token-to-HTML writer before `rendering.ts` can go. |
| Menus, the tip, the key sheet, the undo toast, and the drag ghost are appended to `document.body`, outside `#app`. Menus close on every redraw (`render()` calls `closeTagContextMenu()`). | Preact core has no portal: `createPortal` is in `preact/compat`, which 0002 rules out. Each floating layer becomes its own render root on a host element in the body. |
| Every page test builds its page with a stand-in webview written by hand. Most stand-ins have no `asWebviewUri`, and their `extensionUri` is `/deckard` or `/ext`. | A shell that links `dist/webview/…` would resolve to a missing file. Step 1 routes every test through one stand-in that maps to the repository. |
| Only `pretest` runs `node esbuild.js`. `test:ui`, `test:e2e`, `test:layout`, `test:visual`, and `test:contrast` run `compile-tests` alone. | Once a page is a bundle, each of these scripts must build the bundles first. |
| No test restores a page from saved state (persisted-formats inventory, rows 20–24). `openWebviewPage` has no way to seed `getState`. | Read-back pinning tests come before any page's state code is rewritten. |
| `@vscode/vsce` depends on `markdown-it`. | `npm ls markdown-it` keeps listing it after the removal. The removal check has to read the shipped tree (§6). |
| Help's CSP grants `img-src` to the GitHub origin of the guide images. | `getContentSecurityPolicy` takes extra image origins as an option. |

### 1.2 The pages as they stand

Rendered and script sizes are the ones §1.5 measured. Line counts are at `fe96912`. "Page → host" counts the members of each page's message union in `src/ui/protocol`, shared messages included.

| Page | Builder | Host | Rendered / script | Page → host | Host → page | `setState` today |
| --- | --- | --- | --- | --- | --- | --- |
| Help | `helpHtml.ts` 861, `guide.ts` 193 | `help.ts` 159 | 164.1 KB / 5 KB | 3 (`runCommand`, `openGuide`, `openChangelog`) | `reveal`, `guide` | none |
| Stats | `statsHtml.ts` 555 | `stats.ts` 374 | 203.3 / 133.5 KB | 9 | `state`, `indexing` | none |
| Calendar, view and page | `calendarHtml.ts` 655, `calendarDay.ts` 155 | `calendar.ts` 338, `calendarPage.ts` 250, `activeCalendar.ts` 95 | 210.3 / 140.6 KB | 18 | `state`, `moveRefused`, `indexing` | `{ layout }`, on the page only |
| Task Board | `taskBoardHtml.ts` 604 | `taskBoard.ts` 646 | 279.1 / 200.2 KB | 26 | `state`, `moveRefused` | `{ query, scrollY }` |
| Search page | `searchPageHtml.ts` 727 | `searchPage.ts` 1,044, `activeSearch.ts` 102 | 295.4 / 211.2 KB | 27 | `state` | `{ query, origin, tab, scrollY }` |
| Related Notes (view) | `sidebarNotesHtml.ts` 897 | `sidebarNotes.ts` 1,135 | 235.4 / 154.1 KB | 22, plus 3 parsed by hand | `state` | none |
| Dashboard | `dashboardHtml.ts` 1,422 | `dashboard.ts` 830, `activeHome.ts` 67 | 339.8 / 245.8 KB | 34 members (40 types) | `state`, `addWidget`, `quickAddResult`, `runTryNext` | six fields |
| Notes Graph | `notesGraphHtml.ts` 2,841 | `notesGraph.ts` 544 | 190.5 / 107.1 KB | 6 | `state`, `selectNode`, `highlightNode`, `applyFilters` | 23 settings and the camera |
| Related Notes debug | `relatedNotesDebugHtml.ts` 105 | `relatedNotesDebug.ts` 66 | no script | 0 | none | none |

The shared code is `components.ts` (4,978 lines, including the component script at 2,136 lines and the query editor at 1,421), `themes.ts` (519), and `messages.ts` (1,051).

## 2. Gates

### 2.1 The rule

Each rewritten page must produce the same DOM. That means the same elements in the same order, the same classes, ids, `data-*` and ARIA attributes, the same text, and the same floating layers at the body level. The stylesheets, the layout and contrast checks, and about 300 page-driving tests all key on that DOM. The stylesheets themselves change in this phase only in where they live.

Preact is a way to produce that DOM, not a reason to change it. A component may naturally write different markup, such as a fragment where the old page wrapped in a span, or a property where the old page wrote an attribute. In those cases the old markup wins.

A difference is allowed only when all three of these hold:

- the normalized DOM diff of §2.3 shows it,
- the visual suite shows no pixel change for it, and
- the commit message says why.

### 2.2 What runs after every page moves

| # | Check | Command | What only it catches here |
| --- | --- | --- | --- |
| 1 | Types and lint | `npm run check-types && npm run lint` | Page code that does not type-check under `src/webview/tsconfig.json`, and an import that breaks the dependency rules. Runs on every commit. |
| 2 | DOM goldens | `npm run test:dom` (§2.3) | Markup that drifted: a class, attribute, element, or text node, before any pixel is compared |
| 3 | Suite DOM recording | `DECKARD_DOM_RECORD`, base vs branch (§2.3) | A difference in a state that only an interaction reaches, such as an open menu or a builder row |
| 4 | Unit and host suites | `npm run test:unit`, `npm test` | The page-driving jsdom suites and the rewritten source-text tests |
| 5 | End to end | `npm run test:e2e` | The real host and the real page talking through real messages |
| 6 | Page checks | `npm run test:ui` | Nonces, tokens, layout contracts, the cascade order, and contrast |
| 7 | Layout | `npm run test:layout` | Geometry, and CSP as Chrome enforces it |
| 8 | Pixels | `npm run test:visual` locally; `test:visual -- --ci` on CI | Anything visible. Linux on CI is the gate of record (§2.5). |
| 9 | Bundle inputs | `node scripts/check-bundle-inputs.js` (§6) | Third-party code in a bundle that should not have it |
| 10 | By hand | Extension Development Host | Open the page and check that Webview Developer Tools shows no CSP or resource errors. Hide and show it, run Reload Window (serializer restore), switch theme, and toggle zen. |

An agent runs checks 1 and 2 on each commit for its page's surfaces. It runs the full set before handing a page back for merge. The phase lands only on a clean full run on CI with no pixel changes.

### 2.3 The DOM snapshot check

**Capture.** The layout harness already opens every surface in headless Chrome under the page's CSP. Its probe gains one step, taken before the hover run:

1. Clone the iframe's `body`.
2. Copy each form control's `.value`, `.checked`, and `.selected` into `data-dom-*` attributes.
3. Write the clone's `outerHTML` into the dump.

Node then normalizes the dump and compares it with `test/ui/dom-baseline/<surface>[+zen].html`. `npm run test:dom` runs only this pass, for Replicant with and without zen. The theme changes no markup except the gear's theme name, so one theme is enough. `--update` records new goldens.

The goldens are recorded in step 1 from the current pages. They are never re-recorded during Phase 6, except by a commit that names the difference it accepts.

**Normalization:**

- Drop `<script>`, `<style>`, and `<link>`, and drop `#layout-probe`. Replace nonces with `NONCE`.
- Sort attributes by name. Sort class names, and drop an empty `class` or `style`. Give boolean attributes the value `""`.
- Re-serialize each `style` attribute from `element.style`, with declarations sorted.
- Drop the `value`, `checked`, and `selected` attributes in favor of the recorded properties. Preact sets properties where the templates wrote attributes.
- Merge adjacent text nodes and remove comments. Collapse each run of whitespace to one space, but keep whitespace-only text nodes. A diff that differs only in whitespace is reported in its own category, because a space between two inline elements is visible.

**Surfaces.** The DOM check uses the 11 existing surfaces. Step 1 adds these, and the visual and layout suites get them too:

- `dashboardHome`, `dashboardTags`, and `dashboardArranging` (Home being arranged)
- `dashboardQueryBuilder` (the query editor with its builder open)
- `help`, and `helpGuide` (a `guide` message carrying a fixture page)
- `notesGraph` (controls only, with the canvas hidden)
- `relatedNotesDebug`
- `searchTagMenu` (the tag context menu open) and `taskBoardCardMenu` (the card's action menu open)

The last two exist so that a floating layer is compared too. Interaction surfaces need a new `drive` field on a surface: a list of `[event, selector]` pairs that the drive script dispatches after the state.

**Embedded and posted state.** Once a page reads inert JSON, `test:dom` draws each of its surfaces twice: once with the snapshot embedded in the shell, and once with it posted. The two normalized bodies must be equal.

**What the suites drive.** `openWebviewPage` and `test/e2e/support.js` gain a recorder. With `DECKARD_DOM_RECORD=<dir>`, they write the normalized body after each `send`, `click`, and reader action. Each record is keyed by test file, mount index, and step. Running the page's suites once on the phase base and once on the branch, then running `node test/ui/diffDomRecords.js <base> <branch>`, lists every state that differs. These records are not committed. The diff summary goes in the page's pull request.

### 2.4 Harness changes that land before any page moves

- **One stand-in webview** (`src/test/pageWebview.ts`). Its `asWebviewUri` maps `dist/webview/…` to the repository, and its `extensionUri` is the repository root. Every mocha suite renders its page through the catalog, as `renderPage(id, options)` in `src/test/pages.ts`, rather than calling `get*Html` with its own stand-in. `test/e2e/vscodeStub.js`'s `asWebviewUri` maps `dist/webview` the same way. After this, a builder's signature can change in one file.
- **Contrast discovery.** Today's text-derived element shapes are frozen per page in `test/ui/contrast-shapes.json`, generated once from the current code. `checkContrast.js` then checks the union of those frozen shapes and the shapes found in each surface's rendered DOM. The rewrite keeps the same classes, so a frozen shape still describes a real element. Without the frozen list, states that no surface draws would drop out of the contrast matrix unnoticed.
- **`verifyWebviews.js`.** The content-row rule reads the rendered surfaces instead of page text. `SHARED_HELPERS` applies only to scripts that are still inline. The parse and nonce checks skip `type="application/json"` blocks.
- **"No native title".** This test reads the rendered surfaces. A `no-restricted-syntax` ESLint rule on `.tsx` forbids `title` on `button`, `summary`, `input`, `select`, `textarea`, `a`, and any element with `tabIndex`, so unrendered states stay covered.
- **"Starts busy".** This test queries the DOM of the loaded page. It no longer regexes the raw markup.
- **`loadPage.js`.** It marks the scripts it inlines with `data-inlined-from`. `checkWebviewScripts.js` skips scripts with that mark until it is retired.
- **Build before every page suite.** A new `build:webview` script is called by `test:ui`, `test:e2e`, `test:layout`, `test:visual`, `test:contrast`, `test:dom`, and `pretest`.
- **Saved state.** `openWebviewPage(html, state, { savedState })` seeds `getState`. Pinning tests read back each shape in inventory rows 20–24 from the current pages: the search page with each current and legacy shape through `readSerializedSearch`, the board's `{ query }`, the Dashboard's six fields, the graph's 23 keys and its camera, and the calendar's `{ layout: 'week' }`.
- **CI time.** The extra surfaces add about 160 screenshots, and the bundle build adds a little more. `ci.yml`'s `timeout-minutes` goes from 15 to 25.

### 2.5 The visual suite

- **The gate of record is Linux.** CI compares with `--ci` against `test/ui/visual-baseline/linux`, with the current thresholds: 0.01% of the page, and 0.1% for Synthwave's two board surfaces.
- **macOS.** Two Related Notes surfaces draw their chevrons flipped there. `checkVisual.js` gets a darwin-only list naming those two surfaces, so a local run is clean and the exception is written down rather than remembered. The list is never consulted on Linux.
- **New surfaces are recorded from the current code, before anything changes.** Darwin baselines are recorded locally. The Linux set comes from one push whose `--ci` run fails on the new surfaces and uploads them in the `visual-<sha>` artifact. They are committed from that artifact. This is the only time baselines are recorded in Phase 6.
- **The Notes Graph surface hides its canvas.** The simulation settles differently from run to run, so the surface's extra CSS hides the canvas. The canvas is gated by its recorded calls instead (§4.12).
- **The Help guide surface** draws a fixture page. The fixture is captured once in the extension host from `renderGuidePage` (today's `markdown-it` output) and once from `markdown.api.render` after the link rewrite. The surface compares the two, so Q7 is answered by pixels.

### 2.6 Tests that read page source text

These tests assert on text that a bundler rewrites. Each one is rewritten in the step that moves what it reads.

| Test | What it reads | Rewritten in | Rewritten as |
| --- | --- | --- | --- |
| `messages-rendering` "renders tag-clustered graph relationships" | About 25 `includes` over the graph script: clustering constants, function names, `vx.fill(0)`, `reheat(1)`, `message.type === 'selectNode'`, one CSS rule, and control order by `indexOf` | Notes Graph | Unit tests of `domain/graph/communities.ts` for cluster sizing and membership weights; a page test that sends `selectNode` and asserts the selection through the canvas calls and `#status-counts`; control order by DOM query; the rule asserted against the CSS file |
| `messages-rendering` "renders accessible Home and Tags dashboard modes with focused controls" | The CSP string, icon file names, about ten CSS rules, and the `TAB_MARK_ICON` constant | Dashboard (CSS in step 3) | The CSP through the shell test; icons and the tab mark by DOM query on a driven page; rules against the Dashboard's CSS file |
| `messages-rendering` "renders the Dashboard with a centered maximum width and no outer frame" | CSS text | Step 3 | The CSS file. `LAYOUT_CONTRACTS` already pins `main` `max-width`. |
| `messages-rendering` "renders search page tabs and side-by-side layouts" | Search page text | Search | Driving the page |
| `messages-rendering` "renders formatted related-note relevance explanations" | Related Notes page text | Related Notes | Driving the page with a snapshot that carries explanations |
| `messages-rendering` "renders safe Markdown without executable HTML or unsafe links" | `rendering.ts` output | Removals (step 6) | `inline.ts` tests (no HTML token kind; links only `http`, `https`, `mailto`) and an escaping test of the preview's token writer |
| `messages-rendering` theme tests ×4 (a tag drawn alike in every theme; Corpo takes every color; overrides for each theme; high contrast deferred to) | `getDeckardThemeCss` text | Step 3 | The same assertions over `src/webview/shared/themes/*.css` |
| `messages-rendering` parser tests ×3 (Dashboard, Search, sidebar) | `messages.ts` | Step 2, per host | Narrowing-table tests with the same accepted and rejected payloads |
| `components-primitives` "starts busy" | Regex over raw markup | Step 1 | DOM query, plus a case per moved page: a shell with embedded state draws no loading line |
| `components-primitives` "no control on any page carries a native title" | Regex over every page's text, scripts included | Step 1 | DOM query over every surface, plus the TSX lint rule |
| `components-primitives` sheet tests (tail order, card-tag sheet, the `:hover` guard) | CSS text from `get*Css()` | Step 3 | The CSS files and the shell's link order |
| `zen-mode` "marks the body only when it is on, and always ships its sheet", and the sheet tests | `<body class="zen">` and `body.zen {` in raw HTML; `getZenCss`, `getProvenanceCss` | Step 3 | The body class by DOM on the loaded page; sheet tests over `zen.css` and `provenance.css` |
| `page-sheets` "no page sheet redeclares a token the base sheet owns" | `<style>` text | Step 3 | The loaded page's sheets compared with `base.css` |
| `query-builder-webview`: about 12 assertions in about 9 tests | Regexes over `view.html()` that depend on attribute order and quoting, such as `data-action="builder-toggle-not" data-path="0" aria-pressed="true"` | Search | DOM queries and `getAttribute`. Preact writes attributes in prop order and appends attributes added later, so these tests would break on order alone. |
| `verifyWebviews`, `checkContrast`, `checkWebviewScripts` | Script text | Step 1, and cleanup | §2.4; `checkWebviewScripts.js` is retired in step 7 |

Some tests assert on HTML the host builds, not on page script, and stay as they are:

- `help-page.test.ts`, and the three Help tests in `messages-rendering`, provided Q6 keeps Help's body host-built.
- The debug page test.
- `note-embeds`, `query-block`, and `extension.test.ts:549`, which cover the Markdown preview.

`guide.test.ts` is rewritten in the Help step to cover the `markdown.api.render` path. It moves to the extension host.

## 3. Shapes every step shares

Agents working in parallel need the same answers to these questions. This section fixes them.

**Host** (`src/ui/webview/host/`):

- `WebviewHost` owns one webview's session: html, message routing, ready gating, the stale refresh, `followIndexing`, the chrome subscription, and dispose. It has a panel adapter and a view adapter.
- `PageController<TSnapshot, TPageToHost>` supplies `buildSnapshot()` (undefined until the index is published), a handler map, and options: retain, find widget, CSP extras, and restore.
- `sharedHandlers` handles `chooseTheme`, `setZenMode`, `openHelp`, `openSource`, `openTag`, `toggleTask`, `renameTag`, `parkTag`/`unparkTag`, `pinNote`/`unpinNote`, `mergeTags`, `exportResults`, and `saveSearch`, as adapters over services.
- `narrowing.ts` holds the shared narrowers. Each page keeps its own table in `pages/<page>/messages.ts`, so parallel agents never edit one shared table.
- `ActiveSource<T>`, `pageShell.ts`, and `panelPriority` live here too.
- `NavigationService.resolveSourceLocation(index, filePath, line, policy)` lives in `src/services/`. It has one named policy for each of today's four rules, and two for `openTag`'s two validations, so no page's acceptance changes.
- Each host keeps its public class name and constructor options (`StatsPanel`, `TaskBoardPanel`, …). Then `composition/services.ts`, `test/harness/modules.js`, and the e2e suites change little.

**Shell** (`buildPageShell`):

- `getContentSecurityPolicy(cspSource, nonce, { images?: string[] | true, fonts? })`.
- Stylesheet links in cascade order: `dist/webview/<page>.css`, then `dist/webview/themes/<theme>.css`, then `dist/webview/tail.css`.
- `<body>` with the zen class.
- `<main id="app" …>`, with the loading line when there is no state.
- `#live-status`.
- `<script type="application/json" id="state">` with `<` escaped, when there is state.
- `<script nonce src="…/dist/webview/<page>.js">`, last in the body.
- `localResourceRoots` is `[dist/webview, resources]`.
- Theme and zen changes reset `webview.html`, as they do today (Q9).

**Page bootstrap** (`src/webview/shared/page.ts`):

- **One store and a synchronous render.** Each page keeps one store holding the snapshot and its UI state. A host `state` message, or an action, updates the store and calls Preact's top-level `render(<Page …/>, app)`, which runs synchronously. Every test that clicks and then reads the DOM in the same tick keeps working. A `useState` update would be deferred to a microtask, so components do not use `useState` for anything a test or the first frame observes. Hooks are limited to refs and `useLayoutEffect`, which runs synchronously at commit. `useEffect` is deferred until after paint, so it is not used for anything observable.
- **Delegated actions.** One delegated listener on `#app` reads `[data-action]` and calls `dispatchAction(action, element, event)` from a `Record<string, handler>`. The `data-action` attributes the CSS and the tests rely on therefore stay in the DOM.
- **Floating layers.** The tip, menus, key sheet, undo toast, and drag ghost each render as their own root, on a host element appended to `document.body` where today's code appends it. A host `state` message closes open menus, as `render()` does today (Q5).
- **Focus.** After each render, `restorePlace` runs only when focus fell to `body`, and keeps today's fallback to the item at the same index (Q4).
- **First render.** The loading line is cleared before the first render, so Preact never adopts its attributes.
- **Shared code.** The `aria-busy` observer, the indexing line, and `announce` move over unchanged in behavior.

**CSS:**

- `src/webview/shared/base.css` (today's `getBaseCss`) is imported first by each `src/webview/<page>/page.css`. The page's own rules follow, with shared component sheets such as the query editor and calendar day at the position they hold today.
- Each theme becomes its own file, `src/webview/shared/themes/<theme>.css`.
- `src/webview/shared/tail.css` holds control edges, provenance, high contrast, card tags, and zen, in that order.
- `ENABLED` and the generated `cardTagSelectors` lists are written out as literal text.
- esbuild drops repeated `@import`s, keeping the last, so no file is imported twice.

**Page code:**

- Each page is `src/webview/<page>/main.tsx` plus its `page.css`.
- Calendar has two entries, `calendar` (the view) and `calendarPage`, over `src/webview/shared/calendar/`.
- Help's entry is `help/main.ts`.
- The esbuild entries are globbed, so adding a page edits no build file.

## 4. Order of work

The steps map onto §5 row 6 as follows:

| Here | §5 row 6 |
| --- | --- |
| 1 | The gates every later step depends on |
| 2 | (a) and (b) |
| 3 | (c) |
| 4–5 | (d) and (e), in the plan's size order, split into two lanes after Stats |
| 6 | (f) |
| 7 | Cleanup |

Commits within a step land in the order listed.

### Step 1. Gates, before anything moves

| Commit | Contents |
| --- | --- |
| 1.1 | `src/test/pageWebview.ts`; every suite renders through the catalog; `vscodeStub.asWebviewUri` maps `dist/webview` |
| 1.2 | DOM capture in the layout probe, `test:dom`, normalization, and goldens for the 11 existing surfaces |
| 1.3 | The `drive` field and the new surfaces of §2.3; darwin baselines and DOM goldens |
| 1.4 | Linux baselines for the new surfaces, from the CI artifact |
| 1.5 | Contrast shapes frozen and the union with the DOM; `verifyWebviews`, the native-title test, and the busy test on the DOM; the TSX lint rule, which has nothing to lint yet |
| 1.6 | The `openWebviewPage` `savedState` option and the read-back pinning tests of §2.4 |
| 1.7 | The DOM recorder and `diffDomRecords.js`; a stepped clock option for `openWebviewPage`, so `performance.now()` advances a fixed amount per call |
| 1.8 | `ci.yml` timeout; the darwin-only chevron list in `checkVisual.js` |
| 1.9 | `domain/markdown/inline.ts` (`InlineToken`) and a block-excerpt builder from the parser's structure, with unit tests |
| 1.10 | The card comparison: `scripts/compare-card-markdown.js` renders every card and task title in `resources/sample`, `development/`, and the test fixtures with `rendering.ts` and with the tokens, then compares visible text and element sequence. Constructs are added to the tree until the remaining differences are only the ones Q8 lists for decision. This answers open question 5. |

Commits 1.9 and 1.10 touch only `domain/markdown/` and `scripts/`, so they run in parallel with 1.1–1.8.

### Step 2. Host base class and protocol, (a) and (b)

| Commit | Contents |
| --- | --- |
| 2.1 | First, pinning host tests for today's four `openSource` rules and two `openTag` validations, against the current hosts. Then `host/`, `NavigationService`, `ActiveSource<T>`, `sharedHandlers`, the shared narrowers, and `src/test/fakeWebview.ts` (only `postMessage` and `onDidReceiveMessage`). Stats becomes the first controller, with its `HostToPage` and `PageToHost` maps in `protocol/stats.ts` and its narrowing table. `parseStatsMessage` is deleted. |
| 2.2–2.9 | One host per commit, each with its protocol maps, narrowing table, and host-controller tests: Help, Calendar (view and page; `ActiveCalendar` → `ActiveSource`), Task Board (`moveTask`/`moveRefused` gain a request id on both sides of the old page, which is still a template), Search (`ActiveSearch` → `ActiveSource`, keeping its refine-visibility event), Related Notes (its three hand parses join the table; the five handlers that re-rank with `createSnapshot()` to validate a click use a `NavigationService` policy instead), Dashboard (`ActiveHome` → `ActiveSource`), Notes Graph, and the debug page. Each deletes its parser from `messages.ts` and moves its parser tests. Each view's `retainContextWhenHidden` moves from `registerViews` into its controller options, still `true`. |
| 2.10 | `messages.ts` deleted. `panelPriority` and the stale refresh live only in `host/`. |

The hosts still serve today's template pages, so this step changes no DOM. `test:dom` must stay identical throughout.

### Step 3. Build, loader, CSS, and CSP, (c)

| Commit | Contents |
| --- | --- |
| 3.1 | `esbuild.js` gains a second context: browser, `iife`, entries globbed from `src/webview/*/main.ts{,x}` and `page.css`, plus the theme and tail files, written to `dist/webview/`. JSX is `automatic` with `jsxImportSource: 'preact'`. The target is the Chromium of VS Code 1.134. Output is minified with `--production`. The metafile goes to `out/webview-meta.json`, which does not ship. `src/webview/tsconfig.json` sets `lib: DOM`, the JSX options, strict, and `noEmit`, and the root `tsconfig.json` excludes `src/webview`. `check-types` runs both configs. `eslint` covers `.tsx` (projectService finds the nested `tsconfig.json`). `build:webview` is called from the test scripts and `watch`. Preact is installed (§6), though nothing imports it yet. The dependency-cruiser allowance of D1 is added. |
| 3.2 | CSS to files, for all ten webviews at once. A one-off script runs today's `get*Css` functions and writes the `.css` files, which are then hand-maintained. Every builder becomes a `buildPageShell` call that links the CSS. The style nonce goes. `getContentSecurityPolicy` is used on every page, with GitHub images for Help and `resources/` images for the Dashboard. `getDeckardThemeCss` becomes a `Record<DeckardTheme, string>` of file names, and `getPageTailCss` takes `{ theme, zen }`. The gate is `scripts/check-css-parity.js`: for every page, theme, and zen state, the concatenated sheets of the loaded page must equal today's `<style>` text, ignoring whitespace and comments. That script is deleted at the end of the step. |
| 3.3 | The CSS-text tests of §2.6 rewritten over the files |

The pages still run inline scripts after this step. Only `<head>` changes, so `test:dom` stays identical and the visual suite must show nothing.

### Step 4. Help, then Stats (sequential)

#### 4.1 Help

- **Messages.** 3 in; `reveal` and `guide` out.
- **Domain out first.** The manifest functions move to `ui/webview/pages/help/helpManifest.ts`. The guide link and image rewriting moves from `markdown-it` tokens to `pages/help/guideLinks.ts`, which works over the HTML `markdown.api.render` returns.
- **Shared components.** None. If Q6 is accepted, Help has no Preact.
- **Tests.** `help-page` (6), `guide` (6), and the Help tests in `messages-rendering` (3). Help has no e2e suite. New: an extension-host test that renders all 17 guide pages through `markdown.api.render` and checks text and heading ids, as 0012 asks. Its `--version 1.134.0` run is done once by hand and noted in the pull request.
- **Risks.** `markdown.api.render` is an internal command. The built-in Markdown extension can be disabled. The first call takes about 500 ms. The output carries `data-line`, `hljs` spans, and the Mermaid span (Q7).
- **Commits.**
  1. Host modules and their tests.
  2. The host on `markdown.api.render`: a warm-up call when the panel opens, and a failure message that links to the guide on the site. `guide.ts` stops importing `markdown-it` and `sanitize-html`.
  3. `src/webview/help/main.ts`, a typed page script with the rail observer and the guide view. The guide view sets the trusted HTML through one documented assignment. `retainContextWhenHidden` is dropped, and `setState` keeps `{ guide: { page, anchor }, scrollY }`.

#### 4.2 Stats

Stats is the first Preact page and the measurement.

- **Messages.** 9 in; `state` and `indexing` out.
- **Domain out first.** Nothing of substance. The snapshot is already host-projected.
- **Shared core.** The core is everything both lanes of step 5 use. It is written here even where Stats does not draw it:
  - `page.ts`: the store, sync render, `dispatchAction`, the busy observer, the loading and indexing lines, `announce`, and place restore
  - scroll memory, the tip, the key sheet, the undo toast
  - view options, gear, theme and zen rows, and the help and icon buttons
  - the tag label, the metric with its sparkline and change, and `<Inline>`
- **Tests.** `stats` (22), `parked-views` (the Stats case), and `stats.e2e` (9). Surface: `stats`.
- **Risks.** Every later page inherits the core's choices. Stats' three toggles are UI state that is lost on hide once retain goes, so they move into `setState`.
- **Commits.**
  1. The core, with tests through Stats. `@testing-library/preact` is added here if a core component needs a test on its own (§6).
  2. The Stats page, its shell with inert state, and its template script deleted. The busy test gains the embedded-state case.
  3. Retain dropped. `setState` gets `{ showAllOrphans, showUsedOnce, pairsAsTable, scrollY }`. The host's reveal behavior (Q2) gets host-controller tests.
  4. **Open question 3, measured** (below).

**The measurement.** Two variants of Stats are built:

- **A**, one bundle per page.
- **B**, a shared `shared.js` that holds Preact and `webview/shared` as an `iife` global, with Stats mapped to it by an esbuild plugin.

Both variants hold Preact once. A per-page bundle can never load two copies, because hooks and context break across copies.

For each variant, record:

- each bundle's raw, minified, and gzip bytes, with Preact's, the core's, and the page's shares from the metafile
- the VSIX size
- the median of 20 `openWebviewPage` loads to first render in jsdom
- the median of 10 Chrome first renders, from a `LAYOUT_TIMING=1` mode of the layout harness that drops `--virtual-time-budget` (virtual time does not advance while a script runs, so it cannot time one)

The rule, set before the numbers are in: choose B only if it saves more than 100 KB in the VSIX, or more than 10 ms of Chrome first render on a page. Otherwise choose A, which is one request per page and needs nothing new in the loader.

The numbers go in `docs/architecture/webviews.md`. The decision is interim until Search, where the query editor is first shared by two moved pages. It is measured again there, and then recorded as an ADR.

### Step 5. Two lanes

#### 4.3 Calendar (lane B)

- **Messages.** 18 in; `state`, `moveRefused` (with request id), and `indexing` out.
- **Domain out first.** `shiftDate`, the focus-day choice, `isWeekend`, and month and week stepping go into `domain/markdown/calendar.ts`, imported by the page (D1).
- **Shared components.** `shared/calendar/` (the grid, and the day panel that `calendarDay.ts` holds today). Related Notes uses the day panel too.
- **Tests.** `calendar` (11), `calendar-day` (19), `calendar.e2e` (8), and `calendarPage.e2e` (6). Surfaces: `calendar`, `calendarNoWeekends`, `calendarPage`, `calendarPageNarrow`, and `sidebarNotesCalendarDay`.
- **Risks.**
  - Two entries share one grid: a 240 px sidebar view and a page.
  - The page drags tasks between days.
  - The sidebar never writes state, while the page writes `{ layout }`. Both must keep reading old state.
  - `calendarDay.ts` has hand-doubled backslashes, which disappear when it becomes a module.
- **Commits.**
  1. Date math in the domain.
  2. The shared calendar and day panel, with the view.
  3. The page.
  4. Retain dropped on both. The page's `setState` gains `scrollY` and keeps `layout`.

#### 4.4 Task Board (lane A)

- **Messages.** 26 in; `state` and `moveRefused` out.
- **Domain out first.** Status-column validation, today in `addStatus` and `setStatuses` on the page and in `BOARD_NAME` in the host parser, becomes one pure validator in `domain/tasks/taskColumns.ts`. The page imports it for instant feedback (D1), and the host's narrowing calls it.
- **Shared components.**
  - the query editor (1,421 lines of script; the largest single port)
  - the task list row, task date, and priority badge
  - the board, its card, and its group switch
  - drag and keyboard moves, with the ghost as a body-level root
  - the action menu, the rank menu, and ranked rows (also on the Dashboard)
  - facets (`facetValuesShown` is shared with Related Notes)
- **Tests.** `task-board-page` (9), `tag-board` (7), `task-steps-views` (5), `task-title-parity` (5, shared with Search and the Dashboard), the board parts of `components-primitives`, and `taskBoard.e2e` (20). Surfaces: `taskBoard`, `taskBoardByTag`, and `taskBoardCardMenu`.
- **Risks.**
  - The drag state, held across redraws, with pointer capture and linger.
  - The board draws only the cards on screen and the first 100 of a long column. That windowing depends on geometry, which is why the DOM goldens come from Chrome.
  - Synthwave's two surfaces that come to rest unevenly.
  - The query editor's caret and selection handling, which needs refs rather than props.
  - The page keeps retain (Q1).
- **Commits.**
  1. Validator.
  2. Task row, `<Inline>` titles, and the `titleTokens` field added beside `renderedTitle` in `DashboardTask`.
  3. Query editor component, still unused, with its tests.
  4. The board page.
  5. `setState` keeps `{ query, scrollY }`.

#### 4.5 Search page (lane A)

- **Messages.** 27 in; `state` out.
- **Domain out first.** None beyond step 2.
- **Shared components.**
  - the card with its block excerpt
  - the tag button and the tag context menu, with the park item (also used by Related Notes)
  - result tabs, page steps, the heading path, source location, and word marking
- **Tests.** `search-page-behavior` (37), `search-history` (5), `query-builder-webview` (27, with its attribute-order regexes rewritten), `parked-search` (6), `source-location` (1), and `searchPage.e2e` (36). Surfaces: `searchPage` and `searchTagMenu`.
- **Risks.**
  - This is the first page to draw block excerpts from tokens, so `TagOverviewCard` gains `bodyTokens` and `snippet.bodyTokens` beside `renderedHtml`.
  - The host's legacy `setState` migration was pinned in 1.6 and must keep passing.
  - Open question 3 is decided here.
- **Commits.**
  1. Card and block excerpt.
  2. Tag menu.
  3. The page.
  4. The measurement and ADR.
  5. Retain per Q1.

#### 4.6 Related Notes (lane A, after Calendar merges)

- **Messages.** 25 in (22 plus the 3 formerly parsed by hand); `state` out.
- **Domain out first.** Done in step 2.
- **Shared components.** Refine and the weight rail. It reuses the day panel (lane B), facets, and the tag menu.
- **Tests.** `related-notes-behavior` (19), `sidebarNotes.e2e` (10), and the relevance test in `messages-rendering`. Surfaces: `sidebarNotes`, `sidebarNotesUntagged`, and `sidebarNotesCalendarDay`.
- **Risks.**
  - It is a webview view: no serializer, a `ready` handshake, and `onDidChangeVisibility`.
  - Its `calendarDay` state mode.
  - It relays hover and activate to the Notes Graph, and refines the active search.
  - The macOS chevron surfaces.
  - The cost of its snapshot on first paint (Q3).
- **Commits.**
  1. Refine and the weight rail.
  2. The view.
  3. Retain dropped, with `setState` `{ scrollY, … }` for whatever UI state it holds.

#### 4.7 Dashboard (lane A)

- **Messages.** 40 types in; `state`, `addWidget`, `quickAddResult`, and `runTryNext` out.
- **Domain out first.** The `WIDGET_KINDS` catalog becomes one typed module that both sides import. Widget id minting stays on the page, typed, because the new widget is drawn at once with its `.is-new` outline; the host's narrowing already bounds what it accepts. Tag-key parsing (`getTagNamespace`, `formatEntityKindLabel`) uses the domain's own tag-key reader, so the page and the host agree.
- **Shared components.** Home widgets and the menu item. It reuses ranked rows, the query editor, the task row, and the metric.
- **Tests.** `dashboard-behavior` (25), `zen-mode` (11), `page-sheets` (1), the Dashboard tests in `messages-rendering`, and `dashboardHome.e2e` (19). Surfaces: the four Dashboard surfaces from step 1.
- **Risks.**
  - It is the largest page, with three modes, arranging, quick add round trips, Try next, and What's new.
  - It keeps retain.
  - Its six `setState` fields include `browseQuery`, which is written but never read, and must keep being written.
  - It had no pixel guard before step 1.
- **Commits.**
  1. Catalog.
  2. Widgets.
  3. Modes.
  4. The page.
  5. `setState` read-back against the 1.6 pins.

#### 4.8 Notes Graph (lane B, after Calendar)

- **Messages.** 6 in; `state`, `selectNode`, `highlightNode`, and `applyFilters` out.
- **Domain out first.**
  - `buildCommunities`, `selectSalientEdges`, `tagMembershipScore`, and `graphEdgeSalience` move to `src/domain/graph/communities.ts`, with unit tests that replace the source-text test.
  - The physics (`tick`, `applyRepulsion`, `tickCommunityAnchors`) moves to `src/webview/notesGraph/simulation.ts`, and drawing to `canvas.ts`. Both are typed ports, line for line, with no change to arithmetic order.
- **Shared components.** It uses only the tip and the undo toast. Preact draws the controls, the tag and group lists, the legend, and the status line. The canvas is one element with a ref, driven by `requestAnimationFrame` outside Preact.
- **Tests.** `notes-graph-behavior` (21), `notes-graph-state`, `parked-views` (the graph case), and the graph test in `messages-rendering`. Surface: `notesGraph`, with the canvas hidden.
- **Risks.**
  - **Canvas parity.** With the stepped clock of 1.7, the full canvas call log for the behavior suite's fixtures is recorded on the base and compared on the branch. It must be equal, compared to 1e-6.
  - The 23-key `setState` is read with no type check today. The port keeps accepting any old value.
  - The relay from Related Notes.
  - Retain is decided in Q1.
- **Commits.**
  1. Communities module.
  2. Simulation and canvas modules, still driven by the old page through no change. The old script keeps its own copy until commit 3, so this commit only adds and tests the modules.
  3. The page.
  4. `setState` read-back against the 1.6 pins.

#### 4.9 Related Notes debug (either lane)

It is already on the shell, after 3.2. One commit removes its local `escapeHtml` in favor of `src/shared/html.ts`.

### Step 6. Dependency removals, (f)

This step comes after the Dashboard. The Dashboard is the last page that reads `renderedHtml` or `renderedTitle`; the Notes Graph reads neither.

| Commit | Contents |
| --- | --- |
| 6.1 | `queryBlockHtml.ts` writes titles from `InlineToken[]` with the shared `escapeHtml`, keeping its link flattening. The `query-block` suite (18 tests) is the gate. |
| 6.2 | `renderedHtml`, `renderedTitle`, and `snippet.renderedHtml` leave `ui/protocol/shared.ts` and the state builders. `rendering.ts` is deleted. `markdown-it` and `sanitize-html` leave `dependencies`, and `@types/sanitize-html` leaves `devDependencies`. `@types/markdown-it` stays, for the preview plugins' type imports. The §6 checks are recorded in the commit message. |

### Step 7. Cleanup

- After the Notes Graph lands: `getComponentScript`, `getQueryEditorScript`, `getTipScript`, `getUndoScript`, `calendarDay.ts`, `renderKeepingPlace`, and the page-script part of `components.ts` are deleted, and `checkWebviewScripts.js` is retired from `test:ui`. Phase 7 shrinks the `eslint.known-violations.mjs` entries the old builders held.
- Docs:
  - `docs/components.md` is rewritten for components and modules.
  - `docs/architecture/webviews.md` is marked current, with the bundle numbers.
  - `testing.md` covers `test:dom`, the recorder, and the retired suite.
  - `layers.md` records D1.
  - CONTRIBUTING's "Webview components" section is rewritten.
  - The persisted-formats inventory gets the new `setState` shapes. The source-paths inventory is refreshed.
  - 0006 is superseded if Q1 changes its list.
  - The closed findings in `19-refactor-findings.md` are struck.
- The DOM goldens and the darwin chevron list stay. The CSS parity and card comparison scripts were deleted when their steps ended.

## 5. Parallelism

Each agent owns a set of files in its own worktree and branch (`refactor/06-<step>`, which CI runs). Branches are merged by hand into the phase branch.

| Must be sequential | Why |
| --- | --- |
| 1.1 before everything | Every test's way of building a page changes. |
| 1.2–1.8, one agent | They share `checkLayout.js`, `checkVisual.js`, and the surfaces. |
| 2.1 before 2.2–2.9 | The base class and the shared narrowers |
| Step 3, one agent | `esbuild.js`, the tsconfigs, the lint and dependency configs, and the CSS of every page |
| 4.2 (Stats and the core) before both lanes | `src/webview/shared/page.ts` and the core components |
| Calendar before Related Notes | The day panel |
| Task Board before Search before Related Notes before Dashboard | The query editor, rows, facets, menus, and ranked rows, each written once |
| Step 6 after the Dashboard | The last reader of `rendered*` |

| Can run in parallel | Files owned |
| --- | --- |
| 1.9–1.10 beside 1.1–1.8 | `domain/markdown/inline.ts`, `scripts/compare-card-markdown.js` |
| 2.2–2.9, up to eight agents | Each page's host, `pages/<page>/`, and `protocol/<page>.ts`. The hot spots (`composition/services.ts`, `test/harness/modules.js`, `messages.ts` deletions, `messages-rendering.test.ts`) are edits to distinct regions, merged by hand. |
| 4.1 (Help) beside 4.2 (Stats) | `ui/webview/pages/help/`, `src/webview/help/` |
| Lane A (Task Board → Search → Related Notes → Dashboard) beside lane B (Calendar → Notes Graph → debug) | Lane A owns the `src/webview/shared/` files it creates, and so does lane B. Neither edits the other's. A lane that needs a change to the core asks for it as a separate commit on the phase branch. |

**Protocol additions.** All token fields (`titleTokens`, `bodyTokens`, `snippet.bodyTokens`) are added to `protocol/shared.ts` in one commit at the start of lane A, so lane B never touches that file. The build config is globbed and the narrowing tables are per page, so neither causes a merge conflict.

## 6. The dependency change

**Preact.** The latest 10.29 patch is **10.29.8**, published 2026-08-01. This was read from the npm registry on 2026-09-30. On that date the `latest` tag moved to 11.0.0, so `npm install preact` would install 11. The install is `npm install --save-exact preact@10.29.8`, into `dependencies` (not dev), so the `shipped-code-uses-no-dev-dependency` rule passes. 10.29.8 has no dependencies.

The checks:

- `npm ls preact` shows one copy.
- No source file imports `preact/compat`. The dependency rule allows only `^node_modules/preact/` from `src/webview`, and a lint `no-restricted-imports` names `preact/compat` and `react`.

**`@testing-library/preact`**: 3.2.4, `devDependencies`. Its peer range is `preact >=10`, and it brings `@testing-library/dom` 8 into the dev tree only.

- Its `render` uses the global `document`. A suite that uses it installs a jsdom window as globals in `suiteSetup` and removes it in `suiteTeardown`, so no suite shares globals (§2.6 of the parent plan).
- Component tests that use it compile `src/webview` to `out/webview` with a test tsconfig.
- It is added in the commit that writes the first such test, likely the core in 4.2, and is not used for page tests: `openWebviewPage` stays the page harness.
- `npm audit` is run on the new dev tree.

**Removals in step 6:**

| Check | Expected |
| --- | --- |
| `out/extension-meta.json` (the host context's metafile) | The `node_modules` inputs of `dist/extension.js` are `picomatch` alone. `scripts/check-bundle-inputs.js` asserts this, and asserts that `dist/webview/*.js` has `preact` alone, in CI from step 3 on. It is the standing guard for 0011. |
| `npm ls --omit=dev --all` | `preact@10.29.8` and `picomatch` only. `npm ls markdown-it` still shows `@vscode/vsce` → `markdown-it`, which is a dev dependency and does not ship. |
| `npx vsce ls --no-dependencies` | No `node_modules`. `dist/webview/*.js`, `*.css`, and `themes/*.css` are present. No `.map` files and no `tsconfig.json` (`.vscodeignore` already excludes both). `docs/guide/**` is present. |
| `dist/extension.js` size | Recorded before and after; it is 2.8 MB today |
| `grep -c` for `sanitizeHtml`, `MarkdownIt`, and `linkify` in `dist/extension.js` | 0 |

## 7. Questions to settle before starting

### Behavior

Each of these is a place where the target would change something a reader can see. Each has a recommendation. David decided Q1, Q3, Q6, and Q7 on 2026-10-01, taking the recommendation in each case; Q2, Q4, Q5, Q8, and Q9 keep today's behavior and are settled as recommended.

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | **Which pages keep `retainContextWhenHidden`.** 0006 keeps it for the Dashboard's query editor and the Task Board's drag. The Search page carries the same query editor, so a half-built query would be lost on hide. Without it, the Notes Graph restarts its simulation on every reveal: nodes jump and re-settle, and a large graph spends CPU each time. | Keep it on the Dashboard, Search, Task Board, and Notes Graph. Drop it on Stats, Help, the Calendar page, both sidebar views, and the debug page. A new ADR supersedes 0006 with that list and the reason for each. **Decided: kept on the Dashboard, Search, Task Board, and Notes Graph; a new ADR supersedes 0006.** |
| Q2 | **What a page without retain shows when it is shown again.** VS Code reloads its HTML, so the page would draw the snapshot embedded when the HTML was first set, which can be many updates old, and then update. | When such a page is hidden, the host resets `webview.html` with the last snapshot it posted (cached, not recomputed). The existing stale refresh posts a fresh one on show if the index changed meanwhile. UI state comes back from `setState`. This is pinned by host-controller tests. |
| Q3 | **The "Loading…" flash.** With inert state, it disappears when a snapshot is ready at HTML time. That is a visible change, but it is the one 0005 decided. Building the snapshot synchronously can also delay first paint where it is expensive: Related Notes ranks the workspace, and the Dashboard is large. | Embed the snapshot when the index is published and the build is cheap: under 50 ms median on the 5,000-note bench, read from the existing `measure` timings, which are recorded in 4.2. Otherwise keep the loading line and push the state, as today. Until the first scan finishes, the loading line and its indexing count stay on every page. **Decided: embed only when the build is cheap.** |
| Q4 | **Focus when the focused row disappears.** Today `restorePlace` moves focus to the item at the same index. Preact's keyed diff would leave focus on `body`. | Keep today's fallback as the post-render step of §3. |
| Q5 | **Open menus when the host pushes state.** Today they close. Preact would let them stay open. | Keep closing them. Staying open is a possible follow-up, not part of this phase. |
| Q6 | **Help with no Preact.** Help's body is static, trusted reference text built by the host from the manifest. CONTRIBUTING asks that it be edited with every feature. Rewriting it as TSX changes nothing for readers and moves where contributors edit. | Help's body stays host-built HTML in the shell. Its script becomes a typed bundle with no Preact. This departs from §5 row 6(d), which lists Help as a Preact page, and is recorded in `webviews.md`. **Decided: Help stays host-built, with a typed script and no Preact.** |
| Q7 | **Help's guide output from `markdown.api.render`.** It carries `data-line`, `class="code-line"`, `dir="auto"`, `hljs-*` spans, and an empty Mermaid span. | Rewrite links and images. Drop the Mermaid span. Leave the rest, since no Help rule styles it. The `helpGuide` surface decides whether anything visible moved. Warm the command when Help opens. When the Markdown extension is disabled, show one sentence and a link to the page on the site. That message is new text, shown only on that failure. **Decided: one sentence and a link to the guide on the site when the Markdown extension is unavailable.** |
| Q8 | **Where the token tree and `markdown-it` disagree.** Candidates: entities such as `&copy;`, backslash escapes, `<https://…>` autolinks, images (which the sanitizer drops), tables (which the sanitizer flattens to cell text), `breaks: true` line breaks, nested lists, `hr`, and `[[wiki links]]`. | For every construct the 1.10 comparison finds in the corpora, match `markdown-it`'s visible output. Wiki links render as their literal text, as today. A wiki-link token must not become a control in this phase. Constructs the corpora do not contain also follow `markdown-it` where that is cheap: entities, escapes, autolinks, breaks. Anything left unmatched is listed for David before step 5. |
| Q9 | **Theme and zen changes.** Today they reload the page. | Keep the reload. Swapping the theme link in place would keep UI state and avoid the reload, but it is a behavior change and a later follow-up. |

### Architecture

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | `src/webview` may import named pure domain modules. Today the rule `pages-import-protocol-and-shared` forbids any domain import. The graph's communities, calendar date stepping, and the board's status validator must run on the page and be tested under `test:unit`. | Allow `^src/domain/(graph/communities\|markdown/calendar\|tasks/taskColumns)` and the widget catalog by name, not `src/domain/**`. `domain-is-pure` already keeps these free of `vscode` and I/O. Record the change in `layers.md`. |
| D2 | Pages render synchronously from one store, with hooks limited to refs and layout effects (§3). | Record it as an ADR in 4.2. Without it, about 300 synchronous page tests would have to become asynchronous. |

## 8. Size

These are estimates for an agent that reads the code first and runs the gates. Review and hand-merging are not included; allow one to two hours of review per page.

| Step | Commits | Agent-hours |
| --- | --- | --- |
| 1. Gates | 10 | 16–24 |
| 2. Hosts and protocol | 10 | 6–8 for 2.1, then 2–4 per host: 22–36 |
| 3. Build, CSS, CSP | 3 | 10–15 |
| 4.1 Help | 3 | 5–8 |
| 4.2 Stats, the core, and the measurement | 4 | 12–18 |
| 4.3 Calendar | 4 | 8–12 |
| 4.4 Task Board | 5 | 18–26 |
| 4.5 Search | 5 | 12–18 |
| 4.6 Related Notes | 3 | 10–14 |
| 4.7 Dashboard | 5 | 18–26 |
| 4.8 Notes Graph | 4 | 16–24 |
| 4.9 Debug page | 1 | 1 |
| 6. Removals | 2 | 2–4 |
| 7. Cleanup and docs | 4 | 8–12 |
| **Total** | **about 63** | **about 165–240** |

Two lanes in step 5, and up to eight agents in step 2, cut the elapsed time to about 60% of the serial figure. The query editor and the Notes Graph are each one agent's work and cannot be split further. The new TSX must pass the lint rules from its first commit, including 80 lines per function, complexity 15, and doc blocks on exports, which the template scripts never had to meet. That cost is in these estimates.
