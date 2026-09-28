# Fixes
- A `[[link]]` written inside inline code still counts as a link: it shows in Linked from, backlinks, the `link` search field, link health, and the Notes Graph. Tags already skip inline code (`findCodeAndLinkRanges` in `src/core/markdown/inlineRanges.ts`); the link extraction in the parser should skip the same code ranges, and the parse-format marker in the cache fingerprint must be bumped with it. The sample's `07 Links.md` describes its Try it link in words rather than code because of this.

# Improvements
- Later: move each webview's page script into TypeScript modules bundled by esbuild, with typed state and messages, so the pages are type-checked like the rest of the source. For now `npm run test:ui` type-checks and lints the generated scripts instead, which catches unknown names, redeclarations, syntax errors, and wrong argument counts but not type errors.

  The pages are big: about 12,000 rendered lines of script, of which roughly 1,960 are the shared layer (`getComponentScript` and `getQueryEditorScript`) injected into every page, so no page can move on its own.

  Done so far: `src/test/webviewPage.ts` runs a rendered page in jsdom with a stand-in for the webview API, so a page is tested by what it draws and what it posts, and no test matches script source any more — the checks that did are gone. `test/ui/checkLayout.js` lays the pages out in a real browser, so a bundler rewriting the text has that to answer to as well.

  Next: move the shared layer into a typed module emitted as its own bundle, with `getComponentScript` reading it, which leaves the string-building pages working while they are migrated one at a time.

# Features
- Calendar: show every date a repeating task falls on in the weeks drawn, not only its next one, and open the calendar, with its day panel, as a full page of its own. Planned in `docs/implementation/18-calendar-page.md`.
- Calendar: when a week or month is clicked and Deckard asks whether to create its note, offer **Create Review** as a second action beside creating the note, so the review for that week or month is written from the same prompt rather than by opening the note first and running the review afterwards.

# Themes
