# Editor lenses

## Why

The lenses Deckard draws above a note's lines count things: who links to the
note, which links name a heading, how many open tasks sit beneath it. They
report. Several commands Deckard already has — carrying tasks forward, creating
a linked note, linking a mention — answer a question the reader only has while
looking at a particular line, and today they are reached from the palette.

Five lenses bring what the index already knows to the line it is about:

| Lens | Where | Says | Selecting it |
| --- | --- | --- | --- |
| Task dependencies | A task with `⛔` or `🆔` | **Waiting on 2 open tasks**, **Blocks 3 open tasks**, **No task has 🆔 abc** | Lists the tasks in the references peek |
| Daily notes | First line of a daily note | **Carry in 4 unfinished tasks** (today's note only), **‹ 2026-09-21**, **2026-09-23 ›** | Runs `Deckard: Roll Unfinished Tasks Forward`, or opens the neighboring daily note |
| Link problems | First line of a note | **2 links open no note** | Lists them in the references peek |
| | | **Create 2 missing notes** | Creates the notes the missing links name |
| Embeds | An `![[Note#Heading]]` line | **Embed: Atlas has no heading "Decision"** | Opens the note it names |
| Unlinked mentions | First line of a note | **Mentioned in 3 notes without a link** | Lists them in the references peek |
| | | **Link 5 mentions** | Links them, through the refactor preview |

## Constraints

**A lens appears only when there is something to see.** No lens reads
"0 tasks", "No problems", or "Open source". A task whose dependencies are all
done is not waiting on anything, so it gets no lens. An embed that draws gets
no lens; the `[[link]]` inside it already opens its note. A daily note with
nothing left in earlier notes offers nothing to carry in, and a daily note
with no neighbor on one side has no arrow on that side. This is the same rule
`editorReferences.ts` already follows for the Related Notes lens.

**Each group has its own setting**, all `true` by default, in the Editor
settings beside `deckard.editor.referenceCounts`:

- `deckard.editor.taskDependencies`
- `deckard.editor.dailyNoteActions`
- `deckard.editor.linkProblems`
- `deckard.editor.embedProblems`
- `deckard.editor.unlinkedMentions`

**Lenses sit on headings, the first line, fences, embeds, and tasks that have
dependencies** — never on every task line.

**Work is deferred where it can be.** A lens whose title needs the count is
computed when the lenses are provided, because a lens with nothing to show
must not be provided at all; what is costly is cached per index snapshot, so
it runs once per save rather than once per keystroke or scroll. The locations
a peek lists are gathered only when VS Code resolves the lens, which it does
for lenses on screen.

## Shape

`src/ui/commands/editorLenses.ts` holds one provider, `EditorLenses`, beside
`EditorReferences`. Each group is a function from the note being edited and
the index to the lenses it wants, gated by its own setting. What each group
decides — which tasks are waited on, which links are broken, which mentions
are unlinked — is a pure function in `src/ui/state/editorLensState.ts`, and
`src/test/editor-lenses.test.ts` tests those directly, the way
`editor-references.test.ts` tests `referenceState.ts`.

Commands the lenses run that no palette entry needs are registered in
`extension.ts` and left out of `package.json`, as `deckard.createLinkedNote`
is.

### Task dependencies

A task's `⛔ abc, def` names the `🆔` of the tasks it waits for. The lens
counts the **open** tasks among them, since a done task no longer holds
anything up; an id no task in the workspace carries is named, since that is a
typo or a deleted task, and either way worth seeing. A task with a `🆔` counts
the open tasks whose `⛔` names it, but only while it is open itself: a done
task blocks nothing. Queries already call these `is:blocked` and `is:blocking`,
from the same reading of the index.

### Daily notes

The carry-in lens appears only on today's daily note, since the rollover
writes into today's note, and counts the unfinished tasks
`planRollover()` would carry, minus those whose line is already in today's
note — a rollover skips those, and in copy mode they would otherwise keep the
lens up after every rollover. The arrows use `findAdjacentDailyNote()`, and
run the existing previous and next commands.

### Link problems

`findLinkProblems()` already finds the `[[links]]` that open no note or
several. The lens counts them from the editor's text, so it follows unsaved
edits the way the diagnostics do. **Create N missing notes** appears only for
names no note has; an ambiguous name is not fixed by creating another note.
An existing note is never overwritten.

### Embeds

`resolveEmbed()` is what the preview draws. The lens appears when it draws a
message instead of a note, with that message as the lens title — except a
note name that opens no note, which the link-problem lens and the diagnostics
already mark. Selecting it opens the note the embed names, where the heading
or `^marker` went missing.

### Unlinked mentions

A mention is the note's title or one of its aliases written as whole words in
another note's prose: not inside a `[[link]]`, inline code, a code fence, a
URL, or front matter. Names shorter than three characters, and names several
notes share, are not looked for. Case is ignored when finding a mention and
kept when linking one: `atlas` becomes `[[atlas]]`, which opens `Atlas.md`
because links match names without regard to case. The link is one
`applyWorkspaceWrite()`, so it is previewed by `deckard.previewWorkspaceWrites`
and taken back by `Deckard: Undo Last Change`.

## Testing

Each group's state function has unit tests in `editor-lenses.test.ts`,
including the cases where nothing is shown. `extension.test.ts` asks VS Code
for a note's lenses through `vscode.executeCodeLensProvider`, as the existing
reference-count test does. All four suites run before each commit.

See [components.md](components.md) for how the editor surfaces are arranged,
and [CONTRIBUTING.md](CONTRIBUTING.md) for the suites.
