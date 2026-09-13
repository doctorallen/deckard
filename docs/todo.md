# Fixes

# Improvements
- Later: move each webview's page script into TypeScript modules bundled by esbuild, with typed state and messages, so the pages are type-checked like the rest of the source. For now `npm run test:ui` type-checks and lints the generated scripts instead, which catches unknown names, redeclarations, syntax errors, and wrong argument counts but not type errors. The pages hold about 4,800 lines of script (the Notes Graph 1,771, the Dashboard 1,133, the Tag Overview 1,067), and about 400 checks in `src/test/messages-rendering.test.ts` match script source text, so they would need rewriting as behavior tests first.
- The Dashboard's Notes tab is still sent, and draws, every note on each save: about 9.9 MB at 940 notes in the Markdown view. Page or virtualize that list if it shows up in Deckard's log.
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
