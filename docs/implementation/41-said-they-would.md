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
