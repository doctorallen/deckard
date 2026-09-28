# Privacy, source safety, and troubleshooting

## Source safety and persistence

Markdown files remain the source of truth. Deckard changes note content only when you:

- use a task checkbox (which also adds the ✅ date, and the next occurrence of a repeating task);
- extract a tagged heading, or rename a note, tag, or heading;
- carry unfinished tasks forward, or write a review into a periodic note;
- [edit a search's results](search-pages.md#editing-a-searchs-results);
- approve an entity tag from `Deckard: Link Current Heading to Entity`.

Before a task edit or extraction, Deckard checks the source is unchanged since it was indexed. A rename or merge that reaches more than one note is [shown before it is written](search-pages.md#previewing-and-undoing-a-write), and `Deckard: Undo Last Change` takes the last one back.

**Local cache:** a workspace-scoped SQLite cache holds note words for search and each note as last read.

**No external services:** note content is not sent to an AI model or external service, except a task's own words when you choose [Suggest steps](ai-assistants.md#suggest-steps).

**What Deckard remembers** is stored in VS Code, not in your notes:

- **Per workspace:** favorite tags and entities, pinned notes, saved searches, Home's widgets, tag and note view counts, and the custom task order.
- **Per machine:** sort modes, column counts, layouts, and page sizes.

**Favorites, pins, and saved searches** are never deleted on their own. When their tag or note is gone, `Deckard: Tidy Favorites, Pins, and Saved Searches` lists them and asks before removing them.

**Copies:** Deckard keeps the last twenty copies. `Deckard: Restore Favorites, Pins, and Searches from a Copy` takes one back. `Deckard: Export Favorites, Pins, and Searches` writes a JSON file that `Deckard: Import` reads back.

## Limitations and troubleshooting

- **A message offers Open Log:** the message says what did not happen and what to do; the details are in Deckard's log.
- **Something is not there:** run `Deckard: Check My Setup`. It checks the notes folder, excluded files, unreadable notes, and whether `deckard.me` matches anyone.
- **A note is missing from every search:** open `Deckard: Open Stats`, which lists notes the index could not read, with the reason.
- **Opened during first indexing:** pages open at once and show progress, such as *Indexing this workspace: 412 of 3,760 notes read…*.
- **The Dashboard is empty:** make sure a workspace is open, its Markdown files are within the configured scope, and they use the Markdown patterns shown above.
- **Related Notes shows no results:** open a saved Markdown note containing a tag, then check that another saved note uses the same tag.
- **A task is missing from the Tasks view:** it may be parked. Search `is:parked`.
- **A task or section is missing:** confirm the task is an unordered checklist item, the heading is an ATX heading such as `## Heading`, and `deckard.parseInlineTags` is enabled for tagged non-heading lines.
- **A heading is missing from the Outline:** the Outline shows ATX headings only, not underlined `Title`/`===` headings, and excludes headings in fenced code blocks.
- **Content in a code block is ignored:** fenced code is excluded from indexing, tag links, and completion.
- **A numeric hash is missing:** numeric-only `#` tokens are not tags. Use an `@` marker or include a non-numeric character.
- **Date sorting looks unexpected:** task and section dates come from file creation and modification timestamps, not dates written in the note.
- **Deckard feels slow:** run `Deckard: Open Log`. Steps of 100 ms or longer are listed as `Slow:`. For every timing, set the log's level to **Debug** in the Output panel. While the search cache is first built, a search finds notes by title and tags before their words.

Deckard does not support ordered-list tasks or arbitrary checklist syntaxes, and it scans only Markdown files within the configured workspace scope.

---

← [Settings](settings.md) · [All topics](README.md)
