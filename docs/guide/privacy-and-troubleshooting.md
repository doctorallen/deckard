# Privacy, source safety, and troubleshooting

## Source safety and persistence

Markdown files remain the source of truth. Deckard changes note content only when you use a task checkbox, explicitly extract a tagged heading, rename a note, tag, or heading, carry unfinished tasks forward, write a review into a periodic note, [edit a search's results](search-pages.md#editing-a-searchs-results), or approve an entity tag from `Deckard: Link Current Heading to Entity`. A rename or merge that reaches more than one note is [shown before it is written](search-pages.md#previewing-and-undoing-a-write), and `Deckard: Undo Last Change` takes the last one back. Before applying a task edit, Deckard compares the complete source line and checkbox value with the indexed version. Completing a task also adds its ✅ date, and completing a repeating task inserts its next occurrence on the line above; both happen in that same checked edit. Before an extraction, Deckard verifies the source section is unchanged, then removes it only after the new note is created.

Deckard stores a workspace-scoped SQLite cache locally: the words of each saved note for fast search, and each note as it was last read, so the next start does not read every note again. A new version of Deckard, a change to a parsing setting, or a new time zone rebuilds it. It does not send note content to an AI model or external service; the one exception is a task's own words, sent only when you choose [Suggest steps](ai-assistants.md#suggest-steps). Favorites, sorting choices, custom display order, access counts, and source/rendered view preference are stored separately in VS Code and do not add metadata to your notes.

Deckard never deletes a favorite, a pin, or a saved search on its own. If a tag or note it pointed at is gone, the item stays until you run **Deckard: Tidy Favorites, Pins, and Saved Searches**, which lists what points nowhere and asks before removing it. Only what Deckard derived for itself — view counts, access order, when a tag was first seen — is cleaned up automatically, and only against this workspace's own index.

What Deckard remembers is also copied. A moment after each change it writes a copy into this workspace's storage and keeps the last twenty, so a bad write, a mistaken import, or an over-eager tidy is something you can take back with **Deckard: Restore Favorites, Pins, and Searches from a Copy**. To carry it to another machine, or to keep your own copy, **Deckard: Export Favorites, Pins, and Searches** writes it as one JSON file and **Deckard: Import** reads it back; both say what they hold before replacing anything.

What Deckard remembers is split in two. Anything that **names what is in a workspace** — favorite tags and entities, pinned notes, saved searches, Home's widgets, tag and note view counts, and the custom task order — is kept with that workspace, so opening another folder cannot disturb it. Anything that is **how Deckard looks** — sort modes, column counts, layouts, and page sizes — is kept for the machine and is the same in every workspace. Upgrading from 1.18 or earlier hands what was stored machine-wide to the first workspace you open, so a single set of notes carries over untouched; a second workspace starts empty rather than inheriting tags it does not have.

## Limitations and troubleshooting

- **A message offers Open Log:** when something fails, the message says what did not happen and what to do; the details are in Deckard's log.
- **Something is not there, and you are not sure why:** run `Deckard: Check My Setup`. It says where notes are read from and whether that folder exists, how many files the exclude patterns kept out, which notes could not be read, and whether `deckard.me` matches anyone — each with what to do.
- **A note is missing from every search:** open `Deckard: Open Stats`. A note the index could not read is listed there with the reason; Deckard also says so when it first happens.
- **Opened while the workspace is first indexed:** Find, search pages, Home, the Task board, and Stats open at once and say how far the scan has got, such as *Indexing this workspace: 412 of 3,760 notes read…*; what you typed in Find is kept, and the results take the line's place when the index is ready.
- **The Dashboard is empty:** make sure a workspace is open, its Markdown files are within the configured scope, and they use the Markdown patterns shown above.
- **Related Notes shows no results:** open a saved Markdown note containing a tag, then check that another saved note uses the same tag.
- **A task is missing from the Tasks view:** it may be parked. Search `is:parked` to see what is.
- **A task or section is missing:** confirm the task is an unordered checklist item, the heading is an ATX heading such as `## Heading`, and `deckard.parseInlineTags` is enabled for tagged non-heading lines.
- **A heading is missing from the Outline:** the Outline shows ATX headings only, so an underlined `Title`/`===` heading does not appear. Headings inside fenced code blocks are excluded on purpose.
- **Content in a code block appears ignored:** this is intentional. Fenced code is excluded from indexing, tag links, and completion.
- **A numeric hash is missing:** numeric-only `#` tokens are intentionally not tags. Use an `@` marker or include a non-numeric character.
- **Date sorting looks unexpected:** task and section dates come from source file creation and modification timestamps, not dates written in note content.
- **Deckard feels slow:** run `Deckard: Open Log`. Any step that takes 100 ms or longer is listed there as `Slow:` with how long it took and how much it covered, such as the number of notes. To see every timing, open the log's settings in the Output panel and set its level to **Debug**. Editing a note never waits on indexing. A save updates only that note's part of the index, the views on screen then redraw one at a time with the one in front first, the Notes Graph is not redrawn by a save that changes none of its links, headings, tags, or tasks, the Related Notes sidebar ranks again only when the cursor moves to a different tagged entry, and hidden panels catch up when they are shown. At start, Deckard shows your notes as they were when VS Code last closed and then rereads only the notes whose size or saved time changed, with **Deckard: Checking notes for changes** in the status bar; `Deckard: Reindex Workspace` rereads every note. The search cache is written on a thread of its own, so the first build in a new workspace does not hold VS Code up; while it runs, a search finds a note by its title and tags before it finds it by the words inside it, and the log records the build as `Write search index off the extension host`.

Deckard does not support ordered-list tasks or arbitrary checklist syntaxes, and it scans only Markdown files within the configured workspace scope.

---

← [Settings](settings.md) · [All topics](README.md)
