# Architecture decisions

**Status: target.** These records describe the choices behind [the refactor plan](../../implementation/19-refactor.md), made before the code that carries them out; each phase keeps them current.

An architecture decision record is one short page about one choice that could reasonably have gone the other way. It says what was decided and why, so a later contributor can tell a deliberate choice from an accident. It also records what was rejected, so the same question is not reopened without new facts.

## Format

Each record fits on one screen and has five parts:

| Part | What it says |
| --- | --- |
| Status | Proposed, Accepted, or Superseded, with the date. A superseded record links to the one that replaced it |
| Context | The problem, and the facts that bear on it |
| Decision | What Deckard does, in a few sentences |
| Consequences | What follows from the decision, including its costs |
| Alternatives considered | What else was weighed, and why each lost |

A record is not edited to change its decision. A new record supersedes it instead, so the history of the reasoning survives.

## Index

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-load-page-bundles-through-aswebviewuri.md) | Load page bundles through `asWebviewUri`, not inline | Accepted |
| [0002](0002-preact-in-the-light-dom.md) | Preact 10 in the light DOM | Accepted |
| [0003](0003-no-vscode-elements.md) | No `@vscode-elements/elements` | Accepted |
| [0004](0004-hand-written-message-narrowing.md) | Hand-written message narrowing, one table, no validation library | Accepted |
| [0005](0005-inert-json-for-initial-state.md) | Inert JSON for initial state | Accepted |
| [0006](0006-retain-context-only-for-live-editing-state.md) | `retainContextWhenHidden` only where live editing state exists | Accepted |
| [0007](0007-fast-unit-tier-under-plain-mocha.md) | A fast unit tier under plain mocha | Accepted |
| [0008](0008-architecture-docs-as-a-separate-folder.md) | Architecture docs as a separate folder, not guide pages | Accepted |
| [0009](0009-constructor-injection-and-result-objects.md) | Constructor injection into a plain `Services` object, and result objects | Accepted |
| [0010](0010-feature-modules-with-promise-allsettled.md) | Feature modules run with `Promise.allSettled` | Accepted |
| [0011](0011-host-bundle-ships-no-third-party-code.md) | The host bundle ships no third-party code | Accepted |
| [0012](0012-help-renders-through-markdown-api.md) | Help renders the guide through VS Code's `markdown.api.render` | Accepted: the Phase 0 check passed |
| [0013](0013-exclude-globs-and-path-matchesglob.md) | Exclude globs stay on `picomatch` | Accepted: `path.matchesGlob` failed the check |
