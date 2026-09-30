# 0011. The host bundle ships no third-party code

**Status:** Accepted (2026-09-30)

## Context

`vsce package --no-dependencies` means esbuild inlines whatever the source imports. Today that is three direct dependencies and 21 transitive packages in `dist/extension.js`, 2.7 MB, all running in the extension host with file-system and network access. Third-party code in the host is the largest attack surface the extension has, and the one an update can shrink. The pages ship no third-party code today.

| Dependency | What it does today |
| --- | --- |
| `markdown-it` | Renders note excerpts and task titles for the pages, and the guide for Help |
| `sanitize-html` | Cleans that HTML, since note content is untrusted and lands in a scripted page |
| `picomatch` | Matches `deckard.exclude` globs in the scanner |

## Decision

- Note Markdown becomes an `InlineToken[]` tree from a small `domain/markdown/inline.ts`, drawn by a Preact `<Inline tokens>` component. Card excerpts render from the parser's existing block structure. Nothing is parsed as HTML, so nothing needs sanitizing.
- Help renders the guide through VS Code's `markdown.api.render`; see [0012](0012-help-renders-through-markdown-api.md).
- The preview plugins import `markdown-it` as a type only, since VS Code's preview passes its own instance.
- `picomatch` gives way to `path.matchesGlob` if the exclude tests agree; see [0013](0013-exclude-globs-and-path-matchesglob.md).

## Consequences

- If all three hold, the only shipped dependency is Preact, one package, in the webview sandbox. The exclude check of [0013](0013-exclude-globs-and-path-matchesglob.md) kept `picomatch`, so the host ships that one package, which has no dependencies of its own.
- The boundary against untrusted Markdown becomes structural rather than a filter.
- Every card in the sample workspace must render the same visible text and emphasis both ways, a comparison made in Phase 0.
- The lockfile, `npm ci`, and `npm audit` stay, since the build-time tree can be attacked too.

## Alternatives considered

- **Keep `markdown-it` and `sanitize-html`.** Seven packages and about twelve more in the most privileged context, for an inline subset Deckard's own parser nearly covers.
- **Keep `picomatch`.** It stays if any exclude pattern behaves differently under `path.matchesGlob`, as the one host dependency left.
