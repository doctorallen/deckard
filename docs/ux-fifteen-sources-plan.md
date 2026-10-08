# UX plan: fifteen sources, one plan

A plan, not a change. It was written on 2026-09-25 at `726d23b` on `dev`
(v1.22.0), after `ux-review.md`, `ui-plan.md`, and `ux-research-plan.md`,
and it deliberately leaves out everything those three, `zen-mode.md`, and
`improvements.md` already cover. Nothing here has been implemented.

Fifteen researchers worked independently, each on one kind of source, and
each was told what the earlier plans had already covered:

| # | Source | What it read |
| --- | --- | --- |
| A | Writing editors | iA Writer, Ulysses, Typora, Bear, Craft, Zettlr |
| B | Outliners and networked notes | Roam, RemNote, Workflowy, Dynalist, Anytype, Mem, Napkin, Supernotes, Kosmik, Scrintal |
| C | Calendar and planning apps | Fantastical, Notion Calendar, Amie, Motion, TickTick, Structured, Apple Reminders, Todoist's scheduler |
| D | Launchers | Raycast, Alfred, JetBrains Search Everywhere, Zed, Arc, Firefox's frecency and adaptive history |
| E | Design systems | Primer, Carbon, Atlassian, Fluent 2, Apple HIG, Material 3, Polaris |
| F | Visualization research | Tufte, Munzner, Shneiderman, Ghoniem et al., Elmqvist and Fekete, Kumu, InfraNodus |
| G | NN/g and the Laws of UX | Hick, serial position, von Restorff, layer-cake scanning, information scent, NN/g on dashboards and filters |
| H | Cognitive accessibility | W3C COGA, ADHD and executive-function literature, Personal Kanban, Goblin Tools, Amazing Marvin |
| I | UX writing | Google and Microsoft style guides, GOV.UK, VS Code notification guidelines, Podmajersky; an audit of all 123 notifications |
| J | Onboarding and discovery | UserOnboard, Appcues, Pendo, Intercom, VS Code walkthrough guidance, GitLens's What's New |
| K | Perceived performance | RAIL, Nielsen's response limits, `content-visibility`; measured on synthetic 1,000- and 5,000-note workspaces |
| L | Cognitive walkthrough | Six real tasks walked step by step through the manifest, page builders, and message handlers |
| M | Adjacent VS Code extensions | Front Matter CMS, Foam and Dendron's UI, Markdown All in One, Todo+, Error Lens, Marp, vscode-journal, and eight more, by their manifests |
| N | PKM methods | GTD, Building a Second Brain and PARA, Zettelkasten, Linking Your Thinking, Johnny Decimal, Bullet Journal, time-blocking |
| O | Users' own words, round two | Marketplace reviews of Foam, Dendron, Todo Tree, Markdown All in One; about 500 App Store reviews of Bear, Things, and Craft; Product Hunt; "why I left" posts. Reddit and Medium could not be fetched. |

Each finding names a file and line. The claims the plan rests on most were
read again in the source before writing: the swapped format icons, copy-mode
rollover carrying one task into several notes, the task editor's Done never
writing a repeat's next occurrence, the section band's hard-coded white,
Refine's "This month" leaving out the last seven days, the scan passing no
exclude to `findFiles` and never reading `search.exclude`, capture having no
`ignoreFocusOut`, the query language having no link field, and the Tasks
view putting Overdue before Today.

## Where the sources agree

Where researchers who never saw each other's work arrived at the same
change:

| Change | Sources | Piece |
| --- | --- | --- |
| One date language everywhere, that says back the day it read | C, I, L, D, M | 2 |
| Overdue stops being the first and loudest thing; show what was done | H, G, C | 3 |
| Search results are short enough to scan, rendered, and fast | G, O, K, A | 4 |
| Notes can be parked: out of the action lists, still searchable | N, O, H | 3, 12 |
| `[[links]]`, lookalike tags, and plain-text mentions reach a tag's page | B, L, M | 5 |
| Reviews look ahead as well as back | C, N | 3 |
| Editor decorations use theme colors, and apply only to notes | A, M, O | 1, 7 |
| Find and Capture remember, and act without leaving | D, H, N | 6 |
| Failures say what to do next, in one voice and one severity rule | I, L, E | 8 |
| A search becomes a live query block in one step | L, J | 4 |

---

## Piece 1. Fix what is broken

Each of these is a bug or a promise the README makes and the code does not
keep. All are small, and they go first.

| # | Observed | Change | Source |
| --- | --- | --- | --- |
| 1a | The search page's format toggle draws the eye on **Source** and `<>` on **Rendered** (`searchPageHtml.ts:415`). | Swap `renderedIcon` and `sourceIcon`. Add a test that each `set-mode` button carries the icon of its own mode. | O |
| 1b | Copy-mode rollover dedupes only against today's note (`rollover.ts:133-155`). A task copied Monday to Tuesday qualifies twice on Wednesday, from both notes, and after N days is open N times; the test covers one day (`rollover.test.ts:175`). | Dedupe the carried set by `sourceLineText`, keeping the newest. Add a three-day test. | N |
| 1c | **Edit Task → Done** in the editor only flips the draft (`taskEditor.ts:202-210`) and writes one line; it never calls `createNextOccurrence`, so a repeating task finished there does not come back. README:270 promises it does. | Send Done through the path `toggleTask` uses (`taskActions.ts:254-272`). | M |
| 1d | A 🔁 rule Deckard cannot read is dropped without a word when the task is completed (`taskMetadata.ts:410-415`, `taskActions.ts:265`, `bulkEdit.ts:228`). | Say so in the completion message beside Undo. Piece 7 adds the diagnostic. | C |
| 1e | The section band is `rgba(255,255,255,…)` (`tagDecorations.ts:48-53`), invisible on light themes, and it bands every tagged section although README:77 says "the section being edited". | Contribute `deckard.sectionHighlightBackground` and `…Border` with dark, light, and high-contrast defaults, and band only the section holding the cursor. | A, M |
| 1f | In a code repository the scan indexes `node_modules`: `findFiles` gets no exclude (`scanner.ts:82`) and the matcher reads only `deckard.exclude` and `files.exclude`. This repository has 1,024 such files carrying 7 open tasks from other packages. Reference lenses and tag decorations never check `isNotesFile` (`editorReferences.ts`, `tagDecorations.ts`), so a README in a code repo is marked up even with a notes folder set. | Build the scan's exclude from `search.exclude`, `files.exclude`, and `deckard.exclude`; gate lenses, decorations, hovers, and completion on `isNotesFile`. Make the large-workspace hint per workspace (`extension.ts:227` uses `globalState`). | O |
| 1g | Refine's Updated facet labels `updated >= 7d` "This week" and `updated < 7d AND updated >= 30d` "This month" (`searchFacets.ts:151-163`), so on Sep 25 "This month" leaves out Sep 19–25. | Relabel "Last 7 days", "8–30 days ago", "Older". Piece 2 adds calendar periods. | L |
| 1h | The daily reminder is one `setTimeout` (`taskStatusBar.ts:80-87`): late after sleep, skipped when VS Code opens after the hour, repeated once per window; and the count keeps yesterday's date past midnight while the window keeps focus. | A once-a-minute check against `globalState.lastReminderDate`, written before the message shows, which also refreshes the date. | C |
| 1i | Quick Capture has no `ignoreFocusOut` (`capture.ts:291`); clicking away discards the half-typed line. The task editor sets it five times. | Set it, and keep a non-empty draft in `workspaceState`, restored on the next open with "Restored what you were typing". | H |
| 1j | **Reset graph settings** clears every filter and the layout with no confirm or undo (`notesGraphHtml.ts:163`, handler `:1902`), against `ux-review.md`'s "never fire on their own". | Keep the previous settings; show "Graph reset. Undo" inline for 8 s. | E |
| 1k | The query-block lens says "Open this query on the Dashboard's Search tab" (`queryBlocks.ts:118`); there is no such tab now. | "Open this query on a search page". | L |
| 1l | `CHANGELOG.md` has not been cut since 1.14: eight releases sit under `## Unreleased`, which is what the Extensions view's Changelog tab shows for the VSIX. `prepare-release.yml` never touches it. | The release workflow renames `## Unreleased` to `## X.Y.Z - date`, opens a fresh one, and passes the section to `gh release create --notes-file`. Backfill 1.15–1.22 once from the tag dates. | J |

**Size:** S each; about two days together.

---

## Piece 2. One date language

**Observed.** Four parsers answer the same question differently.
`parseTaskDateInput` (`taskDraft.ts:159-220`) reads weekdays and "in 3
days" but not "Oct 3", "next week", or "end of month", though the indexer
reads "Sep 12" in task text (`parser.ts:57`). Bulk edit's `parseBulkDate`
(`bulkEditPrompts.ts:60-75`) reads only ISO dates, today, and tomorrow, so
"friday" works in one box and fails in the next. The query language accepts
only rolling windows (`isDateValue`, `queryParser.ts:836-846`): `due <=
friday` and `created = last-month` are errors. `askForDueDate`
(`agendaActions.ts:49-66`) never says which day it read; "Due Next Week"
silently means Monday while Deckard's weeks run Sunday to Saturday. Errors
say "Deckard cannot read that as a date" with no example (I).

**Why.** Fantastical and TickTick read month names and relative phrases and
show the resolved date before you commit (C). GOV.UK: an error says how to
fix it, with the expected form (I). The walkthrough's "find what was
written last month" fails at the first natural attempt (L).

**Change.**

- **2a.** One `parseDatePhrase(text, now)` in `core/markdown`, used by
  capture, the task editor, `askForDueDate`, bulk edit, `[[` day links, and
  the query parser. Delete `parseBulkDate`. Add month-day in either order,
  locale numeric dates, "next week", "next month", "end of week", "end of
  month", "weekend".
- **2b.** Every date prompt answers valid input with an Info validation
  message, "Monday 2026-09-28 · in 3 days", and invalid input with one
  error: `Enter a date such as friday, in 3 days, or 2026-10-02.` Rename
  "Due Next Week" to "Due Next Monday".
- **2c.** Query periods: `this-week`, `last-week`, `next-week`,
  `this-month`, `last-month`, and weekday names, in `resolveDateRange` and
  the value completions (`dashboardState.ts:1454`). A **Created** facet
  with calendar months.
- **2d.** `Deckard: Open Daily Note for Date…` — a quick pick of
  Yesterday, Today, Tomorrow, and recent daily notes, that reads typed dates
  with 2a; Find offers "Open daily note for Fri, Oct 2" when its whole input
  is a date (D, M).
- **2e.** `deckard.calendar.weekStart`: `sunday` (default), `monday`, or
  `locale`, passed to the calendar grid, weekly notes and reviews, "next
  week", and the board's within-a-week column. A week note is looked up by
  the range containing the day, so existing notes still open. The README's
  review example is Monday to Sunday today and needs correcting (C).

**Size:** 2a–2c M; 2d S; 2e M.

---

## Piece 3. Tasks without the pile

The most-repeated finding across sources is that Deckard's task surfaces
open on a wall of red and never show progress.

**Observed.** The Tasks view orders Overdue before Today (`agendaState.ts:70`)
and sorts it oldest first; in `docs/images/agenda.png` Today is off screen.
Home's agenda widget copies the order. The status bar turns to its warning
color for any overdue task however old (`taskStatusBar.ts:174-177`). On the
board 40 cards in Doing all read "overdue 20 days" in red, so red no longer
picks anything out (G). Reschedule All to Today turns 17 overdue tasks into
17 due today and says nothing about it (`agendaActions.ts:113-129`). Nothing
ever shows what was finished, though `doneAt` is on every task. Home's three
largest numerals are workspace totals nobody acts on (`dashboardHtml.ts:984`).

**Why.** COGA 4.3.4: the key actions visible without scrolling (H). The
"Wall of Awful": repeated visible failure is what stops a task being started
(H). Von Restorff: emphasis works only while it is scarce (G). Personal
Kanban's second rule is a work-in-progress limit (H). NN/g: a dashboard
leads with what needs action (G).

**Change.**

- **3a.** Tasks view: Today, then Overdue (most recently slipped first,
  five rows and "Show 12 more"), then Upcoming. `deckard.agenda.overdueFirst`
  keeps the old order. (S)
- **3b.** A folded **Done today (4)** group at the bottom of the Tasks view,
  reopenable from its checkbox; "4 done today" in the status bar tooltip; a
  one-line footer on Home's agenda widget. No streaks. (S)
- **3c.** Home's header tiles become **Overdue / Due today / Open**, each a
  button opening its search, reusing Stats' `metric()`. Totals stay on
  Stats. New and reset Homes lead with the Tasks view widget, not the
  undated Tasks list (`preferences.ts:147-153`). (S)
- **3d.** Two more Reschedule choices: **Spread over the next 5 days**
  (weekdays, oldest first) and **3 for today, the rest next week**. After a
  bulk move the message gives the new total: "Today now has 22 tasks."
  Where a date is picked from a list, each day shows its load, "3 due · 1
  scheduled" (C). (S–M)
- **3e.** Upcoming groups by day, "Tomorrow (3)", "Mon Sep 28 (1)", each
  day node a drop target (C). (S)
- **3f.** Board columns count their overdue cards in the header, "40 · 38
  overdue"; when over half a column is overdue, card dates go muted with a
  small marker and the full red is kept for the worst third. Optional
  `deckard.board.limits` (`{ "doing": 3 }`) shows "40 / 3" with a neutral
  outline and never blocks a drop. (M)
- **3g.** `is:available`: open, not blocked, started, and not in
  `deckard.tasks.parkedStatuses` (default `waiting, someday`). Offered as a
  one-click alternative to the board's `is:open`, which today includes
  future-start and blocked tasks the Tasks view hides (N). `is:waiting`
  currently means dependency-blocked (`queryParser.ts:118`); make it the
  status `waiting` or assigned to someone else, and keep `is:blocked` for
  dependencies. (S)
- **3h.** Rollover writes carried tasks under a `### Carried over` heading
  below today's own lines; `rolloverDays` defaults to 7 rather than all
  history. Copy mode becomes **migrate**: the source line is rewritten
  `- [>] … → [[2026-09-25]]`, which the index already does not read as open
  (H, N). (S)
- **3i.** The weekly and monthly review gains a **Coming up** section
  (tasks due, scheduled, or starting next period, by day) and a summary
  figure (C, N). `deckard.periodicNote.reviewSections` lets a user add
  `{title, query}` sections, frozen when written. Checklist lines inside the
  review markers stop being indexed as tasks, so a template's "Clear inbox"
  no longer piles up every week (N). (S–M)
- **3j.** "People gone quiet" generalizes to **Gone quiet** with a
  namespace choice and a "no open tasks" filter: `project` with that filter
  is GTD's stuck-projects list, each row offering **Add next action** (N). (S)

**Decision for David.** Whether to retire old overdue tasks into a neutral,
folded **Needs a new date** group after `deckard.tasks.staleAfterDays`
(H proposes 14; 0 would keep today's behavior). It is a policy choice, so
it is listed, not scheduled.

---

## Piece 4. Search results you can scan

**Observed.** A result card prints its whole section (`searchPageHtml.ts:268`),
monospace, by default (`renderMode: 'markdown'`, `preferences.ts:121`);
`docs/images/tag-overview.png` fits about two results on a 1080px screen.
Refine can show about 47 chips before the first result (`searchFacets.ts:40-42`).
On a tag page with no hub note, the amber-barred "create a hub" panel is the
most prominent thing on the page (`searchPageHtml.ts:86, 241`). A saved
search's toast leads nowhere, although the Save tooltip promises "on Home"
(`searchPage.ts:827`). No path turns a search into a live query block;
Export's "Copy as Markdown list" is a frozen copy that looks like one (L).

Underneath, `createSearchPageSnapshot` renders and sanitizes a card for
every match before choosing the page of 30 (`dashboardState.ts:227-259`):
at 5,000 notes the first empty search takes 2.0 s and a warm one 454 ms (K).

**Why.** Layer-cake scanning needs the headings close together (G). Hick's
law and NN/g's progressive disclosure: a few values, more on request (G).
Bear's reviewers praise rendered text and complain of raw Markdown (O).
RAIL: respond to input within 100 ms, work in chunks of 50 ms or less (K).

**Change.**

- **4a.** Clamp card bodies to 3 lines with a per-card **Show all**; a
  Preview row in the gear: None / 3 lines / Full. When search words are
  present, `ux-research-plan.md` 4b's centered snippet fills the 3 lines —
  it is still not built, and three sources now ask for it. (S)
- **4b.** Default `renderMode` to rendered; stored preferences keep anyone
  who chose Source. (S; see decisions)
- **4c.** Each facet shows its top 5 values, applied values always, and
  `+N more`, remembered for the session; the sidebar Refine too. (S)
- **4d.** No hub note: a "Create hub note" text button under the tag's
  subtitle, not a panel. (S)
- **4e.** Sort on light keys, `takePage`, then build cards for the 30
  shown; filter plain words through the full-text store first. The same for
  tasks. (S)
- **4f.** Export's first item on search pages and the board: **Copy as live
  query block**, "stays up to date", writing the fence with the page's
  query and sort. A command, **Insert Query Block…**, lists saved and recent
  searches and inserts the fence at the cursor. (S)
- **4g.** After Save, the toast offers **Show Results on Home** and **Open
  Home**; the first adds the saved-search widget. The same action on each
  Saved searches row. (S)
- **4h.** The Task board's "Tasks view" button is a toggle labeled as a
  place. Label it "List in Tasks view" with `aria-pressed`, and move it into
  the gear (G). (S)

---

## Piece 5. Links and spellings reach a tag's page

**Observed.** The query language has no link field (`queryTypes.ts:27-44`)
though every section carries `links`. A note's backlinks live only in the
Related Notes "Linked from" list, capped at 50 with "N more not listed" and
nothing to reach them (`noteLinks.ts:30`), in index order, one line each.
A tag's page shows neither the notes that link to its hub note, nor entries
that name its subject in plain words, nor its other spelling: lookalike
tags are found only on Stats (`tagHygiene.ts:34`), so a search for
`#project/atlas` silently misses the entries written `#proj/atlas`. There is
no `is:daily`, so daily notes flood backlinks and tag pages in a journaling
workspace. Nothing lists links to notes that do not exist yet.

**Why.** In Roam a tag and a page reference are one reference, filterable
in both directions, with a daily-notes filter (B). Foam lists placeholders
beside orphans (M). The walkthrough's tag-rename task failed because the
merge lives on a page the user has no reason to open (L).

**Change.**

- **5a.** A `link` field: `link = [[Atlas]]`, bare `[[Atlas]]` as
  shorthand, resolved through aliases as `backlinks.ts` does, with
  `[[Atlas#Decision]]` naming a heading. In the builder, and as a "Links
  to" facet. "N more not listed" becomes **Open as search**, so Refine,
  Bulk edit, Save, and Export work on backlinks. (M)
- **5b.** On a one-tag page, when a lookalike exists: "Also written as
  **#proj/atlas** (6 entries). [Include in search] [Merge]". (S–M)
- **5c.** When a tag has a hub, its page searches `#tag OR [[Hub]]`, rows
  matched by link only saying "links the hub". Needs 5a. (S)
- **5d.** A quiet line on a tag's page: "12 entries mention 'atlas' without
  the tag", opening the search where Bulk edit → Add a tag does the fix. (S)
- **5e.** `is:daily` and `is:periodic`, and a **Hide daily notes** toggle
  on Linked from and Related Notes. (S)
- **5f.** Linked from groups by source note, newest updated first, each row
  expanding to the rest of its section. (S–M)
- **5g.** Stats gains **Links that open no note**, each with its count and
  sources, and Create / Create all. (M)
- **5h.** Rename Tag's box starts filled with the old name, name part
  selected, titled "Rename #proj/atlas", and says on every keystroke what
  will happen: "Merges into #project/atlas (42 entries)" or "Becomes a new
  tag #proj/project/atlas". Today a bare `project/atlas` silently gains the
  old namespace (`renameTag.ts:816-834`) (L). (S)

---

## Piece 6. Find and Capture that remember

**Observed.** "Recently opened" and the frecency behind every Find ranking
count only notes opened from Deckard's own surfaces; opening from the
Explorer, Cmd+P, or a link is never recorded (`quickFind.ts:204, 254`).
Empty Find lists recent searches, tags, every saved search, then recent
notes last, and never pinned notes (`quickFindState.ts:528-580`). Row
actions are mouse-only (`quickFind.ts:36-55`). A task found in Find can only
be opened. Find does not learn which result you pick for a query. Capture
forgets its last heading (`capture.ts:48, 369-395`), and neither Find nor
Capture reads the editor selection. Nothing moves a line or task into
another note: Extract refuses anything untagged (`extractHeading.ts:43`).

**Why.** Raycast and Alfred rank by frecency fed by every use, and by
query-to-choice history; pinned items head the empty state; ⌘Enter is the
secondary action; fallbacks catch what matched nothing (D). GTD's Organize
step, Zettelkasten's fleeting-to-permanent move, and PARA's filing are all
a refile (N).

**Change.**

- **6a.** Record access when an indexed note stays active for about 1.5 s,
  from anywhere. (S)
- **6b.** Empty Find: Pinned, Recently opened (5), Recent searches (5),
  Saved, tags. (S)
- **6c.** Keybindings inside Find: `cmd/ctrl+enter` opens beside and keeps
  the list open; `alt+enter` inserts a link; the keys in each button's
  tooltip. (S)
- **6d.** Task rows get **Complete** and **Set due**; `cmd/ctrl+.` opens
  every action for the row, grouped, and Escape returns to the search. (M)
- **6e.** Remember which result was picked for a typed prefix (capped at
  200) as a ranking bonus that never beats an exact title. (M)
- **6f.** When nothing matches: **Capture "…" to today's note**, parsed as
  Capture parses. (S)
- **6g.** Capture remembers its last five headings and offers the last
  first; Find and Capture seed from a short single-line selection, and a
  capture from a selection links back to where it came from. (S)
- **6h.** `Deckard: Move to…`: the line, task, or selection moves under a
  chosen heading or into a new note, as one checked, undoable write, leaving
  a `[[link]]` for prose or `- [>]` for tasks. A lightbulb action and an
  entry in the Tasks view and board menus. Extract accepts any heading. (M)

---

## Piece 7. The editor as a writing surface

Five sources looked at the editor and found it had never been reviewed as a
place to write: the earlier plans touched it only through zen.

**Observed.** Deckard contributes nothing to `editor/title`,
`editor/context`, `explorer/context`, `file/newFile`, `grammars`, or
`colors` (`package.json:403-614`). Every tag is drawn with a 1px box
(`tagDecorations.ts:39-46`), so a line of prose can carry three boxes.
Task metadata and `^ids` read at full weight. An overdue task looks like
any other in its note. `[[links]]` and dates are uncolored wherever
decorations do not run: diffs, peek views, before the index is ready. There
is no word count.

**Why.** Bear and iA Writer show a tag as styled text, not a control (A).
Foam, Markdown Memo, and vscode-journal inject a grammar for wiki links (M).
Error Lens puts the message on the problem line and contributes themeable
colors (M). Marp puts one title-bar button on Markdown that opens its
commands (M).

**Change.**

- **7a.** One Deckard button in a Markdown editor's title bar opening a
  quick pick (Graph around this note, Related Notes, Pin, Edit Task); ‹ ›
  for the previous and next daily note under `deckard.isDailyNote`; the zen
  toggle in Deckard pages' title bars. A **Deckard** submenu in the editor
  context menu with Toggle Done, Edit Task, Rename Heading, Extract, Move
  to…, and Pin. (S)
- **7b.** `deckard.toggleTaskDone` with a keybinding on task lines, through
  the same path as 1c. (S)
- **7c.** An Explorer submenu: New Note from Template Here, Exclude from /
  Include in Deckard on a folder; `file/newFile` entries for a daily note
  and a template note. (S)
- **7d.** An injection grammar for `[[links]]`, 📅 ⏳ 🛫 ✅ dates, priority,
  and 🔁 rules, colored by the user's theme. The tag decoration stays. (S)
- **7e.** `deckard.editor.tagStyle`: `box` (today), `text` (link color, no
  border, the new default), `quiet` (the `#` and namespace dimmed; zen's
  choice). (S)
- **7f.** Task metadata and `^ids` drawn at reduced opacity; an overdue date
  never dimmed; after-text "overdue 5 days" worded by `describeDueDate`, in
  `deckard.overdueForeground`; the Outline shows done/total on headings that
  hold tasks. `deckard.editor.taskDueHints`, off in zen. A diagnostic on a
  🔁 rule Deckard cannot read, with a quick fix to the nearest one it can,
  and `parseRecurrence` learns "every other", nth weekday, quarter, and
  weekend (C). (S–M)
- **7g.** A word count in the status bar while a note is active, "412 words
  · 2 min", counting the selection when there is one, leaving out front
  matter, code, and metadata. (S)
- **7h.** The Outline: **Focus section** (`editor.foldAllExcept`) and
  Unfocus; a tag chip filters the Outline; the heading's incoming links in
  its description, "↩3" (B). (S)
- **7i.** Later: a writing focus that dims everything outside the current
  paragraph or section, separate from zen (A); a walkthrough step that sets
  up `[markdown]` for prose, shown as a diff first (A). (M, S)

---

## Piece 8. Messages that say what to do

**Observed.** Of 123 notifications, 41 report a failure and 36 of those
offer no next step; 13 append `String(error)` as it comes; the 41 split 5
Information, 22 Warning, 14 Error with no pattern. "The note changed since
Deckard read it" is written seven ways at three severities. Six messages
name a raw setting ID with no link. The Save flow says "filter" in its title,
error, and confirmation, and "search" in its prompt. "Entity" survives in
Link Current Heading's quick picks and Home's widget list; toast buttons
still say "Show Stats" and "Show Log".

**Why.** Google: say what went wrong and how to fix it, and identical
problems get identical words. VS Code: link to the log. GOV.UK: an error
reuses the field's words (I).

**Change.**

- **8a.** A `reportFailure(outcome, fix, actions)` helper: outcome, cause in
  the reader's terms, one action; the raw error goes to the log with an
  **Open Log** button. The worst case first: `extractHeading.ts:296` must say
  the heading is now in both notes and which to delete. (M)
- **8b.** One string, one severity, for a note that changed underneath:
  "{Name} changed after Deckard last read it, so nothing was written."
  [Open Note]. (S)
- **8c.** A three-line severity rule in `components.md` — Error: nothing
  written, or half-written; Warning: written with a caveat, or skipped;
  Information: nothing needed doing — and the 41 reclassified. (S)
- **8d.** Setting names in words with an **Open Setting** button; the Tasks
  view's empty state names its query and offers "Show every open task". (S)
- **8e.** "Save search" and `Saved the search "{name}".` everywhere; the
  glossary carried into quick picks, widget labels, and toast buttons; the
  naming test extended to read them. (S)
- **8f.** The Notes Graph's sliders in the reader's words — "Links per
  note", "Favor rare tags", "Links between groups", "Show every link" —
  with fewer / more in place of decimals, and all but the first behind
  **Advanced**. The Related Notes settings that say "atomic source units"
  rewritten and tagged `advanced` (O). (S)

---

## Piece 9. Shared component primitives

**Observed.** The card ⋯ menu drops the current value instead of checking
it, and never shows the single-key shortcuts the board already has
(`components.ts:1643-1677, 1858-1883`). Hover paints the full accent fill on
disabled buttons (`components.ts:184`, `themes.ts`); Save and Clear leave the
tab order and explain themselves only in `title`. About 100 tooltips are
native `title`, never shown on keyboard focus. Tags and chips handle long
text three ways, and `#topic/replicants` breaks mid-word in a Related Notes
card. Three popover styles use three z-indexes. Loading is drawn with the
dashed empty-state box, with no `aria-busy`.

**Why.** Primer, Apple HIG, and Fluent: single-select menus check the
current item and show shortcuts; Material 3: disabled takes no hover
state; Carbon: tags truncate with a tooltip, never wrap; Primer: loading
shows nothing under 1 s and uses `aria-busy` (E).

**Change.** (S each unless noted)

- **9a.** Menu items as `menuitemradio` with `aria-checked`, a reserved
  check column, and a trailing `<kbd>` from an optional `item.key`.
- **9b.** `:not(:disabled):not([aria-disabled="true"])` on every hover
  rule; Save and Clear become `aria-disabled` with a reason. A UI test.
- **9c.** One token rule: single line, ellipsis, namespace shrinks before
  value, tooltip only when truncated.
- **9d.** A `data-tip` tooltip: immediate on focus, 400 ms on hover,
  Escape closes, hoverable, `<kbd>` slot; `renderIconButton` emits it. (M)
- **9e.** A `.popover` base and a z-index scale; a 28px `.menu-item`.
- **9f.** A `.loading` placeholder shown after 400 ms, `aria-busy` until
  the first state, and a 2px bar for a search in flight past 1 s. (M)
- **9g.** A `button.danger` tone and the rule in `components.md`: undo for
  what can be undone, confirm for what cannot.

**Decision for David.** The hover-revealed file and line on each row
(`getProvenanceCss`, `components.ts:676-796`) draws over the next row in
three baselines, and cannot be seen on touch. E proposes showing it inline
at rest outside zen, and revealing it in flow rather than as an overlay in
zen. This reverses a recent, deliberate design, so it is his call.

**Decided (David, 2026-10-07; plan 29, R17).** In flow, not an overlay, and
only when details are switched on: while at least one card detail is
ticked, every row and card keeps one line for its details under its date
line, at every step, drawn at opacity 0 and shown on the row's hover or
focus, and always on a screen that does not hover. With none ticked no line
is kept, and the file and line stay in the accessibility tree. The overlay
and its Escape dismissal are gone.

---

## Piece 10. Speed at scale

Measured on synthetic workspaces of 1,000 and 5,000 notes (K). The numbers
are upper bounds, but each grows with note count.

| # | Observed | Change | Size |
| --- | --- | --- | --- |
| 10a | A card dragged on the board stays put for 0.5–1.5 s: save, a fixed 200 ms flush, a full index rebuild, and a full board redraw. | Move the card at once, marked pending, and reconcile or revert on the next state; flush a URI Deckard itself wrote without waiting. | S |
| 10b | Find, a new search page, and a restored search page wait silently on the first scan (`quickFind.ts:76`, `searchPage.ts:105, 129`). | Open at once with `busy` and "Indexing 412 of 3,760 notes…"; the same count in every "Loading index…". | S |
| 10c | The Dashboard posts every tag's `sectionIds` and `taskIds`, which no script reads: 2.4 MB per save at 5,000 notes against 216 KB without them. The hidden Tags panel is 92% of each redraw. | Post `{key, label, count, isFavorite}`; build the Tags panel only when shown; a size test. | S |
| 10d | The board replaces every card on every save: 650 ms of script and layout at 3,000 open tasks. | `content-visibility: auto` on cards; the first 100 per column and "Show 412 more"; later, patch by task id. | S, then M |
| 10e | Every save rebuilds the whole index (520 ms at 5,000 notes) and 18 listeners recompute in one tick, blocking the host every extension shares. | Now: publish to visible views one at a time, most visible first. Later: add and subtract one file's contributions instead of rebuilding. | S, then L |
| 10f | The Notes Graph rebuilds and posts the whole graph on every save: 8.3 MB at 1,000 notes, 40 MB at 5,000. | Skip when a file's links, headings, tags, and tasks are unchanged; filter on the host. | M |
| 10g | Every launch re-reads and re-parses every note in turn (`scanner.ts:101-114`). | Cache each parsed file with its size and mtime in the SQLite store, publish it at once as stale, then reparse what changed. | L |

4e belongs here too.

---

## Piece 11. Onboarding and what's new

**Observed.** Nothing records the last version seen, so an update changes
nothing a user can see — and releases ship about daily into gears and
menus. The sample workspace's three dated tasks were due 2026-09-12, so it
opens with everything overdue or empty; no sample task has a status, though
the README says to drag one on the board; installing it takes a folder
dialog and a reload. The walkthrough never mentions tasks. First activation
in a folder of existing notes, the usual case, finishes silently. Themes,
the README's most photographed feature, can only be chosen in Settings.
Help names 29 commands as text that cannot be clicked.

**Why.** GitLens shows What's New on feature releases only, and can be
turned off (J). UserOnboard and Duolingo: sample data that shows success,
before any commitment (J). VS Code's walkthrough guidance: actions as verbs,
theme-aware images (J).

**Change.**

- **11a.** `lastSeenVersion` in `globalState`; on a minor or major bump, a
  dismissible line in Home's hint bar, "Updated to 1.23 — What's new", opening
  a What's new section of Help built from each release's three-line
  Highlights (which 1l adds). `deckard.showWhatsNew`. No toast. (M)
- **11b.** Sample dates as tokens resolved at install (one overdue, two
  today, one this week, a daily note for yesterday and today), three tasks
  with a status, installed into `globalStorageUri` by default, and the
  README opened once after the reload. (M)
- **11c.** Walkthrough steps **Capture a task** (done on `deckard.hasTasks`)
  and **Make it yours** (theme and zen); screenshots as media; a link back
  to the walkthrough from Help and Home's gear. (S)
- **11d.** On the first index of a folder with notes, once: "Deckard read
  412 notes: 1,204 open tasks (17 overdue) and 185 tags." [Open Dashboard]
  [Get Started]. (S)
- **11e.** `Deckard: Choose Theme…` with live preview and Escape to
  restore, and a Theme row beside Zen in the gear. (S)
- **11f.** Command names in Help become buttons, allowed only for ids in
  the manifest, with their keybindings. (S)
- **11g.** Later: a **Try next** Home widget offering one suggestion when the
  data for it arrives — a review on a Monday after five daily notes, a merge
  when Stats finds a lookalike — retired once run. (M)

---

## Piece 12. The Graph and Stats explain themselves

**Observed.** The graph computes communities and shows only "65
COMMUNITIES" (`notesGraphHtml.ts:619, 1525`). Four edge kinds are drawn as
one stroke (`:1388`); the screenshot workspace has 2 wiki links and 542
drawn lines, which a reader takes for links they wrote. Node size and the
tooltip's "N links" change with the density slider. Each heading is a node,
so 51 files become 485 nodes. Stats and Home show totals with no trend,
though `createdAt` and `doneAt` exist. Stats puts its fixable lists last
(`statsHtml.ts:157-178`).

**Why.** Munzner: a visual difference should mean a data difference (F).
InfraNodus and GMap name clusters where they sit (F). Tufte: "compared to
what?" (F). Serial position: what needs attention goes first (G).

**Change.**

- **12a.** Edge kinds drawn apart — wiki links solid, headings dashed, tag
  edges dotted — in the legend, with an **Only links I wrote** filter. (S)
- **12b.** Node size and tooltip from indexed degree, and the tooltip by
  kind: "4 wiki links · 2 headings · 7 tags". (S)
- **12c.** Community labels at their centroid, from their top tags, over a
  faint hull; a click filters to the group. (M)
- **12d.** Stats leads with **Needs attention** (unreadable notes, lookalike
  tags, unlinked notes, 5g's missing notes); every tile opens its list;
  empty view-count panels collapse to a line. (S)
- **12e.** 12-week sparklines under notes, tasks, and open tasks on Stats,
  "+9 this week". (S–M)
- **12f.** Later: files as nodes in the overview, expanding to headings on
  zoom (M–L); a **Tags written together** matrix on Stats (M); a usage
  histogram of tags whose "used once" bar opens them for merging (S). The
  relation-strength rail becomes part-of-whole, "in 6 of 13", rather than
  rank scaled to the strongest (S).

---

## Larger features the sources point to

Each is worth a design pass of its own before any build.

| Feature | What it is | Sources |
| --- | --- | --- |
| Parked notes | `deckard.parked` (folder globs and a tag, `#someday` or `#archived`): parked items stay searchable with `is:parked` and ranked last in Find, but leave the Tasks view, status bar, board default, rollover, Related Notes, the graph, and tag completion. **Park note / Park folder / Park tag** commands. Today the only choice is `deckard.exclude`, which removes them from search as well. | N, O, H |
| Group by any tag namespace | The Tasks view and board group by status, priority, due, or person only. "Group by namespace…" serves GTD contexts, PARA areas, and projects; inherited tags count. | N |
| Calendar day panel | Scheduled dates marked beside due dates, and a panel under the grid for the chosen day: its note, its tasks with checkboxes, the notes written that day. Changes what a click does, so behind a setting first. | C |
| Break a task into steps | **Break into Steps…** writes indented sub-tasks; cards show "2 of 5 steps · next: …"; optionally suggested by a VS Code language model, previewed. | H |
| Related Notes for untagged notes | In the `noTags` state only, BM25 over the entry under "Similar wording", and the tags those notes use, each with Add. | B |
| Excerpts in Related Notes | A two-line excerpt per card with matched words marked; a Preview lines 0 / 1 / 2 row. | A |
| Incremental index and warm start | 10e's and 10g's later halves. | K |

---

## Decisions

David decided these on 2026-09-25:

1. **Stale overdue tasks** (3): yes. An overdue task more than **30 days**
   past its date moves to a neutral, folded **Needs a new date** group, and
   leaves the status bar count and its warning color.
2. **Search pages default to rendered** (4b): yes.
3. **Overdue stays first** in the Tasks view (3a): the order is unchanged.
   3a keeps only the most-recently-slipped sort and the five-row cap.
4. **Tags in the editor keep their box** (7e): `box` stays the editor
   default. In **card views** — search pages, the board, Home, Related
   Notes — the full tag button is too loud and becomes subtler.
5. **Provenance stays on hover** (9): the current fold and overlay stay;
   E's proposal is dropped.
6. **`is:waiting`** (3g): David asked what it is for. Planned in Piece 3
   with a recommendation.

## Considered and left out

- **A global capture hotkey outside VS Code** (Raycast, Things): an
  extension cannot register one (D).
- **Streaks, points, and confetti**: a broken streak is a new source of
  shame (H, J).
- **Coach marks, tours, and tip-of-the-day toasts**: skipped by users and
  against VS Code's "don't use for promotion" (J).
- **Telemetry to measure adoption**: against "nothing leaves your
  machine" (J).
- **Hiding Markdown syntax in the editor** (Bear, Typora): decorations
  cannot remove characters without breaking the cursor; dimming (7f) gets
  most of it (A).
- **Time blocking, auto-scheduling, calendar sync, per-task reminders**:
  they need times of day, already deferred, and accounts (C, N).
- **Edge bundling, community hue, betweenness sizing** on the graph: they
  hide the connection a reader is looking for, or cost too much per rebuild
  (F).
- **Mirrors, portals, multiple parents, canvases, typed objects**: editable
  copies risk the source files, and the rest are already declined in
  `improvements.md` (B).
- **Skeleton screens and retuned debounces**: loads are under 1 s once 4e
  and 10c land, and every debounce is already under the Doherty threshold
  (K).
- **A custom Markdown editor, a front-matter form, Peacock-style tinting,
  views moved into the Explorer**: a second surface, typed schemas already
  declined, a reskin already rejected, and a move VS Code already lets the
  user make (M). A sentence in Help saying views can be dragged is enough
  (O).

## Order of work

1. Piece 1, in one pass, since each item is small and each is a bug.
2. Piece 2, since Pieces 3, 5, and 6 read dates through it.
3. Piece 4 and 10a–10d together: the search page and board are where both
   the scanning and the speed findings land.
4. Piece 3, after David's decisions 1 and 3.
5. Pieces 8 and 9, which touch every page and are best done in one sweep.
6. Pieces 5, 6, 7, 11, and 12, in any order; 5c waits on 5a.
7. The larger features, each after a design note of its own.
