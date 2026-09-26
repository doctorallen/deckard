# A sample Deckard workspace

Nine notes, kept small on purpose, so the conventions Deckard reads are
in front of you rather than described. Open the Dashboard, then look at
how each note is written.

The dates are set on the day you create the sample, so one task is overdue,
two are due today, and one is due later this week.

| Note | What it shows |
| --- | --- |
| `{{date-9}}.md`, `{{date-8}}.md`, `{{date-5}}.md`, `{{date-1}}.md`, `{{date}}.md` | **Daily notes**, the last two yesterday's and today's. A heading per thing worked on, tagged with what it is about — `#project/ghostline-relay`, `#team/wardens`. Tasks under the heading, some with a date `📅` and a priority `⏫`, some naming a person `#person/ren-kade`, and three with a status, `#status/doing`, `#status/todo`, and `#status/waiting`. |
| `Argent Protocol.md`, `Harbor.md` | **Hub notes.** `describes:` in the front matter says which tag the note is about, so a search for that tag opens with this note at the top. The other front-matter fields are the note's own. |
| `Sable Ortiz.md` | **A person.** `describes: person/sable-ortiz` makes this the hub for `#person/sable-ortiz`. |
| `Wardens.md` | **A team**, and a list of people in front matter, each a tag. |

Some tags and people are named here that have no note of their own.
That is normal: a tag exists the moment it is written, and Home lists
the ones without a hub under **Tags without a hub**. One is misspelled on
purpose: `#person/mara-vle` in `{{date-9}}.md` is Mara Vale written wrong,
and Stats offers to merge it into `#person/mara-vale`.

Try, in order:

1. `Deckard: Open Dashboard` — what is overdue and due today, then Home.
2. Search `#project/ghostline-relay` — every entry about it, and its tasks.
3. `Deckard: Open Task Board` — three tasks already have a status. Drag one to another column.
4. Open `Sable Ortiz.md` — the Related Notes sidebar fills with what shares its tags.
5. `Deckard: Create Daily Note` — today's note is already here; it opens.

`.vscode/settings.json` sets the few settings that could otherwise hide the
sample's notes or tasks, so your own settings cannot make it look empty.

This folder is kept in VS Code's storage for Deckard. Running
`Deckard: Create a Sample Workspace` again replaces it with a fresh copy
dated from that day.
