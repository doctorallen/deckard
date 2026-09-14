# Fixes

# Improvements
- Later: move each webview's page script into TypeScript modules bundled by esbuild, with typed state and messages, so the pages are type-checked like the rest of the source. For now `npm run test:ui` type-checks and lints the generated scripts instead, which catches unknown names, redeclarations, syntax errors, and wrong argument counts but not type errors. The pages hold about 4,800 lines of script (the Notes Graph 1,771, the Dashboard 1,133, the Tag Overview 1,067), and about 400 checks in `src/test/messages-rendering.test.ts` match script source text, so they would need rewriting as behavior tests first.
- The Dashboard's Notes tab is still sent, and draws, every note on each save: about 9.9 MB at 940 notes in the Markdown view. Page or virtualize that list if it shows up in Deckard's log.
- The first build of the search cache, in a new workspace or after the cache is cleared, still writes every note synchronously on the extension host: about 140 ms at 940 notes and 820 ms at 5,000. Rescans are incremental now. Move the store to a worker thread if that first build shows up as Slow in Deckard's log.

# Features

# Themes
