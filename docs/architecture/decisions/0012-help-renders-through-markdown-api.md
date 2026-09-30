# 0012. Help renders the guide through VS Code's `markdown.api.render`

**Status:** Accepted (2026-09-30), from the first Phase 0 check of [the refactor plan](../../implementation/19-refactor.md) (§2.7, §8.4).

## Context

Help shows the pages of `docs/guide/` inside its panel. Today [`guide.ts`](../../../src/ui/webview/guide.ts) renders them with `markdown-it`, rewrites their links and images for the panel, and passes the result through `sanitize-html`. Those two packages and the 21 they pull in are inlined into `dist/extension.js` and run in the extension host. The guide is Deckard's own content, shipped in the VSIX, so the sanitizer guards nothing there.

VS Code's built-in Markdown extension exposes a command, `markdown.api.render`, that turns a Markdown string into HTML with the engine every preview uses. The plan chose it for Help, pending a check that it is reachable from the extension host and renders the guide acceptably. The alternative was rendering the guide at build time.

## The check

A throwaway extension ran inside VS Code 1.139.1 on macOS (Electron 43.6.0, Node 24.20.0), launched by `@vscode/test-electron` once with `--disable-extensions`, as the test runner launches it, and once without. For each of the 17 pages in `docs/guide/` it called `markdown.api.render` and Deckard's own `renderGuidePage`, then compared the two.

| Question | Answer |
| --- | --- |
| Does the command exist in the extension host? | Yes, with or without `--disable-extensions`, which leaves built-in extensions running. |
| Is it listed by `vscode.commands.getCommands()`? | No. It is an internal command the Markdown extension registers without contributing it. |
| Does it activate the Markdown extension? | Yes. The first call took about 500 ms while the extension activated; each page after that took 1 to 10 ms. |
| Is the visible text the same? | Yes, on all 17 pages, once tags are removed and whitespace is collapsed. |
| Are the heading ids the same? | Yes, on all 17 pages. Both follow GitHub's slugs, so links written for GitHub still land. |
| Is the raw HTML in the pages kept? | Yes. The themes page's screenshot table renders with the same nine images. |

The output differs from Deckard's in ways the panel would have to handle:

- Links and images come back as written, such as `href="settings.md#settings"` and `src="../images/dashboard-corpo.png"`. Deckard's rewriting of them, into `data-guide-page` attributes and GitHub image URLs, has to run over the HTML the command returns.
- Every block carries `data-line`, `class="code-line"`, and `dir="auto"`, and each link repeats its target in `data-href`.
- Code blocks come back highlighted, as `hljs-*` spans. They look the same only while Help's stylesheet gives those classes no color.
- The output opens with an empty `<span id="markdown-mermaid">` that carries the preview's Mermaid settings.

## Decision

Help renders the guide through `markdown.api.render` in Phase 6, as planned. The check passed: the command is reachable, and the guide reads the same.

## Consequences

- `markdown-it` and `sanitize-html` leave the host bundle once the pages stop using `rendering.ts` too (§2.7).
- Link and image rewriting moves from `markdown-it` tokens to the returned HTML. It stays Deckard's code and gains a test over every guide page.
- Three risks come with an internal command, and Phase 6 must handle each:
  1. The command is not documented, so a VS Code release can change it or its output, as the Mermaid span shows it already has. A test that renders every guide page in the extension host and checks the text and ids catches that.
  2. A reader can disable the built-in Markdown extension. Deckard's `markdown.markdownItPlugins` contribution already depends on it, but Help must still say something useful then, such as a link to the page on the site, rather than stay blank.
  3. The first call waits for the Markdown extension to activate, about half a second. Help can render the page it opens on after it shows, rather than before.
- If any of these proves worse than expected, the fallback stays open: render `docs/guide/*.md` at build time into `dist/guide/*.html` with a build-only `markdown-it`, which also ships no parser.

## Alternatives considered

- **Build-time rendering.** Ships no parser and no dependency on the built-in extension, and the rewriting runs once at build time. It adds a build step and a second copy of every page in the VSIX. It remains the fallback.
- **Keeping `markdown-it` and `sanitize-html` for Help alone.** Keeps 23 third-party packages in the extension host for trusted content, against decision [0011](0011-host-bundle-ships-no-third-party-code.md).

## How to repeat the check

The probe is a `package.json` with only an `engines` field as the extension, and a tests module whose `run()` calls `vscode.commands.executeCommand('markdown.api.render', source)` for each guide page, requires `out/ui/webview/guide.js` for `renderGuidePage`, and writes both outputs to disk. It runs with `runTests({ version, extensionDevelopmentPath, extensionTestsPath, launchArgs: ['--disable-extensions'] })`. It was not run on VS Code 1.134, Deckard's minimum, because the machine had no disk space for a second download. The command dates from well before 1.134, but Phase 6's host test should run on the minimum version too.
