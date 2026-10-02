# Webview pages

**Status: current.** This page describes the webview pages as they stand after Phase 7, the last phase of [the refactor plan](../implementation/19-refactor.md). Phase 6 moved every page to a bundle.

## How pages are built

Every page is a shell its host writes and a bundle that draws it. Eight pages draw with Preact on the shared core: Stats, the Task Board, the search page, Related Notes, both calendars, the Notes Graph, and the Dashboard. Help's script is a typed module with no Preact that moves around the body its host builds from the manifest, and the Related Notes debug page is HTML its host builds, with no script at all. Each bundle is built from `src/webview/<page>/` and loaded by URI under the page's nonce ([Bundling and loading](#bundling-and-loading)); its code is type-checked against the DOM, and imports only its own folder, `webview/shared`, the protocol, the domain modules D1 names, and Preact ([layers.md](layers.md)). [docs/components.md](../components.md) documents the components a page draws with.

The nine scripts come to 586.2 KB minified, 195.2 KB with gzip ([the table](#the-pages-scripts)); the host's `dist/extension.js` is 944.3 KB.

Before Phase 6, each host function wrote its page's script as one template literal, which interpolated a shared component script of 105.9 KB, and on three pages a 67.8 KB query editor script, as untyped text; the Dashboard rendered to 339.8 KB. The compiler never saw page code, so `test/ui/checkWebviewScripts.js` extracted it by regex and type-checked it with `strict: false`. Every redraw assigned `app.innerHTML`, and `renderKeepingPlace` put back the focus and scroll each redraw lost. Until step 3, seven of nine builders hand-wrote their CSP, and the copies had drifted. Step 7 deleted what was left of that model: the template builders in `src/ui/webview/components.ts` and `checkWebviewScripts.js`. The suites that held the shared components to the template now hold them to recordings of it ([The shared core](#the-shared-core)).

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
| `WebviewHost<TSnapshot, TPageToHost>` | `webviewHost.ts` | Owns one webview's session. It sets the HTML when a panel or view is attached, and again on a theme or zen change, in the theme and zen it reads then (`readPageChrome`), which it listens to before anything the controller subscribes to. It narrows each message with the page's table and hands it to its handler. It sends `{ type: 'state', data }` after each index update, in the page's turn, and whenever the controller asks, and times the snapshot in the log. It marks a hidden page stale and sends it one snapshot when it is shown. It sends `indexing` until the first scan ends, and it disposes of everything. |
| `PanelAdapter` | `panelAdapter.ts` | Keeps a page in at most one editor panel: `show()`, `open()`, `restore(panel, state)`, and `dispose()` |
| `ViewAdapter` | `viewAdapter.ts` | Shows a page in a side-bar view: `resolveWebviewView(view)` |
| `PanelSurface`, `ViewSurface` | `surface.ts` | What the host needs of a panel or a view: its webview, visibility, events, redraw priority, and how to close it |
| `PageController` | `pageController.ts` | What a page supplies: its `name`, `options`, `html()`, `buildSnapshot()`, `narrow()`, `handlers`, and optional hooks; see the next section |
| `PageContext` | `pageController.ts` | What a handler or hook may ask of the host: `refresh()`, `post(message)`, `postState(data)` (a snapshot the controller built, timed, and logged itself, kept as the last sent), `renderHtml()`, and `surface` |
| `narrowWith`, the shared narrowers | `narrowing.ts` | Turns a page's table into its narrowing function. Holds the checks that two or more pages make identically today, `narrowAs(type, narrow)`, which lists a check that serves two types under one of them, and `isRequestId`. |
| The shared handlers | `sharedHandlers.ts` | Factories for the handlers that two or more pages run identically today: `chooseTheme`, `setZenMode`, `openHelp(section?)`, `ready`, `renameTag`, `parkTag` (both types), `toggleTask`, `openSource`, and `openTag` |
| `ActiveSource<T>` | `activeSource.ts` | Which page of a kind is in front, and whether the sidebar shows its part. It is the one shape of `ActiveSearch`, `ActiveCalendar`, and `ActiveHome`. |
| `panelPriority`, `viewPriority` | `panelPriority.ts` | A panel's or view's redraw priority |
| `buildPageShell`, `getContentSecurityPolicy`, `joinUnder` | `pageShell.ts` | A page's document, its policy, and a file under the extension's folder joined as `vscode.Uri.joinPath` joins one; see [Bundling and loading](#bundling-and-loading). Added in step 3. It names no `vscode` type: it takes the webview as a `ShellWebview` and the folder as a `ShellUri`, so a page builds without the extension host. |
| `pageResourceRoots` | `surface.ts` | The folders a page's webview may load from |
| `readPageChrome`, `onDidChangePageChrome`, `affectsPageChrome` | `pageChrome.ts` | The theme, preview and all, and zen mode as a page is written in them now; the event that redraws a page in another look; and whether a settings change is one |

### What a controller tells its host

Every option and hook is optional, and a page that sets none behaves as Stats does.

| Option or hook | What it does | Pages that set it |
| --- | --- | --- |
| `name` | The page's turn after an index update in the log (`Refresh {name} after an index update`), and the name its snapshot is timed under unless `measure` says otherwise | every page |
| `options.measure` | How the snapshot is timed in the log: by default `buildSnapshot` under `name`. `{ name }` logs it under another name, `{ name, includesPost: true }` times the post as well, and `false` leaves it to the page, which calls `measure` inside `buildSnapshot` around only what it always timed. | Home (`{ name: 'Dashboard', includesPost: true }`); `false` for a search page (`Search page`, around its search), both calendars (`CalendarController.snapshot` logs `Calendar`), and the Notes Graph (`Notes Graph`, with how many nodes the graph holds before hidden kinds are left out) |
| `options.readsInertState` | The page draws a snapshot its HTML carries, which `html` is then handed. Not retained, it is drawn again from the last snapshot sent when it is hidden (Q2; see [State](#state)) | Stats, both calendars, Related Notes |
| `options.embedsSnapshot` | With `readsInertState`, the HTML set while the page is shown carries a snapshot built then, once the index has notes to show, so the page draws them on its first frame (Q3). It is built and timed as a sent one is, and kept as the last sent; a hidden page is built nothing | both calendars |
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

This is the recipe Stats followed in 2.1, and steps 2.2 to 2.10 after it, each moving one host on its own branch while the others moved theirs. A move changes nothing a page receives, nothing any message does, and no line the log writes. In step 2 the pages still served their template HTML, so `npm run test:dom` stayed identical.

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
4. **Controller.** Set its `name` to the name the host gave `onIndexUpdateInTurn`. If it gave `measure` another name, or timed more or less than building the snapshot, say so in `options.measure`, so the log reads as it did. Set its `options` (`retainContextWhenHidden` and `enableFindWidget` as created today) and `html(webview, chrome)` (the page's `get*Html`, handed the theme and zen its host read). Set `buildSnapshot()` to what `refresh()` posted as `data`. Set `subscribe(page)` to every other listener that called `refresh()`, in the order the host registered them; the host's theme and zen listener comes before all of them. Then write one handler per map key. Take a shared handler wherever the old branch matches it, and use the `NavigationService` policy this page has today for `openSource` and `openTag`. Keep each comment that says why, next to its handler.
5. **Host class.** Build the controller and a `WebviewHost` with `{ indexer, themePreview }`, and wrap them in a `PanelAdapter` (view type, title, extension URI, icon path) or a `ViewAdapter`. Forward the public methods. Construct `new NavigationService()` there; it holds no state. `composition/services.ts`, `test/harness/modules.js`, and the e2e suites should need no change.
6. **Delete the parser** from `messages.ts`, with any constant or helper only it used. Move its tests (step 3's file), including any in other suites, such as Stats' merge test in `tag-hygiene.test.ts`.
7. **Check.** Run `npm run check-types && npm run lint`, then `npm run lint:baseline`. Its diff must only remove lines. Then run the page's unit, host, and e2e suites, `node test/e2e/run.js navigation.e2e.js`, and `npm run test:dom`. A host suite also runs without VS Code, under `node node_modules/mocha/bin/mocha.js --ui tdd --require test/e2e/support.js out/test/<page>-host.test.js`; `src/test/timingLog.ts` captures what a refresh logs, and `src/test/configurationEvents.ts` fires one settings change that touches several settings. Run the full set before handing the branch back.

### What each host needs beyond Stats

Each host does some things Stats does not. These are the options and hooks each page now sets.

| Host | Adapter and options | Navigation | Hooks and notes |
| --- | --- | --- | --- |
| Help (`help.ts`) | `PanelAdapter`; no `indexer`; `scripts: 'merge'`; `onChromeChange: 'reload'`; `hasSnapshot: false`; no retain (step 4.1), find widget | none | `show(anchor)` loads the releases and calls `open()` when there is no panel, draws a hidden one again at the anchor, since its page is not running to be asked, posts `reveal` to a visible one, then reveals it. `onDidAttach` starts the Markdown extension that renders the guide (decision 0012). Only the first HTML takes the anchor, so the controller holds it for that render. `restore` loads the releases before attaching; `options.restore` may return a promise, which is awaited. With no snapshot, a restore or a show refreshes nothing and logs nothing. |
| Calendar view (`calendar.ts`) | `ViewAdapter`; `followIndexing: false`; `onChromeChange: 'reload'`; `measure: false` | none | `ready` is the shared `ready()`. `CalendarController.snapshot` times the calendar as `Calendar`, as it always did. `subscribe` follows the window's focus and the calendar settings. |
| Calendar page (`calendarPage.ts`) | `PanelAdapter` with `priority: viewPriority`, icon `resources/views/calendar.svg`; `followIndexing: false`; `onChromeChange: 'reload'`; `measure: false`; retain, no find widget | none | Its turn is `Calendar page`, and its calendar is timed as `Calendar`. `show(month, date)`: an open page is revealed and refreshed at once; a new one is made with `open()`, not revealed, and refreshed once the index has notes. `onDidAttach` and `onDidChangeViewState` set or release the `ActiveCalendar`; `onDidDetach` clears the day and releases; `dispose` releases first. `onDidSendSnapshot` calls `notifyChanged`. `openHelp('periodic')`. |
| Task Board (`taskBoard.ts`) | `PanelAdapter`; `options.restore` reads the saved `{ query }`; `onChromeChange: 'reload'` (the page asks with `ready`); retain, no find widget | `tasks`, `exact` | `show(query)` applies the query, then `show()`. The activity hooks are as on the Calendar page, and `onDidDetach` also clears `lastSnapshot`. `buildSnapshot` keeps `lastSnapshot` and `refineWasInSidebar`, and `onDidSendSnapshot` calls `notifyChanged`. `subscribe` ends with its settings listener. `toggleTask` and `moveTask` keep their own handlers (they mark `writeIndexAt`). |
| Search page (`searchPage.ts`) | One `WebviewHost` per `SearchPanel`, attached to a `PanelSurface` directly, since there are many; `onChromeChange: 'none'`, since `SearchPanels` redraws every page's HTML and then refreshes them all, closing a missing tag's page; `measure: false` | `lenient` for tags; its `openSource` reads the page's snapshot, so it stays its own | Its turn is `search page`, and `buildSnapshot` times its search alone as `Search page`. `isReady` is false before the first scan, so nothing is sent and a hidden page is not marked stale. `onDidMarkStale` clears `lastSnapshot` and calls `notifyChanged`. `onDidSendSnapshot` calls `notifyChanged`. The title is set before the post, and the posted data is not the kept snapshot. `onDidDetach` disposes of the `SearchPanel`. |
| Related Notes (`sidebarNotes.ts`) | `ViewSurface` attached directly, since its resolve refreshes at once and again once the index is published; `followIndexing: false`; `refreshWhenShown: 'never'`; `onChromeChange: 'none'` | `lenient`, and `related` for the five clicks that re-rank to check a row | It sends its own state, with its log lines and `Related Notes: N ms (N results)`, from `onIndexUpdate`, `onDidAttach`, `onDidChangeViewState`, and each listener, through `page.postState`, so the host keeps it to draw the view again from when it is hidden (since step 4.6, not retained, `readsInertState`); it debounces cursor moves. It keeps the state it last posted while nothing the ranking reads has changed (any refresh it could not send, a cursor move pending, a preference write or visit, any Deckard setting, the day turning), so a reveal ranks at most once: not at all when nothing changed while it was hidden, since the view draws that state from its HTML, and `ready` from a view VS Code loaded again is sent that state rather than a new ranking. It reads its view from the host. Its theme listener resets the HTML through `page.renderHtml()` and then sends its state, between the editor's listeners and the settings. `onDidDispose` tells `ActiveSearch` and `ActiveCalendar` the sidebar is gone once the host has let go of the view. Its `openSource` reads a fresh snapshot, so it stays its own. |
| Home (`dashboard.ts`) | `PanelAdapter`; `measure: { name: 'Dashboard', includesPost: true }`; retain, find widget | `entries`, `lenient` | Its turn is `Home`. `isOutOfDate` is "the day has turned". `subscribe` ends with its settings listener. The activity hooks set and release `ActiveHome`, but `dispose` does not release it. `openSource`'s handler is the shared one; `pinNote` and `unpinNote` are Home's own. |
| Notes Graph (`notesGraph.ts`) | `PanelAdapter`, icon `resources/notes-graph.svg`; `followIndexing: false`; `measure: false`; retain, no find widget | `graphNodes`, `exact` (opened by `deckard.showTagOverview`) | `buildSnapshot` times the graph alone as `Notes Graph`, with how many nodes it holds. `onIndexUpdate` keeps its "nothing it draws changed" check. `onDidChangeViewState` publishes or clears the graph context. `onDidDetach` clears the selection and the context. `show(options)` posts `applyFilters` after `show()`. |
| Related Notes debug (`relatedNotesDebug.ts`) | `PanelAdapter`; no `indexer`; `scripts: 'off'`; `onChromeChange: 'none'`; `hasSnapshot: false`; not retained (since step 4.9, Q1), find widget | none | It has no messages: an empty table and an empty handler map. `show()` keeps the diagnostic for `html()`, then calls `open()` for a new panel, which draws it, or `renderHtml()` for an open one, sets the title, and reveals the panel. |

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

The page context compiles JSX with the automatic runtime and `jsxImportSource: 'preact'`. Its output folder is emptied before each build, so a removed page leaves no bundle behind, and with no page entries it builds nothing and still succeeds. Each build writes its esbuild metafile to `out/extension-meta.json` or `out/webview-meta.json`, which never ship. `scripts/check-bundle-inputs.js` reads them: the host bundles may take in only `markdown-it` and its five packages and `picomatch` (the list only shrinks: it held 23 packages when the check arrived, and step 6 removed `sanitize-html` and the 15 it brought), a page's script only Preact, and a page's sheet nothing. CI runs it after packaging the VSIX.

`src/webview/tsconfig.json` type-checks page code against the DOM, with no Node types, strict and `noEmit`. It also lists the domain modules a page may import (D1 in [layers.md](layers.md)), so they are held to the browser's types before a page imports one. The root `tsconfig.json` leaves `src/webview` to it, and `npm run check-types` runs both. ESLint lints `.tsx` with the rules for `.ts`, and forbids `preact/compat` and `react` in `src/webview`. Preact 10.29.8 is a pinned dependency, and each Preact page's bundle carries its own copy, with what it uses of the shared core; see [One bundle per page](#one-bundle-per-page).

Stats (`src/webview/stats/main.tsx`), the Task Board (`src/webview/taskBoard/main.tsx`), the search page (`src/webview/searchPage/main.tsx`), Related Notes (`src/webview/sidebarNotes/main.tsx`), the Calendar view (`src/webview/calendar/main.tsx`), the calendar page (`src/webview/calendarPage/main.tsx`), the Notes Graph (`src/webview/notesGraph/main.tsx`), the Dashboard (`src/webview/dashboard/main.tsx`), and Help (`src/webview/help/main.ts`) have script entries, built to `dist/webview/stats.js`, `taskBoard.js`, `searchPage.js`, `sidebarNotes.js`, `calendar.js`, `calendarPage.js`, `notesGraph.js`, `dashboard.js`, and `help.js`. The Related Notes debug page has no entry, since it runs no script. The two calendars are two entries over `src/webview/shared/calendar/`. What step 3 moved is the CSS and the document around the body. Every builder returns `buildPageShell({ webview, extensionUri, page, title, nonce, theme, zen, csp, bodyAttributes, body, bundle, state })`, which writes:

1. the policy `getContentSecurityPolicy` builds (next section);
2. for a page with `bundle`, `<meta name="deckard-theme" content="…">`, the theme's name, which a gear's theme row reads (`readThemeName`);
3. `<link rel="stylesheet">` for `dist/webview/<page>.css`, then `themes/<theme>.css`, then `tail.css`, each through `asWebviewUri`, in that cascade order;
4. `<body>`, with `class="zen"` when zen is on and any attributes the page adds, such as Help's anchor, around the body the builder wrote;
5. for a page with `bundle`, at the end of the body: the snapshot, when `state` is given, as `<script type="application/json" id="state">` with every `<` written `\u003c` (`inertJson`), then `<script nonce src>` for `dist/webview/<page>.js`.

A bundled page's body is its `<main id="app">`, holding the loading line when the shell carries no snapshot and empty when it does, and the `#live-status` node. The Notes Graph's body is empty: its template wrote the canvas and its panels straight into the body, with no `#app`, so its page draws the whole body (see [The Notes Graph](#the-notes-graph)).

The theme and zen come from the page's host: `WebviewHost` reads them with `readPageChrome(themePreview)` as it writes the page, and the controller hands them to its builder as `chrome`, a `PageChrome` (`components.ts`). `getPageTailCss(chrome)` names the sheets after the page's own and the body's class, so neither a builder nor the shell reads a setting, and a page's catalog suites run under `test:unit`. Each webview's `localResourceRoots` is `[dist/webview, resources]`, from `pageResourceRoots` in `host/surface.ts`, set wherever its options are set: the panel and view adapters, the search pages, and Related Notes. A builder therefore takes the extension's folder, and so do the controllers and `CalendarView` and `SidebarNotesView`, which hand it on.

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

A page with a script entry passes `bundle: true`, and the shell writes `<script nonce src>` for `dist/webview/<page>.js` last in the body, after the page's inert state when it has one.

### The pages' scripts

*Measured at the end of Phase 6*, from `node esbuild.js --production`, the build the VSIX ships, with gzip at level 9:

| Script | Production | Gzip |
| --- | --- | --- |
| `dashboard.js` | 117.0 KB | 36.9 KB |
| `taskBoard.js` | 110.1 KB | 35.2 KB |
| `searchPage.js` | 94.5 KB | 31.1 KB |
| `notesGraph.js` | 71.6 KB | 25.4 KB |
| `sidebarNotes.js` | 62.9 KB | 20.9 KB |
| `calendarPage.js` | 50.8 KB | 18.1 KB |
| `stats.js` | 38.3 KB | 13.0 KB |
| `calendar.js` | 37.5 KB | 13.1 KB |
| `help.js` | 3.7 KB | 1.6 KB |
| All nine | 586.2 KB | 195.2 KB |

Each Preact page's script carries Preact and what it uses of the shared core ([One bundle per page](#one-bundle-per-page)); Help's carries neither. `scripts/check-bundle-inputs.js` holds every page's script to Preact alone.

**Help** is the one page with no Preact (Q6 of the [Phase 6 plan](../implementation/20-webviews.md)). Its body stays the HTML the host builds from the manifest, and its script, `src/webview/help/main.ts`, is a typed module that only moves around in it: the rail, the guide view, and the way back. The guide view sets the HTML of a guide page, rendered by the host through `markdown.api.render` from the guide the VSIX ships, in one documented assignment. Help is not retained when hidden; it saves `{ guide?: { page, anchor? }, scrollY, drawn }` with `setState`, and a page shown again asks for its guide page and scrolls back. `drawn` is a hash of the nonce the HTML was drawn with, so a state saved by an earlier drawing (a theme change, a section asked for while hidden, a window reload) is not read, and those open where they always have. The official guide calls external files the best practice, and every surveyed extension loads its bundle this way; see [decision 0001](decisions/0001-load-page-bundles-through-aswebviewuri.md).

### One bundle per page

*Measured in Phase 6 step 4.2, on Stats, the first Preact page, and again in step 4.5, once the search page and the Task Board shared the query editor; recorded as [decision 0016](decisions/0016-one-bundle-per-page.md).* Open question 3 asked whether the pages share one bundle of Preact and the shared core, or each carry their own. Two variants of Stats were built by `scripts/measure-page-bundles.js`:

- **A**, one bundle per page: `stats.js` holds Preact, what Stats uses of `src/webview/shared`, and the page.
- **B**, a shared bundle: `shared.js` holds Preact and all of `src/webview/shared` as one `iife` global, and an esbuild plugin maps the page's imports to it, so `stats.js` holds only the page. The shell loads `shared.js` first.

The rule was set before the numbers: B only if it saves more than 100 KB in the VSIX, or more than 10 ms of Chrome first render on a page; otherwise A, which is one request per page and needs nothing new in the loader.

| Bundle | Raw | Minified | Gzip | Preact | Core | Page | esbuild's own |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A `stats.js` | 64.4 KB | 38.3 KB | 13.0 KB | 10.6 KB | 10.1 KB | 17.5 KB | 0.0 KB |
| B `shared.js` | 57.2 KB | 34.5 KB | 13.5 KB | 13.2 KB | 20.9 KB | 0 | 0.5 KB |
| B `stats.js` | 37.3 KB | 20.1 KB | 6.2 KB | 0 | 0 | 19.2 KB | 0.9 KB |

The shares are of the minified bytes, from esbuild's metafile. B's shared bundle carries more of both Preact and the core than A's page does, because nothing in it can be left out: it exports everything for pages that are not built with it.

| | A | B |
| --- | --- | --- |
| Page script, minified | 38.3 KB | 54.6 KB, in two files |
| VSIX, the same files zipped again with `zip -9` | 1,464.5 KB | 1,471.1 KB |
| First render in jsdom, median of 20 `openWebviewPage` loads | 50.9 ms | 49.6 ms |
| First render in Chrome, median of 10 (`LAYOUT_TIMING=1`) | 54.9 ms | 58.6 ms |

The VSIX `vsce` packed was 1,473.3 KB. A first render runs from the start of the page's document to its state drawn and laid out. Chrome's is timed in real time, since virtual time does not advance while a script runs. On macOS, Chrome 153.

**Decision: A.** With one Preact page, B cannot save anything: it ships 6.6 KB more and draws 3.7 ms later, and jsdom's 1.3 ms is within its run-to-run spread. The build keeps one bundle per page. The question is measured again at Search, the first time two moved pages share the query editor, and then recorded as a decision.

**Measured again at Search** (step 4.5), with the same script, on the search page, the Task Board, and Stats. `--together` swaps every Preact page's bundles in the VSIX at once, B with one `shared.js` for all five, which is what B would ship.

| Bundle | Raw | Minified | Gzip | Preact | Core | Page | esbuild's own |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A `searchPage.js` | 170.0 KB | 94.2 KB | 31.0 KB | 10.7 KB | 64.5 KB | 19.0 KB | 0.0 KB |
| A `taskBoard.js` | 198.1 KB | 110.1 KB | 35.2 KB | 10.7 KB | 68.1 KB | 30.7 KB | 0.5 KB |
| A `stats.js` | 64.5 KB | 38.3 KB | 13.0 KB | 10.6 KB | 10.1 KB | 17.5 KB | 0.0 KB |
| B `shared.js` | 176.7 KB | 96.0 KB | 32.2 KB | 13.2 KB | 82.3 KB | 0 | 0.5 KB |
| B `searchPage.js` | 44.0 KB | 22.7 KB | 7.7 KB | 0 | 0 | 21.1 KB | 1.6 KB |
| B `taskBoard.js` | 66.4 KB | 35.0 KB | 11.5 KB | 0 | 0 | 33.0 KB | 2.1 KB |
| B `stats.js` | 37.3 KB | 20.1 KB | 6.2 KB | 0 | 0 | 19.2 KB | 0.9 KB |

| | A | B |
| --- | --- | --- |
| The five Preact pages' scripts, minified (`--together`) | 328.4 KB in 5 files | 188.5 KB in 6 files |
| The same, gzip | 109.7 KB | 63.3 KB |
| VSIX, every page swapped, zipped again with `zip -9` | 1,536.7 KB | 1,491.2 KB |
| Search page first render, jsdom (median of 20) / Chrome (median of 10) | 66.0 / 83.3 ms | 64.7 / 86.6 ms |
| Task Board first render, jsdom / Chrome | 57.9 / 66.3 ms | 61.7 / 70.3 ms |
| Stats first render, jsdom / Chrome | 35.2 / 49.7 ms | 39.7 / 54.6 ms |

The VSIX `vsce` packed was 1,546.3 KB. On macOS, Chrome 153.

**Decision: A, again** ([0016](decisions/0016-one-bundle-per-page.md)). B saves 45.5 KB of the VSIX, under half the rule's 100 KB, and draws every page measured 3 to 5 ms later in Chrome, since its shared bundle holds all of the core for whichever page loads it. Related Notes and the Dashboard, the pages still to move, will raise B's saving; if it ever crosses 100 KB, the question is measured again with this script and rule.

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

**Initial state.** A Preact page reads a snapshot its shell carries as `<script type="application/json" id="state">`, with `<` escaped, and draws it on its first frame with no loading line; no JSON is ever interpolated into executable script. Updates arrive as `postMessage({ type: 'state' })`, the entry point the tests already drive. See [decision 0005](decisions/0005-inert-json-for-initial-state.md).

When the shell carries one is Q3 of the sub-plan: a page's HTML embeds a freshly built snapshot only when the build is cheap, under 50 ms median on the 5,000-note bench, read from the `measure` line its host writes (`npm run bench:index` reports Stats'). Otherwise the page opens on its loading line, with the indexing count until the first scan ends, and the host posts the snapshot, as before. Stats builds in 150 ms there (65 ms on 1,000 notes), the Task Board, on the search it opens with, `is:open`, in 230 ms (47 ms on 1,000; `Task Board snapshot` in the bench, step 4.4), a search page in 182 ms on the page a tag opens and 133 ms on a search of every note (31 and 19 ms on 1,000; `Search page snapshot` in the bench, step 4.5), and Home, with the widgets it starts with, in 394 ms (90 ms on 1,000; `Dashboard snapshot, Home` in the bench, step 4.7), so all four open on their loading lines and nothing builds their snapshots into HTML. A page under 50 ms sets `options.embedsSnapshot`: whenever its HTML is set while it is shown and the index has notes, the host builds its snapshot, timed as a sent one is, and hands it to `html`. The Calendar view's month builds in 15 ms there (3.3 ms on 1,000), and the calendar page's month with its day panel in 37 ms (6.3 ms), so both calendars' HTML carries their month; each still says `ready` when it loads, as it always has, and is sent a snapshot then. The Notes Graph's whole-workspace graph builds in 1,412 ms there (229 ms on 1,000), and its message is about 40 MB, so its HTML carries none: it never had a loading line, and it is posted its graph as before. Related Notes ranks the whole workspace for its note: 1,924 ms on 5,000 notes and 185 ms on 1,000 (`Related Notes snapshot` in the bench, step 4.6, for the note and what links to it), so it opens on its loading line too, and is posted its state as before.

A page that reads inert JSON says so with `options.readsInertState`. `controller.html(webview, chrome, state)` is then handed a snapshot to carry when there is one. `test:dom` draws each surface of such a page twice, posted and embedded, and holds the two to one DOM (`readsInertState` in the page catalog).

**A hidden page that is not kept running** (Q2). VS Code throws away a hidden webview's page unless it is retained, and loads its HTML again when it is shown. So when a page that reads inert JSON and is not retained is hidden, its host sets its HTML once more, carrying the last snapshot it sent: the one kept, not built again. Shown, the page draws that at once, and the stale refresh sends a newer one only if the page missed one. A theme change while it is hidden carries the snapshot too; a newly attached panel carries nothing a closed one was sent. What the page itself chose comes back from `setState`.

**`retainContextWhenHidden`.** In step 2 all nine webviews kept it. Stats dropped it in step 4.2 (Q1); its three choices and its scroll position are kept with `setState` as `{ showAllOrphans, showUsedOnce, pairsAsTable, scrollY }`, each choice when the reader makes it and the scroll at most every 200 ms, and a value that is not `true` reads as off. Both calendars dropped it in step 4.3: the calendar page keeps `{ layout, scrollY }`, its layout as before and its scroll as Stats keeps its own, and the Calendar view keeps nothing, as before; each is drawn again from its last month when hidden (Q2). Related Notes dropped it in step 4.6: hidden, it is drawn again from the last state it posted, and it keeps what the reader chose in it, which retain used to keep while it was hidden, with `setState` as `{ noteLimit, noteListKey, showEveryActiveTag, contextOpen, linksOpen: { linked, mentions }, openLinkSections, expandedRefine, shownGroups, scrollY }`: how many results Show more has drawn and for which list, the note's tags all shown, the context and the Links groups open, the link rows unfolded, the Refine facets opened past five, the calendar day's groups shown whole, and the scroll, after each draw and each fold, and the scroll at most every 200 ms. A value of the wrong kind reads as a new view's choice. The relevance breakdown, the gear, and the tag menu are not kept, as a draw closed them before. The Related Notes debug page dropped it in step 4.9: it runs no script and keeps nothing, so shown again it is the HTML it was last given, the same evidence, at the top and with every calculation folded. Q1 keeps it on the Dashboard, Search, the Task Board, and the Notes Graph. The Task Board, a Preact page since step 4.4, keeps it, and keeps `{ query, scrollY }` with `setState` as its template did: the search on each snapshot, and the scroll only while the search is the one it was scrolled in. A search page, a Preact page since step 4.5, keeps it for the search half built in its box, and keeps `{ query, origin, scrollY?, tab? }` as its template did: the search and the one it opened with on each snapshot, the scroll only while the search is the one it was scrolled in, and the tab only once the reader chose one; its host reads the same record, and the shapes older releases wrote, to restore it. The Dashboard, a Preact page since step 4.7, keeps it for Home's search box and for arranging Home, and keeps `{ dashboardMode, tagColumns, browseQuery, tagNamespaceFilter, editingHome, homeHintDismissed }` with `setState` as its template did: the whole record whenever the reader changes one of them, read back as the template read it (the tab only as `browse`, the columns only as 1 to 4, anything else as nothing kept), and `browseQuery` written as the Tags tab's search is typed and never read back. The Notes Graph, moved in step 4.8, keeps it so its simulation does not restart on every reveal; it keeps its 23 settings and its camera with `setState` as before, for a reload, read back as its template read them (row 23 of the persisted-formats inventory). The guide calls it the exception, with high memory overhead, so it stays only on those four pages, each for the reason [decision 0017](decisions/0017-retain-context-on-four-pages.md) gives. Other UI state, such as scroll, selection, and open sections, goes into `setState`, so the serializers restore it. The stale refresh on `onDidChangeViewState` stays everywhere. The API documentation and the guide disagree on whether a hidden retained webview receives messages, and the refresh is correct either way. See [decision 0017](decisions/0017-retain-context-on-four-pages.md), which supersedes [0006](decisions/0006-retain-context-only-for-live-editing-state.md).

VS Code hands a page's saved `setState` back after a restart, so a page restored after an upgrade reads state the old script wrote. Those shapes are persisted formats, listed in [inventories/persisted-formats.md](inventories/persisted-formats.md).

## Rendering with Preact

Each page is a tree of TSX components that render from the snapshot. Preact diffs and patches only what changed. That removed the full-page `innerHTML` redraw, `renderKeepingPlace`, and the in-page `escapeHtml`, since text becomes text nodes by construction. esbuild compiles TSX natively, so `tsc` type-checks the markup with no plugin. See [decision 0002](decisions/0002-preact-in-the-light-dom.md).

Two guards apply:

- **Pin 10.29.x exactly.** Preact 11.0.0 shipped on 2026-09-30 and has no track record yet.
- **Never import `preact/compat`.** The React-compatibility layer then never ships, and a later move to React stays a rename the compiler drives.

Preact renders into the light DOM, not a shadow root. Document-level theme CSS does not cross a shadow root except through inherited and custom properties. jsdom has never implemented `adoptedStyleSheets`. The light DOM keeps the eight themes, the high-contrast sheets, and the layout, contrast, and visual tests working unchanged.

Domain logic left page script. The graph's clustering and salience, the Home widget catalog, calendar arithmetic, board status validation, tag-key parsing, and the Help manifest interpreter are typed modules: host-side where the host owns the decision, and among the domain modules D1 names where the page computes for itself. Click handlers go through one `dispatchAction` over a `Record<string, handler>`.

### The shared core

*As built in Phase 6 step 4.2.* Every Preact page starts from `src/webview/shared`, written with Stats and held, component by component, to the template script it replaced: `src/test/webview-shared.test.ts` draws each one through the core bundled as esbuild builds a page, and requires the DOM the template's helper drew, node for node. Since step 7 deleted the template, the helper's side is a recording of it, taken before the deletion (`src/test/templateRecords.ts`).

| Module | What a page uses |
| --- | --- |
| `page.ts` | `startPage({ initial, ready, view, afterDraw })` returns the page's one store; `store.update(change)` draws the whole page with Preact's top-level `render` before it returns ([decision 0014](decisions/0014-pages-render-synchronously-from-one-store.md)). Until `ready` holds, the shell's loading line stays; it is cleared before the first draw. After each draw, `afterDraw` runs, then the reader's place is put back. `readEmbeddedState()` reads `#state`. `listenForActions(app, actions, otherwise)` is the one delegated click listener, and `dispatchAction(actions, element, event)` runs the handler an element's `data-action` names. `onHostMessage(type, handler)` takes one kind of host message. `startPage` first installs what every page shares: the indexing line, the busy mark, the `aria-disabled` click guard, Escape putting the provenance line away, and tips |
| `place.ts` | `readPlace` and `restorePlace`, as the template had them; the store calls both around each draw, and focus goes back only when the draw took away the element that had it |
| `status.ts` | `announce`, `describeIndexing`, and, for a page that runs a search, `setSearchInFlight` |
| `vscode.ts` | `post(message)`, `vscodeApi()`, and `keptState()` and `keepState(change)` over `setState` |
| `scroll.ts` | `rememberScroll` and `restoreScroll` |
| `tip.tsx`, `keySheet.tsx`, `undoToast.tsx` | The tip (`installTip`, run by `startPage`), the key sheet (`installKeySheet`, `openKeySheet`, `closeKeySheet`), and the undo toast (`createUndoNotice`, `<UndoNotice>`): each a layer appended to the body where the template appended it, outside `#app`, its contents a render root of its own |
| `viewOptions.tsx` | The gear (`<ViewOptions groups>`), a row of choices (`<ViewOptionChoices>`), `themeOption()` and `zenOption()`, and `installViewOptions()` |
| `buttons.tsx`, `icons.tsx` | `<IconButton>`, `<HelpButton anchor>`, and the settings and help icons, drawn as the host's `icons.ts` writes them |
| `tagLabel.tsx`, `metric.tsx`, `inline.tsx`, `loading.tsx` | `<TagLabel label svg>`, `<Metric>` with `<Sparkline>` and `describeChange`, `<Inline tokens>`, which draws `InlineToken[]` as markdown-it's elements and text nodes, and `<Loading>` |

The token types live in `domain/model/inline.ts` and `blocks.ts`, since the protocol imports only the domain model; `ui/protocol/inline.ts` re-exports the two the pages name, `InlineToken` and `BlockToken`, since a page may import the protocol but not the model.

Lane B's shared components are in `src/webview/shared/calendar/`, written with the Calendar view and held to the template script they replaced:

| Module | What a page uses |
| --- | --- |
| `session.ts` | `new CalendarSession({ initial, view, afterFullDraw, stepsByDay })`: a calendar's store, its host's snapshots each drawn whole, and what both calendars do: `selectDay`, `redraw`, `focusWhenDrawn`, `onGridKey`, `onDoubleClick`, and the `actions` of the controls both draw. Choosing a day only marks it until the next full draw, as the template's `selectDay` did (`marked` and `tabStop` in `model.ts`). `send` posts a calendar message |
| `model.ts` | `CalendarState`, and the words and choices both calendars share: `dueTone`, `describeDay`, `dayClasses`, `isDrawn`, `drawnWeekdays`, `markedDate`, `tabStopDate`, `withGroupShown` |
| `grid.tsx`, `calendarIcon.tsx` | `<CalendarGrid snapshot weeks label multiselectable days>`, with `<WeekdayRow>` and each week's `<WeekRail>`; each calendar draws its own days. `<CalendarIcon>` |
| `dayPanel.tsx` | `<DayPanel day shownGroups>`, the chosen day as the calendars and Related Notes show it, and `installDayPanel({ send, showGroup })`, which wires every panel on the page once; Related Notes' `send` wraps each message in its `calendarDay` envelope. `src/test/calendar-day-panel.test.ts` held it to the template script it replaced, `calendarDay.ts`, until Related Notes moved and that script went. Its tasks are lane A's `<TaskListRow>` (step 6; the panel's own row, which set the host's sanitized `renderedTitle`, is gone) |
| `events.ts` | `eventElement(event)` |

The date steps both calendars take are `domain/markdown/calendar.ts`'s (D1): `shiftDate`, `isWeekend`, `skipWeekend`, `stepDate`, `sameDayIn`, `chooseFocusDay`, and `stepCalendar`.

### The task and search parts

*As built in Phase 6 steps 4.4 and 4.5, with the Task Board and the search page.* Lane A's pages share these, each held to the template it replaced, through the recording step 7 kept of it: `src/test/webview-tasks.test.ts` draws the task parts; `src/test/webview-query-editor.test.ts` runs the search box through the clicks, keys, and typing the template was driven through, and requires at each step the DOM, the searches, and the focus the template's recording holds; and `src/test/webview-search.test.ts` draws every note excerpt of the sample workspace, the development notes, and the fixtures from its tokens and through `markdown-it`, and opens the tag menu the template opened.

| Module | What a page uses |
| --- | --- |
| `taskRow.tsx` | `<TaskListRow item draggable titleDisplay leading trailing entry afterSource>` (`entry` is a search's `data-search-entry`, and `afterSource` what follows where the task is written, such as Links the hub note), `<PriorityBadge priority>`, `<ParkedLabel>`, `formatTaskDate`, `formatSourceLocation`, `trimHeadingPath` and `<HeadingPathSteps steps>`, and `taskTitleOf(element)` |
| `taskTitle.tsx`, `tagButton.tsx` | `<TaskTitle tokens tags>`, a title from its `titleTokens` with its tags as controls where they are written; `<TagButton tag className>`, `withTagButtons`, and `<TitleWithTags title tags appendMissing>` for a plain title |
| `queryEditor.tsx`, `queryText.ts` | `createQueryEditor(options)`, the search box: `bar(statusControls)` and `facets()` draw it from the page's store, and `receive`, `beforeRender`, `afterRender`, `focus`, and the `handle*` methods are told of each draw and event, as the template's editor was. `queryText.ts` reads and writes query text and the builder's tree with no page in it |
| `facets.tsx` | `facetValuesShown(facet, expanded, className)`, `FACET_VISIBLE`, `<FacetValue facet value>`, `describeFacetValue`, `getWeightLevel`, and `<WeightRail level title>` |
| `actionMenu.tsx` | `openActionMenu(opener, groups, onChoose)` and `closeActionMenu()`: the menu a card's ⋯ opens, `#action-menu`, a layer of the body whose contents are a render root |
| `rankedRows.tsx` | `installRankedRows({ kinds, canRank, reorder, move, menuActions, onMenuAction, onListChanged })`, `closeRankMenu()`, `<ContextMenuItem action label>`, `rankKeys`, and `moveKeyToEdge`; the rank menu is a layer of the body, and the drag's ghost a copy of the row appended to it |
| `menuKeys.ts`, `openSource.ts`, `strokeIcons.tsx` | `installMenuKeys()` (the menu key, Shift+F10, and Alt+Enter raise a contextmenu) and `returnFocusFromMenu()`; `openSourceMessage(element, event)`; `<EllipsisIcon>`, `<CheckIcon>`, `<SortIcon>`, `<LinesIcon>`, `<LayoutTabsIcon>`, `<LayoutSplitIcon>`, `<RenderedIcon>`, and `<SourceIcon>` |
| `blockExcerpt.tsx` | `<BlockExcerpt blocks>`: a note excerpt drawn from its `BlockToken[]` as the elements and text nodes `markdown-it` wrote and the sanitizer kept, line ends between blocks included, and a table as its cells' words |
| `searchCard.tsx` | `<SearchCard card position display opened>`, a note a search found: its title and tags, file and line, heading path, Links the hub note, Parked, and its body as the Preview row asks, with the snippet lead and Show all; `<NoteBody rawContent blocks renderMode>`, a body drawn from its tokens or as its source in a `<pre>`, keyed by its source; and `CardDisplay`, the gear's Format, Preview, and tag rows |
| `tagMenu.tsx` | `openTagContextMenu(event, target)`, Rename tag and Park tag or Unpark tag; `openContextMenu(event, items)`, whatever a page offers at the pointer; `closeTagContextMenu()`, `isTagContextMenuOpen()`, `hasTagContextMenu()`, and `tagContextKey()`; and `setParkedTags`, `isParkedTag`, and `parkTagMenuItem`. The menu is `#tag-context-menu`, a layer of the body whose rows are `<ContextMenuItem>`s in a render root |
| `resultTabs.tsx`, `pageSteps.tsx` | `<ResultTabs tabs active label>`, `resultPanelAttributes(id)`, and `installResultTabKeys()`, the arrow keys between the tabs; `<PageSteps paging action attributes noun>`, `pageNumbers`, and `describePageRange` |
| `markWords.ts` | `markWords(root, words, options)`: the searched words marked in `<mark>` where they are written, outside controls, tags, and code, returning what takes the marks out again |

### Home and the Tags tab

*As built in Phase 6 step 4.7.* The Dashboard (`src/webview/dashboard/`) is drawn from one store on the shared core, and takes the shared parts lane A wrote: the query editor for Home's search box, the task row, ranked rows for its tags and, while Home is arranged, its widgets, the metric for its three tiles, the gear, and the undo toast. No other page draws a Home widget, so Home's parts stay in its folder.

| Module | What it holds |
| --- | --- |
| `main.tsx` | The page as it runs: the store, the listeners in the order the template registered them, arranging Home (adding, removing with Undo, resizing, ranking, and each widget's settings), the tag search told to the host once typing settles, and what the host sends: `state`, `addWidget`, and `quickAddResult` |
| `header.tsx` | The page's name, the three tiles, the gear, and the Home and Tags tabs |
| `home.tsx` | Home: the bar it is arranged from, the line saying what is new or that it can be arranged, the way in for a workspace with no notes, the grid, and `widgetChoices`, what + Add widget offers and the host hands Related Notes |
| `widgets.tsx`, `widgetBodies.tsx`, `rows.tsx` | One widget in its frame, with its gear and pager; what each kind shows; and the rows they list |
| `tagsTab.tsx`, `tagNames.ts` | The Tags tab, and how it names a tag by the namespace the host sends and narrows the tags |
| `model.ts`, `keptView.ts`, `homeContext.ts`, `icons.tsx` | The page's own state, what it keeps with `setState`, what a widget is drawn with, and its glyphs |

Which widgets there are, and what each can do, is `domain/dashboard/widgetCatalog.ts`'s `WIDGET_KINDS`, which the host's preferences schema reads to keep a stored widget; a tag key's namespace is `domain/markdown/tagKeys.ts`'s, which the parser reads too (D1). A widget's id is made on the page, so the new widget is drawn at once with its mark.

What the template did to the page outside a draw, the page still does, and squares with the next draw: the tag columns are laid out by script and their buttons marked at once, and listened to on the button so the gear stays open; a widget's gear is open exactly when the reader left it open; and the widget just added is marked and focused after the state that shows it, and unmarked before the next draw, as every template draw dropped the mark until the next state. A select is given the value its template marked selected, which Preact puts back on every draw.

### Related Notes

*As built in Phase 6 step 4.6.* Related Notes (`src/webview/sidebarNotes/`) is a view in the sidebar, drawn with `startPage` from one store holding the host's last state. What the reader chose there, which the host never hears of, stays in one `choices` object of the page's, as the template's script kept it, and since the view is not kept running while hidden it is kept with `setState` too ([State](#state)): how many results Show more has drawn and for which list, the note's tags all shown, the context and the Links groups open, the link rows unfolded, the Refine facets opened past five, and the calendar day's groups shown whole.

| Module | What it holds |
| --- | --- |
| `main.tsx` | The page: its context, the heading over its list, what each state lists, and Links; the listeners, on the document in the order the template added them; and the store's draws, each closing the tag menu as the template's did |
| `model.ts` | The store and the reader's choices, the list's page size, which list Show more counts for, and how many lines of each excerpt show |
| `context.tsx` | What the sidebar is about: the note or entry, with its own tags, or the page in front; and the related notes' sort and gear |
| `cards.tsx` | A ranked result's card, a graph node's connections, the entries worded like a note with no tags, and Home's widgets to add |
| `links.tsx` | Linked from and Mentioned without a link |
| `refine.tsx` | Refine: the active search's values, folded at five |
| `weights.tsx` | The weight rail where the sidebar draws it: beside each of the note's tags, and as each result's relevance with its breakdown |

It draws the calendar's day with lane B's `<DayPanel>`, the tag menu, `markWords` with `{ wordStart }`, and the shared core's rail, tag label, and gear. Two things the template did to the DOM after a draw are put back before the next, so Preact finds the page as it drew it: the words each result shares with the note, marked in its excerpt after every draw, and a relevance breakdown its score opened, which every template draw closed.

### The Notes Graph

*As built in Phase 6 step 4.8.* The Notes Graph (`src/webview/notesGraph/`) has no `#app`: its template wrote the canvas and its panels straight into the body. So `main.tsx` renders `<GraphBody>` (`controls.tsx`) into `document.body`, ahead of the script, with the template's whitespace between elements as text nodes. It keeps one store and draws synchronously, as [decision 0014](decisions/0014-pages-render-synchronously-from-one-store.md) asks, but not through `startPage`: the indexing line, the busy mark, the disabled-click guard, and Escape's provenance were never on the graph, so it installs the tip alone, and draws Reset's Undo with `<UndoNotice>`.

| Module | What it holds |
| --- | --- |
| `model.ts` | The graph state, one mutable object as the template's closure held it (`GraphState`, `emptyGraphState`), the 23 settings (`GraphSettings`), the edge kinds, and `nodeDegree`, `nodeRadius`, `isRendered`, and `isDimmed` |
| `view.ts` | `buildView`: the nodes and edges a snapshot and the settings draw, headings folded into files when zoomed out, the links each note keeps, the groups and their names, and where each node starts; the search, tag, and group matches; the selection and the hover |
| `simulation.ts` | `tick`, `tickCommunityAnchors`, and `applyRepulsion` (Barnes-Hut) |
| `canvas.ts` | `drawGraph`: one frame, and the group names and centers a click reads |
| `camera.ts`, `status.ts`, `settings.ts` | The camera's zoom, fit, and centering; the status line and the tooltip's words; what is kept with `setState` |
| `graphPage.ts` | The page as it runs (`GraphPage`): the frame loop on `requestAnimationFrame`, the rebuild, the group picked, the selection, and Reset with its Undo |
| `pointer.ts` | The canvas under the pointer and the keyboard, and the tooltip |
| `controls.tsx` | Every control, the zoom controls, the legend, and the status line |

Its groups and the links it draws are `domain/graph/communities.ts`'s (D1): `buildCommunities`, `choosePrimaryTags`, `selectSalientEdges`, `tagMembershipScore`, and `graphEdgeSalience`. Every module is a line-for-line port of the template's script, its arithmetic in the same order, and its canvas calls are held to the template's by recording them on the stepped clock.

The canvas is one element with a ref, outside what Preact changes: the frame loop sizes it and draws into it, and writes the zoom readout and Simulating, which Preact draws once; the pointer writes the tooltip's contents into a box Preact draws empty, and the canvas's own classes. Three things the controls do differently from a page drawn wholly from its store, each because the template did:

- The two search boxes are not controlled. Their settings follow typing after 150 ms, so a draw in between must not put the old text back; they are set only where the template set them, on load, Reset, and Undo.
- The Group list takes its value only where the template set it, so a group kept from before a graph arrives does not empty the list's selection.
- Reset's offer of Undo goes on any later input or change, heard before the control as the template heard it, but drawn by the control's own handler: a draw before the handler would put a checkbox or slider back to the setting it is changing.

What a page written on the core has to know, learned on Stats, the calendars, the Task Board, the search page, the Notes Graph, and Related Notes:

- **The old markup wins.** Write the elements, attributes, and text nodes the template wrote, including the empty `class=""` a choice that is not active carried; `test:dom` and the recorded suites compare them.
- **Key siblings of different kinds.** Preact reuses an element at the same position. A reflected property it then takes away, such as `id`, is set to the empty string rather than removed, so a heading reused for another panel would keep `id=""`. Stats keys its attention panels and its most-viewed panels.
- **A reflected property is emptied, not removed.** When a prop such as `title`, `id`, or `placeholder` goes from set to unset on an element Preact keeps, the element is left with `title=""`. Key siblings that may trade places, as the task row keys each fact it can carry, and key a title by its HTML, so a title that changes is drawn afresh. Write `spellcheck="false"` through the `spellCheck` attribute: Chrome's `spellcheck` property reads the string as true.
- **A list the page changes outside a draw is drawn afresh.** The Task Board moves a card at once, marks it completing, and drags cards and ranked rows; it keys those lists by a count of such changes (`listsChanged` in `src/webview/taskBoard/model.ts`), so the next draw makes them anew, as every template draw did, rather than patching elements the page moved. The search box puts back what it changes between draws, its completion lists and the buttons that need text, in `afterRender`.
- **Write a run of words as the one text node the template wrote.** `test:dom` merges adjacent text, but Chrome lays out the edge between two text nodes apart: the search page's Tasks tab, drawn as `Tasks` and ` (` in two nodes, moved its glyphs a subpixel. Join the words in one string, as `` `${label} (` ``.
- **What a page changes after a draw, it undoes before the next.** The search page marks the searched words after each state, replacing text nodes Preact made, and takes out a Show all whose body fits its three lines. Preact would patch, or insert beside, nodes that are no longer in the page, so the page puts both back before it draws again (`markWords` returns what does it), and Preact finds the page as it drew it. The draw then shows the words unmarked, as every template redraw did, until the next state marks them.
- **A test reads a property where Preact writes one.** A select's chosen option is its `selected` property, which Preact sets; the template wrote the attribute. A test asks the option whether it is selected, which holds on both.
- **What the DOM keeps outside props stays.** Preact compares props with the last ones it wrote, not with the DOM, so a value a page sets directly, such as the pair grid's roving `tabindex`, is not put back by a draw; Stats resets it in `afterDraw`, as each template redraw did. Focus on an element a draw keeps stays where it is, where the template's redraw dropped it.

## CSS and theming

*As built in Phase 6 step 3.* Every rule is in a `.css` file under `src/webview`, bundled by esbuild; the host builds no style text. Pages keep styling with `--vscode-*` variables, which is what Microsoft recommends since the webview toolkit was deprecated. The files were written once from the CSS functions they replace, checked equal to them for every page, theme, and zen state, and are maintained by hand.

| File | What it holds |
| --- | --- |
| `shared/base.css` | Imports the base sheet's parts in cascade order: `designTokens`, `shell`, `typography`, `control`, `tag`, `popover`, `surface`, `taskBoard`, and `taskList` |
| `shared/queryEditor.css`, `shared/calendarDay.css`, `shared/calendar/calendar.css` | Component sheets two or more pages import: the query editor, the calendar's day panel, and the rules both calendars share |
| `<page>/page.css` | Imports `base.css` first, then the component sheets the page uses, then holds the page's own rules. An `@import` must lead a sheet, so Related Notes keeps the rules that come before the day panel in `notes.css` and imports it ahead of `calendarDay.css`, and every rule keeps its place in the cascade. |
| `shared/themes/<theme>.css` | One theme each, `ENABLED` written out; `deckardThemeCss` in `src/ui/webview/components.ts` names each by theme |
| `shared/tail.css` | Imports what every page lays after its theme: `controlEdge`, `provenance`, `highContrast`, `cardTag`, and `zen`, in that order. The card-tag selector lists are written out. |

A sheet names a file of the extension in `url()` by its path from `dist/webview/`, where it is served: the favorite heart is `../../resources/favorite-heart-outline.svg`, which esbuild leaves as written. `getPageTailCss` takes the `PageChrome` (`{ theme, zen }`) as input instead of reading settings. The `previewTheme` global became a `ThemePreview` object owned by the composition root. A theme or zen change still resets the page's HTML, which links the new theme.

## What ships

*Current since Phase 6 step 6.* Preact is the one package the pages ship, and it runs in the sandbox, which has no file system and no network. The host bundle inlines `markdown-it` and its five packages, as the parser of note Markdown ([decision 0015](decisions/0015-note-markdown-tokenized-by-markdown-it.md)), and `picomatch`, which the Phase 0 exclude check kept: seven packages. Before step 6 it also inlined `sanitize-html` and the 15 packages it brought, `postcss` and `htmlparser2` among them; the production `dist/extension.js` went from 1,169,906 bytes to 969,343 when they left, and to 966,943 when step 7 deleted the glyphs and the icon button only the template pages wrote. The pages' scripts are in [the table above](#the-pages-scripts).

Note Markdown in a card or title reaches the page as a token tree, drawn by an `<Inline tokens>` component as elements and text nodes. The host builds the tree in `domain/markdown/inline.ts` and `blockExcerpt.ts` by mapping the tokens of one `markdown-it` instance, configured as the retired `rendering.ts` configured its own, and never asks `markdown-it` for HTML. Nothing is parsed as HTML, so there is nothing to sanitize, and no snapshot carries HTML: `renderedHtml`, `renderedTitle`, and `TableCell.html` are gone. The Markdown preview's query blocks write a title's HTML themselves, from `tokenizeInlineWithoutWikiLinks` (the same instance, without the wiki-link rule, since the preview's HTML has always been `markdown-it`'s reading), byte for byte what `markdown-it` and the sanitizer wrote. The Markdown previews and the debug page share one `escapeHtml` in `src/shared/html.ts`, with `escapeHtmlText` beside it for the query block's text, which leaves quotes as written as the sanitizer did. See [decision 0011](decisions/0011-host-bundle-ships-no-third-party-code.md).
