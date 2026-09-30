# 0013. Exclude globs stay on `picomatch`

**Status:** Accepted (2026-09-30), from the second Phase 0 check of [the refactor plan](../../implementation/19-refactor.md) (§2.7, §8.4).

## Context

The index leaves out what `files.exclude`, `search.exclude`, and `deckard.exclude` name. [`createExcludeMatcher`](../../../src/core/workspace/scanner.ts) reads those settings the way VS Code reads `files.exclude`: it hands the patterns to `picomatch` with `{ dot: true }`, since VS Code's `*` matches names that start with a dot, and tries every prefix of a path, so a pattern that names a folder also leaves out what is inside it. `parking.ts` uses the same matcher.

`picomatch` is one package, inlined into `dist/extension.js`. The plan's goal is a host bundle with no third-party code (§2.7), and Node has shipped `path.matchesGlob` since 22.5. It takes no options, so the plan made the swap depend on a check: the swap happens only if `path.matchesGlob` on the extension host's Node agrees with `picomatch` on every exclude pattern the tests hold.

## The check

The comparison ran the matcher's prefix rule both ways, once with `picomatch(patterns, { dot: true })` and once with `path.matchesGlob` (and `path.posix.matchesGlob`), over the 11 pattern and path pairs in `src/test/workspace.test.ts` and `src/test/exclude-folders.test.ts`. It ran inside the extension host of VS Code 1.139.1 (Node 24.20.0), where no experimental warning was raised, and again on Node 26.8.1.

| Patterns | Path | Test expects | `picomatch` | `path.matchesGlob` |
| --- | --- | --- | --- | --- |
| `**/archive`, `drafts/*.md`, `scratch/*` | `.trash/archive/old.md` | excluded | excluded | kept |
| `**/archive`, `drafts/*.md`, `scratch/*` | `scratch/.todo.md` | excluded | excluded | kept |
| `notes/\[draft\]` | `notes/[draft]/idea.md` | excluded | excluded | kept |

The other eight pairs agree. The three that disagree have two causes:

- **Names that start with a dot.** `path.matchesGlob` never lets `*` or `**` match a name that starts with a dot, and it takes no option to change that. VS Code does let them, which is why the scanner passes `{ dot: true }`.
- **Escaped brackets.** Deckard's Exclude from Deckard command writes a folder named `[draft]` as the key `notes/\[draft\]`, so the brackets are literal. Node's matcher treats a backslash as a path separator, not an escape, on every platform, so the key no longer names the folder.

Ten more patterns taken from VS Code's defaults and common shapes, such as `**/.git`, `**/{node_modules,.git}`, and `**/[Dd]rafts`, agreed on the 13 paths tried. They were informational; the tests decide.

## Decision

`picomatch` stays. It is the one third-party package left in the extension host after Phase 6, and the plan's Phase 1 drops the swap.

## Consequences

- The host bundle ships one third-party package, `picomatch`, which has no dependencies of its own. Decision [0011](0011-host-bundle-ships-no-third-party-code.md) holds with that one exception.
- The exclude tests keep pinning the two behaviors Node lacks, so a later attempt to swap would fail them rather than change which notes are indexed.
- Writing Deckard's own glob matcher was not considered worth it. It would have to reproduce VS Code's glob dialect, braces and classes included, and that is more code to own than one small, dependency-free package.

## Alternatives considered

- **`path.matchesGlob` with the dot rule worked around**, for example by trying each pattern again with every `*` rewritten. That is a second glob dialect to maintain, and it does not fix the escaped brackets.
- **VS Code's `RelativePattern` and `workspace.findFiles`.** They match files on disk, not a path the scanner already holds, and would tie the pure matcher to `vscode`.
