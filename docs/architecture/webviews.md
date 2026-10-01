# Webview pages

**Status: target.** This page describes the design of [the refactor plan](../implementation/19-refactor.md), not the code as it stands; each phase rewrites it to describe what then exists.

## How pages are built today

Each page's host function returns one template literal that holds the whole document. It carries a CSP `<meta>`, one inline `<style nonce>`, and one inline `<script nonce>`. The script interpolates the shared component script, 105.9 KB of it, as untyped text. Four pages also interpolate the 67.8 KB query editor script. The Dashboard renders to 339.8 KB.

This has costs. The compiler never sees page code, so `test/ui/checkWebviewScripts.js` extracts it by regex and runs `tsc` with `strict: false`. Every redraw assigns `app.innerHTML`, and `renderKeepingPlace` exists to restore the focus and scroll that each redraw loses. Seven of nine builders hand-write their CSP, and the copies have drifted. Everything below replaces this model. [docs/components.md](../components.md) documents the current mechanism until Phase 6 rewrites it.

## The shape every well-made extension shares

The research read the official guide and samples and the webview source of GitLens, GitHub Pull Requests, Jupyter, Azure Cosmos DB, and DocumentDB. Seven patterns hold across all of them, and Deckard adopts all seven:

1. Page code is real TypeScript, bundled, and loaded through `asWebviewUri`.
2. The HTML template is tiny.
3. A host base class owns the panel lifecycle.
4. Initial state reaches the page as inert data or by a ready handshake, never as JSON inside a script.
5. Message types live in one module imported by both sides.
6. Tests are two-tier: a fast tier under jsdom, and a slow tier in a real VS Code.
7. Rendering is declarative, and CSS is authored as files.

## The host side

*As built in Phase 6 step 2.1.* Host code lives in `src/ui/webview/host/`, and each page's controller and narrowing table in `src/ui/webview/pages/<page>/`. Stats runs on it. The other hosts move onto it in steps 2.2 to 2.9, by the recipe in the next section, and each still writes its own lifecycle until then.

| Piece | File | What it does |
| --- | --- | --- |
| `WebviewHost<TSnapshot, TPageToHost>` | `webviewHost.ts` | Owns one webview's session. It sets the HTML when a panel or view is attached, and again on a theme or zen change. It narrows each message with the page's table and hands it to its handler. It sends `{ type: 'state', data }` after each index update, in the page's turn, and whenever the controller asks. It marks a hidden page stale and sends it one snapshot when it is shown. It sends `indexing` until the first scan ends, and it disposes of everything. |
| `PanelAdapter` | `panelAdapter.ts` | Keeps a page in at most one editor panel: `show()`, `open()`, `restore(panel, state)`, and `dispose()` |
| `ViewAdapter` | `viewAdapter.ts` | Shows a page in a side-bar view: `resolveWebviewView(view)` |
| `PanelSurface`, `ViewSurface` | `surface.ts` | What the host needs of a panel or a view: its webview, visibility, events, redraw priority, and how to close it |
| `PageController` | `pageController.ts` | What a page supplies: its `name`, `options`, `html()`, `buildSnapshot()`, `narrow()`, `handlers`, and optional hooks |
| `narrowWith`, the shared narrowers | `narrowing.ts` | Turns a page's table into its narrowing function. Holds the checks that two or more pages make identically today. |
| The shared handlers | `sharedHandlers.ts` | Factories for the handlers that two or more pages run identically today: `chooseTheme`, `setZenMode`, `openHelp(section?)`, `ready`, `renameTag`, `parkTag` (both types), `toggleTask`, `openSource`, and `openTag` |
| `ActiveSource<T>` | `activeSource.ts` | Which page of a kind is in front, and whether the sidebar shows its part. It is the one shape of `ActiveSearch`, `ActiveCalendar`, and `ActiveHome`. |
| `panelPriority`, `viewPriority` | `panelPriority.ts` | A panel's or view's redraw priority. The old path re-exports them until 2.10. |

`NavigationService` (`src/services/navigationService.ts`) says what `openSource` and `openTag` may open. Each page's rule today is a named policy: `entries` (Home), `graphNodes` (the Notes Graph), `tasks` (the Task Board), and `notes` (Stats) for a line; and `lenient` (Stats, Home, a search page, Related Notes) and `exact` (the Task Board, the Notes Graph) for a tag. `test/e2e/navigation.e2e.js` pins all six against the hosts.

A message handler is an adapter under the rules in [services.md](services.md). A message several pages send gets one shared handler only where those pages act on it identically today. Where pages differ, as Stats and a search page do on `mergeTags`, each page keeps its own handler, so moving a host changes nothing a reader sees. The same goes for narrowers: one used by a single page lives in that page's table.

`src/test/fakeWebview.ts` holds a `FakeWebview`, with only `postMessage` and `onDidReceiveMessage`, and a `FakeSurface` around it. A host-controller test attaches a `WebviewHost` to a `FakeSurface`, sends messages with `await surface.webview.send(...)`, and reads what the host posted in `surface.webview.posted`.

## Moving a host onto WebviewHost

This is the recipe Stats followed in 2.1, for steps 2.2 to 2.9. Each of those moves one host, on its own branch, while the others move theirs. A move changes nothing a page receives and nothing any message does. The pages still serve today's template HTML, so `npm run test:dom` stays identical.

### What a page owns

| File | Contents |
| --- | --- |
| `src/ui/protocol/<page>.ts` | `<Page>PageToHost` and `<Page>HostToPage` maps, keyed by message type. The old union becomes `MessageOf<<Page>PageToHost>` under its old name, so its importers do not change. |
| `src/ui/webview/pages/<page>/messages.ts` | The page's narrowing table (`<PAGE>_MESSAGES: NarrowingTable<<Page>PageToHost>`) and `narrow<Page>Message = narrowWith(<PAGE>_MESSAGES)`. Checks only this page makes live here. |
| `src/ui/webview/pages/<page>/<page>Controller.ts` | The controller class, and any helpers that moved with it, such as `pickStatsTag` |
| `src/ui/webview/<page>.ts` | The host class under its old name, with its old constructor options and public methods, now a thin class around a `PanelAdapter` or `ViewAdapter` and a `WebviewHost` |
| `src/test/<page>-messages.test.ts` | The page's parser tests, moved from wherever they were, rewritten against `narrow<Page>Message` with the same accepted and refused payloads. The file imports nothing that reaches `vscode`, so it runs under `test:unit`. |
| `src/test/<page>-host.test.ts` | Host-controller tests through `FakeSurface`. Effects that go through VS Code (`commands.executeCommand`, `window.showQuickPick`, `workspace.openTextDocument`, `window.showTextDocument`) are recorded by swapping the function for the test and putting it back in `finally`, as `stats-host.test.ts` does. |

### Steps

1. **Read the host and its parser to the line.** For each message, write down its parser case (including every `Object.keys(value).length` check and every field it copies or passes through), what the handler reads, the index snapshot it reads, and each effect in order. For the session, write down the panel's view type, title, icon, and creation options, and what `attachPanel` sets and listens to, in order. Note what the chrome subscription does, what `refresh()` does when hidden and when visible, what runs after the post, and what `show`, `restore`, and `dispose` do.
2. **Protocol maps.** In `protocol/<page>.ts`, declare the two maps and define the old union as `MessageOf<...>`. The shapes come from `protocol/messaging.ts`, which needs no change: `MessageMap`, `MessageOf`, `StateMessage`, `IndexingMessage`, and `Correlated` (the request id a request and its answer share, such as `moveTask` and `moveRefused`).
3. **Narrowing table.** Use a shared narrower only where it accepts and returns exactly what the old case did: `narrowSetZenMode`, `narrowOpenSource` (it rebuilds the message with `beside` and `pin` only when true, which `openResultAt` and `openSourceAt` treat as the same as a passed-through message), `narrowOpenTag`, `narrowRenameTag`, `narrowParkTag`, `narrowToggleTask`, `narrowPinNote` (today's `parsePinMessage`), `narrowOpenSearch`, `narrowExportResults`, `onlyType(type)` (any extra fields), and `exactlyType(type)` (no extra fields). Write anything else in the page's own table. A case that used to pass the whole record through with `as unknown as` returns the record rebuilt from the fields its handler reads.
4. **Controller.** Set its `name` to the name the host gave `onIndexUpdateInTurn` and `measure`. Set its `options` (`retainContextWhenHidden` and `enableFindWidget` as created today) and `html(webview, theme)` (the page's `get*Html`). Set `buildSnapshot()` to what `refresh()` posted as `data`. Set `subscribe(page)` to every other listener that called `refresh()`. Then write one handler per map key. Take a shared handler wherever the old branch matches it, and use the `NavigationService` policy this page has today for `openSource` and `openTag`. Keep each comment that says why, next to its handler.
5. **Host class.** Build the controller and a `WebviewHost` with `{ indexer, themePreview }`, and wrap them in a `PanelAdapter` (view type, title, extension URI, icon path) or a `ViewAdapter`. Forward the public methods. Construct `new NavigationService()` there; it holds no state. `composition/services.ts`, `test/harness/modules.js`, and the e2e suites should need no change.
6. **Delete the parser** from `messages.ts`, with any constant or helper only it used. Move its tests (step 3's file), including any in other suites, such as Stats' merge test in `tag-hygiene.test.ts`.
7. **Check.** Run `npm run check-types && npm run lint`, then `npm run lint:baseline`. Its diff must only remove lines. Then run the page's unit, host, and e2e suites, `node test/e2e/run.js navigation.e2e.js`, and `npm run test:dom`. Run the full set before handing the branch back.

### What each host needs beyond Stats

Each host does some things Stats does not. These are the options and hooks for them, read from the hosts at 2.1. Read your host again anyway; where it differs from this table, the host wins.

| Host | Adapter and options | Navigation | Hooks and notes |
| --- | --- | --- | --- |
| Help (`help.ts`) | `PanelAdapter`; no `indexer`; `scripts: 'merge'`; `onChromeChange: 'reload'`; retain, find widget | none | `show(anchor)` loads the releases and calls `open()` when there is no panel, posts `reveal` when there is one, then reveals it; it sends no snapshot. Only the first HTML takes the anchor, so the controller holds it for that render. `restore` loads the releases before attaching; `options.restore` may return a promise, which is awaited. `buildSnapshot` returns undefined. |
| Calendar view (`calendar.ts`) | `ViewAdapter`; `followIndexing: false`; `onChromeChange: 'reload'` | none | `ready` is the shared `ready()`; `CalendarController` stays as it is. |
| Calendar page (`calendarPage.ts`) | `PanelAdapter` with `priority: viewPriority`, icon `resources/views/calendar.svg`; `followIndexing: false`; `onChromeChange: 'reload'`; retain, no find widget | none | `show(month, date)`: an open page is revealed and refreshed at once; a new one is made with `open()`, not revealed, and refreshed once the index has notes. `onDidAttach` and `onDidChangeViewState` set or release the `ActiveCalendar`; `onDidDetach` clears the day and releases; `dispose` releases first. `onDidSendSnapshot` calls `notifyChanged`. `openHelp('periodic')`. |
| Task Board (`taskBoard.ts`) | `PanelAdapter`; `options.restore` reads the saved `{ query }`; `onChromeChange: 'reload'` (the page asks with `ready`); retain, no find widget | `tasks`, `exact` | `show(query)` applies the query, then `show()`. The activity hooks are as on the Calendar page, and `onDidDetach` also clears `lastSnapshot`. `buildSnapshot` keeps `lastSnapshot` and `refineWasInSidebar`, and `onDidSendSnapshot` calls `notifyChanged`. `toggleTask` and `moveTask` keep their own handlers (they mark `writeIndexAt`). |
| Search page (`searchPage.ts`) | One `WebviewHost` per `SearchPanel`, attached to a `PanelSurface` directly, since there are many; `onChromeChange: 'none'`, since `SearchPanels` redraws every page's HTML and then refreshes them all, closing a missing tag's page | `lenient` for tags; its `openSource` reads the page's snapshot, so it stays its own | Before the first scan, `buildSnapshot` returns undefined, which sends nothing and leaves a stale page stale. `onDidMarkStale` clears `lastSnapshot` and calls `notifyChanged`. `onDidSendSnapshot` calls `notifyChanged`. The title is set before the post, and the posted data is not the kept snapshot. `onDidDetach` disposes of the `SearchPanel`. |
| Related Notes (`sidebarNotes.ts`) | `ViewSurface` attached directly, since its resolve refreshes at once and again once the index is published; `followIndexing: false`; `refreshWhenShown: 'never'` | `lenient` | `onDidChangeViewState` sets the sidebar visible on `ActiveSearch` and `ActiveCalendar` and then refreshes, always. Its refresh logs, and debounces cursor moves. Its three hand parses (`homeAddWidget`, `homeResetWidgets`, `calendarDay`) join its table. Its `openSource` reads a fresh snapshot, so it stays its own. The sub-plan asks for a `NavigationService` policy for the five handlers that re-rank to check a click; that policy must accept exactly what a fresh `createSnapshot()` does, and it is added in the branch's first commit. |
| Home (`dashboard.ts`) | `PanelAdapter`; retain, find widget | `entries`, `lenient` | `isOutOfDate` is "the day has turned". The activity hooks set and release `ActiveHome`, but `dispose` does not release it. `openSource`'s handler is the shared one; `pinNote` and `unpinNote` are Home's own. |
| Notes Graph (`notesGraph.ts`) | `PanelAdapter`, icon `resources/notes-graph.svg`; `followIndexing: false`; retain, no find widget | `graphNodes`, `exact` (opened by `deckard.showTagOverview`) | `onIndexUpdate` keeps its "nothing it draws changed" check. `onDidChangeViewState` publishes or clears the graph context. `onDidDetach` clears the selection and the context. `show(options)` posts `applyFilters` after `show()`. |
| Related Notes debug (`relatedNotesDebug.ts`) | `PanelAdapter`; no `indexer`; `scripts: 'off'`; `onChromeChange: 'none'`; retain, find widget | none | It has no messages: an empty table and an empty handler map, and `buildSnapshot` returns undefined. `show()` keeps the diagnostic for `html()`, then calls `open()` for a new panel, which draws it, or `renderHtml()` for an open one, sets the title, and reveals the panel. |

### What not to touch

- **Another page's files**, and `messages.ts` beyond your own parser's region. The hot spots (`composition/services.ts`, `test/harness/modules.js`, `messages.ts`, and `messages-rendering.test.ts`) are merged by hand, so keep your edits to them small and in one place.
- **`src/ui/webview/host/` and `src/services/navigationService.ts`.** If your host needs something the base does not have, add it in a separate first commit on your branch. Make it an option or a hook that changes nothing for a page that does not set it, with a test in `webview-host.test.ts`, and say so when you hand the branch back. Do not change what an existing option or policy does.
- **The policies.** No page changes which lines or tags it accepts, even where the rules look like they should agree. Unifying them is a behavior change for a later step.
- **The template HTML and the page scripts.** Step 2 changes no DOM, so `test/ui/dom-baseline/` is never re-recorded here.
- **The pinning suite.** `navigation.e2e.js` must pass unchanged, on every branch.

## The protocol

`src/ui/protocol/<page>.ts` declares each page's `HostToPage` and `PageToHost` message maps and its snapshot type. Both the host and the page import it, so a renamed field fails to compile on both sides. The shape follows `vscode-messenger`: each message is declared once as a request or a notification. A request and its response share a request id, as `moveTask` and `moveRefused` do.

Page-to-host messages are untrusted, so the host narrows each one before handling it. The narrowing is hand-written, as in every surveyed extension, in one table of per-message functions shared across pages. It replaces the check-then-cast parsers in `messages.ts`. No validation library is added; see [decision 0004](decisions/0004-hand-written-message-narrowing.md).

## Bundling and loading

`esbuild.js` gains a second build context for the pages: `platform: 'browser'`, `format: 'iife'`, and one script entry and one CSS entry per page, written to `dist/webview/`. Page code lives in `src/webview/<page>/main.ts`, and shared code in `src/webview/shared/` as imported modules. A second `tsconfig.webview.json` with the DOM library type-checks it, so `checkWebviewScripts.js` is retired. Whether the four query-editor pages share one components bundle or each carry a copy is decided in Phase 6 by measuring both.

Each page's HTML shell links `dist/webview/<page>.css` and loads `dist/webview/<page>.js` with `<script nonce src>`. The webview's `localResourceRoots` is `dist/webview`, plus `resources/` where a page uses icons. The official guide calls external files the best practice, and every surveyed extension loads its bundle this way; see [decision 0001](decisions/0001-load-page-bundles-through-aswebviewuri.md).

## The Content Security Policy

Every page builds its policy with `getContentSecurityPolicy`, so no policy can drift from the others. Scripts need the page nonce. `style-src` is plain `${cspSource}`, since no style is inline any more. `font-src` is granted only to a page that loads a font.

Only Chrome enforces the policy. jsdom ignores CSP entirely: a script with the wrong nonce ran in the probe. So the headless-Chrome `srcdoc` harness in `test/ui/checkLayout.js` is the one place a CSP regression can show. A `srcdoc` document inherits its parent's policy, so from Phase 0 the harness's parent page carries the intended CSP rather than stripping it.

## State

**Initial state.** The first snapshot is embedded as `<script type="application/json" id="state">`, with `<` escaped. The page draws on its first frame, with no "Loading…" flash, and no JSON is ever interpolated into executable script. Updates arrive as `postMessage({ type: 'state' })`, the entry point the tests already drive. See [decision 0005](decisions/0005-inert-json-for-initial-state.md).

**`retainContextWhenHidden`.** Today all nine webviews set it. The guide calls it the exception, with high memory overhead. It stays only on the Dashboard's query editor and the Task Board's drag state. Other UI state, such as scroll, selection, and open sections, goes into `setState`, so the serializers restore it. The stale refresh on `onDidChangeViewState` stays everywhere. The API documentation and the guide disagree on whether a hidden retained webview receives messages, and the refresh is correct either way. See [decision 0006](decisions/0006-retain-context-only-for-live-editing-state.md).

VS Code hands a page's saved `setState` back after a restart, so a page restored after an upgrade reads state the old script wrote. Those shapes are persisted formats, listed in [inventories/persisted-formats.md](inventories/persisted-formats.md).

## Rendering with Preact

Each page is a tree of TSX components that render from the snapshot. Preact diffs and patches only what changed. That removes the full-page `innerHTML` redraw, `renderKeepingPlace`, and the in-page `escapeHtml`, since text becomes text nodes by construction. esbuild compiles TSX natively, so `tsc` type-checks the markup with no plugin. See [decision 0002](decisions/0002-preact-in-the-light-dom.md).

Two guards apply:

- **Pin 10.29.x exactly.** Preact 11.0.0 shipped on 2026-09-30 and has no track record yet.
- **Never import `preact/compat`.** The React-compatibility layer then never ships, and a later move to React stays a rename the compiler drives.

Preact renders into the light DOM, not a shadow root. Document-level theme CSS does not cross a shadow root except through inherited and custom properties. jsdom has never implemented `adoptedStyleSheets`. The light DOM keeps the eight themes, the high-contrast sheets, and the layout, contrast, and visual tests working unchanged.

Domain logic leaves page script. The graph's clustering and salience, the Home widget catalog, calendar arithmetic, board status validation, tag-key parsing, and the Help manifest interpreter become typed modules. They go host-side where the host owns the decision, and into shared modules where the page must compute locally. Click handlers become one `dispatchAction` over a `Record<string, handler>`.

## CSS and theming

Page and shared CSS move to `.css` files bundled by esbuild. Pages keep styling with `--vscode-*` variables, which is what Microsoft recommends since the webview toolkit was deprecated. `getDeckardThemeCss` becomes a `Record<DeckardTheme, string>` lookup instead of a 373-line ladder. `getPageTailCss` takes `{ theme, zen }` as input instead of reading settings, so a page can render without a VS Code stub. The `previewTheme` global becomes a `ThemePreview` object owned by the composition root.

## What ships

Today the pages ship no third-party code, and the host bundle inlines `markdown-it`, `sanitize-html`, and `picomatch` with 21 transitive packages. After the refactor, Preact is the one package the pages ship, and it runs in the sandbox, which has no file system and no network. The host keeps only `picomatch`, which the Phase 0 exclude check kept.

Note Markdown in a card or title reaches the page as a token tree, drawn by an `<Inline tokens>` component as elements and text nodes. Nothing is parsed as HTML, so there is nothing to sanitize. `rendering.ts` is retired. The Markdown previews and the debug page share one `escapeHtml` in `src/shared/html.ts`. Eight copies with two different escape sets become one. See [decision 0011](decisions/0011-host-bundle-ships-no-third-party-code.md).
