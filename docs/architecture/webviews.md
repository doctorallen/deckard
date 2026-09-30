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

`WebviewHost<TSnapshot, TMessage>` owns the lifecycle that each panel writes for itself today, in 60 to 110 lines. That covers create, restore, the serializer registration, the stale-when-hidden refresh, following the index, theme and settings subscriptions, writing through the index, and disposal.

Each page supplies a `PageController`:

| Member | What it supplies |
| --- | --- |
| `buildSnapshot()` | Everything the page draws, as data |
| A handler map keyed by message type | One adapter per message, under the rules in [services.md](services.md) |
| Panel options | What the page needs from its webview |

Messages that many pages share, such as theme, zen, `openSource`, and `openTag`, are handled once in `sharedHandlers`. `openSource` and `openTag` go through `NavigationService.resolveSourceLocation`, so the four rules for what may open become one. The three `Active*` registries become one `ActiveSource<T>`. Host code lives in `src/ui/webview/host/`, and each page's controller and snapshot builder in `src/ui/webview/pages/<page>/`.

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
