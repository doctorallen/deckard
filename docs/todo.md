# Fixes

# Improvements
- Later: move each webview's page script into TypeScript modules bundled by esbuild, with typed state and messages, so the pages are type-checked like the rest of the source. For now `npm run test:ui` type-checks and lints the generated scripts instead, which catches unknown names, redeclarations, syntax errors, and wrong argument counts but not type errors.

  The pages are bigger than this note used to say: about 12,000 rendered lines of script, of which roughly 1,960 are the shared layer (`getComponentScript` and `getQueryEditorScript`) injected into all seven pages, so no page can move on its own. A bundler rewrites the text, so the 453 remaining checks in `src/test/messages-rendering.test.ts` that match script source have to go first.

  Started: `src/test/webviewPage.ts` runs a rendered page in jsdom with a stand-in for the webview API, so a page can be tested by what it draws and what it posts. Two suites use it — `search-page-behavior.test.ts` and `related-notes-behavior.test.ts` — and the script-text checks they replace are gone. The first of them found a Show more button that was built and never placed in its pane, which every source-text check had passed.

  Next: keep converting, page by page, until nothing matches script source; then move the shared layer into a typed module emitted as its own bundle, with `getComponentScript` reading it, which leaves the string-building pages working while they are migrated one at a time.
- ~~The Dashboard's Notes tab is still sent, and draws, every note on each save: about 9.9 MB at 940 notes in the Markdown view. Page or virtualize that list if it shows up in Deckard's log.~~ Done, on search pages, where the list moved: a page carries 200 notes and 200 tasks and asks for the next batch, so its payload is about 0.54 MB in the source view whatever the workspace holds, rather than 4.3 MB at 940 notes and growing with it. Building the snapshot still costs a pass over every section, about 1.1 s at 5,000 notes; that is the evaluator, not the channel.
- ~~The first build of the search cache, in a new workspace or after the cache is cleared, still writes every note synchronously on the extension host: about 140 ms at 940 notes and 820 ms at 5,000. Rescans are incremental now. Move the store to a worker thread if that first build shows up as Slow in Deckard's log.~~ Done: the writing goes to a worker thread, leaving the host 14 ms at 940 notes and 45 ms at 5,000, both under the Slow threshold. The host still compares the scan against the cache and splits each note into its rows, which together are about 3% of the cost; searching stays on the host, where every caller wants its answer at once.

# Features

# Themes
