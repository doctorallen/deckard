# Fixes

# Improvements
- Later: move each webview's page script into TypeScript modules bundled by esbuild, with typed state and messages, so the pages are type-checked like the rest of the source. For now `npm run test:ui` type-checks and lints the generated scripts instead, which catches unknown names, redeclarations, syntax errors, and wrong argument counts but not type errors.

  The pages are big: about 12,000 rendered lines of script, of which roughly 1,960 are the shared layer (`getComponentScript` and `getQueryEditorScript`) injected into every page, so no page can move on its own.

  Done so far: `src/test/webviewPage.ts` runs a rendered page in jsdom with a stand-in for the webview API, so a page is tested by what it draws and what it posts, and no test matches script source any more — the checks that did are gone. `test/ui/checkLayout.js` lays the pages out in a real browser, so a bundler rewriting the text has that to answer to as well.

  Next: move the shared layer into a typed module emitted as its own bundle, with `getComponentScript` reading it, which leaves the string-building pages working while they are migrated one at a time.
- An evaluation fixture for Related Notes ranking: one oversized daily note with generic headings, nested tagged headings, tagged prose, nested tasks, front matter, and fenced code, beside direct-match, ancestor-only, association, link, keyword-only, and unrelated candidates, with common tags such as `#daily` that should not dominate. Measure Precision@5, since a sidebar is chosen from its first screen. The ranking is documented in `related-notes-associations.md`; nothing measures it.

# Features

# Themes
