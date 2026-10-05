# 25 · Faster tests and CI, with nothing less checked

David asked whether the tests and CI can be faster without losing
accuracy. Four reviewers looked independently (the pipeline, the unit and
host suites, the browser suites, and accuracy and overlap), read each
other's findings, and converged on this plan.

## Where the time goes

A CI run takes as long as its `validate` job: 18 to 27 minutes (26.6 on
911ffabd). The macOS and Windows jobs take 3 to 5 and are never the
critical path.

| validate step (911ffabd) | Time |
| --- | --- |
| `npm test`: tsc 13s, eslint 27s, depcruise 5s, unit 41s, host 37s + scope labels 18s/25s | 178s |
| test:ui (compile 12s, static contrast 30s) | 46s |
| test:e2e (compile 12s) | 54s |
| test:layout: checkLayout 6.5 min, checkRenderedContrast 6.9 min | 13.5 min |
| test:visual: checkVisual | 7.3 min |
| Build VSIX (check-types again, lint again) | 47s |

About 20 of the 26 minutes are three Chrome passes, run one after another,
each opening a Chrome per page over the same 29 surfaces × 8 themes × zen
(464 pages, 1,392 launches a run). A page costs about 1.7 s whatever it
draws: the cost is starting Chrome. Around that: `tsc` emits five times,
eslint runs twice, and macOS and Windows lint too.

## What the reviewers agreed

- **Run the Chrome passes in parallel jobs.** It changes nothing that is
  checked and takes the run from about 26 to about 8 minutes.
- **Never sample the theme matrix.** 162a7c7c failed only in `corpo+zen`.
- **Close the ways a run passes while checking less.** The Chrome suites
  `exit(0)` when no Chrome is found (`checkLayout.js:54-58`, imported by
  visual and DOM); nothing forbids a committed `.only`; `test/e2e/run.js`
  hard-codes its suite list; `test:dom` never runs on CI; the runner's
  Chrome moves under the Linux baselines.
- **The aggregator must not let a failure merge.** Master's ruleset requires
  the context `validate`. A job with `needs:` is skipped when one it needs
  fails, and GitHub counts a skipped required check as passing, so the
  aggregator runs `if: always()` and fails unless every result is `success`.

## The plan, in order

1. **Split `validate`** (`.github/workflows/ci.yml`). Jobs, all on
   ubuntu-latest:
   - `checks`: check-types (both projects), lint, and depcruise. Type errors
     show in about a minute, not 25.
   - `core`: compile once, esbuild, unit, host and the two scope labels
     under xvfb, test:ui, test:e2e, and the VSIX build (without its second
     lint).
   - `browser`, a matrix of `check` × `shard`: `checkLayout`,
     `checkRenderedContrast`, `checkVisual`, each in 2 shards, and
     `checkDom` (one theme, one job).
   - `validate`: `needs:` all of them, `if: always()`, fails unless each is
     `success`. Its name keeps master's required check.

   About 26 → 6-8 minutes. Keep the total near 12 jobs (a free public repo
   runs 20 at once, and CodeQL, Docs, and Prepare Release share them).
2. **Shard by pass** (`test/ui/checkLayout.js` `passes()`, which visual and
   rendered contrast share): `UI_SHARD=k/n` takes every n-th of the 16
   passes. Keep `UI_CONCURRENCY` at 2 on 4 cores (`chromePool.js:15-23`:
   virtual time drifts under contention).
3. **Check baselines over the whole matrix before any Chrome.** Missing and
   stale visual baseline names, and DOM goldens, from `createSurfaces()` ×
   `passes()` over all 16 passes, in every shard (cheap: no drawing). A
   missing baseline is reported at once, and the shard still draws, records,
   and uploads it, since CI is where Linux baselines come from.
4. **Fail, don't skip, without Chrome on CI**, and **pin Chrome** to the
   version the Linux baselines were recorded with, passed as `CHROME_PATH`.
5. **Compile once.** `compile-tests` incremental (`--incremental
   --tsBuildInfoFile out/.tsbuildinfo`, so a clean `out/` resets it); CI
   calls the `node test/...` scripts after one build; the VSIX step skips
   the lint `checks` already ran.
6. **macOS and Windows run what can differ by OS**: compile, unit, host,
   and the scope labels, without lint (`.gitattributes` forces LF since
   a29712ae). Pin and cache VS Code (`.vscode-test`), keyed on OS and
   version: it removes the download timeout that failed 37241955541.
7. **Silent-pass guards**: `forbidOnly` in the unit runner, the host
   config, and e2e; e2e finds its suites by glob; `test:dom` on CI (its
   goldens are recorded on macOS, so the first Linux run is a trial that
   may record Linux goldens).
8. **Faster unit suites, safely.** Replace fixed real-time waits with
   fake timers in jsdom suites and with polling for a condition in host
   suites (as 434d8fd8 did), keeping one real-timer test per timer path;
   then run unit suites in parallel (`mocha --parallel`, a capped worker
   count on CI). Move `resolveSampleTokens` and `sampleFileName` out of
   `src/ui/commands/sampleWorkspace.ts` into domain, so `indexCorpus.ts`
   stops pulling three suites into the extension host.
9. **Prepare Release cuts on a label or by hand**, not on every push to
   the PR (`prepare-release.yml`), so a bump stops starting a second full
   run that waits for approval.
10. **A nightly full run on dev**, serial unit suites included, so a test
    that leans on another file's state or on the date still surfaces.

## Decided against, or later

- **Dropping the zen pass for the five Display surfaces**: rejected. Zen
  and Display interact (a0f41a1b), and that the two match is the thing
  checked.
- **Selecting tests by import graph on CI**: rejected. CSS, fonts, and
  fixtures are read, not imported. Fine as a local `test:affected`, later.
- **Release reusing the PR's green run** (needs strict up-to-date merging
  on the ruleset, a repository setting): later, with David.
- **Skipping a run whose file tree a green run already tested**: later, if
  at all; it needs the Chrome, VS Code, and runner versions in its key and
  the nightly run first.
- **One Chrome draw for all three checks, and a persistent Chrome over
  `--remote-debugging-pipe`**: the next harness project. It cuts Chrome
  launches from 1,392 to 464, but the probes change the page (the contrast
  probe moves `:hover` rules onto classes, the layout probe hovers and adds
  a `<pre>`, visual forces every board card to draw), so it is only safe
  as screenshot, then layout, then contrast, which needs CDP. It lands
  behind an equivalence run (the same verdicts on every surface, planted
  regressions still failing) and one re-record of every baseline in a
  commit of its own.
- **The three VS Code labels at once**: later; each needs its own user-data
  directory, and macOS has had timing flakes (434d8fd8).

## Correctness gaps found on the way

- e2e was red at 73667813 (`dashboardHome.e2e.js:1010` asserts Zen's
  exact body markers); fixed on dev with the note-entries work.
- Visual baselines are taken after the layout probe hovers the first
  target and appends its report, so a resting row is never compared.
- `active-note-context.test.ts:11` leaves four `deckard-active-*` folders
  in the temp folder every host run.
- CI runs today's VS Code only; `engines` says `^1.134.0`. The nightly run
  adds a host leg at 1.134.
