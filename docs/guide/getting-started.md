# Getting started

## Requirements

- VS Code 1.134.0 or newer.
- An open folder or workspace containing Markdown notes.

Deckard scans every `*.md` file in each workspace folder by default. Set a notes folder to restrict the index.

## Install

Search for **Deckard** in the Extensions view and select **Install**, or install it from its [Visual Studio Marketplace page](https://marketplace.visualstudio.com/items?itemName=esperinnovations.deckard-notes). VS Code keeps it up to date from there.

Each [GitHub release](https://github.com/doctorallen/deckard/releases) also carries the VSIX, for `Extensions: Install from VSIX...` where the Marketplace is out of reach.

## Get started

**Sample:** `Deckard: Create a Work Sample` writes a week of a team lead's notes: standups, two 1:1s, a project hub, a team, and two decision records, with **Try it** in its README. Its `Types` folder makes the people, the team, its areas, and the decisions [types](databases.md), so Find answers `checkout lead`. It opens in this window when no folder is open, and otherwise in a new window or this one, as you choose; its notes are dated from the day you make it, and running the command again offers a fresh copy.

**Walkthrough:** `Deckard: Get Started`, or **Walkthrough** in Home's **⋯**, opens six steps: write a note, tag it and mention a person, link two notes, find anything, add a task, and see the workspace. Each is checked off as you do it. It is the place to start: the work sample is offered from its first step.

**In your own notes:**

1. Open a folder or workspace in VS Code.
2. Open any Markdown note in the workspace, or [restrict indexing to a folder](settings.md#settings).
3. Run `Deckard: Open Home` from the Command Palette.
4. Select the Deckard icon in the Activity Bar. The **Context** view shows Deckard's pages as a row of icons at its top; under them, it shows what links to the note you are editing and its related notes.

### Finding your way

Every page Deckard opens is an icon in the row at the top of the sidebar's **Context** view. Point at one, or <kbd>Tab</kbd> to it, for its name and a word on what is there now: *Home: 3 tasks due today*, *Task Board: 2 tasks overdue*, whether today's note is written yet. The page in front is shown pressed, and the row stays at the top while the rest of Context scrolls. **List** in the gear beside the icons draws each page as a labeled row instead, with that word at its right, and **Pages** in the same gear picks which pages Context keeps. The pages are one <kbd>Tab</kbd> stop: the arrow keys move between them. The same list is **Go to…**: `Deckard: Go to…`, <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>P</kbd> on macOS, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>P</kbd> elsewhere. On any page, **DECKARD ▾** at the top drops the other pages as a menu, with **Go to…** at its foot; arrows move through it and <kbd>Escape</kbd> closes it. Hover over any button, or Tab to it, to see what it does.

Deckard reads only saved files, so save a note to see it in the index; it refreshes when saved notes are added, edited, or deleted. The first time, it says what it found, such as *Deckard read 412 notes: 1,204 open tasks (17 overdue) and 185 tags.* A workspace of 3,000 notes or more is also told how the "Exclude" setting leaves folders out. Deckard says one such thing each time VS Code starts it: an offer about [status tags](tasks.md#moving-status-tags-into-checkboxes) comes first, then what it read, then tasks whose status it doesn't know, so the rest wait for a later start.

In a code repository, Deckard's editor features apply only to notes: a README outside `deckard.notesFolder`, or under `node_modules`, is left alone.

**A code repository with no notes folder.** With `deckard.notesFolder` empty, Deckard reads every Markdown file in the workspace and writes today's note at its top level. When the folder looks like a code repository (it has `.git`, `package.json`, `go.mod`, or the like at its top):

- The status bar says **Deckard: whole workspace**. Select it to choose a notes folder, leave folders out, pause Deckard here, or keep reading everything, which hides it.
- Before the first note Deckard makes there, it asks once: **Write Here**, **Choose a Folder…**, which sets the notes folder, or **Pause Deckard Here**. Dismissing it writes nothing.
- The first scan's summary offers **Not a Notes Workspace**, which pauses Deckard.
- Add Task says where it wrote, such as *Added it to notes/2026-10-07.md in deckard-work.*

**Paused**, Deckard reads and writes nothing in the workspace, and the status bar says **Deckard paused**; select it, or run `Deckard: Resume in This Workspace`, to start again. `Deckard: Pause in This Workspace` pauses any workspace. Both answers are kept in VS Code's storage for the workspace, not in a file in the repository.

`Deckard: Reindex Workspace` reads and parses every note again. A rescan after a settings change rereads only the notes whose size or saved time changed.

## Reading this guide

This guide is Deckard's Help. `Deckard: Open Help`, **Help** at the top of the Context view, or **Help on this page** in any Deckard page's **⋯** opens it inside VS Code, at the page about where you were. Its pages are down the side, in the order [the contents](README.md) give them, with the page you are reading marked, and **Changelog** at the end lists what is new in recent releases. Read inside VS Code, a command the guide names, such as `Deckard: Find in Notes`, is a button that runs it; one that acts on a note, such as `Deckard: Edit Task`, is run from that note. VS Code's find (Cmd+F on macOS, Ctrl+F elsewhere) searches the page shown.

---

[All topics](README.md) · [Writing notes: tags, people, and links](notes-and-links.md) →
