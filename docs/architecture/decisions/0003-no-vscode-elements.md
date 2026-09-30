# 0003. No `@vscode-elements/elements`

**Status:** Accepted (2026-09-30)

## Context

`@vscode/webview-ui-toolkit` was deprecated on 6 January 2025 with no official successor. `@vscode-elements/elements`, at v2.5.1, is the community alternative. It is alive, and built on Lit with shadow-DOM components. Deckard styles its pages with its own eight themes and high-contrast sheets, applied as document-level CSS over `--vscode-*` variables.

## Decision

Deckard does not adopt `@vscode-elements/elements`. Its controls stay plain HTML, rendered by Preact into the light DOM and styled by Deckard's own CSS.

## Consequences

- The themes keep reaching every control, since no shadow root stands between them.
- The layout, contrast, and visual tests keep working, and so do jsdom tests, which cannot handle `adoptedStyleSheets`.
- No second shipped package arrives with the controls.
- Deckard keeps writing its own controls, as it does today.

## Alternatives considered

- **Adopt the library for its ready-made controls.** Rejected because shadow-DOM components work against Deckard's own themes. Microsoft's stated position after the toolkit is plain HTML styled with `--vscode-*` variables, which Deckard already does.
