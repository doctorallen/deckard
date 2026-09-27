# Piece 2: One date language — implementation plan

Written against `dev` at `726d23b` (v1.22.0). Source: `docs/ux-fifteen-sources-plan.md`, Piece 2 (items 2a–2e). None of David's six Decisions touch this piece.

## 1. Scope

This plan covers **2a, 2b, 2c, 2d, and 2e**, plus one small docs fix taken out of 2e.

### Parser inventory (checked against the source)

| Where | What it reads | Callers |
| --- | --- | --- |
| `core/markdown/taskDraft.ts:159` `parseTaskDateInput` | ISO; today, tomorrow, yesterday; `in 3 days`, `+2w`, `3 weeks`; `[next] weekday` (the next one, never today) | `taskEditor.ts:220` (`setDraftDate`) and `:352` (`readDate` validation); `agendaActions.ts:58,65` (`askForDueDate`); `captureWords.ts:123`; `linkSuggestions.ts:215` (`[[` day links) |
| `ui/commands/bulkEditPrompts.ts:60` `parseBulkDate` | ISO, today, tomorrow | `bulkEditPrompts.ts:171,178` only |
| `core/query/queryParser.ts:838` `isDateValue` + `queryEvaluator.ts:821` `resolveDateRange` | ISO; today, yesterday, tomorrow; `Nd/Nw/Nm/Ny` windows | every query (search pages, board, Tasks view, query blocks, widgets, Find, MCP) |
| `core/markdown/parser.ts:57,1521` `findTaskDate` | ISO, `Sep 12[, 2026]`, `next Friday`, found **inside prose** and anchored to the note's date | the indexer |
| `ui/commands/agendaActions.ts:32` `dueDateFor` | named choices; `nextWeek` is the next Monday | the Due Today/Tomorrow/Next Week commands, `pickReschedule` |
| Week math | `dailyNote.ts:162` `getPeriodStart` (Sunday), `calendarState.ts:123` (rows from Sunday), `calendarHtml.ts:63` (a fixed Sun…Sat header), `review.ts:42` `getReviewRange` (via `getPeriodStart`), `review.ts:274` ISO | Calendar, Open Weekly Note, Write a Review |

### Claims I verified

- `due <= friday`, `created = last-month`, and `created = 2026-08` are all rejected today. I checked this against `out/core/query/queryParser.js`.
- The line numbers the UX plan gives are right: `taskDraft.ts:159-220`, `bulkEditPrompts.ts:60-75`, `queryParser.ts:836-846`, `agendaActions.ts:49-66`, `dashboardState.ts:1454`.
- The README review example is wrong today. README:865 says *Review of 2026-09-14 to 2026-09-20*, which runs Monday to Sunday, but Deckard writes Sunday to Saturday (`2026-09-13 to 2026-09-19`, as `review.test.ts:177` asserts).

### What I changed or dropped after checking

- **2b is partly built already.** The task editor's `readDate` (`taskEditor.ts:343-365`) already answers valid input with an Info message, *Friday 2026-09-25*. 2b brings the other prompts up to it and adds the distance from today.
- **`parser.ts` month dates stay a separate reader.** The indexer finds dates inside prose and anchors them to the note's own date, not to today: "Sep 12" in a 2025 note means 2025. Sending it through `parseDatePhrase` would change what existing notes mean. It will share the month and weekday tables from the new module, and nothing else.
- **2e's "the board's within-a-week column" is dropped.** That column is a rolling window (`taskBoardState.ts:641`, `dueAt < today + 8 days`), not a calendar week, so a week start has nothing to change there. The Due facet's "Next 7 days" is rolling too, and stays.
- **Locale numeric dates (`10/3`) are read only in interactive date boxes.** Those are the task editor, Due on a Date, bulk edit, Open Daily Note for Date, `[[`, and capture after `on`, `by`, or `due`. Every one of them shows the resolved day before anything is written. The query language never reads them, because a query block saved in a note would mean a different day on another machine. Section 2 has the rule.
- **"next week" means different things in a date box and in a search.** In a date box it means one day (next week's Monday). In a search, `next-week` means the whole week. A box needs one day and a search needs a range. The Help page and README say so in one sentence.

## 2. Design

### 2a. `parseDatePhrase`

New module `src/core/markdown/dates.ts` (core, no `vscode`):

```ts
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;           // 0 = Sunday
export interface DatePhraseOptions {
  weekStart?: Weekday;                 // default 0
  numericOrder?: 'mdy' | 'dmy';        // absent: numeric dates are not read
  direction?: 'future' | 'past';       // default 'future'
}
export function parseDatePhrase(text: string, now?: number, options?: DatePhraseOptions):
  { date: string | undefined } | undefined;   // same shape parseTaskDateInput had
export function describeDay(date: string, now?: number): string;  // "Monday 2026-09-28 · in 3 days"
export function formatShortDay(date: string, now?: number): string; // "Fri, Oct 2" (", 2027" when not this year)
export function startOfWeek(at: number, weekStart: Weekday): number;
export function resolveDatePeriod(text: string, now: number, weekStart: Weekday):
  { start: number; end: number } | undefined;  // this-week … next-month, YYYY-MM
export const MONTH_NUMBERS, WEEKDAY_NAMES;       // shared with parser.ts
```

**Grammar.** Case-insensitive. Whitespace is collapsed. A trailing `.` and an ordinal suffix (`3rd`) are ignored.

| Written | Means (future direction) |
| --- | --- |
| empty | `{ date: undefined }`: clears the date |
| `2026-10-02` | that day, when it is a real day |
| `today`, `tomorrow`, `yesterday` | as named |
| `in 3 days`, `+2w`, `3 weeks`, `1 month` | the distance forward. Months are calendar months, clamped to the month's last day, so Jan 31 plus 1m is Feb 28. Today it is Mar 3, which is a bug fixed here. |
| `3 days ago`, `2 weeks ago` | the distance back (new) |
| `friday`, `fri`, `next friday`, `this friday`, `on friday` | the next one to come, never today (unchanged) |
| `last friday` | the most recent one before today (new) |
| `oct 3`, `october 3rd`, `3 oct`, `3 October 2027`, `Oct 3, 2027` | that day. With no year, the next one on or after today. |
| `10/3`, `10/3/27`, `3.10.2026` | a numeric date, only when `numericOrder` is given. See the rule below. `2026/10/02` is always year-month-day. |
| `next week` | **Monday of next week**, where next week is the week after the current one as `deckard.calendar.weekStart` draws it |
| `end of week`, `end of the week`, `eow` | the last day of this week, by the week start (Saturday by default) |
| `end of month`, `end of the month`, `eom` | the last day of this month |
| `next month` | the 1st of next month |
| `weekend`, `this weekend`, `the weekend` | the coming Saturday, or today when today is Saturday or Sunday |

With `direction: 'past'` (used by the query language for `created`, `updated`, and `done`), a bare weekday means the most recent one before today. A month-day or numeric date with no year means the most recent one on or before today. Everything else keeps its fixed meaning.

**Numeric rule.** The order comes from VS Code's display language: `Intl.DateTimeFormat(vscode.env.language).formatToParts(...)`, with day before month giving `dmy` and otherwise `mdy`. When the date is not a real day in that order but is one in the other (`25/9` in `en`), the other order is used. That reading is unambiguous. Two-digit years are 20xx. Separators are `/` and `.`. A `-` is never a numeric separator, which keeps ISO dates and query hyphens clean. The resolved day is always shown before anything is written.

`parseTaskDateInput` and `parseBulkDate` are deleted. `describeTaskDate` moves to `describeDay`, and its weekday-plus-date prefix stays the same.

### 2b. Every date box says the day it read

New helper `src/ui/commands/datePrompt.ts`:

- `readDateOptions(): DatePhraseOptions` returns `weekStart` (from 2e, Sunday until then) and `numericOrder` from `vscode.env.language`.
- `validateDateInput(value, now, options)`:
  - For an empty value it returns `undefined`, because empty clears the date.
  - For a valid value it returns `{ message: describeDay(date, now), severity: Info }`, for example `Monday 2026-09-28 · in 3 days`.
  - Otherwise it returns the one error string.
- `askForDate({ title, value?, now? })` wraps `showInputBox` with `ignoreFocusOut: true`. It returns `{date}`, `{date: undefined}` (cleared), or `undefined` (closed).

**How `describeDay` words the distance:**
- `today`, `tomorrow`, `yesterday`
- `in N days` and `N days ago` up to 31 days
- beyond 31 days, the distance is left out (`Wednesday 2027-03-10`), as `describeDueDate` already does

**Exact strings**

- **Error, one string everywhere:** `Enter a date such as friday, in 3 days, or 2026-10-02.` It is exported as `DATE_INPUT_ERROR`, and it replaces these three:
  - `Deckard cannot read that as a date.`
  - `Deckard cannot read that as a day.`
  - `Write the date as YYYY-MM-DD, or today, or tomorrow.`
- **Prompt, one string everywhere:** `A date in plain words: friday, oct 3, next week, end of month, in 3 days, or 2026-10-02. Leave it empty to clear it.`
- **Placeholder:** `friday`.
- **Commands:** `deckard.agenda.dueNextWeek` keeps its id, so existing keybindings still work, but its title changes from `Due Next Week` to **`Due Next Monday`**. `pickReschedule`'s row `Next week` becomes **`Next Monday`**. `dueDateFor('nextWeek')` stays "the next Monday, never today", and its doc comment says so.
- **`[[` day links:** the detail becomes `${describeDay(date)}, that day's note`, for example `Friday 2026-10-02 · in 7 days, that day's note`.
- **Capture:** no change to its detail line. It already shows the line it will write, with the ISO date in it.

### 2c. Query periods, weekday names, and a Created facet

**New values** for `due`, `scheduled`, `start`, `done`, `created`, and `updated`:

| Value | Means |
| --- | --- |
| `this-week`, `last-week`, `next-week` | the whole week, by the week start |
| `this-month`, `last-month`, `next-month` | the whole calendar month |
| `2026-08` | that whole month |
| `monday` … `sunday`, `mon` … `sun` | one day: the next one for `due`, `scheduled`, and `start`; the last one before today for `created`, `updated`, and `done` |
| any other single-day phrase from 2a, quoted or hyphenated | `due <= "oct 3"`, `due <= end-of-month`, `done >= "last friday"`. A `-` in a non-ISO value reads as a space. |

- A period is a range (`isWindow: false`), so the operators already mean the right thing:
  - `due < next-week` is before next week starts.
  - `created >= last-month` is from the 1st of last month.
  - `created = this-month` is anywhere in this month.
- A numeric date such as `10/3` is still an error in a query. The query parser calls `parseDatePhrase` without `numericOrder`, so it never reads one.
- Values are kept as written and resolved when the query is evaluated. A query block's `this-week` moves on at the week boundary, as `today` moves at midnight.

**Error messages:**
- `due`, `scheduled`, `start`, and `done`: `due accepts a date such as 2026-09-13, friday, "oct 3", this-week, next-month, a window such as 7d, or none.`
- `created` and `updated`: `created accepts a date such as 2026-09-13, friday, this-week, last-month, 2026-08, or a window such as 30d.`

**Value completions** (`createQuerySuggestions`, `dashboardState.ts:1454`). These also feed the builder's value box, which keeps builder parity. It takes an optional `now` argument.
- `dates` (the past-facing fields) gains `this-week`, `last-week`, `this-month`, and `last-month`.
- `taskDates` gains `this-week`, `next-week`, `this-month`, and `next-month`.
- Both lists gain the seven weekday names.
- Each detail says what the value resolves to. Examples:
  - `this-week`: `Sep 20 to Sep 26`
  - `last-month`: `August`
  - a weekday in `taskDates`: `Fri, Oct 2`
  - a weekday in `dates`: `Fri, Sep 18`

**Created facet** (`searchFacets.ts`). It goes after Updated, with id `'created'` added to the `QueryFacet['id']` union. Zero-count values are dropped, as they are in every other facet. On 2026-09-25 its values are:

| Label | Clause |
| --- | --- |
| `This month` | `created = this-month` |
| `Last month` | `created = last-month` |
| `July` | `created = 2026-07` |
| `June` | `created = 2026-06` |
| `Earlier` | `created < 2026-06` |

A month from another year carries its year (`December 2025`). Counts come from `section.createdAt` and `file.createdAt`, as the Updated facet uses `updatedAt`.

### 2d. Open Daily Note for Date

- **Command:** `deckard.openDailyNoteForDate`, title **`Open Daily Note for Date…`**, category Deckard.
- **The quick pick:**
  - Title: `Open a daily note`
  - Placeholder: `A day in plain words, such as last friday, oct 3, or 2026-10-02`
  - Rows, when nothing is typed:
    - `Yesterday`, `Today`, and `Tomorrow`, each with the description `describeDay(date)`.
    - Then a separator **Recent daily notes**, followed by the seven newest existing daily notes other than those three. Each has the label `formatShortDay(date)` (`Tue, Sep 22`) and the description `2026-09-22 · 3 days ago`.
  - When the typed value reads as a date, the first row becomes `$(calendar) Open daily note for Fri, Oct 2` with the description `2026-10-02 · in 7 days`. When no note exists for that day, it also has the detail `Creates it from the daily note template`.
  - When the typed value does not read as a date, one row that does nothing when accepted: `$(info) Enter a date such as friday, in 3 days, or 2026-10-02.`
- **What accepting a row does:**
  - An existing note (found with `listDailyNotes`) opens with `openSourceAt(filePath, 1)`.
  - Today with no note runs `createDailyNoteWithRollover`, so rollover still happens.
  - Any other day is created with `ensurePeriodicNote(folder, 'day', day)` and opened, without a confirm step. The row already said it would create the note, and a direct request is not a stray click.
- **Find:** when Find's whole input reads as a date through `parseDatePhrase` (with `readDateOptions()`) and `isNoteName(input)` holds:
  - `toPickItems` puts `$(calendar) Open daily note for Fri, Oct 2` first, with the description `2026-10-02 · in 7 days`.
  - The `Create note "friday"` row is left out.
  - Accepting the date row runs the same `openDailyNoteFor(date)`.

### 2e. `deckard.calendar.weekStart`

**The setting:**
```json
"deckard.calendar.weekStart": {
  "type": "string",
  "enum": ["sunday", "monday", "locale"],
  "enumDescriptions": [
    "Weeks run Sunday to Saturday.",
    "Weeks run Monday to Sunday.",
    "Weeks start on the day VS Code's display language starts them."
  ],
  "default": "sunday",
  "scope": "window",
  "markdownDescription": "The day a week starts on: in the Calendar, in weekly notes and their reviews, in a search's `this-week`, `last-week`, and `next-week`, and in *next week* and *end of week* typed as a date. A weekly note written before a change still opens for the week it mostly covers."
}
```

- `locale` reads `new Intl.Locale(vscode.env.language).getWeekInfo?.().firstDay ?? .weekInfo?.firstDay`, mapping 7 to 0. It falls back to Sunday.
- The value is read by `readWeekStart()` in `datePrompt.ts`. The query evaluator gets it from `setQueryWeekStart(day)` in `extension.ts`, next to `setQueryIdentity`, and it is set again when the setting changes. That follows the existing pattern: the evaluator runs in nine places and none of them reads settings.

**It reaches:**
- **Calendar.** Rows start on the week start. `CalendarSnapshot` gains `weekdays: string[]`, and `calendarHtml.ts` draws `state.weekdays` instead of its fixed list, falling back to Sun…Sat when absent. The view refreshes on the setting change.
- **Weekly notes.** `getPeriodStart('week', day, weekStart)`, `getPeriodicNote`, and `ensurePeriodicNote`. New notes are named for the new span. `{date}` is the week's first day.
- **Reviews.** `getReviewRange(period, day, weekStart)`.
- **Date phrases.** `next week` and `end of week` in `parseDatePhrase`.
- **Query periods.** `this-week`, `last-week`, and `next-week`.

**Existing notes still open.** `findPeriodicNoteNames('week', day, weekStart)` returns:
- the name under the current week start;
- for each of the six other possible week starts, the name of the week that holds this week's **middle day** (start + 3);
- the ISO name of the week holding the middle day.

Week notes tile seven days apart, so each old note holds exactly one row's middle day. Switching Sunday to Monday, the row Mon Sep 21–Sun 27 opens `week-2026-09-20-2026-09-26`, which shares six days with it. Switching back works the same way. The ISO lookup gives the same answer it gives today: the Monday inside a Sunday row lies in the same ISO week as that row's middle day. Every existing caller (`calendarState.periodicNote`, `calendar.openPeriod`, `findExistingPeriodicNote`) goes through this function, so none of them changes shape.

**A bug that would appear, and its fix.** `writeReviewCommand` on an open note used the note's first day and recomputed the week from it. Under a changed week start, that reviews and writes into the wrong week. `findOpenPeriod` will return the note's own range instead: `week-A-B` gives A to B, and ISO gives Monday to Sunday. `writeReview` takes an optional `{ range, noteUri }`, so a review of an open note always covers that note's own days and is written into that note.

## 3. Implementation steps

### Commit A: docs, the review example (tiny)
- README:865: *Review of 2026-09-14 to 2026-09-20* becomes *Review of 2026-09-13 to 2026-09-19*.

### Commit B: 2a and 2b
1. Add `src/core/markdown/dates.ts` as specified.
   - Move the `WEEKDAYS` table and `describeTaskDate` out of `taskDraft.ts`.
   - Export `MONTH_NUMBERS` and `WEEKDAY_NAMES`, and import them in `parser.ts` in place of its local copies (`parser.ts:1559-1596`). That file changes nothing else.
2. `taskDraft.ts`: delete `parseTaskDateInput` and `describeTaskDate`.
3. `taskEditor.ts`:
   - `setDraftDate(draft, field, written, now, options)` calls `parseDatePhrase`.
   - `readDate` uses `validateDateInput` and the shared prompt string.
4. `agendaActions.ts`:
   - `askForDueDate` uses `askForDate` and `readDateOptions()`.
   - `pickReschedule`'s row becomes `Next Monday`, and the `A date…` description becomes `friday, oct 3, in 3 days, 2026-10-02`.
5. `bulkEditPrompts.ts`: delete `parseBulkDate`. `readEdit('due')` uses `askForDate({ title: 'Due date' })`.
6. `captureWords.ts`:
   - `readCaptureText(text, format, now, options?)`.
   - `PLAIN_DAY` becomes a function `isPlainDay(phrase)` that accepts:
     - today and tomorrow
     - a full weekday name, with or without `next`
     - `in N units`
     - `next week`, `next month`
     - `end of [the] week|month`
     - `this weekend`
     - a month name with a day in either order
   - These still need a lead word (`on`, `by`, `due`): short weekday names, `+2w`, ISO dates, numeric dates, `weekend` or `the weekend`, and `last …`.
   - The window grows from 3 words to 4, for `end of the month`.
   - `capture.ts:146` passes `readDateOptions()`.
7. `linkSuggestions.ts`: `DATE_WORDS` is replaced by `parseDatePhrase(words, now, readDateOptions())`, which must read the whole of what was typed. The detail uses `describeDay`.
8. `package.json`: the title `Due Next Week` becomes `Due Next Monday`.

### Commit C: 2c
1. `queryEvaluator.ts`:
   - Add `setQueryWeekStart` and `getQueryWeekStart`, a module-level value like `queryIdentity`, defaulting to Sunday.
   - `resolveDateRange` tries, in order: named days, windows, ISO, then `resolveDatePeriod` (periods and `YYYY-MM`), then `parseDatePhrase(value.replace(/-/g, ' '), now, { direction, weekStart })` as a one-day range.
   - Remove the private `startOfDay` duplicate and import it from `taskMetadata`.
2. `queryParser.ts`:
   - `isDateValue(value)` accepts what `resolveDateRange` accepts, tested against a fixed `now`, since acceptance does not depend on the day.
   - Both messages change to the new strings.
   - `created` and `updated` keep `value.toLowerCase()`.
3. `extension.ts`: call `setQueryWeekStart(0)` for now. Commit E wires the setting.
4. `dashboardState.ts` `createQuerySuggestions(index, now = Date.now())`: add the new values and details. The `quickFind.ts:153` caller is unchanged.
5. `searchFacets.ts`: add the Created facet. `queryTypes.ts` adds `'created'` to the facet id union. Check `messages.ts` for any facet-id allowlist; there appears to be none.
6. `assistantTools.ts:32,35` and the `package.json` `modelDescription` (line 705) gain the new values: *"… this-week, next-month, a weekday such as friday …"*.

### Commit D: 2d
1. `dailyNote.ts`:
   - `buildDailyNotePicks(notes, typed, now, options)` is a pure function returning items. It is testable without VS Code quick-pick plumbing, using plain objects mapped later.
   - `openDailyNoteForDate(indexer)` shows a `createQuickPick` with `onDidChangeValue`.
   - `openDailyNoteFor(indexer, date)` holds the open-or-create logic.
2. `extension.ts`: register `deckard.openDailyNoteForDate`.
3. `package.json`: the command, with icon `$(calendar)`, and an activation event if the file lists them per command. It lists `onCommand:deckard.createDailyNote`; follow that.
4. `quickFind.ts`:
   - `toPickItems(results, value, dateRow?)` puts the date row first.
   - A new pick-item field `openDate?: string`.
   - `accept()` handles it by hiding the picker and calling `openDailyNoteFor`.
   - The caller computes `dateRow` from `parseDatePhrase` and `isNoteName`.
   - Suppress the Create row when there is a date row.

### Commit E: 2e
1. `package.json`: add the setting. The `weeklyNoteTemplate` description changes "{date} its Sunday" to "{date} its first day".
2. `datePrompt.ts`: add `readWeekStart()`, and feed it into `readDateOptions()`.
3. `extension.ts`: `setQueryWeekStart(readWeekStart())`, and set it again on `affectsConfiguration('deckard.calendar.weekStart')`.
4. `dailyNote.ts`:
   - `getPeriodStart`, `getPeriodicNote`, `findPeriodicNoteNames`, `ensurePeriodicNote`, and `findExistingPeriodicNote` take `weekStart`, defaulting to `readWeekStart()` at the `vscode` layer. The pure functions take it as a parameter defaulting to 0, which keeps the current tests valid.
   - The middle-day lookup goes in `findPeriodicNoteNames`.
   - Delete the unused `getWeekday` helper (`:351`) if nothing references it.
5. `calendarState.ts` `createCalendar(index, month, now, weekStart = 0)`:
   - Rows start from `1 - ((first.getDay() - weekStart + 7) % 7)`.
   - The snapshot gains `weekdays`.
   - Rename the loop's `sunday` variable to `rowStart`.
6. `calendar.ts`: pass `readWeekStart()`, and refresh on the setting change. `calendarHtml.ts`: use `state.weekdays`, and change the comment "Sunday to Saturday" to "a month of whole weeks".
7. `review.ts`:
   - `getReviewRange(period, day, weekStart = 0)`.
   - `findOpenPeriod` returns `{ period, day, start?, end? }` from the name's own span.
   - `writeReview(..., options: { silent?, range?, noteUri? })`.
   - `writeReviewCommand` passes the open note's range and URI.
   - `openPeriodicNoteWithReview` passes `readWeekStart()`.
8. `dates.ts`: `next week` and `end of week` already take `weekStart` from Commit B. Nothing new is needed; the tests add Monday cases.

## 4. Tests

The gate is the exit code of all four suites (`npm test`, `npm run test:ui`, `npm run test:e2e`, `npm run test:layout`), plus `npm run test:visual`.

### `npm test` (unit, vscode-test)

**New file `src/test/date-phrases.test.ts`.** `now` is Friday 2026-09-25 at noon.

Future direction:

| Input | Expected |
| --- | --- |
| `friday` | `2026-10-02` |
| `last friday` | `2026-09-18` |
| `oct 3`, `3 Oct`, `October 3rd` | `2026-10-03` |
| `sep 12` | `2027-09-12` |
| `Oct 3, 2027` | `2027-10-03` |
| `next week` | `2026-09-28` |
| `end of week` | `2026-09-26` |
| `end of the month` | `2026-09-30` |
| `next month` | `2026-10-01` |
| `weekend` | `2026-09-26` |
| `3 days ago` | `2026-09-22` |
| `in 3 days` | `2026-09-28` |

Past direction: `sep 12` is `2026-09-12` and `friday` is `2026-09-18`.

Sunday 2026-09-27:
- `next week` is `2026-10-05` with a Sunday start and `2026-09-28` with a Monday start.
- `end of week` is `2026-10-03` with a Sunday start and `2026-09-27` with a Monday start.
- `weekend` is `2026-09-27`.

Numeric dates:

| Input | Order | Expected |
| --- | --- | --- |
| `10/3` | mdy | `2026-10-03` |
| `10/3` | dmy | `2027-03-10` |
| `25/9` | mdy | `2026-09-25` (the other order) |
| `10/3` | none given | undefined |
| `31/2/2027` | any | undefined |
| `2026/10/02` | any | `2026-10-02` |

Other cases:
- `+1m` from Jan 31, 2027 is `2027-02-28`.
- `''` returns `{date: undefined}`.
- `the cat` returns undefined.

`describeDay`:
- `Monday 2026-09-28 · in 3 days`
- `Friday 2026-09-25 · today`
- `Thursday 2026-09-24 · yesterday`
- `Tuesday 2026-09-22 · 3 days ago`
- `Wednesday 2027-03-10`, with no distance beyond 31 days

`formatShortDay`: `Fri, Oct 2`, and `Wed, Mar 10, 2027` for another year.

**Changes to existing test files:**

| File | Change |
| --- | --- |
| `task-draft.test.ts` | Move the `parseTaskDateInput` cases to `parseDatePhrase`, keeping every existing expectation. |
| `bulk-edit.test.ts` | The `parseBulkDate` cases become `validateDateInput` cases. `next week` now reads as `2026-09-21` from Sat 2026-09-19. The error equals `DATE_INPUT_ERROR`. |
| `agenda-actions.test.ts` | `dueDateFor` is unchanged. Add: `validateDateInput('monday', friday)` gives `{message: 'Monday 2026-09-28 · in 3 days', severity: Info}`, and `'blah'` gives `Enter a date such as friday, in 3 days, or 2026-10-02.` |
| `capture-words.test.ts` | New cases below. |
| `link-suggestions.test.ts` | `[[oct 3` offers `2026-10-03` first, with detail `Saturday 2026-10-03 · in 8 days, that day's note`. `[[Atlas` offers no date row. |
| `query-language.test.ts` | New cases below. |
| `search-refine.test.ts` | New Created facet cases below. |
| `query-builder-webview.test.ts` or `dashboard-behavior.test.ts` | `createQuerySuggestions(index, now).values.due` includes `next-week` with detail `Sep 27 to Oct 3`, and `values.created` includes `last-month` with detail `August`. |
| `quick-find.test.ts` | `toPickItems(results, 'friday', row)` puts `Open daily note for Fri, Oct 2` first and has no `Create note` row. `'Atlas plan'` has no date row. |
| `daily-notes.test.ts` | New cases below. |
| `calendar.test.ts` | New cases below. |
| `review.test.ts` | New cases below. |
| `extension.test.ts` | The command list includes `deckard.openDailyNoteForDate`. |
| `settings.test.ts` or the manifest check | `deckard.calendar.weekStart` has the enum and the default `sunday`. |

`capture-words.test.ts` new cases:
- `Call Ren next week` becomes `- [ ] Call Ren 📅 2026-09-28`.
- `Pay rent end of the month` is due `2026-09-30`.
- `Dinner oct 3` is due `2026-10-03`.
- `Ship by 10/3` with mdy is due `2026-10-03`.
- `Ship 10/3` with no lead word stays as written.
- `plan the weekend` stays as written.
- `Read chapter 3` stays as written.

`query-language.test.ts` new cases:
- These parse without diagnostics: `created = last-month`, `due <= friday`, `due <= "oct 3"`, `due <= end-of-month`, and `created = 2026-08`.
- `due = 10/3` is an error, and the message equals the new string.
- Evaluated at a fixed `now`, with `setQueryWeekStart(1)` for the Monday start:

| Query | Matches |
| --- | --- |
| `due = this-week`, Sunday start | Sep 20–26 |
| `due = this-week`, Monday start | Sep 21–27 |
| `created >= last-month` | includes Aug 1, excludes Jul 31 |
| `due < next-week` | Sep 26 but not Sep 27 |
| `created = friday` (past) | Sep 18 |
| `done >= "last friday"` | Sep 18 onward |

- `setQueryWeekStart(0)` runs in teardown.

`search-refine.test.ts` new cases for the Created facet:
- Labels and clauses at 2026-09-25: This month, Last month, July, June, Earlier.
- Counts match the fixture's `createdAt`.
- Zero-count months are left out.
- `December 2025` carries its year.

`daily-notes.test.ts` new cases:
- `buildDailyNotePicks` gives Yesterday, Today, Tomorrow, and then recent notes newest first, without duplicates.
- Typed `last friday` gives the first row `Open daily note for Fri, Sep 18`.
- Typed nonsense gives the info row.
- `findPeriodicNoteNames('week', …, 1)` for Mon Sep 21 includes `week-2026-09-20-2026-09-26` and `2026-W39`.
- `getPeriodicNote('week', day, 1).name` is `week-2026-09-21-2026-09-27`.

`calendar.test.ts` new cases:
- `createCalendar(index, '2026-09', now, 1)`: every row starts on a Monday, and `weekdays` is `['Mon', …, 'Sun']`.
- A Sunday-named `week-2026-09-20-2026-09-26` note is the `notePath` of the row starting Mon Sep 21.
- The existing ISO case (`2026-W37`) still passes under both starts.

`review.test.ts` new cases:
- `getReviewRange('week', Sep 17, 1)` has the title `2026-09-14 to 2026-09-20`.
- `findOpenPeriod('week-2026-09-20-2026-09-26')` returns start Sep 20 and end Sep 27, whatever the setting.
- `findOpenPeriod('2026-W39')` returns Mon Sep 21 to Mon Sep 28.

### `npm run test:ui`

- `verifyWebviews` and `checkWebviewScripts` cover the calendar page, whose script now reads `state.weekdays`. The fixture state in `test/ui/pages.js` needs no change, because it falls back to Sun…Sat. `checkContrast` is unaffected.

### `npm run test:e2e`

- `calendar.e2e.js`: with a snapshot whose `weekdays` start on Mon, the header cells read Mon…Sun, and the week buttons still post `openWeek` with the row's first date.
- `searchPage.e2e.js`: a Created facet value (`data-facet-id="created"`, `data-clause="created = last-month"`) posts the clause when clicked.

### `npm run test:layout` and `npm run test:visual`

- There are no new surfaces. The Refine panel gains a Created row, but the zen `searchPage` surface (`checkLayout.js:125`) is drawn with Refine folded, so I expect no baseline change. If `test:visual` reports a diff on `*+zen-searchPage.png`, re-record those nine with `npm run test:visual -- --update` in a separate `test:` commit. The calendar is not a visual surface.

## 5. Docs

Every commit carries its own README, Help, and CHANGELOG `## Unreleased` changes.

**README**

| Commit | Change |
| --- | --- |
| A | :865 review example. |
| B | :319 (task editor): list the new forms, and say the box shows the day and how far off it is, such as *Monday 2026-09-28 · in 3 days*. |
| B | :502: "next week (its Monday)" becomes "next Monday". |
| B | :897 (capture): add `next week`, `end of month`, `oct 3`, and, after a lead word, `10/3`. |
| B | The `[[` day link text, wherever it is described (grep `links a day by name`). |
| B | One new subsection, **Dates in plain words**: the grammar table from §2, the numeric-date rule, and the note that a search reads `next-week` as the whole week. The other sections link to it. |
| C | :765 query table: `created`/`updated` gain `this-week`, `last-month`, `2026-08`, and weekday names. The `due` row gains periods, weekdays, and quoted phrases. |
| C | One example: `created = last-month`. |
| C | Mention the Created facet where Refine's facets are listed. |
| D | Commands table: add **Deckard: Open Daily Note for Date…**. Find section: *"When what you type is a day, such as `friday` or `oct 3`, Find offers to open that day's note."* |
| E | Remove "Sunday to Saturday" at :36, :843, :845, :891, and :988, and say it follows `deckard.calendar.weekStart`. Add the setting to the settings table. Add one sentence on how existing week notes are found. |

**Help** (`src/ui/webview/helpHtml.ts`)

| Commit | Change |
| --- | --- |
| B | :365 task editor card: the new forms. |
| C | :428 and :434 query rows: the new values. |
| C | :436 paragraph: add *"`this-week`, `last-month`, and `2026-08` name a whole week or month; `friday` names one day, the next one for task dates and the last one for `created` and `updated`."* |
| D | `COMMAND_NOTES` gains `'deckard.openDailyNoteForDate': 'Opens the daily note for a day you name in plain words, creating it when there is none.'` |
| E | :483 calendar card: "Sunday to Saturday" becomes "from the day `deckard.calendar.weekStart` names, Sunday unless you change it". |

**CHANGELOG** (`## Unreleased`, under `### Added` or `### Changed`, in the file's bold-lead style)
- B: **One way to write a date.** Every date box reads month names, "next week", "end of month", and your locale's numeric dates, and says back the day it read and how far off it is. Due Next Week is now Due Next Monday.
- C: **Searches name weeks and months.** `created = last-month`, `due <= friday`, `due = this-week`; Refine has a Created facet by month.
- D: **Open Daily Note for Date…**, and Find opens a day's note when you type a day.
- E: **Weeks can start on Monday.** `deckard.calendar.weekStart`; existing weekly notes still open.

**components.md.** No shared component changes. Add one line under the Calendar or Surfaces notes if a calendar entry exists: the header comes from `state.weekdays`. Otherwise nothing.

**package.json.** Covered in Commits B–E: the `modelDescription` (the assistant tool), the `weeklyNoteTemplate` description, the new command and setting, and the Due Next Monday title.

## 6. Commits

1. `docs: the review example covers a week that runs Sunday to Saturday`
2. `feat: every date box reads a month, next week, or end of month, and says back the day it read`. This is 2a and 2b.
3. `feat: a search names a week, a month, or a weekday, and Refine counts notes by the month they were written`. This is 2c.
4. `feat: a daily note opens for any day named in words, from the palette or from Find`. This is 2d.
5. `feat: weeks can start on Monday, and a weekly note written before still opens`. This is 2e.
6. Only if the visual diff appears: `test: re-record the zen search page baselines for the Created facet`.

Each commit passes all four suites on its own. Commits 3 and 5 are independent of 4. Commit 5 depends on 3, which introduces `setQueryWeekStart`.

## 7. Size, risks, dependencies, questions

**Size**

| Commits | Items | Estimate |
| --- | --- | --- |
| 2–3 | 2a–2c | about 2.5 days (M) |
| 4 | 2d | 0.5 day (S) |
| 5 | 2e | about 1.5 days (M) |
| 1 | docs fix | negligible |

The total is about **4.5 days**.

**Risks**
- **Capture reading more trailing words.** "…next week" or "…oct 3" now becomes a date. The detail line shows it and the whole-word button undoes it. Tests pin the sentences that must stay literal.
- **Locale detection.** `vscode.env.language` is the display language (often plain `en`, which is US order). A British user on `en` gets month-day order, but the Info echo makes that visible before anything is written. `getWeekInfo` is missing on older Electron, so `locale` falls back to Sunday; this needs a guard and a test with a stub.
- **The global week start in the evaluator.** It follows the `queryIdentity` precedent. Tests must reset it in teardown.
- **Hyphen-as-space in query values.** It must not touch ISO dates, `YYYY-MM`, or windows. Those are checked first, so the order in `resolveDateRange` matters.
- **Week notes after a switch.** The middle-day rule maps each old note to exactly one row. It is covered by tests in both directions and for ISO names.

**Dependencies**
- **Piece 1g** edits the same `searchFacets.ts` block (the Updated labels). Land 1g first and add Created after it.
- **Piece 1i** adds a capture draft to `capture.ts`. Both change it, but in different functions.
- **Pieces 3, 5, and 6 read dates through this piece:**
  - Piece 3's **Needs a new date** group reschedules with `pickReschedule` and `askForDueDate`.
  - Piece 5 edits `linkSuggestions.ts`, where the `[[` day links live.
  - Piece 6 changes Find (`quickFind.ts toPickItems`) and Capture.
  - Land this piece before them, as the plan's order of work says.
- **Piece 8 (message voice).** The error string here should be adopted as Piece 8's pattern for date errors. If Piece 8 lands first, it should reuse `DATE_INPUT_ERROR`.

**Open questions for David**

None. I settled these myself:
- "next week" means next week's Monday.
- A bare weekday is never today.
- Numeric dates follow the display language and are read only in boxes that show the day before writing.
- Open Daily Note for Date creates a missing note without a second confirm.
