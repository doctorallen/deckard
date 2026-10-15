# 41 · Said they would

Much of what one waits on at work is a sentence, not a task: *Sam says the
loader fix lands by Friday*. Deckard notices a line in today's note that
names a person and a future day, and offers to track it as a waiting task
for that person, due that day. Mockups: the "Six More Deckard Ideas"
artifact, idea 12.

## What is offered

A line is offered when all hold:

- It is in today's daily note (D19: offered while you write; old notes are
  left alone).
- It is not a task, a question, a heading, or inside code.
- It mentions exactly one person (`@name` or `#person/…`), who is not
  `deckard.me`.
- It has a day phrase in the future, within 60 days: `by Friday`, `on
  Friday`, `Friday`, `tomorrow`, `next week` (that week's Friday, or the
  reader's last workday), `end of week`/`EOW`, `end of month`/`EOM`, `on
  the 20th`, `Oct 20`, `20 Oct`, `10/20`, an ISO date, `in 3 days`.
  Reuse Quick add's day parser (Add Task's), extended where needed;
  phrases it cannot read are not offered.
- **Not a promise** has not been chosen for this line (kept in workspace
  state by the line's text hash and note).
- No task under it already tracks it (a child `[w]` line assigned to the
  same person).

## How it is offered

- The day words get a faint wavy underline (a decoration in the editor
  theme's warning-ish color at low strength), in today's note only.
- A CodeLens above the line: **Track: Sam · Fri 17 Oct**, **Not a
  promise**.
- The lightbulb (code actions, kind QuickFix) on the line: **Track as
  waiting on Sam, due Fri 17 Oct**, **Track as waiting on Sam…** (opens
  the task editor prefilled, to change the day or title), **Not a
  promise**.

## What tracking writes (D20: a new line under it)

`- [w] <title> 👤 @sam-okafor 📅 2026-10-17` indented one level under the
line (as a child list item, so it travels with the sentence), in the
task metadata format the note uses (`deckard.tasks.metadataFormat`, or
Dataview brackets when the note uses them).

- The waiting status is the reader's first status of the on-hold type
  (Waiting `[w]` by default).
- **The title**: the words after the person's name and a reporting verb
  (`says`, `said`, `will`, `promised`, `to`), with the day phrase and
  trailing punctuation removed, first letter capitalized: *Sam says the
  loader retry fix lands by Friday* → *Loader retry fix lands*. When that
  leaves fewer than two words, the whole line minus the day phrase.
- A trailing ` (from line N)` is NOT written; the parent line is the
  source.
- Undo is the editor's own undo (one edit).

From then on it is an ordinary task: on the board, `is:waiting`, on the
person's Between you card under *Sam owes you* (plan 36), and overdue
when the day passes.

## Zen

The underline stays (it is content markup, like a link); the lens follows
the editor's own CodeLens setting.

## Setting

`deckard.editor.trackPromises` (default on) turns the underline, lens, and
lightbulb off.

## Tests

- Unit: detection (each rule above, each day phrase, the 60-day limit, one
  person, `deckard.me` excluded, already tracked), title extraction, the
  written line in both metadata formats.
- Host (single file): the code actions on a line in today's note, and
  none in another note; Not a promise remembered.

## As built

Built on `feat/said-and-terms`, after plans 36 and 37. The rules are pure,
in `src/domain/tasks/promises.ts`; the underline, the lens, and the
lightbulb are one provider, `src/ui/providers/promiseTracking.ts`; and
Track and Not a promise are `src/ui/commands/trackPromise.ts`. Where the
plan was silent, or the code made its words impractical:

- **Today's note** is a note whose name, or top heading, is today's date,
  as Deckard tells a daily note anywhere else, and not only the path Deckard
  would create it at, so a daily note kept in another folder is read too.
- **The day.** Every phrase is read by `parseDatePhrase`, but three the
  date boxes read otherwise: `next week` and `end of week`/`EOW` are that
  week's Friday (the plan names Friday for `next week` only; a promise for
  the end of the week means the workday too, and Deckard has no workday
  setting to read a last workday from), and `on the 20th` is the next 20th
  to come. A whole weekday name is read alone; a short one (`fri`, `sat`)
  only after `by`, `on`, `due`, `before`, or `until`, so *the sat nav* is
  no day. `next Monday` and `in 2 weeks` are read too. A numeric `10/20` is
  read in the order the reader's date format writes a day, as the date
  boxes read one. Of two day phrases on a line, the last that reads is the
  promise's, so *said on 1 Oct that it lands by Friday* is Friday.
- **A question** is a line whose last word ends in `?`. Once plan 38 was
  merged in, a question written `- [?]` is skipped too, whatever it ends
  with, as a checkbox line, as a task is; a unit test holds it. A tracked
  promise, a waiting task assigned to the person, is under **Sam owes you**
  on their Between you card (plan 36), as `between-you.test.ts` holds.
- **Already tracked** is any task in the lines indented under the line,
  up to the first that is not, assigned to the same person, whatever its
  status, not only `[w]`: a promise kept and ticked off is not offered
  again.
- **The title** also drops a leading *that*, and a leading *the*, *a*, or
  *an*, as the plan's own example drops *the*, and punctuation at either
  end. No tag of the person's is kept in it: when the words after
  the person are too few and the whole line is used, the person is written
  by name (*Lunch with Sam*), and a closing *…by Friday, says @sam* is
  dropped. `@sam` and `#person/sam` on one line are one person.
- **Where a task cannot go.** A table row, a quote or callout line, a line
  in an HTML comment or in indented code, and a line that is no list item
  but is indented are never offered: a child line would end the table,
  fall outside the quote, hide in the comment, or join the text above.
  The line must read as the same promise with what a reader never sees
  blanked, as words are counted (`maskNoteForWords`). (QA)
- **Numbers and the turn of the year.** A bare numeric `11/12` is a day
  only after a lead word or at the end of the line, so *merged 11/12 PRs*
  is none; *on the 5th* said in December is January's. (QA)
- **The line written** is in the order Deckard writes a task's fields, due
  before the person: `- [w] Loader retry fix lands 📅 2026-10-16 👤
  @sam-okafor`. Under a list item it lines up with the item's words; under
  a plain line it is two spaces in; under a line indented with tabs, one
  tab more.
- **The day said** on the lens and in the lightbulb is in the reader's
  short date format, `Fri, Oct 16`, not `Fri 16 Oct`, as Deckard writes a
  short day everywhere else.
- **The lightbulb's Track** carries its edit, so VS Code can preview it;
  the lens's runs `deckard.trackPromise`, which checks the line still reads
  as it did and writes the same one edit. Before it writes, and again when
  **Track…**'s editor closes, it reads the offer again: the setting must be
  on, the note still today's, the line not tracked yet (a second click on a
  lens drawn before the first wrote is refused), and its day the one the
  lens or lightbulb said, which they pass. (QA) **Track as waiting on Sam…**
  opens the task editor titled *Track as waiting on Sam*. The two commands,
  `deckard.trackPromise` and `deckard.notAPromise`, are internal, as the
  other lens commands are, and not in the palette.
- **Not a promise** is kept in `workspaceState` as `deckard.notPromises`,
  each line as its note's URI and a hash of its trimmed words, the latest
  500 kept (persisted format 28). The hash is the one plan 37's visits
  use, moved to `shared/text.ts` as `shortHash`.
- **The setting** is one more `deckard.editor.*` switch the editor preset
  decides, with no default in the manifest, as the others have: on in
  Full and Tasks, off in Writing and Off. A new theme color,
  `deckard.promiseUnderline`, is the warning color at half strength.
- **Tests**: `promises.test.ts` (unit) and `promise-tracking.test.ts`
  (host).
