# 0001. Load page bundles through `asWebviewUri`, not inline

**Status:** Accepted (2026-09-30)

## Context

Each page today is one template literal with its style and script inline, under a nonce. The compiler never sees the page script, and every test harness depends on finding it inline. The official webview guide says its recommended CSP "implicitly disables inline scripts and styles. It is a best practice to extract all inline styles and scripts to external files." GitLens, GitHub Pull Requests, Jupyter, Azure Cosmos DB, and DocumentDB all load their built JavaScript through `asWebviewUri`. None inlines it.

## Decision

Each page's HTML shell links `dist/webview/<page>.css` and loads `dist/webview/<page>.js` with `<script nonce src>`. `localResourceRoots` is `dist/webview`, plus `resources/` where a page uses icons. The style nonce goes, and `style-src` becomes plain `${cspSource}`.

## Consequences

- The page script is ordinary bundled TypeScript, type-checked with the rest.
- Every harness that reads inline assets would pass nothing. One loader, `test/harness/loadPage.js`, inlines the linked files for tests, so every harness sees the same self-contained page it sees today.
- The loader lands in Phase 0, before any page moves, and its cost is measured on Stats first.

## Alternatives considered

- **Bundle, then inline the built script into the HTML.** This was the earlier draft's choice. It keeps the harnesses as they are, but it goes against the guide and every surveyed extension. Inlining survives only inside the test loader.
