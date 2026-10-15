# 36 · Between you and a person

David keeps a knowledge base of people at work, and before a one-to-one he
wants every open line between him and that person in one place. Every one
of those lines is already written: tasks that mention the person, tasks
assigned to them, waiting tasks, and (with plan 38) questions. This plan
gathers them on the person's page. Mockups: the "Four Deckard Ideas"
artifact, idea 7 (https://claude.ai/artifact/AGHDm1RB8P8GrXmpP6PyAr).

## The card

A person's page is the search page of their tag (`@sam-okafor`, which is
`#person/sam-okafor` too). Under its fields card it gains a **Between you**
card with three groups, each sorted overdue first, then oldest:

| Group | Lines |
| --- | --- |
| **You owe Sam** | Open tasks that are yours (assigned to you, or to nobody) and mention Sam |
| **Sam owes you** | Open tasks assigned to Sam with `👤`/`[assignee:: …]`, and open tasks with an on-hold status (Waiting `[w]`, Blocked `[=]`, Someday `[s]`, or one of the reader's own on-hold statuses) that mention Sam |
| **To ask Sam** | Open questions (plan 38) that mention Sam. Added by plan 38; until then the card has two groups |

- "Yours" is what `is:mine` already means: assigned to `deckard.me`, or to
  nobody. A task assigned to a third person is theirs, and shows on their
  page, not here, even when it mentions Sam (decision D10/D11 below).
- A task assigned to Sam that also mentions you is still *Sam owes you*.
- Only open lines count. Done and cancelled ones leave the card.
- Each row is the board's task row: its box completes it, its title opens
  the line, its date shows overdue in the warning color.
- The header's **Copy as agenda** copies the groups as Markdown:
  `## You owe Sam` then `- [ ] …` lines (titles only, with the due date),
  and the same for the other groups, ready to paste into a one-to-one note.
- Each group's label opens that group as a search page (the group is one
  search, see below), as **From other notes** labels do.
- A person with no open line between you gets no card. With `deckard.me`
  empty, the card says so with **Set who you are…** a click away, as the
  first `is:mine` search does today.

## One search a group

Each group is a query the search language can already say, so the card is
a view over the evaluator, not new matching code:

- You owe: `is:open AND is:mine AND @sam-okafor` (mention), excluding
  assignee = @sam-okafor.
- Owes you: `is:open AND (assignee = @sam-okafor OR (is:waiting AND @sam-okafor AND assignee = none))`.
  Check what `is:waiting` covers (search.md: on-hold statuses, or assigned
  to someone else) and narrow it so a task assigned to a third person is
  not counted.

Write the exact queries as constants with a unit test each against a small
workspace. Where the language cannot say something, add the smallest term
it needs and document it in search.md.

## Where it shows

- On every person's tag page (a tag whose type has `rows: "@*"`, or any
  `@name` / `#person/…` tag), between the fields card and the tabs.
- Zen: counts and dates stay; Copy as agenda is quieted in place
  (`data-zen-reveal`), like the board's buttons.
- The assistant tool `deckard_describe_tag` adds the three groups' counts
  for a person, so "what do I owe Sam?" can be answered.

## Decisions taken (recommended options)

- **D10** A mention on your own task means you owe that person.
- **D11** A waiting task that mentions someone counts as theirs.
- **D12** Copy as agenda is kept.

## Tests

- Unit: the group queries over a fixture workspace (each row of the table
  in the mockup: mention, assigned to me + mention, assigned to Sam, `[w]` +
  mention, assigned to Lena + mention → not shown, done → not shown).
- Page behavior (jsdom, `openWebviewPage`): the card's groups, counts,
  empty state, `deckard.me` empty state, Copy as agenda's text.
- Messages narrowing for any new page→host message.
- No DOM goldens or visual baselines in this plan's branch; those are
  recorded once after David's review.

## As built

Built on `feat/four-ideas`, without the **To ask Sam** group, which plan 38
adds. Where the plan was silent, or the code made its words impractical:

- **The searches.** `src/ui/state/betweenYou.ts` holds them as a table,
  `BETWEEN_GROUPS`, one rule per group, so plan 38 adds its group as one
  more row (and `BetweenGroupKind` gains `toAsk`; its rows are questions,
  not tasks, so that group will carry rows of its own beside `tasks`):
  - You owe: `is:open is:mine -is:waiting -is:parked @sam-okafor`. The
    plan's exclusion of `assignee = @sam-okafor` is left out: `is:mine`
    never holds a task assigned to Sam, since the reader's own page has no
    card. `-is:waiting` is added: for a task of yours it is the on-hold
    status alone, and without it a `[w]` task that mentions Sam was in both
    groups, where D11 puts it in Sam's.
  - Sam owes you: `is:open -is:parked (assignee = @sam-okafor OR (is:waiting
    is:mine @sam-okafor))`. `is:mine` narrows `is:waiting` in place of
    `assignee = none`, so a task on hold that you assigned to yourself and
    that mentions Sam is Sam's too, and a task assigned to a third person
    is still left out. The language says all of it, so nothing was added to
    search.md.
  - Parked tasks are left out, as the Task board and the Tasks view leave
    them out.
- **Where the card shows.** On the page of any `@` or `#person/` tag, but
  not on the reader's own page (the tag `deckard.me` names, however it is
  written), nor on a person's page that a search narrows, where it would
  push the results down.
- **Each group** draws its first ten lines, and **Show all N** opens its
  search, as its label does. A group with no lines is still drawn, with
  *Nothing open.*, so the reader sees both were looked at. Overdue lines
  come first, the longest overdue first; then the oldest by their `➕` date,
  or their note's.
- **The person's name** in the labels is the first word of their row's
  title, else of their hub note's, else of their tag: *Sam*.
- **A group's label** opens its search on a search page of its own, through
  `deckard.searchNotes`. The search page gained an `openSearch` message for
  it, which the host acts on only for a search the card drew.
- **Copy as agenda** is worked out again by the host, every line and not
  only the ten drawn, and written to the clipboard with a status bar
  message. A group with nothing in it is left out of the agenda. The due
  date is written as words, `(due 2026-10-06)`, not as a `📅` field; the
  titles keep their tags as written.
- **Set who you are…** opens the `deckard.me` setting, as Open Setting does
  on the first `is:mine` search's message.
- **The describe tool** adds one line for a person, `Between you: You owe
  Sam: 2. Sam owes you: 2.`, and says when `deckard.me` names nobody.
  `answerDescribeTag` takes the query context as a fourth argument for it;
  without one it says nothing of the card.
- The mockup's *Settled since you last looked* line under the card is not
  in this plan's text and is not built.
- **To ask Sam**, added once plan 38 was merged in: a third row of
  `BETWEEN_GROUPS`, whose lines are `listQuestionsMentioning(index, tag)`,
  the open questions that name the person on their own line, oldest first,
  drawn as the Questions tab draws a question (its line opens, **Answer…**
  writes the answer). Its label opens `is:unanswered @sam-okafor`, which
  also finds the questions under a heading or in a note that names Sam, so
  **Show all** may list more than the card counts. Copy as agenda writes
  `## To ask Sam` and a `- [?] …` line for each, its tags as written, and
  the describe tool's line ends `To ask Sam: 1.` A person with only a
  question open gets the card. While `deckard.me` is empty, the describe
  tool says the "Me" setting names nobody, in words, as every message
  names a setting.
