# 0018. Exclude globs are matched by Deckard's own matcher

**Status:** Accepted (2026-11-18). Supersedes [0013](0013-exclude-globs-and-path-matchesglob.md).

## Context

[0013](0013-exclude-globs-and-path-matchesglob.md) kept `picomatch` for the exclude globs, because `path.matchesGlob` lets no `*` match a name that starts with a dot and reads `\` as a separator, and because a matcher of Deckard's own seemed more code to own than one small package.

On 2026-11-18, `npm audit` began reporting GHSA-fc5q-39xc-vjpf against `picomatch`: a high-severity ReDoS through single-branch repeated extglobs, with no fixed version. CI runs `npm audit --omit=dev --audit-level=high` before anything else, so every build failed, master's included. The patterns come from the reader's own `files.exclude`, `search.exclude`, `deckard.exclude`, and parked folders, so the risk was small, but the only ways to a green build were an exception to the audit or a matcher that is not `picomatch`.

VS Code's dialect for these settings is small: `*`, `?`, `**`, `{a,b}`, and `[...]` with `[!...]` to negate. It has no extglobs, so the code the advisory is about serves nothing a reader can write that VS Code would honor.

## Decision

[`src/core/workspace/glob.ts`](../../../src/core/workspace/glob.ts) matches the exclude globs, and `picomatch` leaves the extension's dependencies.

- It covers VS Code's dialect and the two behaviors 0013 pinned: `*` and `**` match a name that starts with a dot, and `\` escapes the next character, so `notes/\[draft\]` names the folder `[draft]`.
- It uses no regular expressions. Braces are expanded first, at most 1,024 ways. Each pattern is then matched a segment at a time with the two-pointer wildcard algorithm, with `**` as the star over whole segments, so a match takes time bounded by the pattern's length times the path's.
- Extglob characters and a leading `!` are literal, as in VS Code.

## Consequences

- The host bundle ships `markdown-it` and its five packages, and no other third-party code; `scripts/check-bundle-inputs.js` no longer allows `picomatch`. It stays in the lockfile only as a dev dependency of `dependency-cruiser` and `tinyglobby`, which `npm audit --omit=dev` leaves out.
- Against `picomatch(pattern, { dot: true })`, on 720,000 random pattern and path pairs in the shared dialect, the two agreed every time. They differ on `[!a]`, which `picomatch` read as `!` or `a`, and Deckard reads as any character but `a`, as VS Code documents.
- Matching stays case-sensitive on every platform, as it was under `picomatch`. VS Code is case-insensitive on Windows and macOS; that difference predates this decision.
- Deckard now owns about 250 lines of matcher and its tests, in [`src/test/glob.test.ts`](../../../src/test/glob.test.ts), which also time patterns built to backtrack.

## Alternatives considered

- **Keep `picomatch` with `noextglob: true`, and add an audit exception.** The vulnerable code would never run, but the advisory names the package, so the exception would have to be kept and reviewed, and the host would still ship a third-party package.
- **`minimatch`.** Another dependency, with its own history of ReDoS advisories.
- **`path.matchesGlob`.** Ruled out by 0013's check, and nothing about it has changed.
