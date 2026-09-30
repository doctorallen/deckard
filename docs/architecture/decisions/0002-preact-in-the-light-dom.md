# 0002. Preact 10 in the light DOM

**Status:** Accepted (2026-09-30)

## Context

Every page redraws by assigning one HTML string to `app.innerHTML`, and `renderKeepingPlace` restores the focus and scroll each redraw loses. Every surveyed extension renders declaratively with a library that diffs. Whatever library Deckard picks ships in the VSIX, and shipped code is attack surface. Sizes below are esbuild 0.28, minified and gzipped.

## Decision

Pages are TSX components rendered by Preact 10, into the light DOM, written against Preact's own API. Preact is one package with no transitive dependencies, 4.6 kB per page, and it runs in the webview sandbox. It works under the nonce-only CSP with no `unsafe-inline`, uses native `addEventListener`, and renders in jsdom 30. esbuild compiles TSX natively, so `tsc` checks the markup with no plugin.

Two guards: pin 10.29.x exactly, since 11.0.0 shipped on 2026-09-30 with no track record; and never import `preact/compat`. `@preact/signals` is not adopted.

## Consequences

- The full-page redraw, `renderKeepingPlace`, and the in-page `escapeHtml` go, since text becomes text nodes.
- The light DOM keeps the eight themes, the high-contrast sheets, and the layout, contrast, and visual tests working unchanged.
- Without `preact/compat`, a later move to React stays a rename the compiler drives: `preact` imports to `react`, `onInput` to `onChange`, `class` to `className`.
- Each page is rewritten rather than moved, which makes Phase 6 the largest phase.

## Alternatives considered

- **`lit-html`**, 3.4 kB, one package. The smaller change, since the templates move as they are, but it has no component model.
- **Lit with components**, 6.3 kB. It brings shadow DOM, which theme CSS does not cross; see [0003](0003-no-vscode-elements.md).
- **Svelte 5**, about 18.6 kB of runtime plus a 23-package compiler tree at build time.
- **React 19** with `react-dom/client`, 69 kB across three packages: fifteen times the code, for ecosystem features Deckard does not use.
- **Shadow DOM** with any library. Document-level theme CSS crosses a shadow root only through inherited and custom properties, and jsdom has never implemented `adoptedStyleSheets`.
