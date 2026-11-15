# Start here

Six weeks of notes from aboard the **Corvid**, a small independent ship
that takes survey and hauling contracts and keeps itself running. You are
**Rhea Calder**, its captain. The crew is in the middle of the **Relay
survey**, docked at Pallas Yard between legs while the chief engineer
rebuilds a coolant pump. Every date was set the day this sample was made,
so something is overdue, something is due today, and the briefings run up
to today.

Run **Deckard: Take the Tour** for a guided walk through this sample.

## Five things Deckard reads

You write them the way you already do; nothing here is Deckard's own syntax.

| Write | It becomes |
| --- | --- |
| `- [ ] Recalibrate the survey array 📅 {{date+6}}` | A task, in the Tasks view, on the Task board, and on Home |
| `#contract/relay-survey` | A tag: everything that carries it is one page |
| `@juno-achterberg` | A person: every note and task about them is one page |
| `[[DEC-002 Burn profile]]` | A link: that note lists this one under **Linked from** |
| `/` alone at the start of a line | A menu of what to write: a task, a heading, a link, a table, a template |

## Read in this order

Open each note in the editor, with the Deckard sidebar open beside it.
Keys are written both ways: <kbd>Ctrl</kbd> on Windows and Linux,
<kbd>Cmd</kbd> on macOS.

1. [[{{date}}]], today's briefing: the pump, the survey's next leg, two
   things people said they would do, and work due today.
2. [[Relay survey]], the contract's hub: what it is, who is on it, how far
   along its tasks are, and a live list of what is still open. The
   [[Survey flight plan]] and the [[Buoy checklist]] are filed under it.
3. [[DEC-001 Survey route]] and [[DEC-002 Burn profile]]: two decisions,
   linked from the notes that made them.
4. [[Juno Achterberg]] and [[Tomas Vey]]: one-on-ones, with the follow-ups
   each of you owns.
5. [[Engineering]], a team: who leads it, who is on it, and what is still
   open in its people's notes.
6. [[Life support]] and [[Hull]]: the ship's upkeep, with a task that
   repeats every week.

## Try it

- **See a person.** Cmd-click (Ctrl-click) `@juno-achterberg` in any note:
  Juno's page lists every one-on-one, every mention, and the tasks that are
  Juno's.
- **See what links here.** Open [[DEC-002 Burn profile]] and look at
  **Linked from** in the Context view.
- **Add a task.** Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd>
  (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> on macOS) with
  no note open, choose **Description**, and type `Check the new pump seals
  for @dev-laurent friday`: the title names today's note, and **Write the
  task** puts it there, due Friday, as Dev's.
- **Find anything.** Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd>
  (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd>) and type
  `coolant pump`, then `#contract/relay-survey is:open`.
- **Track a promise.** In today's note, `@juno-achterberg says the coolant
  pump rebuild is done by Tuesday` has a lens above it: **Track** writes a
  waiting task for Juno under it.
- **Carry work forward.** Yesterday left two tasks open.
  `Deckard: Roll Unfinished Tasks Forward` brings them into today's note.
- **Open Home.** `Deckard: Open Home`: what is due today, what slipped, and
  what got done this week.
- **Write a note from a template.** `Deckard: New Note from Template`,
  then **Briefing** or **One-on-one**.

## Who does what

The notes in `Types/` say what a person, a team, a contract, a ship's
system, a decision, and a term are, and which fields each has: a table
with a row per field. The front matter of a note then fills them in:
Dev's note says `team: "#team/engineering"`, the Engineering note says
`lead: "@juno-achterberg"`, and the Reactor note says `keeper:
"@juno-achterberg"`. Deckard reads the rest backwards: Dev is one of
Engineering's **members**, and Juno **keeps** the Reactor and the Drive.

- **Ask.** In Find, type `engineering lead`: the answer is Juno
  Achterberg. `who is on engineering`, `engineering channel`, `relay survey
  lead`, `what does juno keep`, and `juno email` work too.
- **See everyone as a table.** Search `type = person`: one row per person,
  with their role, team, who they report to, and email. Lio and Amara have
  no note yet, and the table says so. Right-click a heading to sort by it
  or hide it.
- **See the contracts as a board.** Search `type = contract` and choose
  **Board**: a column for each state, from bidding to delivered.
- **Hover a person.** Point at `@juno-achterberg` in any note: Juno's role,
  team, who Juno reports to, and email, and when Juno was last mentioned.
- **Read a term.** Point at `EVA` in a note about the buoys: what it means,
  from its term note [[EVA]], with **Find uses**. In Find, `what is EVA`
  answers the same, and `Deckard: Open Stats` lists every term the notes
  use, and which have no definition yet.
- **Edit a field.** Cmd-click (Ctrl-click) `@juno-achterberg` in any note,
  or find Juno in Find: the page's hub card lists Juno's fields, and **Edit
  fields…** beside **Open** opens a form with each of them filled in.
  Change one, choose **Save changes**, and only that line of the note's
  front matter changes. **From other notes** lists what other notes say of
  Juno, and where each is set.
- **A page with no note.** Cmd-click (Ctrl-click) `@lio-marsh` in today's
  note: no note describes Lio, and the page still gathers every note that
  mentions Lio. **Add fields…** there writes Lio's note.
- **Decisions.** [[DEC-002 Burn profile]] says `type: decision` in its
  front matter, and [[Relay survey]] lists every decision with its date and
  state. Open the decision as a page (the unicorn button in the editor's
  title bar): its fields sit under the title bar, and **Edit fields…**
  after them opens the same form.

`Deckard: Open Help` covers the rest, and **Types and fields** covers these.
