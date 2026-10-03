# 0016. Each Preact page loads one bundle of its own

**Status:** Accepted (2026-10-01)

## Context

Every Preact page carries Preact and the parts of `src/webview/shared` it uses. Open question 3 of [the webviews plan](../../implementation/20-webviews.md) asked whether each page should keep doing that (A), or load one shared bundle of Preact and the whole shared core beside a page bundle that holds only the page (B). The rule was set before anything was measured: B only if it saves more than 100 KB in the VSIX, or more than 10 ms of Chrome first render on a page.

Step 4.2 measured it on Stats alone, where B could save nothing, and chose A until a second page shared a large part with another. That happened at step 4.5: the search page and the Task Board both carry the query editor, and the shared core is 64.5 KB of the search page's minified bundle and 68.1 KB of the board's, most of it the editor. `scripts/measure-page-bundles.js` measured both again, with Stats, and every Preact page at once for the VSIX.

| | A | B |
| --- | --- | --- |
| The five Preact page scripts, minified | 328.4 KB in 5 files | 188.5 KB in 6 files |
| The same, gzip | 109.7 KB | 63.3 KB |
| VSIX, zipped again with `zip -9` | 1,536.7 KB | 1,491.2 KB |
| Search page first render in Chrome, median of 10 | 83.3 ms | 86.6 ms |
| Task Board first render in Chrome | 66.3 ms | 70.3 ms |
| Stats first render in Chrome | 49.7 ms | 54.6 ms |

Each page's own numbers, with jsdom's, are in [webviews.md](../webviews.md#one-bundle-per-page).

## Decision

A: each Preact page loads one script, `dist/webview/<page>.js`, holding Preact, what the page uses of `src/webview/shared`, and the page. The build stays as it is, with nothing new in the loader or the shell.

## Consequences

- B saves 45.5 KB of the VSIX, under half the 100 KB the rule asks for. The pages still to move, Related Notes and the Dashboard, will raise it; the Dashboard carries the query editor too. If that ever crosses 100 KB, this is measured again with the same script and rule, and a new record supersedes this one.
- B draws every page later, by 3 to 5 ms: its shared bundle holds all of the core, since it cannot know which page will load it, so each page parses code it does not run.
- A page's script holds its own copy of Preact. Two copies can never meet on one page, since each page loads one script.
- A page is one request, as it was before Phase 6.

## Alternatives considered

- **B, a shared bundle.** Smaller in the VSIX, but by less than the rule asks, slower to draw on every page measured, and it needs a plugin in the build and a second script in every shell.
- **Code splitting with ES modules.** esbuild splits shared code into chunks only for `format: 'esm'`. The pages are `iife` bundles under a nonce-only policy, and module scripts would change how every page is loaded and tested, for a saving no larger than B's.
