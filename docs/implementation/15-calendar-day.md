# 15. Calendar day panel

Planned against `dev` at `726d23b` (v1.22.0). Source: `docs/ux-fifteen-sources-plan.md`, "Larger features the sources point to" → **Calendar day panel** (source C), and Decision 1 (stale overdue > 30 days → neutral "Needs a new date").

## 1. Scope

Covered, as items 15a–15f:

| # | Item | Status after verification |
| --- | --- | --- |
| 15a | Scheduled (⏳) dates counted beside due dates, as a second, hollow count; tooltip and aria-label "2 due, 1 scheduled" | Confirmed. `createCalendar` (`src/ui/state/calendarState.ts:95-107`) counts only `!task.completed && task.dueAt`; `Task.scheduledAt` exists (`src/core/types.ts:199`) and is never read by the calendar. |
| 15b | Stale overdue (Decision 1) colors past days neutral | Confirmed. The page colors any past due count `--warning-orange` (`calendarHtml.ts:43`, `renderDay` computes `overdue = day.date < state.today`), however old. |
| 15c | Focus survives a calendar redraw | **Found while verifying, added.** The calendar's `render()` sets `innerHTML` directly and does not use `renderKeepingPlace` (added in 9621447 for the other pages), and `PLACE_KEYS` (`components.ts:1009`) has no `date`, so every state message — a save anywhere, or PageUp/PageDown — drops keyboard focus to `body`. `state.focusDate` is also lost because the new state object replaces the old one. The day panel makes this worse (each selection is a round trip), so it is fixed first. |
| 15d | Day panel: selection model (click / arrows select, Enter / double-click / note row open), behind a setting | Confirmed: today every click posts `openDay` (`calendarHtml.ts:139`). |
| 15e | Day panel: tasks due or scheduled that day, with checkboxes and a Tomorrow action; tasks done that day, folded | Confirmed feasible: `toggleTask`, `setTaskDate(line, col, 'scheduled' \| 'due', …)`, `openTask`, `createDashboardTask` + `renderTaskListRow` exist. "Done that day" is an addition (reopen = undo for a mis-click, parity with Piece 3b). |
| 15f | Day panel: notes created that day | Confirmed: `ParsedFile.createdAt` exists; `created = 2026-09-25` is already a valid query (`resolveDateRange` absolute branch), so "Search all" needs no query work. |

Nothing dropped. Week start is **not** implemented here (Piece 2e owns `deckard.calendar.weekStart`); this plan only stays compatible with it.

## 2. Design

### 2.1 Setting and rollout (decided)

The panel changes what a click does, which users have learned. It ships **behind a setting, off**, in the first release that carries it; the scheduled count (15a), the stale color (15b), and the focus fix (15c) ship to everyone because they change no behavior.

`deckard.calendar.dayPanel` — General section, next to Piece 2e's `deckard.calendar.weekStart`.

- type `boolean`, default `false`, scope `window`
- `markdownDescription`: "Show the chosen day under the Calendar: its daily note, the tasks due or scheduled that day, and the notes created that day. A click then chooses a day; a double-click or Enter opens its note. When off, a click opens the day's note straight away."

Reachable without Settings: two commands in the Calendar view's title-bar `…` menu (never on the palette: `commandPalette` `"when": "false"`, per 4a40253's rule that the palette offers a command only where it can run):

- `deckard.calendar.showDayPanel` — title "Show Day Panel", `view/title` when `view == deckard.calendar && !config.deckard.calendar.dayPanel`
- `deckard.calendar.hideDayPanel` — title "Hide Day Panel", when `view == deckard.calendar && config.deckard.calendar.dayPanel`

Both write the setting globally (`ConfigurationTarget.Global`), or to the workspace when a workspace value already exists (the board's `updateTaskBoardSetting` rule).

Recommended follow-up (commit 8, held for the release after): flip the default to `true`, with a CHANGELOG line saying how to get the old click back. Listed as the one open question.

### 2.2 The grid (everyone)

Each day keeps its three fixed rows (date, note dot, counts), so nothing moves.

- **Counts row**: the due count as today (filled, colored), then the scheduled count **hollow**: `.scheduled-count { color: var(--muted); border: 1px solid currentColor; border-radius: 3px; padding: 0 1px; line-height: 11px; }`, `gap: 2px`, `font-size: var(--text-xs)` (the 11px floor stays).
- **Narrow cells**: at 240px a cell is ~27px. When both counts are ≥ 10 (or either ≥ 100), the scheduled number is replaced by a 5px hollow ring (`.scheduled-ring`); the exact numbers stay in the tooltip and label. A task due **and** scheduled the same day counts once, as due.
- **Scheduled is never orange**; a past scheduled date on an open task is still counted, neutral.
- **Due color by age** (host decides, `dueState` on the day): `due` (today/future, `--positive` green as now), `overdue` (1–30 days past, `--warning-orange` as now), `stale` (more than 30 days past: `--muted`, no warning hue). The day's date alone decides, so the whole day is one state.
- **aria-label / tooltip first line** (replaces `describeDay`): ISO date, then "today", "daily note", then the counts:
  - `2026-09-25, today, daily note, 2 due, 1 scheduled`
  - `2026-09-18, 3 overdue`
  - `2026-08-12, 3 need a new date` (one: `1 needs a new date`)
  - `2026-10-02, 1 scheduled`
- **Tooltip lines** after it: `☐ Call Ren` per due task, `⏳ Draft the brief` per scheduled task (five each at most, `TOOLTIP_ITEMS`), then `# heading` lines as now. With the panel on, the last line is `Double-click or Enter opens the daily note.`

### 2.3 Selection (panel on)

- Click or Space on a day **selects** it; the gridcell gets `aria-selected="true"`, the button `.selected` (`background: var(--hover-bg); color: var(--hover-fg); box-shadow: inset 0 -2px 0 var(--accent)`); today keeps its amber border, so "today" and "chosen" read apart.
- Arrow keys, Home, End move focus **and** selection (selection follows focus, ARIA grid). The page marks the new day at once and posts `selectDay` after 120 ms of quiet, so a held arrow does not flood the host.
- PageUp / PageDown and the ‹ › buttons change month; the selection moves to the same day of the month, clamped (Jan 31 → Feb 28). A step past the drawn weeks selects the day it stepped to.
- Enter or double-click on a day opens its note, exactly as a click does today (open, or "There is no note for 2026-10-02 yet. [Create]").
- **Today** button: shown when the month is not this month **or** the selected day is not today; returns to this month and selects today.
- Default selection is today, held by the host as "no explicit selection", so after midnight it follows the new today. An explicit selection lasts while the view provider lives.
- Week rail and month title are unchanged.
- Panel off: click opens (unchanged), arrows move focus only, no `aria-selected`.

### 2.4 The panel (panel on)

A `<section class="day-panel" aria-labelledby="day-title">` under the grid, `border-top: 1px solid var(--line)`, `margin-top: var(--space-3)`. It scrolls with the page; the grid is never covered. Rows ellipsize to one line; no horizontal scroll at 240px.

```
Friday, September 25 · Today
[doc] Daily note                         Open
Due (2)
 [ ] Call Ren                        Tomorrow
 [ ] Pay rent                        Tomorrow
Scheduled (1)
 [ ] Draft the brief                 Tomorrow
▸ Done (1)
Notes created (3)
  Atlas kickoff
  Ren 1:1
  Budget ideas
```

Exact strings:

- Title `<h2 id="day-title">`: `Friday, September 25` (`Intl` `en`, weekday long, month long, day; the year added when it is not the current year: `Friday, October 2, 2027`), then ` · Today` / ` · Yesterday` / ` · Tomorrow` when it applies.
- Note row, note exists: a button with the `calendarIcon`-family doc icon, label `Daily note`, trailing `Open`; aria-label `Open the daily note for 2026-09-25`. The whole row is the button.
- Note row, no note: `No daily note yet` and a button `Create`; aria-label `Create the daily note for 2026-09-25`. Create writes it from the template **without** asking again (the button is the answer), via `chooseTargetFolder` + `ensurePeriodicNote('day')`, then opens it.
- Groups: `Due (2)`, `Scheduled (1)`, `Done (1)` (a `<details>`, folded), `Notes created (3)`. An empty group is not drawn.
- Nothing at all: `Nothing due or scheduled.` in `.empty` style (the note row still shows).
- Task rows: the shared `renderTaskListRow` (checkbox, title, meta; file and line on hover as elsewhere; Decision 5 keeps provenance on hover), with a trailing button:
  - label `Tomorrow` when the target is tomorrow, `Next day` otherwise. Target = the later of tomorrow and the selected day + 1. So an overdue or today task goes to tomorrow; a task on Oct 3 goes to Oct 4. Never earlier.
  - aria-label `Move "Call Ren" to tomorrow, 2026-09-26` / `Move "Call Ren" to the next day, 2026-10-04`.
  - In the Due group it moves the due date; in the Scheduled group, the scheduled date. Messages: `"Call Ren" is due 2026-09-26.` (existing) and `"Draft the brief" is scheduled 2026-09-26.`, both with Undo through `updateTaskLine`.
  - Checkbox completes (or, in Done, reopens) through `toggleTask`, so repeats write their next occurrence; the row moves to Done on the next state; focus stays on the next row (15c's `renderKeepingPlace`), and `announce()` says `Completed "Call Ren".`
  - Clicking the title or Enter on the row opens the task at its line (`openTask`).
  - Each of Due and Scheduled shows 5 rows, then `Show 7 more` (in-page, remembered for the session per group).
- Done group: open tasks' `doneAt` on that day.
- Notes created: files whose `createdAt` falls on that day, excluding daily, weekly, and monthly notes; titled by their first H1, else the file name without `.md`; the folder, muted, after it; oldest first. 5 rows, then `Search all 14` (aria-label `Search the 14 notes created on 2026-09-25`), which opens a search page for `created = 2026-09-25`. A row opens the note at line 1.

**Zen:** nothing is removed. The panel uses the shared task-row and spacing tokens, so zen's `--space-*` re-declaration tightens it and provenance folds as on every page. The hollow count stays (zen keeps every count).

**Height:** the grid is ~260px; the panel adds ~24px per row, capped at 5 per group. In a short view the page scrolls (`html` is the scroller, as the sidebar's other page). Collapsing the view hides both.

### 2.5 Messages

`CalendarMessage` (`src/core/types.ts:774`) gains:

| Message | Checked by `parseCalendarMessage` | Host |
| --- | --- | --- |
| `{ type: 'showMonth', month, date? }` | `date` optional ISO | set month; select `date`, else the clamped same day |
| `{ type: 'selectDay', date }` | ISO date | `selectedDate = date`; month follows if the date is outside it |
| `{ type: 'createDay', date }` | ISO date | create without asking, open |
| `{ type: 'openNote', filePath }` | non-empty string | only if `index.files.has(filePath)`: `openSourceAt(filePath, 1)` |
| `{ type: 'openTask', taskId }` | non-empty string | `openTask(task)` |
| `{ type: 'toggleTask', taskId, completed }` | string, boolean | `toggleTask(task, completed)` |
| `{ type: 'moveTask', taskId, field, date }` | field `'due' \| 'scheduled'`, ISO date | task must be open: `setTasksDate([task], field, date)` |
| `{ type: 'searchCreated', date }` | ISO date | `deckard.search` with `created = ${date}` |

Unknown keys are rejected as the other parsers do.

## 3. Implementation steps

### 15a. Scheduled counts

- `calendarState.ts`
  - `CalendarDay` gains `scheduledCount: number`, `scheduledTitles?: string[]`, `dueState?: 'due' | 'overdue' | 'stale'` (present when `dueCount > 0`).
  - In the task loop: open tasks with `scheduledAt`; skip when `dueAt` is on the same local day (counted once, as due). Titles capped at `TOOLTIP_ITEMS`.
  - `dueState` from the day's date against `today` (15b adds `stale`; 15a writes `due`/`overdue`, moving the page's `date < today` test to the host).
- `calendarHtml.ts`
  - `renderDay`: counts row becomes `<span class="counts" aria-hidden="true"><span class="due …">2</span><span class="scheduled-count">1</span></span>`, or the ring; the empty row stays drawn so every cell has the same spans (e2e "every day is drawn the same").
  - `describeDay(day)` builds the wording in 2.2; tooltip adds `⏳` lines.
  - CSS: `.counts`, `.scheduled-count`, `.scheduled-ring`, `.due.stale`.
- Edge cases: a completed task with a scheduled date is not counted; a task scheduled on a neighbor month's visible day is counted there.

### 15b. Stale days neutral

- Threshold helper: `isStaleOverdue(dueAt: number, now: number, staleAfterDays: number): boolean` in `src/core/markdown/taskMetadata.ts`, true when the date is more than `staleAfterDays` days before today and `staleAfterDays > 0`. **Owned by Piece 3** (with `deckard.tasks.staleAfterDays`, default 30). If Piece 3 has not landed, this commit adds the helper with a constant `STALE_AFTER_DAYS = 30` and Piece 3 replaces the constant with the setting; the calendar reads it through `createCalendar(index, month, now, { staleAfterDays })`.
- `CalendarView.refresh` reads the setting (when it exists) and passes it; `onDidChangeConfiguration` refreshes on `deckard.tasks.staleAfterDays`.
- `.due.stale { color: var(--muted); }`.

### 15c. Focus through a redraw

- `components.ts` `PLACE_KEYS`: add `'date'`, so a focused `[data-date]` day is found again.
- `calendarHtml.ts`: the state handler calls `renderKeepingPlace(render)`; the page keeps `focusDate` and `selectedDate` in page variables (not on `state`), and after a keyboard month change focuses the day it stepped to.
- Roving `tabindex`: the selected day (panel on), else the focused one, else today, else the 1st.

### 15d. Setting, selection, panel shell with the note row

- `package.json`: the setting (2.1); the two commands with `view/title` and `commandPalette` entries; `order` after `deckard.calendar.weekStart` if present.
- `src/ui/webview/calendar.ts` (`CalendarView`)
  - fields `selectedDate?: string` (undefined = today).
  - `refresh()` passes `{ dayPanel, selectedDate: this.selectedDate ?? today, staleAfterDays }`; when `dayPanel`, the snapshot gains `selected: createCalendarDay(...)`.
  - `onDidChangeConfiguration`: `deckard.calendar.dayPanel` → `refresh()` (no reload).
  - handlers for `selectDay`, `showMonth` (with `date`), `createDay`, `openNote`.
  - `openPeriod` split: `createPeriodNote(period, day)` without the prompt, reused by `createDay`.
- `calendarState.ts`
  - `CalendarSnapshot` gains `dayPanel: boolean`, `selectedDate: string`, `selected?: CalendarDayDetail`.
  - `createCalendarDay(index, date, now, options): CalendarDayDetail` with `{ date, title, relative?, notePath?, due, scheduled, done, notes, notesTotal, move: { date, label } }`. This commit fills `title`, `relative`, `notePath`; empty lists.
  - `clampToMonth(date, month)` for the month-change rule.
- `calendarHtml.ts`
  - `click` on `.day`: panel on → mark selection, post `selectDay` (debounced); off → `openDay` as now. `dblclick` → `openDay`. `keydown` Enter on `.day` → `preventDefault`, `openDay`.
  - `renderPanel(state.selected)`: title, note row, `.empty`.
  - Today-button rule from 2.3.
- `extension.ts`: register the two commands (write the setting).

### 15e. Tasks in the panel

- `createCalendarDay` fills `due`, `scheduled`, `done` as `DashboardTask`s (`createDashboardTask(task, index.sections, now)`, reusing its `dueLabel` and `overdue`), ordered by priority then line; and `move` per 2.4.
- `components.ts` `renderTaskListRow(item, options)`: new `options.trailing` (HTML string placed after the text column). Home, search, and query blocks pass nothing and are unchanged.
- `calendarHtml.ts`: rows with the trailing `Tomorrow`/`Next day` button (`data-action="move-task" data-task-id data-field`); `change` on `[data-action="toggle-task"]` → `toggleTask`; click on `.task-row` outside the controls, or Enter on it → `openTask`; `Show N more` per group; `announce()` for completion.
- `calendar.ts`: handlers `toggleTask`, `openTask`, `moveTask`.
- `agendaActions.ts`: generalize `setTasksDue(tasks, date)` into `setTasksDate(tasks, field, date)` (the single-task message `is scheduled ${date}.` / `has no scheduled date now.`); `setTasksDue` stays as a one-line wrapper so the Tasks view and `rescheduleOverdue` do not change. Bulk path: `applyBulkEdit` with `{ kind: field }` if bulk edit supports `scheduled`; the panel only ever moves one task, so the bulk branch may keep `due` only (assert in code).
- Add `getProvenanceCss()` to the calendar's sheet.

### 15f. Notes created that day

- `createCalendarDay`: iterate `index.files` once; `formatLocalDate(new Date(file.createdAt)) === date`; exclude `listDailyNotes` paths and `isPeriodicNoteName` names; title = first section with `headingLevel === 1` (tags stripped) else file name; `folder` = path relative to the workspace folder minus the name. First 5, `notesTotal` for the rest.
- `calendarHtml.ts`: rows `data-action="open-note" data-file-path`; `Search all N` → `searchCreated`.
- `calendar.ts`: `openNote`, `searchCreated`.
- Edge: a freshly cloned repo gives every file the clone day's birth time; the cap and "Search all" keep that day readable.

## 4. Tests

All gate on exit codes of `npm test`, `npm run test:ui`, `npm run test:e2e`, `npm run test:layout`.

`npm test` (`src/test/calendar.test.ts`, extend the fixture with ⏳ tasks, one due and scheduled the same day, one 45 days old):
- 15a: `scheduledCount` per day; the same-day task counted once, as due; done tasks not counted; `scheduledTitles` capped at 5; `dueState` `due` / `overdue`.
- 15b: a day 31+ days back is `stale`, 30 days back is `overdue`; `staleAfterDays: 0` never stale.
- 15d: `createCalendarDay` title (`Friday, September 25` · `Today`; the year when not current); `clampToMonth('2026-01-31', '2026-02') === '2026-02-28'`; `parseCalendarMessage` accepts each new message and rejects bad dates, bad `field`, extra keys.
- 15e: `due`/`scheduled`/`done` membership; the same-day task only in Due; `move` is tomorrow for past/today days, day+1 for later days, labels `Tomorrow`/`Next day`.
- 15f: notes created that day exclude periodic notes; title from H1; cap 5 with `notesTotal`.
- `setTasksDate` wording for `scheduled` (unit on the message builder).

New `src/test/calendar-page.test.ts` (jsdom via `src/test/webviewPage.ts`, under `npm test`):
- 15a: a day with 2 due and 1 scheduled draws `.scheduled-count` "1", aria-label ends `2 due, 1 scheduled`; a 12/11 day draws the ring; every cell has the same span count.
- 15b: a stale day has `.due.stale`, label `3 need a new date`.
- 15c: focus on a day survives `send(state)`; PageDown focuses the stepped-to day after the next state.
- 15d: panel off → click posts `openDay`, no `.day-panel`; panel on → click posts `selectDay` (after the debounce), marks `aria-selected`, no `openDay`; dblclick and Enter post `openDay`; ArrowRight moves `aria-selected`; Today button appears when another day is selected; note row posts `openNote`/`createDay`.
- 15e: checkbox posts `toggleTask`; the Scheduled row's button posts `moveTask` with `field: 'scheduled'`; `Show 2 more` reveals rows; row click posts `openTask`.
- 15f: `Search all 14` posts `searchCreated`.

`npm run test:e2e` (`test/e2e/calendar.e2e.js`; `vscode._test.settings.set('deckard.calendar.dayPanel', true)` in a second `openCalendar`):
- existing five tests stay as written (panel off by default is the proof the click did not change).
- a scheduled task is drawn hollow against the real host.
- panel on: a click selects and opens nothing (`opened` empty); the panel names today's daily note; Enter opens it.
- `createDay` creates without an info prompt (`shown.info` unchanged).
- the Show/Hide Day Panel command writes `deckard.calendar.dayPanel` (`configurationUpdates`).
- turning the setting on redraws with a panel without reloading the HTML.

`npm run test:ui`: `checkWebviewScripts` parses the new script; `checkContrast` covers `.scheduled-count` (`--muted` on `--bg`) and `.due.stale` in all eight themes plus high contrast.

`npm run test:layout` (`test/ui/checkLayout.js`): a new **calendar** surface at `[240, 700]`, zen and not, from a **separate small fixture index** (so other surfaces' baselines do not move): a month with a 12-due/11-scheduled day, a stale day, and the panel on with 7 due tasks with long titles and 6 notes created. Asserts nothing overflows horizontally (`scrollers: ['html']`, `clippers: ['.day', '.day-panel .task-row']`, `hovered: ['.day-panel .task-row']`). `pages.js` already lists `calendar`.

Visual baselines: the new surface means **16 new PNGs** in `test/ui/visual-baseline/darwin` (`<theme>-calendar.png`, `<theme>+zen-calendar.png` × 8 themes), recorded with `npm run test:visual -- --update` in the commit that adds the surface (15a), and **re-recorded** in 15b (stale color), 15d (panel shell), 15e, and 15f. No existing baseline changes, except: `renderTaskListRow`'s `trailing` option adds no markup when absent, so the search, board, and sidebar baselines must stay byte-identical (checked by running `npm run test:visual` without `--update`).

## 5. Docs

- **README** (`## Calendar`, and the table row at line 36): counts sentence becomes "…then the open tasks due that day, in orange once the day has passed and gray once it is more than 30 days past, and beside it, outlined, the tasks scheduled that day." New paragraph for the panel: the setting, the title-bar menu, click / double-click / Enter, the rows, Tomorrow vs Next day, Notes created and Search all. Table row: "A month in the sidebar, marking days with a daily note, tasks due, and tasks scheduled; optionally the chosen day's note, tasks, and new notes below it."
- **Help** (`helpHtml.ts:483`, the Calendar card): "A dot marks a day with a note; a number counts what is due, orange once the day has passed and gray after 30 days, and an outlined number what is scheduled. Turn on the day panel from the view's … menu to see the chosen day's note, tasks, and new notes below the month."
- **CHANGELOG `## Unreleased`**, `### Added`:
  - **The calendar counts what is scheduled.** Beside a day's due count, an outlined count marks the tasks scheduled (⏳) for it, and the day's tooltip and label say "2 due, 1 scheduled".
  - **A day under the calendar.** With `deckard.calendar.dayPanel` on, or **Show Day Panel** in the Calendar's … menu, a click chooses a day and the panel below it shows its daily note, the tasks due, scheduled, and done that day with a checkbox and a **Tomorrow** button, and the notes created that day. Double-click or Enter opens the day's note. Off by default, so a click still opens the note.
  - `### Changed`: **Old overdue days go gray.** A calendar day more than 30 days past keeps its count but drops the warning color, as the Tasks view's "Needs a new date" does.
  - `### Fixed`: **The calendar keeps keyboard focus through an update.**
- **components.md**: the `renderTaskListRow` row gains `options.trailing`; a sentence under focus restoration that `PLACE_KEYS` includes `date` (calendar days).
- `docs/zen-mode.md` table: no change (calendar still has no gear).

## 6. Commits

Each passes all four suites on its own.

1. `fix: the calendar keeps keyboard focus through an update` — 15c. (0.25 d)
2. `feat: a calendar day counts what is scheduled beside what is due` — 15a, the layout surface, 16 new baselines, README/Help/CHANGELOG. (0.75 d)
3. `feat: a calendar day more than 30 days past is counted in gray, not orange` — 15b; after Piece 3's helper if it exists, else adds it with the constant. Re-record calendar baselines. (0.25 d)
4. `feat: the calendar can show a chosen day below the month, with its daily note` — 15d: setting (off), commands, selection model, panel shell, `createDay`. Re-record. (1 d)
5. `feat: the calendar's day lists its tasks, with a checkbox and a Tomorrow button` — 15e, `setTasksDate`, `renderTaskListRow` trailing. Re-record. (1 d)
6. `feat: the calendar's day lists the notes created that day` — 15f. Re-record. (0.5 d)
7. `docs: the calendar's day panel in the README and Help` — only if 4–6's per-commit docs leave a gap (the panel paragraph written once the three parts exist). (0.25 d)
8. *(Held for the following release; recommended)* `feat: the calendar shows the chosen day by default` — default `true`; CHANGELOG says how to get the one-click open back. (0.1 d)

## 7. Size, risks, dependencies, questions

**Size:** about **4.25 days** (commits 1–7), plus a tenth of a day for 8.

**Risks**
- Cell width at 240px: handled by the ring fallback and a layout assertion; a theme with a wider mono font (Fellowship?) is the one to watch in the layout run.
- Double-click also fires two clicks: two `selectDay` posts then `openDay`. Harmless; the debounce collapses the two.
- Every selection is a host round trip and a full redraw. `createCalendar` + `createCalendarDay` are one pass each over tasks and files (under `measure('Calendar')`); at 5,000 notes it should stay well under 50 ms, but it is measured in the PR on the synthetic workspace from Piece 10.
- `createdAt` from file birth times is unreliable after a clone; capped and searchable, not fixed here.
- Merge conflicts with Piece 2e in `calendarState.ts`/`calendarHtml.ts` (week loop, weekday header). Whichever lands second rebases; neither changes the other's logic.

**Dependencies**
- **Piece 3 (Decision 1)**: `isStaleOverdue` and `deckard.tasks.staleAfterDays` (default 30). Commit 3 can land first with a constant; the panel's `dueLabel` wording ("Needs a new date") follows whatever `describeDueDate` says after Piece 3.
- **Piece 2e**: `deckard.calendar.weekStart` in the grid. Soft: the panel is independent of week start; the setting should sit next to it in General.
- **Piece 1h**: a once-a-minute date check; if it exposes a "day changed" event, the calendar subscribes so an explicit-less selection moves to the new today while the window keeps focus (today it moves on window focus).
- **Piece 9a/9d**: none required; if 9d's `data-tip` lands first, the day tooltips and the Tomorrow button use it.
- **Piece 10**: the synthetic workspace for the timing check.

**Open question for David**
- Flip `deckard.calendar.dayPanel` to on in the release after it ships (commit 8)? Recommended yes: the scheduled counts and focus fix ship to everyone either way, and off-by-default features are rarely found.
