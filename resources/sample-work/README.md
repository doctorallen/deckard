# Start here

A week of work notes, the kind a team lead keeps: standups, two 1:1s, a
project, and the decisions it made. You are **Alex Rivera**, leading the
team that is shipping **Checkout v2**. Every date was set the day this
sample was made, so something is overdue, something is due today, and the
standups run up to today.

## Five things Deckard reads

You write them the way you already do; nothing here is Deckard's own syntax.

| Write | It becomes |
| --- | --- |
| `- [ ] Send the rollout plan 📅 {{date+2}}` | A task, in the Tasks view, on the Task board, and on Home |
| `#project/checkout-v2` | A tag: everything that carries it is one page |
| `@noor-haddad` | A person: every note and task about them is one page |
| `[[ADR-001 Card form]]` | A link: that note lists this one under **Linked from** |
| `/` alone at the start of a line | A menu of what to write: a task, a heading, a link, a table, a template |

## Read in this order

Open each note in the editor, with the Deckard sidebar open beside it.
Keys are written both ways: <kbd>Ctrl</kbd> on Windows and Linux,
<kbd>Cmd</kbd> on macOS.

1. [[{{date}}]], today's standup: tasks due today, one you handed to Theo,
   and links to the project and a decision.
2. [[Checkout v2]], the project's hub: what it is, who is on it, how far
   along its tasks are, and a live list of what is still open.
3. [[ADR-001 Card form]] and [[ADR-002 Feature flags]]: two decisions,
   linked from the notes that made them.
4. [[Noor Haddad]] and [[Theo Park]]: 1:1 notes, with the follow-ups each
   of you owns.
5. [[Payments]], your team: who leads it, what it owns, and who is on call.

## Try it

- **See a person.** Cmd-click (Ctrl-click) `@noor-haddad` in any note: Noor's
  page lists every 1:1, every mention, and the tasks that are Noor's.
- **See what links here.** Open [[ADR-001 Card form]] and look at
  **Linked from** in the Context view.
- **Add a task.** Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd>
  (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> on macOS) with
  no note open, choose **Description**, and type `Review Theo's flag cleanup
  for @theo-park friday`: the title names today's note, and **Write the
  task** puts it there, due Friday, as Theo's.
- **Find anything.** Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd>
  (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd>) and type
  `flags`, then `#project/checkout-v2 is:open`.
- **Open Home.** `Deckard: Open Home`: what is due today, what
  slipped, and what got done this week.
- **Write a note from a template.** `Deckard: New Note from Template`,
  then **One-on-one**.

## Who owns what

The notes in `Types/` say what a person, a team, an area, and a decision
are, and which fields each has: a table with a row per field. The front
matter of a note then fills them in: Noor's note says `team:
"#team/payments"`, and the Payments note says `lead: "@alex-rivera"` and
`owns: ["#area/checkout", ...]`. Deckard reads the rest backwards: Noor is
one of Payments' **members**, and Checkout is **owned by** Payments.

- **Ask.** In Find, type `checkout lead`: the answer is Alex Rivera, by way
  of the team that owns Checkout. `who is on payments` and `payments
  channel` work too.
- **See everyone as a table.** Search `type = person`: one row per person,
  with their role, team, manager, and email. Ines and Sam have no note yet,
  and the table says so. Right-click a heading to sort by it or hide it.
- **Hover a person.** Point at `@noor-haddad` in any note: Noor's role,
  team, manager, and email, and when Noor was last mentioned.
- **Edit a field.** Open [[Noor Haddad]] as a page (the unicorn button in
  the editor's title bar): the fields sit under the title bar, and **Edit**
  on a row changes one line of the front matter.
- **A page with no note.** Cmd-click (Ctrl-click) `#area/checkout` in the
  Payments note: no note describes Checkout, and its page still says which
  team owns it, and who leads that team.
- **Decisions.** [[ADR-001 Card form]] says `type: decision` in its front
  matter, and [[Checkout v2]] lists every decision with its date and state.

`Deckard: Open Help` covers the rest, and **Types and fields** covers these.
