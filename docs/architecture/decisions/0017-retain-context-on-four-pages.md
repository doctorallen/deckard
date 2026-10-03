# 0017. `retainContextWhenHidden` on four pages: those whose live state cannot be saved, or is costly to rebuild

**Status:** Accepted (2026-10-02), as decided for open question 1 of [the webviews plan](../../implementation/20-webviews.md) on 2026-10-01. Supersedes [0006](0006-retain-context-only-for-live-editing-state.md).

## Context

[0006](0006-retain-context-only-for-live-editing-state.md) kept `retainContextWhenHidden` only for the Dashboard's query editor and the Task Board's drag. Phase 6 then found two more pages that 0006 did not weigh. The search page carries the same query editor as the Dashboard, so a half-built query would be lost on hide. The Notes Graph runs a simulation that would restart on every reveal: its nodes jump and settle again, and a large graph spends CPU each time. Its whole-workspace graph also takes 1.4 s to build on 5,000 notes, and its message is about 40 MB.

A page that is not kept running is drawn again when it is shown. Since Phase 6, a page that reads inert state has its HTML set again when it is hidden, carrying the last snapshot it was sent (Q2). What the reader chose in it comes back from `setState`.

## Decision

Four pages keep `retainContextWhenHidden`:

| Page | Why it is kept |
| --- | --- |
| Dashboard | Its query editor holds a half-built query, its caret, and its builder rows, and Home may be mid-arrangement. None of these can be saved quickly at the moment of a hide. |
| Search page | The same query editor, half built in its box. |
| Task Board | A drag in progress (pointer capture, the dragged card's linger) and the same query editor. |
| Notes Graph | Its simulation would restart on every reveal, its nodes jumping and settling again. The graph it would need again is the costliest snapshot Deckard builds. |

Six pages drop it, and keep what the reader chose in them with `setState`:

| Page | What it keeps, and why that is enough |
| --- | --- |
| Stats | `{ showAllOrphans, showUsedOnce, pairsAsTable, scrollY }`. Its snapshot is redrawn from the last one sent (Q2). |
| Help | `{ guide?, scrollY, drawn }`. Its body is static and host-built, and a guide page is asked for again when it is shown. |
| Calendar page | `{ layout, scrollY }`. Its month is cheap enough to build into its HTML (Q3). |
| Calendar view | Nothing, as before. Its month is in its HTML. |
| Related Notes | The reader's choices and its scroll (row 24b of the persisted-formats inventory). It is drawn again from the last state it posted, and a reveal ranks at most once: not at all when nothing changed while it was hidden. |
| Related Notes debug page | Nothing. It runs no script and draws one entry's evidence whole in its HTML, so it only comes back at the top with its calculations folded. |

The stale refresh on `onDidChangeViewState` stays everywhere, kept or not.

## Consequences

- Six hidden webviews no longer hold their whole script context in memory, both sidebar views among them.
- Each dropped page must save and restore its own UI state. Those `setState` shapes are persisted formats that an upgrade must keep reading; the inventory lists them.
- A dropped page reloads when shown. Q2 keeps that reload on the page's last content rather than its loading line, at the cost of setting its HTML once more when it is hidden.
- A page that ranks or builds expensively when shown must avoid doing it twice: once for the reveal and again for the `ready` of the page VS Code loads. Related Notes reuses the state it last posted while nothing it depends on has changed.

## Alternatives considered

- **0006's list, the Dashboard and the Task Board only.** It would lose a half-built search on the search page, and would restart the graph's simulation on every reveal.
- **Keep it on every page.** This is the memory cost the guide warns against, for state that `setState` can hold.
- **Drop it everywhere.** A query editor or a drag in progress holds live state that cannot be saved quickly, and the graph would rebuild its most expensive snapshot on each reveal.
