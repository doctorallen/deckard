# Fixes
- Selecting a heading's "entries share a tag" count opens Related Notes from the saved index, so in an unsaved note whose lines moved it asks to save first. Look the heading up in the live text, as the count does.
- Decide whether the AI assistant tools should be off by default, or ask the first time they run, since Copilot sends what they return to its cloud model. `deckard.assistantTools` is on by default.

# Improvements
- need to do a style consistency pass, there are small inconsistencies all over
- componentize UI elements
- DQL (deckard query language). A more advanced filtering that allows for AND/OR operators, paranthesis, etc.
- Move each webview's page script out of template strings into a TypeScript file bundled by esbuild, so it is type-checked and linted. `notesGraphHtml.ts` (1,934 lines), `dashboardHtml.ts` (1,334), and `tagOverviewHtml.ts` (1,286) are mostly inline script, and a `\b` swallowed by a template string has already shipped as a bug.
- Split `src/ui/state/dashboardState.ts` (2,446 lines): move the Related Notes ranking and the word-similarity model out of the Dashboard and Tag Overview projections.
- Test the sidebar skipping a re-rank while the cursor stays in one entry (the e2e stub needs a selection event), hidden panels catching up when shown, and the tag decoration debounce.
- Rename the sidebar view from "Deckard" to "Related Notes"; inside the Deckard container its pane header repeats "Deckard".
- A visible Dashboard takes about 0.7 s to redraw after each save at 940 notes. Update it in place, or virtualize its lists.
- Group the ~30 settings into titled sections in `package.json`.
- The SQLite search store (`node:sqlite` `DatabaseSync`) rebuilds synchronously on every full scan and blocks the extension host while it does. Watch "Rebuild search index" in Deckard's log on large workspaces, and move it off the main thread if it shows up.
- Remove the unused `eslint-disable` directive at `src/test/query-builder-webview.test.ts:289`, the one lint warning.
- Add `.DS_Store` and `.claude/` to the repo's `.gitignore`; today only a global gitignore keeps them out.
- Remove the stray `- [ ] do something about` task from `development/notes/2026-08-26.md`; it shows in the README screenshots.
- Cut a release: the CHANGELOG's Unreleased section is long for version 1.8.0.
- Created and updated dates, used for sorting and the `created` and `updated` query fields, still come from file timestamps, which a git clone resets. Consider daily-note and front-matter dates there too, as loose task dates now do.

# Features
- Quick capture and templates (`docs/improvements.md` #3): `Deckard: Capture` to add a task to today's note without leaving the editor, a templates folder with `{date}`, `{title}`, and prompted values, and a template per namespace for new hub notes.
- Link health and aliases (#4): unresolved `[[links]]` as diagnostics with a Create note quick fix, notes nothing links to in Stats, and `aliases:` front matter when resolving links.
- Periodic notes and a calendar (#6): weekly and monthly notes, previous and next daily-note commands, and a sidebar calendar marking days with notes or due tasks.
- A local MCP server, protected by a token, so Claude Code and other MCP clients can use the same query and tag tools Copilot has.

# Themes
interstellar - called "cooper"
