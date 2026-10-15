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
