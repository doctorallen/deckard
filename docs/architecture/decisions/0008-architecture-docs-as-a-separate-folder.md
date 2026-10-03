# 0008. Architecture docs as a separate folder, not guide pages

**Status:** Accepted (2026-09-30)

## Context

`deckard.esperinnovations.com` is built by `.github/workflows/docs.yml` from `docs/guide` alone. Nothing public explains the design. The guide ships in the VSIX, where Help shows it, and `guide.test.ts` requires every `docs/guide/*.md` to be registered in `GUIDE_PAGES` and shipped. Architecture pages are for contributors, and belong in neither.

## Decision

The architecture section lives in `docs/architecture/`. `docs.yml` stages it beside the guide and gains a path trigger for it. `_config.yml` gains a "How Deckard is built" nav group, and the site header links **Guide** and **Architecture**. Diagrams are Mermaid, loaded by the site layout, and every diagram is backed by prose.

## Consequences

- Architecture pages never ship in the VSIX, and never need a Help entry.
- The pages are kept current in the same change as the code, as Help and the guide are.
- The site build has two sources to stage.

## Alternatives considered

- **Guide pages.** Rejected because the guide ships to every user and is tested as user documentation.
- **Docs only in the repository.** Rejected because the goal is a published page on how Deckard is built.
