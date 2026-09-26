# UX implementation plan

The build plan for `ux-fifteen-sources-plan.md`, written on 2026-09-25 at
`726d23b` on `dev` (v1.22.0). Seventeen planners each took one workstream,
checked every claim in it against the source, and wrote the design, the
exact wording, the files, the tests, and the commits. Their plans are in
[`implementation/`](implementation/); this document puts them in order,
settles where they disagree, and lists what is left for David to decide.

## Executive summary

**What changes, in one paragraph.** Deckard gets quieter and more
trustworthy. Old overdue tasks stop shouting and move to "Needs a new
date"; finished work is shown, not just removed. Search results become
three rendered lines that can be scanned, with subtle tags instead of
buttons. Every date box reads the same plain words and says back the day it
read. `[[links]]` become searchable, and a tag's page finds its other
spelling and the notes that link to it. Find and Capture remember what you
use and act without leaving. The editor gains a title-bar menu, a
right-click submenu, a done toggle, overdue hints on the line, and a word
count, while keeping its tag boxes. Every failure message says what to do
next. Saving a note at 5,000 notes drops from about half a second of
blocked work to under 30 ms, and a reopened workspace shows its notes at
once. New capabilities follow: parked notes, grouping tasks by any tag
namespace, a calendar day panel, breaking a task into steps, and Related
Notes for untagged notes.

**The highlights a user will notice**

- **Nothing silently lost.** Planning found data-loss bugs the research
  missed; they ship first (Phase 1).
- **Tasks without the pile.** Tasks more than 30 days overdue move to a
  folded, neutral **Needs a new date** group and leave the status bar count
  and its warning color. Overdue stays first, newest slip on top, five rows
  and "Show 12 more". A **Done today** group, per-day Upcoming groups, Home
  tiles for Overdue / Due today / Open, "Spread over the next 5 days", and
  rollover under a **Carried over** heading.
- **Search pages you can read.** Rendered by default; three lines per card
  with the matching paragraph when the words are further down; five values
  per Refine facet; tags on cards drawn as quiet monospace text; **Copy as
  live query block**.
- **One date language.** "oct 3", "next week", "end of month", "last
  friday", "3 days ago" work in every date box and in capture, with
  "Monday 2026-09-28 · in 3 days" said back. Searches take `this-week`,
  `last-month`, `2026-08`, and weekday names. A week-start setting.
- **Links you can search.** `[[Atlas]]` in any search; "Also written as
  #proj/atlas" with Merge on a tag's page; `is:daily`; grouped Linked from;
  "Links that open no note" on Stats.
- **Find and Capture that remember.** Recently opened counts every open;
  pinned notes first; ⌘Enter opens beside; complete a task from Find;
  **Move to…** refiles a line, a task, or a selection.
- **An editor for writing.** A Deckard title-bar menu, a right-click
  submenu, ⌘⇧⌥X to toggle done, "overdue 5 days" at the end of a task line,
  more repeat rules with quick fixes, a word count, and an Outline that
  shows "2/5 · ↩3" and can focus one section.
- **Messages that say what to do.** One voice, one severity rule, an
  **Open Log** button instead of raw errors, setting names in words.
- **Fast at scale.** Instant card moves, busy-but-open Find during
  indexing, a 90% smaller Dashboard payload, an incremental index, a warm
  start from cache, and a graph that no longer rebuilds 40 MB on every save.
- **What's new, in the product.** After an update Home says so, once, and
  Help lists the release's highlights. A sample workspace that is dated
  today. A Choose Theme… picker with live preview.
- **New capabilities.** Parked notes (`#parked`), grouping by any tag
  namespace, a calendar day panel, Break into Steps…, Related Notes for
  untagged notes with excerpts, and a readable Notes Graph and Stats page.

**By the numbers.** About 170 commits over about 130 estimated days of
work, in eight phases, each ending in a release. Phases 1–3 (about 35 days)
carry most of what a user will feel.

---

## David's decisions, as applied

| # | Decision | How the plans apply it |
| --- | --- | --- |
| 1 | Needs a new date after 30 days | `deckard.tasks.needsNewDateAfterDays`, default 30, 0 off. Out of Overdue, the badge, the status bar count and color, and the reminder. Muted "was due 2026-07-01" everywhere else, including the calendar, the board (its own column), search pages, query blocks, and the editor line hint. The name avoids "stale", which Home's Stale tasks widget already uses. (Plans 03, 07, 15) |
| 2 | Search pages rendered by default | Every stored preference holds `markdown` whether chosen or not, so everyone is switched to rendered once; choosing Source after that sticks. (Plan 04) |
| 3 | Overdue stays first | The order is unchanged; the proposed `overdueFirst` setting is dropped. Overdue sorts most-recently-slipped first and shows five rows. (Plan 03) |
| 4 | Box in the editor, subtler tags in cards | The editor keeps its box; the opt-in text style is dropped (see below). On search pages, board cards, task rows, Home, and Related Notes, a tag is monospace text with no box or fill, the namespace muted, a faint accent tint and underline on hover and focus, and still a keyboard-focusable button. (Plans 04, 09, 17) |
| 5 | Provenance stays on hover | Untouched. (Plan 09) |
| 6 | What `is:waiting` means | See the recommendation below. |

### `is:waiting`, explained

Today `is:waiting` is an undocumented second spelling of `is:blocked`: tasks
held up by another open task through a ⛔ dependency. That is why it seemed
to mean nothing, and it disagrees with the board's own **Waiting** column,
which means `#status/waiting`.

**Recommendation:** `is:waiting` means open tasks marked `#status/waiting`
or assigned to someone other than you — things you are waiting on someone
for. `is:blocked` keeps meaning held up by another task. Saved searches that
used `is:waiting` change meaning, and the CHANGELOG says so. (Plan 03)

---

## Bugs planning found

The planners checked each claim before designing, and found these on the
way. The first four can lose or hide data, and lead Phase 1.

| Bug | Effect | Plan |
| --- | --- | --- |
| Section and task ids are a 32-bit hash (`parser.ts:1804`) | About a 1 in 5 chance at 5,000 notes that two ids collide; one entry silently vanishes from the index | 10 |
| Extract Heading's failure path deletes the new note | If the save and its undo both fail, the heading exists only in the old note on disk while the editor shows the link; saving the editor loses the heading | 08 |
| Repeating tasks: the task editor and the assistant complete them without writing the next occurrence | The task never comes back | 01 |
| Copy-mode rollover carries a task from every earlier copy | After N days a task is open N times | 01 |
| The tag-writing helper puts a tag after a heading's closing `##` or a `^block-id` | Breaks the heading or the block link; used by Bulk edit | 17 |
| Nested checkboxes have no parent link | Every sub-item shows as a task of its own; a repeat's next occurrence loses its steps; rollover misplaces steps | 16 |
| `updateTaskLine` fails silently when the line is gone or the edit is refused | A task change that did nothing, with no message | 08 |
| The calendar loses keyboard focus on every redraw | Any save, and PageUp/PageDown, drop focus | 15 |
| Stats' Tasks tile opens `has:task`, which the parser rejects | The tile opens an error | 12 |
| The Help panel is created without `enableScripts` | Its navigation script has never run | 11 |
| Related Notes' Sort does not redraw | The new order appears only after another refresh (confirm in the Extension Development Host) | 17 |
| v1.22.0 shipped no CHANGELOG entries; eight releases sit under Unreleased | The Extensions view shows no history | 01 |
| Find's Open beside closes Find; access counts reset when a line above a heading changes; Capture Under a Heading lands after the last sub-heading | Smaller behavior bugs | 06 |

---

## Phases

Each phase ends in a release, passes all four suites (`npm test`,
`test:ui`, `test:e2e`, `test:layout`) and the visual check at every commit,
and re-records baselines in their own `test:` commits.

### Phase 1 — Nothing silently lost (v1.23) · about 7 days, 20 commits

Plan 01 (1a–1l) and the data bugs above: the id hash (a wider hash, with
old ids carried over for pins and view counts), Extract Heading's failure
path, the silent `updateTaskLine`, the tag-writing helper, `has:task`, the
calendar's focus, Help's scripts, and Related Notes' Sort. The CHANGELOG is
cut per version from here on, each with a three-line **Highlights** list
that Phase 4 reads.

### Phase 2 — Dates and tasks (v1.24) · about 16 days, 18 commits

Plan 02, then plan 03. One `parseDatePhrase` everywhere, the date echo and
the single error string, query periods and a Created facet, Open Daily Note
for Date…, and `deckard.calendar.weekStart`. Then the task pieces: Needs a
new date, Done today, per-day Upcoming, Home's tiles, the reschedule
choices, board column counts and optional limits, rollover under Carried
over with migrate, reviews with Coming up, Gone quiet for any namespace,
and `is:waiting` / `is:available` / `is:today` / `is:needs-date`.

### Phase 3 — Search pages and the board (v1.25) · about 16 days, 25 commits

Plan 09's primitives first, since plan 04's card tags depend on its overflow
rule: checked menu items with their keys, no hover on disabled buttons,
`data-tip` tooltips on focus, one popover style, loading after 400 ms,
Undo on removals. Then plan 04: three-line rendered cards with the matched
paragraph, five-value facets, the hub text button, quiet card tags, live
query blocks, Save to Home, the board's instant moves and 100-card columns,
Find open during indexing, and the slim Dashboard.

### Phase 4 — Words and wayfinding (v1.26) · about 15 days, 14 commits

Plan 08 across all 123 notifications, with one "changed underneath"
string, Open Log, Open Setting, the glossary, and the graph's sliders in
plain words. Plan 11: What's new on Home and in Help, the dated sample
workspace, the six-step walkthrough, the first-index summary, Choose
Theme…, and clickable commands in Help. Try next comes last.

### Phase 5 — Links, Find, and Capture (v1.27) · about 17 days, 22 commits

Plan 05 after Phase 3 (it edits the same search-page code): the `link`
field and its builder row, facet, and completions; `is:daily`; grouped
Linked from; the three lines on a tag's page; Links that open no note; the
Rename Tag box. Plan 06: frecency from every open, the empty-Find order,
keys inside Find, task actions, learned picks, the Capture row, remembered
headings, selection seeding, and Move to….

### Phase 6 — The editor (v1.28) · about 7 days, 12 commits

Plan 07: the title-bar menu and daily arrows, the zen button on Deckard
pages, the right-click and Explorer submenus, File → New File entries,
Toggle Task Done, the injection grammar, dimmed metadata and due hints, the
repeat rules and their quick fixes, the word count, and the Outline's
counts and focus. It adds two dev-only dependencies for the grammar test.

### Phase 7 — Scale (v1.29) · about 12.5 days, 9 commits

Plan 10: a benchmark script first, then staggered view publishing, the
incremental index proven equal to a full rebuild over 4,000 random edits,
graph rebuilds skipped when structure is unchanged, and the warm start from
the SQLite cache. Targets: under 30 ms per save and under 0.9 s to first
display at 5,000 notes.

### Phase 8 — New capabilities (v1.30 onward) · about 40 days, 50 commits

Each ships on its own, in this order:

1. **Parked notes** (plan 13) — after Phases 2 and 3.
2. **Group by tag namespace** (plan 14).
3. **Calendar day panel** (plan 15) — behind `deckard.calendar.dayPanel`,
   off at first.
4. **Break into Steps…** (plan 16).
5. **Related Notes for untagged notes, and excerpts** (plan 17).
6. **Graph and Stats** (plan 12) — its core after Phase 7, which edits the
   same graph code; the four later items after that.

---

## Where the plans disagreed, and how it is settled

| Conflict | Settled |
| --- | --- |
| A restored Capture draft vs. a selection (plans 01, 06) | The selection wins, as the newer and more explicit intent; the draft is kept and offered as the second item, "Restore what you were typing". |
| `deckard.tasks.parkedStatuses` (plan 03) vs. parked notes (plan 13) | Renamed `deckard.tasks.onHoldStatuses`, so "parked" means one thing. `is:available` also leaves out parked tasks. |
| Refine's Updated labels | "Last 7 days / 1–4 weeks ago / Older" (plan 01): the engine counts today as day 1. |
| "+9 this week" on Stats | "+9 in the last 7 days" (plan 12), since the spans are rolling. |
| The editor's tag style (plan 07's opt-in) | Dropped: decision 4 keeps the box, and a setting nobody asked for is a cost. |
| The shared inline Undo (plans 01 and 09) | 1j lands first; 9g turns it into the shared helper. |
| Board cards keyed by task alone (plans 04, 14) | Keyed by column and task, since grouping by namespace can show one task in two columns. |
| The `- [>]` migrated line (plans 03, 06) | One helper, and the parser skips such lines so they never appear as notes on a tag's page. |

---

## Quick decisions for David

Each has a recommendation; if David says nothing, the recommendation is
built.

| # | Question | Recommendation |
| --- | --- | --- |
| A | `is:waiting` means `#status/waiting` or assigned to someone else | **Yes** |
| B | A repeating task's steps come back unchecked with its next occurrence (Obsidian Tasks does not do this) | **Yes** |
| C | Refused board drops: red Error (the new severity rule) or Information | **Information** — a refusal explains a rule, it is not a failure |
| D | The one irreversible confirm button: red, amending "red means overdue only", or neutral with a heavier border | **Neutral with a heavier border** — keeps red's single meaning |
| E | A feature release (x.y.0) fails CI until its Highlights are written | **Yes** |
| F | The calendar day panel turns on by default in the release after it ships | **Yes** |
| G | A task with two tags in the grouped namespace shows in both groups | **Yes** |
| H | The parking tag is `#parked` (not `#archived` or `#someday`, which people already use) | **Yes** |
| I | Honoring `search.exclude` hides a notes folder that is hidden from search. Is any of your notes folders hidden from search? | Check before Phase 1 ships; `deckard.exclude` can re-include it |
| J | "Needs a new date" as the setting's name: `deckard.tasks.needsNewDateAfterDays` | **Yes** |

---

## What each plan contains

| Plan | Workstream | Commits | Days |
| --- | --- | --- | --- |
| [01](implementation/01-bugs.md) | Fix what is broken | 14 | 4 |
| [02](implementation/02-dates.md) | One date language | 5 | 4.5 |
| [03](implementation/03-tasks.md) | Tasks without the pile | 13 | 11 |
| [04](implementation/04-search-board.md) | Search results and the board | 16 | 9 |
| [05](implementation/05-links.md) | Links and spellings | 11 | 9 |
| [06](implementation/06-find-capture.md) | Find and Capture | 11 | 7.75 |
| [07](implementation/07-editor.md) | The editor | 13 | 7.75 |
| [08](implementation/08-messages.md) | Messages | 6 | 5 |
| [09](implementation/09-components.md) | Component primitives | 9 | 7 |
| [10](implementation/10-index-speed.md) | Index speed | 9 | 12.5 |
| [11](implementation/11-onboarding.md) | Onboarding and what's new | 8 | 10 |
| [12](implementation/12-graph-stats.md) | Graph and Stats | 15 | 12.5 |
| [13](implementation/13-parked.md) | Parked notes | 5 | 6.5 |
| [14](implementation/14-group-namespace.md) | Group by tag namespace | 5 | 4.5 |
| [15](implementation/15-calendar-day.md) | Calendar day panel | 7 | 4.25 |
| [16](implementation/16-steps.md) | Break a task into steps | 9 | 7 |
| [17](implementation/17-related.md) | Related Notes upgrades | 9 | 4.75 |

Each plan lists its scope and what it dropped after checking the source,
the design with exact strings and settings, implementation steps, tests by
suite, docs, commits with subject lines, size, risks, and dependencies.
Estimates are the planners' and assume one developer.
