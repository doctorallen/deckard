# Webview pages

**Status: target.** This page describes the design of [the refactor plan](../implementation/19-refactor.md), not the code as it stands; each phase rewrites it to describe what then exists.

## How pages are built today

Each page's host function still writes its page's script as one template literal. Since Phase 6 step 3 it hands that body to `buildPageShell`, which writes the CSP `<meta>` and links the page's style sheets from `dist/webview/` (see [Bundling and loading](#bundling-and-loading)); the body keeps one inline `<script nonce>`. The script interpolates the shared component script, 105.9 KB of it, as untyped text. Four pages also interpolate the 67.8 KB query editor script. The Dashboard renders to 339.8 KB.

This has costs. The compiler never sees page code, so `test/ui/checkWebviewScripts.js` extracts it by regex and runs `tsc` with `strict: false`. Every redraw assigns `app.innerHTML`, and `renderKeepingPlace` exists to restore the focus and scroll that each redraw loses. Until step 3, seven of nine builders hand-wrote their CSP, and the copies had drifted. Everything below replaces this model. [docs/components.md](../components.md) documents the current mechanism until Phase 6 rewrites it.

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

*As built in Phase 6 step 2.* Host code lives in `src/ui/webview/host/`, and each page's controller and narrowing table in `src/ui/webview/pages/<page>/`. All nine pages run on it: Stats moved in 2.1, and the other eight in 2.2 to 2.10, by the recipe in the next section. The base then gained what those moves needed, so no controller works around it.

| Piece | File | What it does |
| --- | --- | --- |
| `WebviewHost<TSnapshot, TPageToHost>` | `webviewHost.ts` | Owns one webview's session. It sets the HTML when a panel or view is attached, and again on a theme or zen change, which it listens to before anything the controller subscribes to. It narrows each message with the page's table and hands it to its handler. It sends `{ type: 'state', data }` after each index update, in the page's turn, and whenever the controller asks, and times the snapshot in the log. It marks a hidden page stale and sends it one snapshot when it is shown. It sends `indexing` until the first scan ends, and it disposes of everything. |
| `PanelAdapter` | `panelAdapter.ts` | Keeps a page in at most one editor panel: `show()`, `open()`, `restore(panel, state)`, and `dispose()` |
| `ViewAdapter` | `viewAdapter.ts` | Shows a page in a side-bar view: `resolveWebviewView(view)` |
| `PanelSurface`, `ViewSurface` | `surface.ts` | What the host needs of a panel or a view: its webview, visibility, events, redraw priority, and how to close it |
| `PageController` | `pageController.ts` | What a page supplies: its `name`, `options`, `html()`, `buildSnapshot()`, `narrow()`, `handlers`, and optional hooks; see the next section |
| `PageContext` | `pageController.ts` | What a handler or hook may ask of the host: `refresh()`, `post(message)`, `renderHtml()`, and `surface` |
| `narrowWith`, the shared narrowers | `narrowing.ts` | Turns a page's table into its narrowing function. Holds the checks that two or more pages make identically today, `narrowAs(type, narrow)`, which lists a check that serves two types under one of them, and `isRequestId`. |
| The shared handlers | `sharedHandlers.ts` | Factories for the handlers that two or more pages run identically today: `chooseTheme`, `setZenMode`, `openHelp(section?)`, `ready`, `renameTag`, `parkTag` (both types), `toggleTask`, `openSource`, and `openTag` |
| `ActiveSource<T>` | `activeSource.ts` | Which page of a kind is in front, and whether the sidebar shows its part. It is the one shape of `ActiveSearch`, `ActiveCalendar`, and `ActiveHome`. |
| `panelPriority`, `viewPriority` | `panelPriority.ts` | A panel's or view's redraw priority. The old path re-exports them until 2.10. |
| `buildPageShell`, `getContentSecurityPolicy`, `pageResourceRoots` | `pageShell.ts` | A page's document, its policy, and the folders its webview may load from; see [Bundling and loading](#bundling-and-loading). Added in step 3. |

### What a controller tells its host

Every option and hook is optional, and a page that sets none behaves as Stats does.

| Option or hook | What it does | Pages that set it |
| --- | --- | --- |
| `name` | The page's turn after an index update in the log (`Refresh {name} after an index update`), and the name its snapshot is timed under unless `measure` says otherwise | every page |
| `options.measure` | How the snapshot is timed in the log: by default `buildSnapshot` under `name`. `{ name }` logs it under another name, `{ name, includesPost: true }` times the post as well, and `false` leaves it to the page, which calls `measure` inside `buildSnapshot` around only what it always timed. | Home (`{ name: 'Dashboard', includesPost: true }`); `false` for a search page (`Search page`, around its search), both calendars (`CalendarController.snapshot` logs `Calendar`), and the Notes Graph (`Notes Graph`, with how many nodes the graph holds before hidden kinds are left out) |
| `options.hasSnapshot` | `false` for a page drawn whole in its HTML: a refresh does nothing at all, so nothing is built, timed, or owed | Help, the Related Notes debug page |
| `options.onChromeChange` | What a theme or zen change does: `redraw` (the default) resets the HTML and refreshes, `reload` only resets the HTML, `none` leaves the page | `reload`: Help, the Task Board, both calendars; `none`: a search page, which `SearchPanels` redraws, Related Notes, which listens itself, and the debug page |
| `options.followIndexing`, `options.refreshWhenShown`, `options.scripts`, `options.restore` | Whether the page is told the first scan's progress, whether showing it sends a snapshot it missed, how its scripts are set, and what it reads from a panel kept across a reload | see the table under the recipe |
| `subscribe(page)` | Every other listener that redraws the page, listened to after the host's theme and zen listener, so one settings change that touches both resets the HTML first | most pages |
| `isReady()` | While false, a refresh sends nothing and a hidden page is not marked stale | a search page, until the first scan is done |
| `isOutOfDate()` | A reason besides a missed index update to send a snapshot when the page is shown | Home, when the day has turned |
| `onIndexUpdate(page)` | Replaces the refresh an index update makes | the Notes Graph, the Task Board, Related Notes |
| `onDidMarkStale`, `onDidSendSnapshot` | Called when a refresh finds the page hidden, and after each snapshot is sent | a search page, the Task Board, the calendar page, the Notes Graph |
| `onDidAttach`, `onDidChangeViewState`, `onDidDetach` | Called when a panel or view is attached, on each view-state change after the stale refresh, and when the reader closes the page | the pages that say they are in front |
| `dispose()` | Called first when the host is disposed of | the pages that let go of being in front |
| `onDidDispose(page)` | Called once the host has let go of its panel or view, before its listeners go, so a refresh asked for then finds no page | Related Notes, which tells the search and calendar pages the sidebar is gone |

`NavigationService` (`src/services/navigationService.ts`) says what `openSource` and `openTag` may open. Each page's rule today is a named policy: `entries` (Home), `graphNodes` (the Notes Graph), `tasks` (the Task Board), and `notes` (Stats) for a line; and `lenient` (Stats, Home, a search page, Related Notes) and `exact` (the Task Board, the Notes Graph) for a tag. `test/e2e/navigation.e2e.js` pins all six against the hosts.

A message handler is an adapter under the rules in [services.md](services.md). A message several pages send gets one shared handler only where those pages act on it identically today. Where pages differ, as Stats and a search page do on `mergeTags`, each page keeps its own handler, so moving a host changes nothing a reader sees. The same goes for narrowers: one used by a single page lives in that page's table.

`src/test/fakeWebview.ts` holds a `FakeWebview`, with only `postMessage` and `onDidReceiveMessage`, and a `FakeSurface` around it. A host-controller test attaches a `WebviewHost` to a `FakeSurface`, sends messages with `await surface.webview.send(...)`, and reads what the host posted in `surface.webview.posted`.

## Moving a host onto WebviewHost

This is the recipe Stats followed in 2.1, and steps 2.2 to 2.10 after it, each moving one host on its own branch while the others moved theirs. A move changes nothing a page receives, nothing any message does, and no line the log writes. The pages still serve today's template HTML, so `npm run test:dom` stays identical.

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
2. **Protocol maps.** In `protocol/<page>.ts`, declare the two maps and define the old union as `MessageOf<...>`. The shapes come from `protocol/messaging.ts`: `MessageMap`, `MessageOf`, `MessageAs` (one type of a message that serves several, listed under each, such as `parkTag: MessageAs<ParkTagMessage, 'parkTag'>`), `StateMessage`, `IndexingMessage`, and `Correlated` (the request id a request and its answer share, such as `moveTask` and `moveRefused`).
3. **Narrowing table.** Use a shared narrower only where it accepts and returns exactly what the old case did: `narrowSetZenMode`, `narrowOpenSource` (it rebuilds the message with `beside` and `pin` only when true, which `openResultAt` and `openSourceAt` treat as the same as a passed-through message), `narrowOpenTag`, `narrowRenameTag`, `narrowParkTag`, `narrowToggleTask`, `narrowPinNote` (today's `parsePinMessage`), `narrowOpenSearch`, `narrowExportResults`, `onlyType(type)` (any extra fields), and `exactlyType(type)` (no extra fields). A check that serves two types is listed under each with `narrowAs`, as in `unparkTag: narrowAs('unparkTag', narrowParkTag)`, and a request id is checked with `isRequestId`. Write anything else in the page's own table. A case that used to pass the whole record through with `as unknown as` returns the record rebuilt from the fields its handler reads.
4. **Controller.** Set its `name` to the name the host gave `onIndexUpdateInTurn`. If it gave `measure` another name, or timed more or less than building the snapshot, say so in `options.measure`, so the log reads as it did. Set its `options` (`retainContextWhenHidden` and `enableFindWidget` as created today) and `html(webview, theme)` (the page's `get*Html`). Set `buildSnapshot()` to what `refresh()` posted as `data`. Set `subscribe(page)` to every other listener that called `refresh()`, in the order the host registered them; the host's theme and zen listener comes before all of them. Then write one handler per map key. Take a shared handler wherever the old branch matches it, and use the `NavigationService` policy this page has today for `openSource` and `openTag`. Keep each comment that says why, next to its handler.
5. **Host class.** Build the controller and a `WebviewHost` with `{ indexer, themePreview }`, and wrap them in a `PanelAdapter` (view type, title, extension URI, icon path) or a `ViewAdapter`. Forward the public methods. Construct `new NavigationService()` there; it holds no state. `composition/services.ts`, `test/harness/modules.js`, and the e2e suites should need no change.
6. **Delete the parser** from `messages.ts`, with any constant or helper only it used. Move its tests (step 3's file), including any in other suites, such as Stats' merge test in `tag-hygiene.test.ts`.
7. **Check.** Run `npm run check-types && npm run lint`, then `npm run lint:baseline`. Its diff must only remove lines. Then run the page's unit, host, and e2e suites, `node test/e2e/run.js navigation.e2e.js`, and `npm run test:dom`. A host suite also runs without VS Code, under `node node_modules/mocha/bin/mocha.js --ui tdd --require test/e2e/support.js out/test/<page>-host.test.js`; `src/test/timingLog.ts` captures what a refresh logs, and `src/test/configurationEvents.ts` fires one settings change that touches several settings. Run the full set before handing the branch back.

### What each host needs beyond Stats

Each host does some things Stats does not. These are the options and hooks each page now sets.

| Host | Adapter and options | Navigation | Hooks and notes |
| --- | --- | --- | --- |
| Help (`help.ts`) | `PanelAdapter`; no `indexer`; `scripts: 'merge'`; `onChromeChange: 'reload'`; `hasSnapshot: false`; retain, find widget | none | `show(anchor)` loads the releases and calls `open()` when there is no panel, posts `reveal` when there is one, then reveals it. Only the first HTML takes the anchor, so the controller holds it for that render. `restore` loads the releases before attaching; `options.restore` may return a promise, which is awaited. With no snapshot, a restore or a show refreshes nothing and logs nothing. |
| Calendar view (`calendar.ts`) | `ViewAdapter`; `followIndexing: false`; `onChromeChange: 'reload'`; `measure: false` | none | `ready` is the shared `ready()`. `CalendarController.snapshot` times the calendar as `Calendar`, as it always did. `subscribe` follows the window's focus and the calendar settings. |
| Calendar page (`calendarPage.ts`) | `PanelAdapter` with `priority: viewPriority`, icon `resources/views/calendar.svg`; `followIndexing: false`; `onChromeChange: 'reload'`; `measure: false`; retain, no find widget | none | Its turn is `Calendar page`, and its calendar is timed as `Calendar`. `show(month, date)`: an open page is revealed and refreshed at once; a new one is made with `open()`, not revealed, and refreshed once the index has notes. `onDidAttach` and `onDidChangeViewState` set or release the `ActiveCalendar`; `onDidDetach` clears the day and releases; `dispose` releases first. `onDidSendSnapshot` calls `notifyChanged`. `openHelp('periodic')`. |
| Task Board (`taskBoard.ts`) | `PanelAdapter`; `options.restore` reads the saved `{ query }`; `onChromeChange: 'reload'` (the page asks with `ready`); retain, no find widget | `tasks`, `exact` | `show(query)` applies the query, then `show()`. The activity hooks are as on the Calendar page, and `onDidDetach` also clears `lastSnapshot`. `buildSnapshot` keeps `lastSnapshot` and `refineWasInSidebar`, and `onDidSendSnapshot` calls `notifyChanged`. `subscribe` ends with its settings listener. `toggleTask` and `moveTask` keep their own handlers (they mark `writeIndexAt`). |
| Search page (`searchPage.ts`) | One `WebviewHost` per `SearchPanel`, attached to a `PanelSurface` directly, since there are many; `onChromeChange: 'none'`, since `SearchPanels` redraws every page's HTML and then refreshes them all, closing a missing tag's page; `measure: false` | `lenient` for tags; its `openSource` reads the page's snapshot, so it stays its own | Its turn is `search page`, and `buildSnapshot` times its search alone as `Search page`. `isReady` is false before the first scan, so nothing is sent and a hidden page is not marked stale. `onDidMarkStale` clears `lastSnapshot` and calls `notifyChanged`. `onDidSendSnapshot` calls `notifyChanged`. The title is set before the post, and the posted data is not the kept snapshot. `onDidDetach` disposes of the `SearchPanel`. |
| Related Notes (`sidebarNotes.ts`) | `ViewSurface` attached directly, since its resolve refreshes at once and again once the index is published; `followIndexing: false`; `refreshWhenShown: 'never'`; `onChromeChange: 'none'` | `lenient`, and `related` for the five clicks that re-rank to check a row | It sends its own state, with its log lines and `Related Notes: N ms (N results)`, from `onIndexUpdate`, `onDidAttach`, `onDidChangeViewState`, and each listener; it debounces cursor moves. It reads its view from the host. Its theme listener resets the HTML through `page.renderHtml()` and then sends its state, between the editor's listeners and the settings. `onDidDispose` tells `ActiveSearch` and `ActiveCalendar` the sidebar is gone once the host has let go of the view. Its `openSource` reads a fresh snapshot, so it stays its own. |
| Home (`dashboard.ts`) | `PanelAdapter`; `measure: { name: 'Dashboard', includesPost: true }`; retain, find widget | `entries`, `lenient` | Its turn is `Home`. `isOutOfDate` is "the day has turned". `subscribe` ends with its settings listener. The activity hooks set and release `ActiveHome`, but `dispose` does not release it. `openSource`'s handler is the shared one; `pinNote` and `unpinNote` are Home's own. |
| Notes Graph (`notesGraph.ts`) | `PanelAdapter`, icon `resources/notes-graph.svg`; `followIndexing: false`; `measure: false`; retain, no find widget | `graphNodes`, `exact` (opened by `deckard.showTagOverview`) | `buildSnapshot` times the graph alone as `Notes Graph`, with how many nodes it holds. `onIndexUpdate` keeps its "nothing it draws changed" check. `onDidChangeViewState` publishes or clears the graph context. `onDidDetach` clears the selection and the context. `show(options)` posts `applyFilters` after `show()`. |
| Related Notes debug (`relatedNotesDebug.ts`) | `PanelAdapter`; no `indexer`; `scripts: 'off'`; `onChromeChange: 'none'`; `hasSnapshot: false`; retain, find widget | none | It has no messages: an empty table and an empty handler map. `show()` keeps the diagnostic for `html()`, then calls `open()` for a new panel, which draws it, or `renderHtml()` for an open one, sets the title, and reveals the panel. |

### What not to touch

- **Another page's files**, and `messages.ts` beyond your own parser's region. The hot spots (`composition/services.ts`, `test/harness/modules.js`, `messages.ts`, and `messages-rendering.test.ts`) are merged by hand, so keep your edits to them small and in one place.
- **`src/ui/webview/host/` and `src/services/navigationService.ts`.** If a page needs something the base does not have, add it in a separate first commit. Make it an option or a hook that changes nothing for a page that does not set it, with a test in `webview-host.test.ts`. Do not change what an existing option or policy does. A controller does not work around the base: in step 2 each page that did (a measure under one name, its own theme listener, a settings listener outside `subscribe`, a refresh wrapper, its own surface) was given the option or hook above instead.
- **The policies.** No page changes which lines or tags it accepts, even where the rules look like they should agree. Unifying them is a behavior change for a later step.
- **The template HTML and the page scripts.** Step 2 changes no DOM, so `test/ui/dom-baseline/` is never re-recorded here.
- **The pinning suite.** `navigation.e2e.js` must pass unchanged, on every branch.

## The protocol

`src/ui/protocol/<page>.ts` declares each page's `HostToPage` and `PageToHost` message maps and its snapshot type. Both the host and the page import it, so a renamed field fails to compile on both sides. The shape follows `vscode-messenger`: each message is declared once as a request or a notification. A request and its response share a request id, as `moveTask` and `moveRefused` do.

Page-to-host messages are untrusted, so the host narrows each one before handling it. The narrowing is hand-written, as in every surveyed extension, in one table of per-message functions shared across pages. It replaces the check-then-cast parsers in `messages.ts`. No validation library is added; see [decision 0004](decisions/0004-hand-written-message-narrowing.md).

## Bundling and loading

*As built in Phase 6 step 3.* `esbuild.js` has two contexts. `node esbuild.js` builds both, `--production` minifies them, `--watch` watches them, and `--webview` (`npm run build:webview`) builds the pages alone.

| Context | Entries | Output |
| --- | --- | --- |
| Host | `src/extension.ts`, `src/core/storage/searchStoreWorker.ts` | `dist/*.js`, Node, CommonJS |
| Pages | Found, not listed: each folder of `src/webview` but `shared` gives its `main.ts` or `main.tsx` and its `page.css`, each sheet in `shared/themes` gives a theme, and `shared/tail.css` the tail | `dist/webview/<page>.js` and `<page>.css`, `dist/webview/themes/<theme>.css`, and `dist/webview/tail.css`; browser, `iife`, target `chrome148` (VS Code 1.134 runs Electron 42) |

The page context compiles JSX with the automatic runtime and `jsxImportSource: 'preact'`. Its output folder is emptied before each build, so a removed page leaves no bundle behind, and with no page entries it builds nothing and still succeeds. Each build writes its esbuild metafile to `out/extension-meta.json` or `out/webview-meta.json`, which never ship. `scripts/check-bundle-inputs.js` reads them: the host bundles may take in only the 23 packages they took in when the check arrived (`markdown-it`, `sanitize-html`, `picomatch`, and theirs; the list only shrinks), a page's script only Preact, and a page's sheet nothing. CI runs it after packaging the VSIX.

`src/webview/tsconfig.json` type-checks page code against the DOM, with no Node types, strict and `noEmit`. It also lists the domain modules a page may import (D1 in [layers.md](layers.md)), so they are held to the browser's types before a page imports one. The root `tsconfig.json` leaves `src/webview` to it, and `npm run check-types` runs both. ESLint lints `.tsx` with the rules for `.ts`, and forbids `preact/compat` and `react` in `src/webview`. Preact 10.29.8 is a pinned dependency; no page imports it yet. Whether the query-editor pages share one components bundle or each carry a copy is decided in Phase 6 by measuring both.

No page has a script entry yet: each still runs the inline script its builder writes. What step 3 moved is the CSS and the document around the body. Every builder returns `buildPageShell({ webview, extensionUri, page, title, nonce, theme, zen, csp, bodyAttributes, body })`, which writes:

1. the policy `getContentSecurityPolicy` builds (next section);
2. `<link rel="stylesheet">` for `dist/webview/<page>.css`, then `themes/<theme>.css`, then `tail.css`, each through `asWebviewUri`, in that cascade order;
3. `<body>`, with `class="zen"` when zen is on and any attributes the page adds, such as Help's anchor, around the body the builder wrote.

The theme and zen come from the page's host, and `getPageTailCss({ theme, zen })` names the sheets after the page's own and the body's class, so nothing in the shell reads a setting. Each webview's `localResourceRoots` is `[dist/webview, resources]`, set wherever its options are set: the panel and view adapters, the search pages, and Related Notes. A builder therefore takes the extension's folder, and so do the controllers and `CalendarView` and `SidebarNotesView`, which hand it on.

The page loader, `test/harness/loadPage.js`, inlines each linked sheet as it inlines a bundle, so every harness still sees a self-contained page. A sheet's `url()` is resolved against the sheet's URI, as the browser does, and the page nonce is added to `style-src` for a sheet the policy admits by its origin, so Chrome in the layout harness lets the inline copy through exactly when VS Code would let the link through.

The built pages in development, and minified for the VSIX:

| Sheet | Development | Production | Gzip |
| --- | --- | --- | --- |
| `dashboard.css` | 55.3 KB | 46.0 KB | 8.8 KB |
| `searchPage.css` | 45.8 KB | 38.2 KB | 7.6 KB |
| `sidebarNotes.css` | 44.7 KB | 37.1 KB | 7.3 KB |
| `taskBoard.css` | 40.9 KB | 34.1 KB | 6.9 KB |
| `calendarPage.css` | 37.1 KB | 30.9 KB | 6.4 KB |
| `notesGraph.css` | 35.0 KB | 29.1 KB | 6.2 KB |
| `help.css` | 34.2 KB | 28.4 KB | 6.3 KB |
| `stats.css` | 33.6 KB | 27.8 KB | 6.1 KB |
| `calendar.css` | 32.6 KB | 27.0 KB | 5.9 KB |
| `relatedNotesDebug.css` | 30.1 KB | 25.0 KB | 5.6 KB |
| `tail.css` | 14.5 KB | 13.1 KB | 2.4 KB |
| `themes/*.css` | 0.9 to 9.5 KB | 0.8 to 8.3 KB | 0.3 to 1.8 KB |

Each page's sheet carries the base sheet, about 28 KB of it in development; a page loads its own sheet, one theme, and the tail. The development build writes a source map beside each sheet; `.vscodeignore` keeps every `.map` out of the VSIX.

Each page will load `dist/webview/<page>.js` with `<script nonce src>` once its script moves. The official guide calls external files the best practice, and every surveyed extension loads its bundle this way; see [decision 0001](decisions/0001-load-page-bundles-through-aswebviewuri.md).

## The Content Security Policy

*As built in Phase 6 step 3.* Every page's policy is built by `getContentSecurityPolicy(cspSource, nonce, extras)` in `host/pageShell.ts`, so no policy can drift from the others. `style-src` is the extension alone, since no style is inline any more. Scripts need the page nonce. `extras` (`ContentSecurityExtras`) adds images from the extension and the origins it lists, or from any HTTPS origin for `images: true`; fonts from the extension; or, for `scripts: false`, no `script-src` at all.

| Page | Policy beyond `default-src 'none'; style-src <extension>` |
| --- | --- |
| Stats, Task Board, both calendars, search page, Related Notes, Notes Graph | `script-src 'nonce-…'` |
| Dashboard | `script-src 'nonce-…'; img-src <extension>`, for the favorite heart in `resources/` |
| Help | `script-src 'nonce-…'; img-src <extension> https://raw.githubusercontent.com`, for its logo and the guide's screenshots |
| Related Notes debug | nothing: it runs no script and shows no image |

No page loads a font, so none is granted `font-src`.

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

*As built in Phase 6 step 3.* Every rule is in a `.css` file under `src/webview`, bundled by esbuild; the host builds no style text. Pages keep styling with `--vscode-*` variables, which is what Microsoft recommends since the webview toolkit was deprecated. The files were written once from the CSS functions they replace, checked equal to them for every page, theme, and zen state, and are maintained by hand.

| File | What it holds |
| --- | --- |
| `shared/base.css` | Imports the base sheet's parts in cascade order: `designTokens`, `shell`, `typography`, `control`, `tag`, `popover`, `surface`, `taskBoard`, and `taskList` |
| `shared/queryEditor.css`, `shared/calendarDay.css`, `shared/calendar/calendar.css` | Component sheets two or more pages import: the query editor, the calendar's day panel, and the rules both calendars share |
| `<page>/page.css` | Imports `base.css` first, then the component sheets the page uses, then holds the page's own rules. An `@import` must lead a sheet, so Related Notes keeps the rules that come before the day panel in `notes.css` and imports it ahead of `calendarDay.css`, and every rule keeps its place in the cascade. |
| `shared/themes/<theme>.css` | One theme each, `ENABLED` written out; `deckardThemeCss` in `themes.ts` names each by theme |
| `shared/tail.css` | Imports what every page lays after its theme: `controlEdge`, `provenance`, `highContrast`, `cardTag`, and `zen`, in that order. The card-tag selector lists are written out. |

A sheet names a file of the extension in `url()` by its path from `dist/webview/`, where it is served: the favorite heart is `../../resources/favorite-heart-outline.svg`, which esbuild leaves as written. `getPageTailCss` takes `{ theme, zen }` as input instead of reading settings. The `previewTheme` global became a `ThemePreview` object owned by the composition root. A theme or zen change still resets the page's HTML, which links the new theme.

## What ships

Today the pages ship no third-party code, and the host bundle inlines `markdown-it`, `sanitize-html`, and `picomatch` with 21 transitive packages. After the refactor, Preact is the one package the pages ship, and it runs in the sandbox, which has no file system and no network. The host keeps only `picomatch`, which the Phase 0 exclude check kept.

Note Markdown in a card or title reaches the page as a token tree, drawn by an `<Inline tokens>` component as elements and text nodes. Nothing is parsed as HTML, so there is nothing to sanitize. `rendering.ts` is retired. The Markdown previews and the debug page share one `escapeHtml` in `src/shared/html.ts`. Eight copies with two different escape sets become one. See [decision 0011](decisions/0011-host-bundle-ships-no-third-party-code.md).
