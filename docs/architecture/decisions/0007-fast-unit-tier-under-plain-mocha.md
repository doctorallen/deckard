# 0007. A fast unit tier under plain mocha

**Status:** Accepted (2026-09-30)

## Context

Every test runs in the extension host today. The only runner is `vscode-test`, over 139 mocha files and 1,331 tests, of which 67 files never import `vscode`. The pure parser, evaluator, and state suites boot Electron with a 20-second timeout to test pure functions. A file that does not import `vscode` may still reach it through what it imports, and nobody has computed which suites could run without it.

## Decision

`npm run test:unit` runs plain mocha over the suites whose modules never reach `vscode`, and `pretest` runs it first. dependency-cruiser decides which modules qualify, from the same rules `npm run lint` enforces. `npm test` keeps the suites that need the host.

## Consequences

- The pure suites run in seconds instead of minutes.
- The set grows as the layers are fixed: after Phase 2, the indexer, scanner, preferences, evaluator, and ranking tests join it.
- A module that comes to import `vscode` leaves the fast tier by rule, rather than failing mysteriously under mocha.
- Two runners must be kept working.

## Alternatives considered

- **Keep one runner.** Simpler, but every pure test keeps paying for an Electron start.
- **A hand-kept list of fast suites.** It drifts. The dependency rules already know which modules reach `vscode`.
