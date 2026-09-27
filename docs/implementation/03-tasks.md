# Piece 3 — Tasks without the pile: implementation plan

Written 2026-09-25 against `dev` at `726d23b` (v1.22.0). Read-only research;
nothing in the repo was changed. Applies David's decisions 1, 3, and 6 from
`docs/ux-fifteen-sources-plan.md` exactly.

---

## 1. Scope

Covered: **3a, 3b, 3c, 3d, 3e, 3f, 3g, 3h, 3i, 3j**, plus **Decision 1**
("Needs a new date") and **Decision 6** (`is:waiting`).

Verified against source, with what changed after verification:

| Item | Claim | Verified? | Plan change |
| --- | --- | --- | --- |
| 3a | Overdue before Today (`agendaState.ts:70`), oldest first | Yes: `GROUP_ORDER` puts `overdue` first; `compareByDate` sorts ascending | **Per Decision 3, order unchanged.** `deckard.agenda.overdueFirst` is **dropped** (nothing to toggle). 3a keeps only most-recently-slipped sort + five-row cap. |
| Decision 1 | Status bar warns for any overdue however old (`taskStatusBar.ts:174-177`) | Yes | Planned. Setting renamed from the suggested `deckard.tasks.staleAfterDays` to **`deckard.tasks.needsNewDateAfterDays`**: "stale" already names a different thing in Deckard — Home's **Stale tasks** widget (`dashboardWidgets.ts:325`, open tasks in notes unchanged for N days). Two meanings for one word is what Piece 8e exists to remove. |
| 3b | Nothing shows what was finished; `doneAt` exists | Yes (`createAgenda` skips completed; `doneAt` parsed from ✅) | Planned. Note: a task completed with `deckard.tasks.addDoneDate: false` has no `doneAt` and cannot be counted. |
| 3c | Home's three numerals are totals (`dashboardHtml.ts:984`); default Home leads with the Tasks list (`preferences.ts:147-153`) | Yes (notes/tasks/tags; `tasks` widget before `agenda`) | Planned. Stats' `metric()` is a local function inside `statsHtml.ts:69`, not shared — it moves into the shared component script. |
| 3d | Reschedule All to Today "says nothing about it" (`agendaActions.ts:113-129`) | **Partly wrong**: `describeBulkEditResult` does say "Set the due date to 2026-09-25 on 17 results in 6 notes." What it never says is the resulting load. | Planned as "add the new total", not "add a message". |
| 3e | Upcoming is one group | Yes | Planned. |
| 3f | 40 red "overdue 20 days" cards in Doing | Yes — and it is literally the `test/ui/checkLayout.js` fixture (40 `#status/doing` tasks due 2026-09-01, NOW 2026-09-21) | Planned; board visual baselines change. |
| 3g | `is:open` includes future-start and blocked tasks "the Tasks view hides" | **Wrong in part**: the Tasks view hides neither. A future start goes to Upcoming/Later (`placeTask`, `agendaState.ts:357-390`); a blocked task is listed with "blocked by …". | `is:available` still planned (it is useful on its own), but the justification is corrected in docs. |
| 3g / D6 | `is:waiting` maps to `blocked` (`queryParser.ts:118`) | Yes; see §2.6 research | Redefined; recommendation below. |
| 3h | Rollover appends into today's note with no heading; `rolloverDays` default 0; copy mode leaves the source open | Yes (`rollover.ts:167-177`, `package.json` `rolloverDays` default 0) | Planned. `[>]` lines are not tasks to the index (`parser.ts:52` only matches `[ xX]`), so migrate needs no parser change. Heading level adapted (see §2.8). |
| 3i | Review has no look-ahead | Yes (`reviewState.ts`: Completed, Still open, Notes written/changed, New tags) | Coming up + summary figure + `reviewSections` planned. **Dropped:** "Checklist lines inside the review markers stop being indexed as tasks, so a template's 'Clear inbox' no longer piles up." The review never writes a checkbox (`formatReview` writes `- title — [[note]]`), and a template's checklist sits *outside* the markers (the template is written before the review is appended, `writeReviewInto`). The rule would change nothing. An undated template chore lands in the folded **No date** group already. |
| 3j | "People gone quiet" is people-only | Yes (`peopleRecency.ts`, widget kind `quietPeople`) | Planned; the stored kind id `quietPeople` is kept for compatibility. |

---

## 2. Design

### 2.0 One task policy for the host

A new module **`src/core/taskPolicy.ts`**, set once by `extension.ts` from
settings (the pattern `setQueryIdentity` already uses, `extension.ts:148-163`),
read by the agenda, `describeDueDate`, the evaluator, the board, and the
calendar — so no pure state function needs a new parameter threaded through
six callers.

```ts
export interface TaskPolicy {
  /** Days past its due date an open task stops being Overdue. 0 = never. */
  needsNewDateAfterDays: number;          // default 30
  statusNamespace: string;                // from deckard.board.statusNamespace
  parkedStatuses: readonly string[];      // from deckard.tasks.parkedStatuses
}
export function setTaskPolicy(p: Partial<TaskPolicy>): void;
export function getTaskPolicy(): TaskPolicy;
/** True for an open task whose due date is more than N days behind `now`. */
export function needsNewDate(dueAt: number | undefined, now: number): boolean;
/** The status written on the task's own line, in the policy's namespace. */
export function readLineStatus(task: Pick<Task, 'associationTagGroups'>): string;
```

Module defaults equal the setting defaults, so tests and the MCP/preview paths
behave as a fresh install does. Boundary: **more than** N days —
`dueAt < startOfDay(now) - N days`. A task exactly 30 days overdue is Overdue;
31 is Needs a new date.

### 2.1 Decision 1 — Needs a new date

**Setting** `deckard.tasks.needsNewDateAfterDays` — `number`, `minimum 0`,
`maximum 365`, default `30`, order after `deckard.me`.
Description: *"How many days past its due date an open task stays in Overdue.
After that it moves to the Tasks view's folded Needs a new date group, and
leaves the status bar's count and its warning color. 0 keeps every overdue
task in Overdue."*

How each surface words and colors a task past the line:

| Surface | Behavior |
| --- | --- |
| **Tasks view** | New group `needsdate`, label **Needs a new date**, icon `$(history)` uncolored, **starts folded**, placed after **No date** (before Done today, 3b). Entry reason `was due Tue 2026-07-01`. Group context value `deckardAgendaGroup.needsDate`: inline calendar icon and **Reschedule All…**, same as Overdue. Drop onto it: "Deckard cannot write…" (no single edit), as Overdue today. |
| **Tasks view badge** | Counts Overdue + Today only (unchanged filter), so these leave the badge automatically. |
| **Status bar** | Count and warning color exclude them. Tooltip adds, after the overdue names, a neutral line: `12 tasks need a new date.` (singular `1 task needs a new date.`). If only such tasks exist and nothing is due, the item stays hidden, as for a clear day. |
| **Reminder** | Counts exclude them; a day whose only open dated work needs a new date says nothing. |
| **`Deckard: Reschedule Overdue Tasks…`** | Unchanged scope: the Overdue group (via `listOverdueTasks`). The Needs a new date group has its own Reschedule All. |
| **Due wording everywhere** (`describeDueDate`: board cards, list/table, search pages, Home rows, query blocks) | New `stale: true` on `DueDescription`, `overdue: false`, label **`was due 2026-07-01`**. Colored `--muted`, never `--danger`. The existing ">30 days: date only" rule (`RELATIVE_DUE_LIMIT_DAYS`) stays for future dates and for overdue when the setting is 0. |
| **Board, grouped by due** | New non-droppable band `due:needsdate`, **Needs a new date**, after **No due date** and before Done. Its column title is `--muted`, not `--danger`. `card.overdue` false, `card.stale` true. |
| **Board, other groupings** | Card detail `was due 2026-07-01` in muted text; not counted in 3f's "N overdue". |
| **Search pages / result table** | `dueLabel` `was due …`, class `due-date stale` (muted); `resultTable` cell kind `muted` rather than `overdue`. |
| **Home** | Tasks view widget shows no rows for the group; instead a footer line (shared with 3b): `4 done today · 12 need a new date`, where "12 need a new date" is a button opening a search `is:needs-date` (scoped by `deckard.agenda.query`). The **Overdue** tile (3c) excludes them. |
| **Calendar** | A past day older than the line keeps its count but loses the warning color: class `due stale` (muted); its label/tooltip reads `3 tasks need a new date` instead of `3 tasks overdue`. The snapshot carries `needsNewDateBefore: 'YYYY-MM-DD'` (omitted when the setting is 0). |
| **Query language** | New `is:needs-date` (alias `needsdate`): open, and more than N days past due. `is:overdue` keeps its meaning (all past due) so saved searches do not change. |

Scheduled-only tasks (a `⏳` date long past, no due date) stay in Today as
they do now: the decision is about overdue tasks, and a scheduled date is not
a deadline. Listed under risks as a possible follow-up.

### 2.2 3a — Overdue: most recently slipped first, five rows

- Overdue sorts **descending** by due date (yesterday's slip first), ranks
  from `taskOrder` still leading. Order of groups unchanged (Decision 3).
- The Tasks view draws the first **5** Overdue entries, then a leaf node
  **`Show 12 more`** (`$(ellipsis)` icon, no checkbox). Selecting it runs
  hidden command `deckard.agenda.showMore` with the group id; the provider
  keeps the group expanded for the rest of the session (in memory) and
  refreshes. The group's description still shows the full count (`17`).
- **Reschedule All…** on the group, and `tasksFor`, act on all 17, not the 5
  drawn (they already read `group.entries`).
- Home's agenda widget already slices each group to its `count`; it inherits
  the new order.
- Cap applies to Overdue only, and only when grouped by due.

### 2.3 3b — Done today

- `createAgenda` option `doneToday?: boolean`. When set, a final group
  `donetoday`, label **Done today**, icon `$(pass)`, **folded**, holding tasks
  with `completed && doneAt` in `[today, tomorrow)`, newest line first. Shown
  in every grouping (appended after the grouping's own groups; excluded from
  the flatten that feeds priority/status/person groups).
- Its task items carry `checkboxState: Checked`, tooltip `Reopen this task`,
  context value `deckardAgendaDoneTask` (no date menus). Unchecking calls
  `toggleTask(task, false)` (`completeTasks` gains the Unchecked branch for
  these nodes only).
- Dropping a task on **Done today** completes it: `groupColumnId('donetoday',
  'due')` → `'done'`, which `resolveTaskMove` already turns into
  `{ kind: 'complete' }`.
- Status bar tooltip: a line `4 done today.` (only when > 0). No streaks,
  no count in the bar text.
- Home's Tasks view widget: footer line `4 done today` (joined with
  `· 12 need a new date` when both). Nothing when both are 0.
- The badge is unchanged.

### 2.4 3c — Home tiles and default order

- Header tiles become three buttons built by one shared
  `renderMetric(label, value, query, hint, code)` moved from `statsHtml.ts`
  into the shared component script (`components.ts`), used by Stats and Home:

  | Tile | Value | Opens | `title` / aria hint | `data-code` |
  | --- | --- | --- | --- | --- |
  | **Overdue** | Overdue group count | `is:overdue -is:needs-date` | `Search the overdue tasks` | `TSK.OVR // 01` |
  | **Due today** | Today group count | `is:today` | `Search what is due today` | `TSK.DUE // 02` |
  | **Open** | open tasks the agenda query selects | `is:open` | `Search every open task` | `TSK.OPN // 03` |

  When `deckard.agenda.query` is set, each count is scoped by it and each
  query becomes `(<agenda query>) AND <clause>`, so a tile's number and the
  search it opens agree, and both agree with the status bar. The group
  `aria-label` becomes `Tasks at a glance`. Values stay neutral (no red): the
  tile's label says Overdue.
- New query value **`is:today`**: open, not overdue, and due today or
  scheduled today or earlier and started — exactly the Tasks view's Today
  group. (A plain `due = today` would miss scheduled tasks and disagree with
  the status bar's "due today", which counts the Today group.)
- `createDashboardSnapshot` gains `taskGlance: { overdue, today, open,
  overdueQuery, todayQuery, openQuery }`; `totalNoteCount`/`totalTaskCount`
  stay (Stats and the empty-workspace check read them).
- `DEFAULT_DASHBOARD_WIDGETS` becomes `search, agenda, tasks, favoriteTags,
  savedSearches`: new and reset Homes lead with the Tasks view widget. Stored
  arrangements are untouched.

### 2.5 3d — More reschedule choices, and load

`pickReschedule(subject, tasks, load)` — gains the tasks it is for (for the
two new choices) and a `load(date) → { due, scheduled }` reader built in
`extension.ts` from the index and `deckard.agenda.query`.

Quick pick, in order (dates formatted `Fri 2026-09-25`, the Tasks view's form):

| Label | Description | Shown when |
| --- | --- | --- |
| `Today` | `Fri 2026-09-25 · 3 due · 1 scheduled` | always |
| `Tomorrow` | `Sat 2026-09-26 · nothing due` | always |
| `Next week` (Piece 2b renames `Next Monday`) | `Mon 2026-09-28 · 2 due` | always |
| `Spread over the next 5 days` | `Fri 2026-09-25 to Thu 2026-10-01, weekdays · 3–4 a day` | 2+ tasks |
| `3 for today, the rest next week` | `3 on Fri 2026-09-25, 14 on Mon 2026-09-28` | 4+ tasks |
| `A date…` | `friday, in 3 days, 2026-10-02` | always |
| `No due date` | — | always |

Load text: `N due`, `M scheduled`, joined by ` · `; `nothing due` when both 0.

- **Spread**: the next five weekdays starting today (Mon–Fri; Saturday or
  Sunday starts on Monday). Tasks sorted oldest due first, then priority;
  contiguous blocks, earlier days take the remainder (17 → 4,4,3,3,3).
- **3 for today**: the three with the highest priority, then oldest due; the
  rest due on the next-week date `dueDateFor('nextWeek')` (Piece 2e's
  `weekStart` moves it with the setting).
- Both write as **one** bulk write via a new `BulkEdit` kind
  `{ kind: 'dueEach'; dates: ReadonlyMap<taskId, string> }`, previewed and
  undoable like any multi-note write.
- **Message after a bulk move** (≥ 2 tasks) ends with the new load, read after
  `indexer.refresh()`:
  - to today: `Set the due date to 2026-09-25 on 17 results in 6 notes. Today now has 22 tasks.`
    (22 = the Tasks view's Today group, so the numbers match.)
  - to another day: `… Mon 2026-09-28 now has 9 tasks due.`
  - spread: `Spread 17 tasks over Fri 2026-09-25 to Thu 2026-10-01, in 6 notes. Today now has 8 tasks.`
  - 3 + rest: `Moved 3 tasks to today and 14 to Mon 2026-09-28, in 6 notes. Today now has 8 tasks.`
- Single-task messages are unchanged. The Task board's ⋯ menu dates are not
  in scope (a webview menu; Piece 9a is reworking it).

### 2.6 3g + Decision 6 — `is:waiting`, `is:available`

**Research: what `is:waiting` is today.**
- `queryParser.ts:118`: `waiting: 'blocked'` — a silent alias, so
  `is:waiting` = `is:blocked` = open and waiting on a ⛔ dependency that is
  still open.
- It appears **nowhere else**: not in `QUERY_IS_VALUES` (`queryTypes.ts:72`),
  not in the completions (`dashboardState.ts:1548-1560`), not in the parser's
  error text (`queryParser.ts:654`), not in Help (`helpHtml.ts:416-418`), the
  README query table (`README.md:741`), or the assistant tool description
  (`assistantTools.ts:36`). No test uses it.
- Meanwhile the board's **default columns are `todo`, `doing`, `waiting`**
  (`package.json` `deckard.board.statuses`; `taskBoardActions.ts:20`). So a
  user who drags a card into **Waiting** and then searches `is:waiting` gets
  a different set — the dependency-blocked tasks — which is why the word
  reads as meaningless.

**For David (two sentences):** *Today `is:waiting` is an undocumented second
spelling of `is:blocked` — tasks held up by another open task through ⛔ —
which is why it seemed to mean nothing, and why it disagrees with the board's
own Waiting column. I recommend it mean what the word and that column mean:
open tasks you are waiting on someone else for, that is, marked
`#status/waiting` or assigned with 👤 to someone other than you, while
`is:blocked` keeps meaning "held up by another task".*

**Definitions** (all open tasks only):

| Value | Meaning | Completion detail |
| --- | --- | --- |
| `is:waiting` | status (line tag in `deckard.board.statusNamespace`) is `waiting`, **or** assigned (👤) to someone who is not `deckard.me` | `Open tasks marked #status/waiting, or for someone else` |
| `is:available` (alias `available`, `actionable`) | not blocked, started (no start date or start ≤ today), and status not in `deckard.tasks.parkedStatuses` | `Open tasks you can start now: not blocked, started, not waiting or someday` |
| `is:blocked` | unchanged | unchanged |

"Someone other than me" follows `is:mine`: with `deckard.me` empty, every
assigned task is someone else's (the README/Help line says to set
`deckard.me`). `is:waiting` reads the literal status `waiting`, whatever
`parkedStatuses` holds.

**Setting** `deckard.tasks.parkedStatuses` — `array` of `string` (pattern as
`board.statuses`), default `["waiting", "someday"]`. Description: *"Statuses
that park a task: is:available leaves out a task whose #status/… tag is one of
these. Write them without the namespace, as in deckard.board.statuses."*

**Board one-click alternative.** A toggle button beside the grouping switch
under the search box: **`Can start now`**, `aria-pressed`, `title="Leave out
blocked, not-yet-started, and waiting or someday tasks (is:available)"`.
Pressing rewrites a leading `is:open` to `is:available` (or prepends
`is:available` when neither is present); unpressing rewrites it back to
`is:open`. Pressed state is derived from the query (`is:available` as a
top-level AND term). The board still opens on `is:open`.

The `deckard.agenda.query` description gains `is:available` as an example.

### 2.7 3e — Upcoming by day

- `createAgenda` option `upcomingByDay?: boolean` (Tasks view: true; Home and
  status bar: false, so Home stays compact).
- Upcoming splits into one group per day that has tasks, id
  `upcoming:YYYY-MM-DD`, label **`Tomorrow`** for tomorrow and
  **`Mon Sep 28`** otherwise (weekday short, month short, day; built by hand
  so no locale comma), count in the item description as every group does.
  Icon `$(calendar)`, expanded. Grouped by the date that placed the task (its
  soonest due/scheduled/start).
- Each day is a drop target: `groupColumnId('upcoming:2026-09-28', 'due')` →
  `due:2026-09-28`; `resolveTaskMove` gains an ISO-date branch writing that
  due date (label `Due Mon 2026-09-28`, `unchanged` when already due then).
  The README line "Overdue and Upcoming cover a range of days…" becomes
  "Overdue and Later…".
- Reschedule All on a day group works as on any group.

### 2.8 3h — Carried over, a week back, and migrate

- **Where**: carried lines go under a heading **`Carried over`** at the end of
  today's note (below today's own lines). If today's note already has a
  `Carried over` heading, they are appended to that section
  (`getCaptureInsertion` with its bounds), so a second run adds under the
  same heading. Heading level: **one deeper than the note's first heading**
  (default template `# {date}` → `## Carried over`), `##` when the note has
  no heading. The plan text said `###`; under the default `# {date}` template
  that skips a level, so the level follows the note. (Design choice, not a
  question.)
- **`deckard.dailyNote.rolloverDays`** default **7** (was 0). Description:
  *"How many days back a rollover looks for unfinished tasks. 7 by default;
  0 reaches as far back as your daily notes go."* Older dated tasks surface
  in Needs a new date anyway.
- **Migrate** replaces copy. Enum becomes `off`, `move`, `migrate`, `copy`,
  with `copy` described *"Older name for migrate."* and read as `migrate`.
  Migrate writes the task into today's note unchanged and rewrites the source
  line from `- [ ] Call Ren 📅 2026-09-20` to
  `- [>] Call Ren 📅 2026-09-20 → [[2026-09-25]]`, where the link target is
  today's daily note name (`getPeriodicNote('day', now).name`). `[>]` is not a
  task to the parser (`parser.ts:52`), so the source stops counting as open,
  which also ends Piece 1b's multi-day duplication for this mode. The
  `→ [[…]]` is an ordinary wiki link, so the old note links forward and
  today's note gets a backlink.
- enumDescriptions: `move` *"Move the unfinished tasks into today's note,
  under Carried over."*; `migrate` *"Copy them into today's note and mark
  each one left behind [>] with a link to today, as a bullet journal
  does."*
- Messages: `Migrated 4 unfinished tasks forward from 2026-09-24.` (verb per
  mode; `describeRollover` gains the third verb).

### 2.9 3i — Reviews look ahead

- `ReviewSummary.comingUp: ReviewItem[]` — open tasks whose due, scheduled,
  or start date falls in the **next** period (next week / next month, via
  `getReviewRange(period, firstDayOfNextPeriod)`), sorted by that date, each
  line led by its day: `- Mon 2026-09-28 · Call Ren — [[2026-09-21]] (due)`
  (detail `due` / `scheduled` / `starts`). A task with several dates in the
  period is listed once, by its earliest.
- Section **`### Coming up`** after **Still open**; empty text:
  `Nothing is due, scheduled, or starting next week.` (`next month`).
- Summary line gains the figures: `**Done:** 12 · **Still open:** 5 ·
  **Coming up:** 9 · **Notes:** … · **New tags:** …`, and `**Done:**` shows
  on-time share when anything was due in the period: `**Done:** 12 (8 of 11
  that were due)`.
- **Setting** `deckard.periodicNote.reviewSections` — `array` of
  `{ title: string, query: string }`, default `[]`. Description: *"Sections of
  your own at the end of a review, each a title and a Deckard search, such as
  { "title": "Waiting on others", "query": "is:waiting" }. Written as a plain
  list when the review is written, so it says what was true then."* Each
  section: `### <title>`, up to 20 lines, tasks as `- title — [[note]]`, notes
  as `- [[note]]`; a query that does not parse writes
  `This search does not parse: <diagnostic>.` rather than failing the review.
- The message after writing gains the look-ahead: `Wrote the review of
  2026-09-20 to 2026-09-26: 12 done, 5 still open, 9 coming up.`

### 2.10 3j — Gone quiet

- Widget label **Gone quiet** (kind id `quietPeople` kept in storage);
  description `People, projects, or any namespace you have not written about
  lately`.
- Widget gear gains **Namespace** (select of namespaces in the index; default
  `person`) and a checkbox **Only those with no open tasks**.
  `DashboardWidgetConfig` gains `namespace?: string` and `noOpenTasks?:
  boolean`, normalized in `preferences.ts` (namespace validated against
  `^[A-Za-z][A-Za-z0-9_-]*$`, max 64).
- `listQuietTags(index, now, days, { namespace, noOpenTasks })` generalizes
  `listQuietPeople`; open-task counts include tasks that **inherit** the tag
  from their heading or front matter (a project tag usually sits on the
  heading).
- With **Only those with no open tasks**, each row gets a row action
  **`Add next action`** (title `Capture a next action for #project/atlas`),
  posting `addNextAction { tagKey }`. The host asks with an input box titled
  `Next action for #project/atlas` (prompt as `captureIntoColumn`'s), appends
  the tag with `appendTagToLine`, and captures to today's note through
  `captureToToday`. That pairing is GTD's stuck-projects review.
- Empty states: `Every <namespace> tag has come up in the last 90 days.` /
  with the filter `Every <namespace> tag written in the last 90 days has an
  open task.` (namespace shown via `formatEntityKindLabel`).

---

## 3. Implementation steps

### 3.0 Policy module (lands with Decision 1, commit 2)
- Add `src/core/taskPolicy.ts` (§2.0). `readLineStatus` lifts the logic of
  `groupByStatus.statusOf` (`agendaState.ts:274-278`) so the agenda, the
  evaluator, and `is:available` share it.
- `extension.ts`: next to `readIdentity`, `readTaskPolicy()` from
  `tasks.needsNewDateAfterDays`, `board.statusNamespace`,
  `tasks.parkedStatuses`; re-read on `affectsConfiguration` of those three;
  reset on dispose.
- Views that must redraw on change: `AgendaTreeProvider` already refreshes on
  `deckard.agenda`; extend to `deckard.tasks`. `TaskStatusBar` — add
  `deckard.tasks.needsNewDateAfterDays`. Dashboard/board/calendar/search pages
  already rebuild on config change for `deckard.agenda`/`deckard.board`
  (`dashboard.ts:110`); add `deckard.tasks.needsNewDateAfterDays` to each
  page's listener.

### 3.1 Decision 1 files
- `agendaState.ts`: `GROUP_ORDER` + `needsdate` after `nodate`;
  `GROUP_LABELS.needsdate = 'Needs a new date'`; `placeTask` checks
  `needsNewDate(dueAt, now)` before the overdue branch, reason
  `was due ${formatDay(dueAt)}`; sort by date ascending (oldest first is fine
  in a folded list). `createAgenda` passes `now` into `placeTask`.
- `agendaTree.ts`: icon, `FOLDED_GROUPS` + `needsdate`, context value
  `deckardAgendaGroup.needsDate`.
- `package.json` menus: the inline `deckard.agenda.reschedule` `when` becomes
  `viewItem =~ /^deckardAgendaGroup\.(overdue|needsDate)$/`.
- `taskStatusBar.ts`: `DueTaskCounts.needsNewDate`; tooltip line.
- `taskMetadata.ts` `describeDueDate`: `stale` flag and `was due` label when
  `needsNewDate` (imports the policy).
- Consumers of `.overdue`: `dashboardState.createDashboardTask` (add
  `stale`), `components.ts:2110` (`due-date stale`), `resultTable.ts:149-150`
  (kind `muted`), `queryBlockHtml.ts:259-271` (`is-stale` class, muted),
  `taskBoardState.createCard` (`overdue` false, `stale` true) and
  `getDueBand` → `needsdate` band; `DUE_BANDS` gains
  `['needsdate', 'Needs a new date', false]` after `''`.
- CSS in `components.ts`: `.due-date.stale, .task .board-details .stale {
  color: var(--muted); }`; `.board-column[data-column-id="due:needsdate"]
  .board-column-title { color: var(--muted); }`.
- `calendarState.ts`: `needsNewDateBefore`; `calendarHtml.ts` `renderDay` /
  `describeDay` gain the stale branch; `.due.stale { color: var(--muted); }`.
- `queryTypes.ts` `QUERY_IS_VALUES` + `needs-date`; `queryParser.ts` aliases
  `needs-date`, `needsdate` and the error text; `queryEvaluator.matchesIs`
  case; completion in `dashboardState.IS_SUGGESTIONS` and `:1594`;
  `assistantTools.ts:36`.
- `dashboardWidgets.ts` agenda case: drop `needsdate` rows, add
  `needsNewDate: number` and `needsNewDateQuery`; `dashboardHtml.ts` agenda
  renderer footer.
- Edge: setting 0 → `needsNewDate` always false; every branch above is a
  no-op and output is byte-identical to today (a test asserts this).

### 3.2 3a
- `agendaState.ts`: overdue uses a descending date comparator
  (`compareByDateDescending`), still under `byRank`.
- `agendaTree.ts`: `AgendaNode` gains `{ kind: 'more'; groupId; hidden }`;
  `getChildren(group)` returns 5 + `more` for `overdue` unless the group id is
  in `this.expanded`; `getTreeItem` for `more`: label `Show ${n} more`,
  command `deckard.agenda.showMore`. `tasksFor` ignores `more` nodes;
  `handleDrag` already filters to tasks; `handleDrop` onto `more` is a no-op.
- `extension.ts`: register `deckard.agenda.showMore` →
  `agenda.showMore(groupId)`. `package.json`: command contributed with
  `commandPalette` `when: false`.

### 3.3 3b
- `agendaState.ts`: `doneToday` option; `donetoday` group built from
  `tasks` where `completed && doneAt ∈ [today, tomorrow)`; appended after
  grouping; label `Done today`.
- `agendaTree.ts`: pass `doneToday: true`; task item for completed entries;
  `completeTasks` handles `Unchecked` → `toggleTask(task, false)`;
  `FOLDED_GROUPS` + `donetoday`; `groupColumnId('donetoday','due')` → `'done'`.
- `taskStatusBar.ts`: `countDueTasks` returns `doneToday`; tooltip line.
- `dashboardWidgets.ts`: `doneToday` on the agenda widget; `dashboardHtml.ts`
  footer `<p class="home-widget-footer">`.
- Edge: `deckard.agenda.query` containing `is:open` in the middle hides done
  tasks from the group; acceptable (the query said open).

### 3.4 3c
- `components.ts`: `renderMetric(label, value, query, hint, code)` in
  `getComponentScript()`; `statsHtml.ts` calls it (keeps its markup).
- `dashboardState.createDashboardSnapshot` (options gain `agendaQuery`, `now`)
  computes `taskGlance` with `createAgenda` + `selectAgendaTasks`.
  `dashboard.ts:344` passes them.
- `dashboardHtml.ts:983-987`: three tiles via `renderMetric`, click handled by
  the existing `open-search` action (`dashboardHtml.ts:1106`).
- `queryEvaluator.matchesIs('today')`; parser/types/completions/help.
- `preferences.ts:147-153` reorder.
- Edge: `is:today` must equal the Today group exactly — a unit test runs
  both over the same fixture.

### 3.5 3d
- `bulkEdit.ts`: `BulkEdit` + `dueEach`; `rewrite` reads
  `edit.dates.get(task.id)`; `describeBulkEdit`/`describeBulkEditResult`
  wordings.
- `agendaActions.ts`: `planSpread(tasks, now)`, `planThreeToday(tasks, now)`
  (pure, exported for tests); `pickReschedule(subject, tasks, load)` returns
  `{ kind: 'one'; date } | { kind: 'each'; dates } | null`; `setTasksDue`
  accepts either and returns the `BulkEditResult`.
- `extension.ts:474-510`: `dueFromView` and `deckard.rescheduleOverdue` build
  `load` from `indexer.getSnapshot()` + agenda query; after a bulk write,
  `await indexer.refresh()` then append the load sentence to the message
  (moved out of `setTasksDue` into a `describeLoadAfter(date, counts)` helper).
- Edge: tasks whose line changed are skipped (existing check) and the load is
  read from the refreshed index, so it is true either way.

### 3.6 3e
- `agendaState.ts`: `upcomingByDay` splits `upcoming` into day groups
  (labels via a `formatShortDay` helper; `Tomorrow` special case).
- `agendaTree.ts`: pass the option; `GROUP_ICONS` lookup by prefix;
  `groupColumnId` maps `upcoming:<date>` → `due:<date>`.
- `taskBoardState.resolveTaskMove` `due` branch: ISO date value.

### 3.7 3f
- `types.ts`: `TaskBoardColumn.overdueCount: number`, `limit?: number`;
  `TaskBoardCard.overdueTone?: 'full' | 'quiet'`, `stale?: boolean`.
- `taskBoardState.layoutTaskBoard`: per column (not `done`, not
  `due:overdue`): `overdueCount`; if `overdueCount * 2 > openCount`, sort the
  overdue cards by days overdue descending (ties by column order) and mark the
  first `ceil(k/3)` `full`, the rest `quiet`; otherwise all `full`.
  `limit` from `deckard.board.limits` matched by status value (`doing`) or
  full column id (`priority:high`). Counts include cards hidden by Piece
  10d's per-column cap.
- `TaskBoardOptions.limits?: Record<string, number>`; read in
  `readTaskBoardOptions` / `taskBoard.ts`.
- `components.ts renderTaskBoard`: header count `40 / 3 · 38 overdue`
  (`/ limit` only with a limit; `· N overdue` only when N > 0); column class
  `over-limit` when `count > limit` → `outline: var(--edge) dashed
  var(--line-strong)`; aria-label `Doing, 40 tasks, limit 3, 38 overdue`.
  `renderTaskBoardCard`: `quiet` → `<span class="overdue quiet">` styled
  `color: var(--muted)` with a `::before` 6px `--danger` dot; text unchanged
  ("overdue 20 days · 2026-09-01"), so the state is still in words.
- **Setting** `deckard.board.limits` — `object`, `additionalProperties:
  { type: integer, minimum: 1 }`, default `{}`. Description: *"Work-in-progress
  limits for board columns, by status, such as { "doing": 3 }. A column over
  its limit shows its count against it, 5 / 3, with a neutral outline. A drop
  is never refused."*
- Edge: filtering by typed words (`isVisible`) recounts shown cards; the
  overdue count follows the same filter.

### 3.8 3g
- `queryEvaluator.createTaskUnit`: `status: readLineStatus(task)`,
  `started: startAt === undefined || startAt < tomorrow`.
- `matchesIs`: `waiting`, `available` cases; parser aliases (`waiting` no
  longer → `blocked`; `available`, `actionable` → `available`); types,
  completions, error text, assistant tool description.
- `taskBoardHtml.ts`: the toggle beside the grouping switch; message
  `setBoardQuery` with the rewritten query (pure helper
  `toggleAvailable(query)` in `queryEdit.ts`, unit-tested).
- `package.json`: `deckard.tasks.parkedStatuses`.
- Builder parity: the query builder's `is:` value list reads the completions,
  so `is:available`, `is:waiting`, `is:today`, `is:needs-date` appear there
  too (verify in `query-builder-webview.test.ts`).

### 3.9 3h
- `rollover.ts`: `RolloverMode` + `migrate` (read `copy` as `migrate`);
  `applyRollover` builds the insertion under the `Carried over` section
  (`findCarriedOverSection(todayText)`, heading-level rule); migrate branch
  replaces the source line with `markMigrated(line, checkboxColumn,
  todayName)`; `describeRollover` verb `Migrated`.
- `getRolloverLookbackDays` default 7; `package.json` default, enum,
  descriptions.
- Edge: today's note already containing the line (rerun) → skipped as now;
  source line with trailing spaces → trimmed before ` → [[…]]`; a task with
  children (indented sub-lines) — only the task line moves, as today.

### 3.10 3i
- `reviewState.ts`: `summarizeReview(index, range, { next, sections })` adds
  `comingUp`, `dueInPeriod`, `doneOnTime`, `custom[]`; `formatReview` writes
  them.
- `review.ts`: computes `next` via `getReviewRange(period, dayAfter(range))`,
  reads `periodicNote.reviewSections`, evaluates each with `parseQuery` +
  `evaluateQuery`; message wording.
- `package.json`: the setting with an items schema
  (`required: ["title", "query"]`).

### 3.11 3j
- `peopleRecency.ts`: `listQuietTags` (kept `listQuietPeople` as a wrapper);
  inherited open-task counting.
- `types.ts` / `preferences.ts`: config fields + normalization.
- `dashboardWidgets.ts`: `quietPeople` case reads the config; label
  `Gone quiet`.
- `dashboardHtml.ts:306, 740, 775`: kind label/description, gear controls
  (new actions `set-widget-namespace`, `set-widget-no-open-tasks`), row action
  `add-next-action`.
- `dashboard.ts`: handlers for the two settings and `addNextAction` →
  `captureNextAction(tagLabel)` in `taskBoardActions.ts` (beside
  `captureIntoColumn`).

---

## 4. Tests

All four gating suites must pass on every commit: `npm test`,
`npm run test:ui`, `npm run test:e2e`, `npm run test:layout` — by exit code.

| Commit | Suite | Test file | Asserts |
| --- | --- | --- | --- |
| 1 (3a) | npm test | `agenda.test.ts` | Overdue sorted yesterday-first; ranks still lead. New `agenda-tree.test.ts` (or `extension.test.ts` provider section): 17 overdue → 5 task nodes + `Show 12 more`; after `showMore`, 17; `tasksFor(group)` returns 17. |
| 2 (D1a) | npm test | `agenda.test.ts`, `task-status-bar.test.ts`, new `task-policy.test.ts` | 30 days → Overdue, 31 → Needs a new date; group folded and last; `countDueTasks` excludes it; tooltip text `12 tasks need a new date.`; setting 0 reproduces today's groups exactly. |
| 3 (D1b) | npm test | `due-date-wording.test.ts`, `task-board.test.ts`, `calendar.test.ts`, `task-query.test.ts`, `dashboard-widgets.test.ts`, `result-table.test.ts`, `query-block.test.ts` | `was due 2026-07-01` label, `stale` true / `overdue` false; board `due:needsdate` band; calendar `needsNewDateBefore`; `is:needs-date` matches only past-the-line tasks; Home footer data. |
| 3 | test:ui | `messages-rendering.test.ts` / webviewPage jsdom | search row `.due-date.stale` not `.overdue`; calendar cell `.due.stale` and label `need a new date`. `checkContrast.js` covers the muted text. |
| 4 (3b) | npm test | `agenda.test.ts`, `task-status-bar.test.ts`, `dashboard-widgets.test.ts` | Done today holds only tasks with `doneAt` today; folded; unchecking reopens (provider test with stubbed `toggleTask`); `groupColumnId('donetoday','due') === 'done'`; footer `4 done today`. |
| 5 (3e) | npm test | `agenda.test.ts`, `task-board.test.ts` | Day groups `Tomorrow`, `Mon Sep 28`; option off keeps one Upcoming; `resolveTaskMove(task, 'due:2026-09-28')` writes that date. |
| 6 (3g) | npm test | `task-query.test.ts`, `query-language.test.ts`, `query-builder-webview.test.ts` | `is:waiting` = status waiting ∪ assigned-not-me; no longer equals `is:blocked`; `is:available` excludes blocked, future start, `#status/someday`; parked list from policy; completions and error text list the new values; `toggleAvailable` round-trips. |
| 6 | test:e2e | `taskBoard.e2e.js` | Pressing **Can start now** posts `setBoardQuery` with `is:available`, shows pressed; unpress restores `is:open`. |
| 7 (3c) | npm test | `dashboard-behavior.test.ts`, `view-state.test.ts`, `preferences.test.ts`, `stats.test.ts` | Tiles labeled Overdue / Due today / Open with values equal to `countDueTasks`; each carries its `data-query` (scoped by agenda query); `is:today` result set === Today group; default widget order; Stats still renders its tiles through `renderMetric`. |
| 7 | test:e2e | `dashboardHome.e2e.js` (lines ~170, ~299) | Default/reset order `search, agenda, tasks, favoriteTags, savedSearches`; clicking a tile posts `openSearch` with its query. |
| 8 (3d) | npm test | `agenda-actions.test.ts`, `bulk-edit.test.ts` | `planSpread` 17 → 4,4,3,3,3 on weekdays, weekend start moves to Monday; `planThreeToday` picks by priority then oldest; `dueEach` rewrite per task; wording of result and load sentences. |
| 9 (3f) | npm test | `task-board.test.ts`, `task-board-page.test.ts` | `overdueCount`; >half rule marks top third `full` (ties by order), rest `quiet`; ≤half all `full`; `due:overdue` column exempt; limits by status and by id. |
| 9 | test:ui | jsdom board render | header text `40 / 3 · 38 overdue`, `over-limit` class, aria-label; quiet spans keep the word "overdue". |
| 9 | test:layout | `checkLayout.js` | board fixture still passes (header wraps without clipping at 1400px; quiet dot does not widen cards). |
| 10 (3h) | npm test | `rollover.test.ts` | Heading created once and reused; level follows first heading; `copy` reads as migrate; migrated source line `- [>] … → [[2026-09-25]]`; source no longer an open task after reindex; default lookback 7. |
| 11 (3i) | npm test | `review.test.ts` | Coming up covers next week only, sorted, deduped per task; summary figures; custom section frozen text; unparsable query writes the notice. |
| 12 (3j) | npm test | `people-recency.test.ts`, `dashboard-widgets.test.ts`, `preferences-invariants.test.ts` | namespace `project`; inherited tasks count; `noOpenTasks` filter; config normalization rejects bad namespace. |
| 12 | test:e2e | `dashboardHome.e2e.js` | Gear shows Namespace and the checkbox; `Add next action` posts `addNextAction`. |

**Visual baselines to re-record** (`npm run test:visual -- --update`,
`test/ui/visual-baseline/darwin`):
- After **3g** (toggle under the board's search box) and **3f** (header
  counts, quiet dates on the 40-card Doing column): all 20 `*-taskBoard.png`
  and `*+zen-taskBoard.png`. Planned as one `test:` commit after both.
- `*+zen-searchPage.png`: not affected (fixture tasks are 20 days overdue, under
  the line; no search-page chrome changes). Re-check anyway.
- `*-sidebarNotes.png`: not affected.
- No Home or calendar baselines exist.

---

## 5. Docs

**README.md**
- *Tasks view* (`README.md:482-505`): Overdue "most recently slipped first,
  five at a time, **Show N more** for the rest"; new bullets for **Upcoming**
  by day (drop to date), **Needs a new date**, **Done today**; drop-target
  sentence ("Overdue and Later cover a range…"); badge sentence unchanged.
- *Status bar and reminders* (`:507-515`): tasks past the line leave the
  count and color; tooltip lines for need-a-new-date and done today.
- *Task board* (`:517-537`): column header counts, quiet dates, limits,
  **Can start now**, the **Needs a new date** band; due-wording bullet adds
  `was due …`.
- *Home* widget table (`:384`, `:394`-area): tiles; **Gone quiet** row
  replaces People gone quiet; default order sentence.
- *Query language* table (`:741`): `is:today`, `is:needs-date`,
  `is:available`, `is:waiting` (with the plain explanation), `is:blocked`
  unchanged.
- *Writing a review* (`:849-869`): Coming up, figures, `reviewSections`.
- *Carrying unfinished tasks forward* (`:871-887`): Carried over heading,
  7-day default, migrate.
- *Settings* table: `tasks.needsNewDateAfterDays`, `tasks.parkedStatuses`,
  `board.limits`, `periodicNote.reviewSections`, changed defaults/enums for
  `dailyNote.rollover` and `rolloverDays`; the settings JSON sample
  (`:933-934`).
- Optional: retake `docs/images/agenda.png` and `task-board.png` after 3f (not
  a blocker; Piece 11b's sample dates would make a better shot).

**Help** (`src/ui/webview/helpHtml.ts`)
- `:391` Tasks view card: Show more, Upcoming by day, Done today, Needs a new
  date.
- `:395` "What is due": `was due …` wording and what leaves the status bar.
- `:416-418` query table: the four values.
- `:369` Dependencies card: unchanged, but add "`is:waiting` is for people,
  not dependencies."
- `:461` Home widget list: "gone quiet" wording.
- `:481-482` Carrying tasks forward and Reviews cards.
- `COMMAND_DESCRIPTIONS`: nothing new in the palette (`showMore` is hidden).

**CHANGELOG.md** `## Unreleased` (whatever section Piece 1l leaves open):
- Added: Needs a new date; Done today; Upcoming by day; Home task tiles;
  spread / 3-today reschedule and load; board overdue counts and limits;
  `is:available`, `is:today`, `is:needs-date`; review Coming up and custom
  sections; Gone quiet for any namespace with Add next action.
- Changed: Overdue order and five-row cap; `is:waiting` now means waiting on
  someone (was an undocumented alias of `is:blocked`); rollover writes under
  Carried over, looks back 7 days by default, and `copy` now migrates (source
  marked `[>] → [[today]]`); default Home order.

**docs/components.md**
- *Design tokens* `--danger` row: add "a task past `needsNewDateAfterDays` is
  `--muted`, not `--danger`".
- *Surfaces → Task board*: `.board-count` format, `.board-column.over-limit`,
  `.overdue.quiet`.
- *Page script helpers*: `renderMetric` in the shared script, used by Home and
  Stats; `.metrics` row notes the Home tiles are buttons (`.metric-open`).
- *Home*: footer line `.home-widget-footer`.

---

## 6. Commits

Each is independently shippable and passes the four suites. Subjects follow
the repo's plain-sentence style.

1. `feat: overdue tasks list the most recently slipped first, five at a time` — 3a.
2. `feat: a task a month past its date waits under Needs a new date, out of the status bar's count` — policy module, setting, Tasks view group, badge, status bar, reminder.
3. `feat: a task that needs a new date says when it was due, without the red, wherever it is listed` — `describeDueDate`, board band and cards, search pages, query blocks, calendar, Home footer, `is:needs-date`.
4. `feat: the Tasks view shows what was done today, and the status bar says how many` — 3b.
5. `feat: Upcoming lists each day on its own, and a task dropped on a day is due that day` — 3e.
6. `feat: is:waiting means waiting on someone, and is:available finds what can be started now` — 3g + Decision 6, board toggle.
7. `feat: Home leads with what is overdue, due today, and open, each a search` — 3c + `is:today`, shared `renderMetric`, default order.
8. `feat: rescheduling can spread tasks over the week, and says how full a day is` — 3d.
9. `feat: a board column counts its overdue cards, keeps red for the worst, and takes a limit` — 3f.
10. `test: re-record the board baselines for Can start now, overdue counts, and quieter dates` — baselines after 6 and 9.
11. `feat: carried tasks go under Carried over, a week back, and migrate rather than copy` — 3h.
12. `feat: a review looks ahead at what is coming up, and takes sections of your own` — 3i.
13. `feat: Gone quiet watches any namespace, and a project with nothing open offers a next action` — 3j.
14. `docs: the tasks pile is gone from the README, Help, and the component notes` — only if any doc text was deferred; otherwise each feat carries its own README/Help/CHANGELOG lines (preferred, and the repo's habit).

---

## 7. Size, risks, dependencies, questions

**Size:** about **11 days**.
3a 0.5 · D1 (2 commits) 2 · 3b 1 · 3e 0.5 · 3g 1 · 3c 1 · 3d 1.5 · 3f 1.5 ·
baselines 0.25 · 3h 1 · 3i 1 · 3j 1.

**Risks**
- **`copy` users' old notes start being rewritten** (`[>] … → [[today]]`) on
  their next new daily note. Approved in the plan, but it is the one change
  here that writes into notes a user did not touch. Mitigation: CHANGELOG
  "Changed" entry; the rollover message says `Migrated`; Undo covers it.
- **`rolloverDays` 0 → 7** stops carrying tasks older than a week for users on
  the default. Dated ones show under Needs a new date; undated ones stay in
  their old note, visible in No date.
- **`is:waiting` meaning changes.** It was undocumented; any saved search or
  query block using it will now list different tasks. CHANGELOG notes it.
- Module-level policy is global state: tests must reset it (`setTaskPolicy`
  in `setup`/`teardown`), as `setQueryIdentity` tests do.
- Existing tests whose fixtures are > 30 days overdue will change groups;
  audit `agenda`, `task-board`, `dashboard-widgets`, `due-date-wording`.
- Scheduled-only tasks long in the past still pile in Today; not covered by
  Decision 1 (possible follow-up: apply the same line to `scheduledAt`).
- `taskStatusBar.ts` is also rewritten by Piece 1h (reminder loop): expect a
  merge; land 1h first.

**Dependencies**
- **Piece 2** (dates): 2a `parseDatePhrase` for "A date…"; 2b renames "Next
  week" → "Next Monday" and the validation message (3d's load can be appended
  to it); 2e `weekStart` for "the rest next week", the spread's week, and the
  review's next period. All Piece 3 commits ship without Piece 2, using
  today's `parseTaskDateInput` and `dueDateFor`.
- **Piece 1**: 1b (copy-mode dedupe) is superseded for rollover by migrate but
  harmless; 1h touches the status bar; 1l decides where `## Unreleased` is.
- **Piece 4**: 4h moves the board's Tasks view button into the gear — place
  **Can start now** beside the grouping switch, not in that action row; 4e
  reorders `createSearchPageSnapshot` (touches `createDashboardTask`, where
  the stale label lands).
- **Piece 8**: 8d rewrites the Tasks view's empty state; 8e glossary (the
  rename away from "stale" follows it).
- **Piece 9**: 9a menus (board ⋯ date items left alone here); `renderMetric`
  is a small instance of 9's shared primitives.
- **Piece 10**: 10d caps cards per column — 3f counts must include hidden
  cards.
- **Piece 11**: 11b's sample tasks (one overdue, two today, three with a
  status) will exercise tiles, Done today, and the board toggle.
- **Larger feature "Parked notes"** will add `is:parked` for notes; keep
  `deckard.tasks.parkedStatuses` (statuses) distinct from `deckard.parked`
  (paths/tags) in the docs.

**Open questions for David:** none required. One to confirm if he wants:
the setting is named `deckard.tasks.needsNewDateAfterDays` rather than
`staleAfterDays` because Home's **Stale tasks** widget already uses "stale"
for something else.
