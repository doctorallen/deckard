# 18. The calendar as a page, and every repeat on it

Planned against `dev` at `4ea3ac2` (v1.22.0). Source: David's note in `docs/review-guide.md`, under **Calendar (sidebar)**: "the calendar should extrapolate all scheduled tasks out to show all of their instances. I know right now it only shows the next instance, but the calendar should be able to show more. I also want to make the new calendar with all of the nice panels it's own full webview page."

## 1. Scope

Two pieces, in this order, because the second draws what the first computes:

| # | Item | What is there now |
| --- | --- | --- |
| 18a | **Repeats on the calendar.** A repeating task shows on every day its rule lands on in the weeks drawn, not only its next date. | `createCalendar` (`src/ui/state/calendarState.ts:248`) counts each open task once, on `dueAt` or `scheduledAt`. A task's `recurrence` is read only when it is completed (`createNextOccurrence`, `src/core/markdown/taskMetadata.ts:473`), which writes the next line. |
| 18b | **The calendar as a page.** `Deckard: Open Calendar` opens a full editor-area calendar: a month or a week of days large enough to list their tasks by name, with the day panel docked beside it. | The calendar is a sidebar `WebviewView` only (`src/ui/webview/calendar.ts`, `CalendarView`), about 240px wide, so a day holds counts, not titles. The day panel (plan 15) sits under the month. |

Not in scope: time of day or time blocking (Deckard has no times; `docs/ux-fifteen-sources-plan.md` already rules them out), calendar sync, and showing repeats anywhere but the calendar. Search, the Tasks view, the board, and the status bar keep counting a task once: a projected date is not a task.

## 2. Design

### 2.1 What a projected repeat is

A projection is **a date a repeating task will be due if it is kept on schedule**, drawn from the rule, never written to a note.

- The **reference date** is the one the rule advances when the task is completed: due, else scheduled, else start (as in `createNextOccurrence`). The next dates come from `parseRecurrence(task.recurrence).next(from)` (`taskMetadata.ts:598`), repeated. Scheduled and start dates keep their distance from due, so a task scheduled two days before its due date is projected the same way.
- Only dates **after today and after the task's own date** are drawn. A weekly task due Sep 1 and still open on Sep 27 is shown overdue on Sep 1, and projected from Sep 29 on (Sep 8, 15, and 22 did not happen). The dates stay on the rule's own sequence, so Sep 29 is a Tuesday for an "every Tuesday" task.
- **`when done` rules are not projected.** Their next date depends on the day the task is done, so any date drawn would be a guess, and Deckard does not guess dates (the reason `parseRecurrence` returns undefined for a rule it cannot read). The task's own date says **repeats when done** in its tooltip and row instead.
- A rule Deckard cannot read projects nothing, as it writes nothing on completion today.
- Projection stops at the last day drawn, and after **370 steps** per task (a daily task over a year), so a rule that never advances cannot hang a redraw. It runs only over tasks with a `recurrence`, a small share of any workspace.
- Parked tasks project nothing (`isParkedTask`), as they count nothing now.

**How it reads.** A projected occurrence is not something to do yet, so it is quieter than a real date:

- **Sidebar grid:** a third mark after the due and scheduled counts, a small `↻` with the number of repeats that day, in `--muted`, never green or orange. The tooltip and aria-label add it: `2026-10-06, 1 due, 2 repeats`, and lines `↻ Water the plants`.
- **Day panel:** a **Repeats** group after Scheduled, each row the task's title with its rule (`every week`), muted, with **no checkbox**: a future occurrence cannot be completed before the current one. The row opens the task's line, which is the one to complete.
- **Page (18b):** a chip with a dashed edge and `↻`.

**Setting.** `deckard.calendar.showRepeats`, boolean, default **true**, General section beside `deckard.calendar.dayPanel`: "Show every date a repeating task falls on in the weeks the Calendar draws, not only its next one. A `when done` rule is shown on its next date only, since the dates after it depend on when it is done." A `…` menu pair in the sidebar view, like the day panel's (Show Repeats / Hide Repeats), and a switch in the page's gear.

### 2.2 The model

In `calendarState.ts`:

```ts
/** A date a repeating task falls on after its current one, drawn from its rule. */
export interface CalendarRepeat {
  taskId: string;
  title: string;
  /** The rule as written, such as "every week". */
  rule: string;
}

// CalendarDay gains
repeatCount: number;
repeatTitles?: string[];
// CalendarDayDetail gains
repeats: CalendarRepeatRow[]; // DashboardTask plus the rule, for the panel
```

A new pure function, `projectRepeats(task, from, to, now)` in `src/core/markdown/taskMetadata.ts` next to `createNextOccurrence`, returns the YYYY-MM-DD dates in `[from, to]`. It shares the reference-date and date-offset logic with `createNextOccurrence` through one extracted helper, so the calendar and a completion can never disagree about the next date. That agreement is a test (§4).

`createCalendar` builds one map, date to projected tasks, over the drawn range (first row's start to last row's end), before its day loop, and `createCalendarDay` fills `repeats` for the chosen day.

### 2.3 The page

`Deckard: Open Calendar` (`deckard.openCalendar`) opens `CalendarPanel`, a `WebviewPanel` with the id `deckard.calendarPage`, restored after a reload by a serializer as the other pages are (`src/extension.ts:868-886`). The sidebar Calendar's title bar gets an **Open in Editor** button (`$(link-external)`) that opens it on the same month and day.

Layout, left to right:

- **The month**, full width minus the panel, seven columns. A day lists its tasks by name as chips: due (colored as the sidebar colors due counts: green, orange overdue, muted when it needs a new date), scheduled (hollow), and repeats (dashed, `↻`). The chips fill the day's height and end in **+3 more**, which chooses the day. The daily note shows as the day's first line, its title linking to it. Week rows keep their week-note link at the left, and the month title its month note.
- **A Week layout** (gear: Month | Week): one row of seven tall days listing every task, for planning a week. `[` and `]` or ‹ › step by the layout's unit.
- **The day panel**, docked at the right at 320px, always on (the setting is the sidebar's): the same sections as plan 15's panel (the note, Due, Scheduled, Repeats, Done, Notes created), with its checkboxes and Tomorrow buttons. Under 900px wide it moves under the month, as the sidebar's does.

**Drag to reschedule.** A due or scheduled chip can be dragged to another day, which sets that date (`setTaskDateField`, as the panel's Tomorrow button does), with the same pending state and refusal the board uses. A repeat chip cannot be dragged: its date is the rule's. This is the one new behavior; it is listed as a question (§7) in case it should wait.

**Keys.** The grid keeps the sidebar's keyboard model (arrows, Home, End, PageUp and PageDown, Enter to open the note), with `t` for today and `w` / `m` for the layouts. `?` lists them, as on the other pages.

**Sharing, not copying.** The sidebar and the page run one controller:

- The message handling in `CalendarView.handle` (`calendar.ts:141-215`: `showMonth`, `selectDay`, `createDay`, `openNote`, `openTask`, `toggleTask`, `moveTask`, `openDay`, `openWeek`, `openMonth`) moves into `CalendarController`, which both the view and the panel own one of, each with its own month and chosen day.
- `createCalendar` takes `options.layout: 'sidebar' | 'page'`. The page's days carry up to ten entries each (`entries`, with id, title, kind, and date field); the sidebar's carry the counts and titles they carry now, so the sidebar's state does not grow.
- `calendarHtml.ts` gains a `page` mode rather than a second file: the grid, keyboard handling, and panel renderer are the same functions, with the page drawing chips where the sidebar draws counts. The CSS for the page lives in a `getCalendarPageCss()` beside the sidebar's.

### 2.4 Messages

New, page only, validated in `parseCalendarMessage` (`src/ui/webview/messages.ts`):

- `{ type: 'setLayout', layout: 'month' | 'week' }`, kept in the preferences' machine-wide appearance settings, as the board's layout is.
- `{ type: 'moveTaskToDay', taskId, field: 'due' | 'scheduled', date }`: the drag. The host answers a refusal with `moveRefused`, as the board does.
- `{ type: 'setShowRepeats', show }`, from the gear, writing `deckard.calendar.showRepeats` where it is set (the zen switch's rule).

## 3. Implementation steps

### 18a. Repeats

1. Extract the reference-date and offset logic from `createNextOccurrence` into `recurrenceReference(metadata)` and `shiftDates(...)`, with no behavior change; the completion tests must pass untouched.
2. Add `projectRepeats(task, from, to, now)`: skips `whenDone` and unreadable rules, starts after `max(reference, today)`, stops at `to` or 370 steps.
3. `createCalendar`: a date-to-repeats map over the drawn weeks, `repeatCount` and `repeatTitles` on each day, behind `deckard.calendar.showRepeats`. `createCalendarDay`: the `repeats` group.
4. `calendarHtml.ts`: the `↻` count and its tooltip line; the panel's Repeats group, rows without checkboxes that open the task.
5. The setting, the `…` menu pair, and `CalendarView` refreshing on it.

### 18b. The page

1. Move `CalendarView.handle` into `CalendarController`; `CalendarView` keeps its behavior exactly (its tests are the check).
2. `CalendarPanel` with `show(month?, date?)`, the serializer, `deckard.openCalendar`, and the sidebar's **Open in Editor**.
3. `createCalendar({ layout: 'page' })` entries; the page mode in `calendarHtml.ts`: chips, **+N more**, the docked panel, the gear (Month | Week, Show repeats, Theme, Zen), the help button.
4. The Week layout and its keys.
5. Drag to reschedule (held back if §7 says so).

## 4. Tests

- **`projectRepeats`**, in `src/test/task-metadata.test.ts`: every rule `parseRecurrence` reads, projected across a month, including month ends (`every month on the 31st` in February), `every month on the last Friday`, `every other week on Monday, Thursday`, and a year boundary; `when done` projects nothing; an overdue task projects only from today, on its own sequence; the 370-step cap.
- **Agreement:** for each rule, the first projected date equals the due date on the line `createNextOccurrence` writes when the task is completed on its due date.
- **`createCalendar`:** repeat counts and titles; nothing projected for parked tasks, completed tasks, or with the setting off; a day's due, scheduled, and repeat counts stay separate.
- **Sidebar page** (`src/test/calendar*.test.ts`, jsdom): the `↻` count, the tooltip and aria-label wording, the Repeats rows without checkboxes, and a row opening the task.
- **Page** (new `test/e2e/calendarPage.e2e.js`, real host and page): chips by kind, **+N more** choosing the day, the Week layout and `[` `]`, a drag posting `moveTaskToDay` and a refusal putting the chip back, and a repeat chip refusing a drag.
- **Controller:** the existing sidebar e2e (`test/e2e/calendar.e2e.js`) passes unchanged after the move, before anything else changes.
- `test:ui`, `test:layout` (the page at 1400px and 800px, no horizontal scroll, the panel docked or below), and `test:visual`: new baselines for the page in every theme and in Zen, and the sidebar Calendar re-recorded for the `↻` mark.

## 5. Docs

- `docs/guide/daily-notes.md`, **Calendar**: repeats, the setting, and the page.
- Help's **Days, weeks, and months** section: a line each for repeats and `Deckard: Open Calendar`.
- README feature table: the Daily notes row mentions the calendar page.
- `docs/review-guide.md`: a **Calendar (page)** section.

## 6. Commits

1. refactor: one helper decides a repeating task's reference date (18a.1)
2. feat: a repeating task's later dates can be projected (18a.2)
3. feat: the calendar shows every date a repeating task falls on (18a.3–4)
4. feat: a setting, and the Calendar's menu, turn repeats off (18a.5)
5. refactor: the calendar's messages are handled by one controller (18b.1)
6. feat: Deckard: Open Calendar opens the calendar as a page (18b.2–3)
7. feat: the calendar page has a week layout (18b.4)
8. feat: a task dragged to another day on the calendar page takes that date (18b.5)
9. docs and baselines

Types and lint per commit; the full set at the end.

## 7. Size, risks, questions

**Size.** 18a is small: one pure function, one map, one mark, one panel group, about a day with tests. 18b is the larger piece: the controller move is mechanical, the page's grid and chips are new drawing on the existing model, and the Week layout and drag are each about half a day.

**Risks.**
- A day with many repeats in the sidebar: a daily task makes every day read `↻1`. The mark is muted and small, and the setting turns it off; if it is still noise, the sidebar could show repeats only for rules longer than a day (question 2).
- Performance: projection is bounded by the drawn range and 370 steps, and runs only over repeating tasks; measured under `measure('Calendar')` on the synthetic workspace from plan 10.
- The controller move touches the calendar's every message; its tests are run first and alone (commit 5).

**Questions for David.**
1. **Drag to reschedule on the page:** in 18b, or a later piece?
2. **Daily repeats in the sidebar:** show them (every day reads `↻1`), or project only rules longer than a day there, keeping daily ones for the page?
3. **`when done` repeats:** not projected (recommended, since any date would be a guess), or projected as if done on the due date, marked *if done on time*?
4. **Where a sidebar day leads:** should choosing a day in the sidebar Calendar open it on the page, or keep opening the day's note as now, with **Open in Editor** the way to the page?
