# 26 · A date format of the reader's own

Deckard writes every date it shows as `2026-10-02`, with a few short forms
of its own (`Fri, Oct 2`, `Mon Sep 28`) in narrow places. This plan adds a
date format the reader sets once, written with tokens, which every date
Deckard shows to a reader follows. Dates Deckard writes into notes, file
names, and searches stay `YYYY-MM-DD`, since they are syntax that other
tools and other people's settings read.

Formatting uses only `Date` and `Intl.DateTimeFormat`, so no package is
added to the extension.

## The settings

| Setting | Default | Used where |
| --- | --- | --- |
| `deckard.display.dateFormat` | `YYYY-MM-DD` | Every full date: due, scheduled, start, done, and cancelled dates, created and updated details, table cells, messages, the task editor, the date box, Find, the daily note picker |
| `deckard.display.shortDateFormat` | `ddd, MMM D` | Where a day has little room and is in this year: agenda group headings, the Pages view, the calendar's day title, query completions, Linked from |

- Both are **application** scope, as every `deckard.display.*` setting is:
  how dates read is personal, so a workspace's settings can't decide it.
- A short date **in another year** is written in the full format, so a
  short format needs no year token and a date never reads as this year's
  when it isn't.
- An **empty or unreadable** format falls back to the default, and the
  setting's description says so.
- **Where Deckard names the weekday** beside a date (`Friday 2026-09-25` in
  the task editor, `Mon 2026-09-14` in the agenda), it writes the weekday
  and then the formatted date, unless the format already has a weekday
  token, in which case the format alone is written.

## The tokens

Moment.js's tokens, which Obsidian's daily notes, Templater, and Periodic
Notes use, so a format copied from a vault works here unchanged. A run of
the same letter is one token; any other character is written as it is, and
text in `[brackets]` is written without its brackets, so `[Week] W`
writes `Week 40`.

| Token | Writes | Token | Writes |
| --- | --- | --- | --- |
| `YYYY` | 2026 | `YY` | 26 |
| `Q` | 4 (quarter) | `Qo` | 4th |
| `M` | 10 | `MM` | 10, 01 padded |
| `Mo` | 10th | `MMM` | Oct |
| `MMMM` | October | `D` | 2 |
| `DD` | 02 | `Do` | 2nd |
| `DDD` | 275 (day of the year) | `DDDD` | 275, 001 padded |
| `d` | 5 (0 is Sunday) | `do` | 5th |
| `dd` | Fr | `ddd` | Fri |
| `dddd` | Friday | `E` | 5 (ISO, 1 is Monday) |
| `w` | 40 (week, from `deckard.calendar.weekStart`) | `ww` | 40, 01 padded |
| `wo` | 40th | `W` / `WW` / `Wo` | ISO week |
| `GGGG` | ISO week year | `gggg` | week year from the week start |
| `H` / `HH` | 0–23 | `h` / `hh` | 1–12 |
| `k` / `kk` | 1–24 | `m` / `mm` | minutes |
| `s` / `ss` | seconds | `A` / `a` | PM / pm |
| `X` | Unix seconds | `x` | Unix milliseconds |
| `L` | 10/02/2026 | `l` | 10/2/2026 |
| `LL` | October 2, 2026 | `ll` | Oct 2, 2026 |
| `LLL` | October 2, 2026 9:30 AM | `lll` | Oct 2, 2026 9:30 AM |
| `LLLL` | Friday, October 2, 2026 9:30 AM | `llll` | Fri, Oct 2, 2026 9:30 AM |

- **Names** (`MMM`, `dddd`, `Do`) are English, as every other word Deckard
  writes is, read from `Intl.DateTimeFormat('en', …)` so that following
  the display language later changes one argument.
- **`L` to `llll`** are the display language's own forms, from
  `Intl.DateTimeFormat(vscode.env.language, { dateStyle, timeStyle })`, so
  `L` reads `02.10.2026` in German. They are the way to say "however my
  language writes a date".
- **Times** read 00:00 on a value that has no time, which is every date in
  a note; only created and updated have one.

## Where it applies

Every date shown to a reader, by one formatter, `formatDisplayDate(at,
formats, kind)` in `domain/markdown/dateFormat.ts` (pure, and on the list
of modules pages may import):

- **Pages**: task rows (`DueText`, scheduled), board cards and their
  details, Created and Updated details, table cells (board Table, note page
  tables, query block note cells), note page query rows, tag progress
  ("next due …"), Home's Today widget and agenda groups, calendar week
  titles and day labels (spoken ones too), the related-notes reason.
- **The Markdown preview's query blocks**, which no page shell marks: the
  host renders them with the formats it read.
- **Native UI**: the Tasks view's descriptions and tooltips, the daily-note
  CodeLens, the daily note picker and Find's date row, the task editor's
  date rows, the date box's read-back, the due-date picker and spread,
  messages that name a date, link completion details, query completion
  details.
- **Copy as plain Markdown** follows it, since it copies what the page
  shows, for pasting where people read.

It does not change:

- **What is written**: task metadata (`📅 2026-10-02`), periodic note file
  names and their template variables (`{date}`, `{week}`), reviews written
  into periodic notes, inserted links, searches (`due = 2026-10-02`),
  exports (CSV, Markdown tables, `.ics`).
- **The assistant's answers**, whose tools ask for and give `YYYY-MM-DD`, so
  a model reads them back the same way.
- **Month names as headings** (`September 2026`, the Created facet's
  `July`): a month is not a date.
- **Moments shown with a time** by the system's locale: undo, preference
  backups, Stats' "Index last refreshed" tooltip, Check setup.
- **Release dates** in Help's What's new, which are the changelog's.

## How it reaches each side

- **Host**: `readDateFormats()` in `ui/commands/displaySettings.ts` reads
  both settings and `vscode.env.language` into a `DateFormats` value.
  `QueryContext` gains `dateFormats`, so the state builders that already
  take a context (board, search, agenda, calendar, note page, Home) format
  with it and nothing below them reads a setting. Commands and views
  without a context call `readDateFormats()` where they begin.
- **Pages**: the page shell writes `data-date-format`,
  `data-short-date-format`, and `data-date-locale` on the body, each only
  when it isn't the default, escaped as attribute text.
  `webview/shared/dateFormats.ts` reads them, as `entryDetails.ts` reads
  `data-details`. Changing either setting redraws open pages through
  `affectsDisplayChoices`, as every display setting does.

## What has to change first

Pages read three host strings by their shape today, which a format would
break:

- `splitDueLabel` (`webview/shared/dueParts.ts`) splits a due label at
  ` · ` and its first words.
- The board's `withDates` (`webview/taskBoard/board.tsx`) finds dates by
  `/\d{4}-\d{2}-\d{2}/`.
- The board's `detailClass` reads a detail's state from its first words.

So `DueDescription` carries its parts (`relative`, `date`, `state`)
beside `label`, and card details carry a `date` part and a `tone`. Pages
draw from the parts, and `label` stays for messages and plain text. This
lands before any date changes shape, with no visible change.

`formatTaskDate` in `taskRow.tsx` and `agendaActions.formatDay`,
`agendaState.formatDayLabel`, and `deckardPages`' own day names are copies
of the shared formatters; they go.

## Phases, one commit each

1. **The formatter.** `domain/markdown/dateFormat.ts`: the tokenizer,
   `formatDisplayDate`, `hasWeekdayToken`, `DEFAULT_DATE_FORMATS`, unit
   tests for every token, brackets, padding, ordinals, weeks around New
   Year, the 12-hour clock, and fallbacks.
2. **Parts, not shapes.** Due and card-detail parts, with the three page
   readers moved onto them; the duplicate formatters removed. No visible
   change.
3. **The settings and the plumbing.** Both settings, `readDateFormats`,
   `QueryContext.dateFormats`, the body attributes and their page reader.
4. **Every display.** The call sites above, host and page.
5. **Choosing a format.** `Deckard: Choose Date Format…`: a quick pick of
   presets (`YYYY-MM-DD`, `MM/DD/YYYY`, `DD/MM/YYYY`, `D MMM YYYY`,
   `ddd, MMM D, YYYY`, `L`, `LL`), each showing today in it, and **Custom…**,
   an input box whose message shows today as typed. It writes the user
   setting. Display's Customize… already opens Settings on
   `deckard.display`.
6. **Docs and tests.** The settings guide's rows (enforced by
   `settings-guide.test.ts`), Themes and Display, the changelog, and DOM
   goldens for a page drawn with a custom format.

## Decisions taken (logged for review)

1. **Two settings**, full and short, so narrow places stay narrow and a
   day-first reader gets `Fri, 2 Oct` there too. One setting was asked for;
   the short one defaults to today's short form, so nothing changes unless
   it is set.
2. **Moment's tokens**, for Obsidian users, rather than Unicode's (`yyyy`,
   `EEE`), which Intl itself doesn't parse either.
3. **English names, localized presets.** Names match the rest of
   Deckard's English. `L` to `llll` follow the display language.
4. **A short date in another year uses the full format**, replacing
   today's `Fri, Oct 2, 2025`.
5. **Small default changes**: query completions' week ranges read
   `Sun, Sep 20 to Sat, Sep 26` (were `Sep 20 to Sep 26`); agenda group
   headings read `Mon, Sep 28` (were `Mon Sep 28`); the calendar's day
   title reads `Fri, Sep 25` (was `Friday, September 25`).
6. **Written dates stay ISO**, assistant answers too.
7. **The date box keeps reading what it reads**; it doesn't parse the
   reader's format. A numeric date is read day first when the format puts
   `D` before `M`, else as the display language orders it.
