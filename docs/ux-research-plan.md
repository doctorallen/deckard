# UX research plan: five sources, one plan

A plan, not a change. It was written on 2026-09-25 at `7824551` on `dev`,
after `ux-review.md` and `ui-plan.md`, and it deliberately leaves out
everything those two, `zen-mode.md`, and `improvements.md` already cover.

Five researchers worked independently, each on one kind of source:

| # | Source | What it read |
| --- | --- | --- |
| A | Note apps | Obsidian and its top plugins (Dataview, Tasks, Kanban, Omnisearch), Logseq, Notion, Tana, Capacities, Heptabase, Reflect, Amplenote, Foam |
| B | Task and keyboard-first apps | Things 3, Todoist, Linear, Trello, GitHub Projects, Superhuman, Sunsama, Akiflow, Atlassian's drag-and-drop guidelines |
| C | The VS Code platform | The extension UX guidelines, the contribution-point and webview references, and GitLens, Todo Tree, the GitHub Pull Requests extension, and Jupyter |
| D | Research and standards | WCAG 2.2, the ARIA Authoring Practices, Hearst, Pirolli and Card, Teevan, Bergman and Whittaker, Jones; plus a contrast measurement of every theme |
| E | Users' own words | The most-upvoted issues on Foam, Dendron, Obsidian Tasks, Dataview, and Kanban; the Obsidian forum; Hacker News. Reddit and Marketplace reviews could not be fetched. |

Each finding was checked against the source and names a file and line. The
claims the plan rests on most were checked again before writing: the
command titles, the Tasks view's unused `contextValue`s, capture writing
text verbatim, `openSourceAt` never opening beside a page, no `<mark>` in
any result, and `announce()` called in one place only.

## Where the sources agree

The strongest signal is where researchers who never saw each other's work
arrived at the same change:

| Change | Sources | Piece |
| --- | --- | --- |
| The Task board works from the keyboard: one Tab stop, arrows, single-key actions, a `?` sheet | B, D | 3 |
| Items in the Tasks view can be right-clicked and acted on; the Overdue group can be rescheduled in one step | B, C, A (hover previews) | 2 |
| Keyboard focus survives a redraw, and outcomes are announced | D, B (undo inside the page) | 1 |
| Results open beside the page, back and forward are visible, and the page remembers where you were | A, D, E | 4 |
| Capture understands what you typed | B, A | 2 |
| Quieter by default, and empty states that offer the next step | E, A, C | 6 |

---

## Piece 1. Foundations: the manifest and accessibility

Small and low-risk, and later pieces rely on them.

### 1a. Commands take a category, and hide when they cannot run (C)

**Observed.** 49 command titles have `Deckard: ` written into them, and
none sets `category`, so the view toolbars' tooltips read "Deckard: Group
Tasks By…" inside Deckard's own view. No command uses `enablement`. The
palette always shows Rename Heading, Extract Heading, Previous and Next
Daily Note, and Undo Last Change; it shows Pin and Unpin together; and it
shows the MCP setup commands while the server is off.

**Change.** Set `"category": "Deckard"` and drop the prefix from each
title. Add `editorLangId == markdown` to the commands that need a note,
`config.deckard.mcpServer.enabled` to the MCP commands, and two new context
keys, `deckard.activeNotePinned` and `deckard.canUndo`. The Outline's
follow-cursor toggle already works this way.

**Size.** Small. It only touches the manifest, plus two `setContext` calls.

### 1b. Focus survives a redraw, and every outcome is announced (D)

**Observed.** Each host `state` message redraws the page, and
`renderKeepingFocus` (`taskBoardHtml.ts:133`, and the same on the
Dashboard) puts focus back only in a text field. Tick a card's checkbox, or
move a card from its ⋯ menu, and focus falls to `<body>`. `announce()`
(`components.ts:930`) is called only for the search result count.

**Change.** Before the redraw, record the focused element's identity
(`data-task-id`, `data-tag-key`, `data-action`), then focus the matching
element afterwards, or its nearest neighbor if it has gone. Announce each
action: "Moved 'Draft spec' to Doing", "Completed 'X'", "Saved the search".

**Size.** Small. It is a prerequisite for piece 3.

### 1c. Contrast and focus that hold up (D)

**Observed.**

- `test/ui/checkContrast.js` measures "large text" in pixels where WCAG
  means points (16px instead of 24px, 14px bold instead of 18.66px). It
  skips any element that does not declare its own background, and it
  treats every border as decoration, so 1.4.11 is never checked.
- Real failures it misses:
  - Fellowship's `--green` on its panel is 4.01:1 against the 4.5
    needed. It is the color of due dates, metric values, and the stats
    counts.
  - Input and control borders fall below 3:1 in six themes, down to
    1.21:1 in LCARS.
- The focus ring is `--edge` wide, which is 1px in Corpo, the default
  theme. The query and builder inputs set `outline: none`, so under
  forced colors their focus disappears.

**Change.** In this order:

1. Correct the gate, and add a 3:1 pass for control borders and the focus
   ring. A rendered-DOM pass with axe-core in the UI suite is the longer-term
   fix.
2. Fix what the corrected gate finds. Fellowship's green moves to about
   `#4a6a32`; the input borders take `--line-strong`, raised where needed.
3. Add `--focus-width: 2px`, separate from `--edge`, and give the inputs a
   transparent outline rather than none.
4. Under `forced-colors`, draw drop targets with a `Highlight` outline, give
   legend swatches borders, and have the graph paint in system colors.

Cooper's colors stay gold on black; only its border token is in scope.

**Size.** Small to medium. It needs a re-record of the visual baselines.

### 1d. ARIA contracts (D)

- **The search combobox.** It has no `aria-controls` or
  `aria-activedescendant`, and its options are tabbable buttons without
  ids (`components.ts:2300, 2972`). Follow the APG combobox: focus stays in
  the input.
- **The calendar grid.** Its `role="grid"` has no rows or cells
  (`calendarHtml.ts:113`).
- **Menu headings.** They use `role="presentation"`; they should be
  `role="group"` with `aria-labelledby`.
- **The Dashboard's `.metric::before` codes.** A screen reader reads them
  aloud; use `content: … / ""`.
- **Board cards.** They have no short accessible name. Add `aria-label`
  with the title, column, and due date.

**Size.** Small.

---

## Piece 2. Tasks you can act on where you see them

### 2a. Menus and inline actions on the Tasks view (B, C)

**Observed.** Tasks set `contextValue = 'deckardAgendaTask'` and groups
`deckardAgendaGroup` (`agendaTree.ts:362, 384`), but no menu in
`package.json` uses either. The only thing you can do to a task in the view
is tick its checkbox.

**Change.**

- One inline action, Edit Task (`$(edit)`).
- A context menu with Due today, Due tomorrow, Next week, Pick a date…,
  Edit Task…, Show on Task Board, and Copy Link. Every one writes through
  `updateTaskLine`, so each keeps its Undo.
- On the Overdue group, **Reschedule all…**: Today, Tomorrow, or a date. It
  is one bulk-edit write, previewed and undoable. The daily reminder gains
  the same button, and a **Turn off reminders** button too.

**Size.** Small.

### 2b. Tooltips that answer "which one is it" (A, C)

`MarkdownString` tooltips on tasks show the due date, priority, heading
path, and the sub-bullets, with links to Edit and Show on Task Board. The
status bar tooltip lists the first few overdue tasks, each linked to its
line. A Calendar day's tooltip lists that day's headings and the tasks due
that day.

**Size.** Small to medium.

### 2c. Capture reads what you typed (B, A)

**Observed.** `formatCaptureLine` (`capture.ts:124`) writes the text as
typed. "Call Ren tomorrow" becomes a task with no due date, even though
`parseTaskDateInput` (`taskDraft.ts:159`) already understands "tomorrow".
Capture always writes a task, so an idea that is not a to-do counts toward
the task totals.

**Change.**

- Read a trailing date phrase ("fri", "in 3 days", "next monday"), a
  priority (`!!`, `p1`), and "every week". Show the finished line as the
  detail of the Add item, in the configured metadata format.
- A **Keep the words as written** button turns the parsing off.
- A second item, **Add as a note line**, writes `- text`. Adding as a
  task stays the default, so Enter works as it does today.

**Size.** Medium. The parser already exists; the work is in deciding which
trailing words count as a date.

---

## Piece 3. A keyboard Task board

The change the most sources agree on. It needs 1b first.

**Observed.** Every card is its own Tab stop, plus its checkbox and ⋯
button: about 200 Tab stops for 66 tasks. There are no arrow keys, and
Enter only opens the card (`components.ts:1409–1526`). A column that will
not take a drop (Overdue, Within a week, Later) silently refuses it
(`components.ts:1460`). The card menu can set a due date only to today or
tomorrow (`taskBoardState.ts:419`). A completed card disappears on the
next redraw, before you can see you ticked the right one.

**Change.**

1. **Roving tabindex.** The board is one Tab stop. Up and Down move within
   a column, Left and Right across columns, as the calendar already does
   (`calendarHtml.ts:84`).
2. **Single keys on the focused card**, announced through 1b:

   | Key | Action |
   | --- | --- |
   | `x` | Complete |
   | `t` / `m` | Due today / tomorrow |
   | `1`–`5` | Priority |
   | `[` / `]` | Move to the column on the left / right, through `moveTask` |
   | `e` | Edit Task |
   | `Enter` | Open |
   | `Shift+F10` | Menu, as today |

3. **`?` opens a sheet of the page's keys**, on every page. It also
   documents `/` for search and the Alt- and Shift-clicks in Refine, which
   nothing lists today.
4. **Clear drop feedback.** While dragging, dim the columns that will not
   take the card and caption them "Pick a date from ⋯". Add
   **Due on a date…** to the card menu, parsed by `parseTaskDateInput`.
5. **A completed card lingers** for about 800ms, struck through, then
   fades. The delay is skipped under reduced motion.
6. **A "+" at the foot of each column** opens Capture, pre-filled with that
   column's edit (`#status/doing`, due tomorrow, `👤 dana`).
7. **In the ranked list**, the rank menu gains Move up and Move down, with
   Alt+Up and Alt+Down, so any position is reachable without dragging (WCAG
   2.5.7).

**Later, on top of this.** Selecting several cards (`x`, Shift-click) with
a bar that sends them through bulk edit. A line drawn between cards while
dragging, so a column keeps an order. An Undo toast inside the page, with
`z`.

**Size.** Medium for items 1 to 7. Every board baseline will be
re-recorded.

---

## Piece 4. Finding, and finding again

### 4a. Open beside, preview tabs, back and forward (A, E)

**Observed.** Only Related Notes opens a result beside the current editor.
The search page, Task board, graph, Stats, Calendar, and Home all call
`openSourceAt` without asking for that, so opening a result covers the page
you were working through. Every result opens as a pinned tab
(`navigation.ts:74`), so browsing piles up tabs. Search history is reached
only with the mouse's back and forward buttons.

**Change.**

- Cmd/Ctrl-click and Cmd/Ctrl+Enter open beside on every page. The graph
  uses Alt, since Cmd-click already opens there.
- A single click opens a preview tab and a double click pins it, as in
  VS Code's own Explorer. It follows `workbench.editor.enablePreview`.
- Search pages get visible Back and Forward buttons, and Alt+Left and
  Alt+Right.

**Size.** Small.

### 4b. Show why a result matched (D)

- Wrap the searched words in `<mark>` in every result. There are none
  today.
- On long sections, show a snippet around the match instead of the
  opening lines.
- On search pages, where re-finding happens, show the file and heading
  path inline. Keep the fold for the board, dense lists, and zen. The
  folded flyout (`components.ts:726`) also fails WCAG 1.4.13: it cannot be
  dismissed with Escape and cannot be hovered, so add Escape wherever it
  stays.

**Size.** Medium.

### 4c. Return people to where they were (D)

Teevan finds that up to 40% of searches are re-finding. Save each page's
scroll position and last-focused entry with `setState`, not only the query
text. Keep results that were already on screen in the same places when the
index updates underneath them.

**Size.** Medium.

---

## Piece 5. Links and backlinks

### 5a. `[[` completion (A)

**Observed.** `linkSuggestions.ts:91–110` matches titles by substring and
sorts them alphabetically. It completes `#^` block ids but not headings,
so `[[Launch plan#Dec` offers nothing, even though heading links resolve,
preview, and count as references.

**Change.**

- After `[[Title#`, offer that note's headings.
- `[[##words` searches headings across all notes.
- Rank completions with Find's title matching and frecency
  (`frecency.ts`), with recent notes first when the query is empty.
- Offer date words ("today", "next fri") inside `[[`, shown with the date
  they resolve to.

**Size.** Small. It is one file.

### 5b. Find creates and links (A)

When nothing matches, Find offers **Create note "…"**, from the template
or into the notes folder. Each note item gets an **Insert link** button
that writes `[[Note#Heading]]` at the cursor.

**Size.** Small.

### 5c. A Links section in Related Notes, and the toolbar moves up (A, C)

**Observed.** The "Linked from N notes" lens opens a references peek of
bare lines. Unlinked mentions can only be linked all at once. The Related
Notes webview draws its own "DECKARD" eyebrow and five buttons
(`sidebarNotesHtml.ts:461`), under a native title bar that has no actions.

**Change.**

- A **Links** mode in Related Notes.
  - **Linked from** groups the links by note, each with its heading
    path and the line in context.
  - **Mentioned without a link**, collapsed by default, has a **Link**
    button on each row and **Link all** at the top.
- Move the five buttons to `view/title`, as codicons. Home and Help sit
  in the navigation group; the rest go in the overflow menu.
- Remove the in-page header, which frees a band of the narrow sidebar.

**Size.** Medium.

---

## Piece 6. Quieter by default, and easier to start

- **Zen quiets the editor too (E).** At least ten editor features are on
  by default. Let `deckard.zenMode`, or a Quiet / Full choice in the
  walkthrough, also turn off reference counts, unlinked-mention hints,
  section highlights, and keyword links. The most common complaint in the
  sources is being overwhelmed by a tool before it has earned its place.
- **Empty states offer the next step (A).** When the index holds no notes,
  Home shows one panel with Create today's note, Create a sample
  workspace, and Check my setup. Each text-only empty widget ("Save a
  search from a search page…") gets a matching button.
- **Indexing shows a count (E).** Where the views say "Indexing this
  workspace…", say "Indexing 412 of 3,760 notes". Past a size threshold,
  show a one-time hint pointing to `deckard.exclude`.
- **The walkthrough checks steps when they are done (C).** Use
  `completionEvents`: `onContext:deckard.hasTags` for tagging,
  `onCommand` for search. Add `featuredFor: ["**/*.md"]`, so the
  walkthrough appears on the Welcome page.
- **Settings link to each other (C).**
  - Use `markdownDescription` with `#setting#` and `command:` links.
  - Give each section an `order`, and fix the four Tasks settings that
    share order 3.
  - Move `developerMode` out of AI Assistants.
  - Trim the descriptions longer than 300 characters.
- **Fewer toasts (C).** "Copied N…" and "Saved N…" go to the status bar.
  Toasts stay only where they offer Undo or Open.
- **A view icon each (C).** Related Notes, Outline, Tasks, and Calendar
  all use the Deckard logo. If a user moves one to the panel, the four
  cannot be told apart.
- **The graph opens on the current note, and can skip daily notes (E).**
  ux-review #9 already proposes opening focused. Add a "Skip periodic
  notes" toggle: daily, weekly, and monthly notes still carry hops but are
  not drawn. It answers the most repeated complaint about graph views,
  that hub notes tangle everything.

**Size.** Small each. They can go in any order.

---

## Order of work

| Order | Piece | Why here | Size |
| --- | --- | --- | --- |
| 1 | 1a, 1d | Manifest and ARIA only; nothing visual moves | S |
| 2 | 1b, 1c | Focus, announcements, and the contrast gate; piece 3 needs 1b | S–M |
| 3 | 2a, 2c | The most frequent task actions, with the parser already written | S–M |
| 4 | 3 | The change with the most agreement, on the foundation above | M |
| 5 | 4a, 5a, 5b | Small, high-frequency navigation and linking | S |
| 6 | 5c, 4b | Links in Related Notes; matches highlighted | M |
| 7 | 6, then 2b and 4c | Quieter defaults and polish | S–M |

Each row is a PR of its own. Anything that changes how a page looks ends
with the four suites (`npm test`, `test:ui`, `test:e2e`, `test:layout`) and
a re-record of the affected baselines.

## Larger features the users asked for

These came up with real demand, mostly from E, but they are features, not
UI polish, so they belong in `improvements.md` rather than this plan:

| Idea | Demand | Size |
| --- | --- | --- |
| `view=board` in a `deckard` query block: read-only columns in the preview, with Open on Task Board | Kanban #4 (258 👍), the plugin's top issue | M |
| Archive on completion: `deckard.tasks.onComplete` = stay, move under `## Done`, or move to a file; also Archive completed in Bulk edit | Tasks #2855 and #2856 (137 👍 together) | M |
| Write a query's results here: freeze a query block into a dated static list | Dataview #42 (126 👍), the plugin's top issue | S |
| Completion, hovers, and diagnostics inside a `deckard` fence | Tasks #1763 (67 👍), Dataview #1624 | M |
| A time of day on due and scheduled dates | Tasks #3307 (57 👍) | M |
| Swimlanes, a second axis on the board | Kanban #237 (124 👍) | M |
| A Library tree: pins, saved searches, favorite tags, nested tags | Obsidian Bookmarks, Foam Tag Explorer | M |
| A guided Plan Today pass through overdue and scheduled tasks | Sunsama, Akiflow | M |
| "From your notes": this date in past years, and a long-unopened note | Obsidian forum | S |
| A web-extension build for vscode.dev | Foam #749 | L |

## Considered and left out

- **Native `webview/context` menus (C).** They would bring native keyboard
  handling and make the commands bindable. But they cannot be themed, and
  the themed menus are part of each theme's identity, Cooper's gold on
  black among them. Revisit only if the themed menus prove hard to make
  accessible after 1d.
- **Turning off `retainContextWhenHidden` (C).** It is a real memory cost,
  but the pages restore state unevenly today. Measure after 4c, which
  makes restoring full state necessary anyway, and start with Stats and
  Help.
- **Explorer file decorations for overdue notes (C).** A badge is only two
  characters and collides with Git's. It is low confidence even as an
  opt-in.
- **A `/` menu on ordinary lines (A).** `/` is too common in paths and
  URLs; the risk of false pop-ups outweighs the discoverability gain.
- **A backlinks footer in the Markdown preview (A).** 5c covers the same
  need where writers already look, and the preview side depends on
  `env.currentDocument`.

## Sources

- Obsidian Help: [Links](https://obsidian.md/help/links), [Backlinks](https://obsidian.md/help/plugins/backlinks), [Quick switcher](https://obsidian.md/help/plugins/quick-switcher), [Bookmarks](https://obsidian.md/help/plugins/bookmarks), [Page preview](https://obsidian.md/help/plugins/page-preview).
- [Omnisearch](https://github.com/scambier/obsidian-omnisearch); [Natural Language Dates](https://github.com/argenos/nldates-obsidian); [Foam](https://github.com/foambubble/foam); [Tana Quick Add](https://help.tana.inc/quick-add.html); [Amplenote Jots](https://www.amplenote.com/help/jots); [Reflect running notes](https://reflect.app/blog/running-notes).
- [Todoist dates](https://www.todoist.com/help/articles/introduction-to-dates-and-time-q7VobO) and [Today view](https://www.todoist.com/help/articles/plan-your-day-with-the-today-view-UVUXaiSs); [Things scheduling](https://culturedcode.com/things/support/articles/2803579/); [Linear selection](https://linear.app/docs/select-issues) and [shortcuts help](https://linear.app/changelog/2021-03-25-keyboard-shortcuts-help); [Trello shortcuts](https://trello.com/shortcuts); [GitHub Projects navigation](https://github.blog/news-insights/the-library/project-navigation-for-the-way-you-work/); [Atlassian drag-and-drop guidelines](https://atlassian.design/components/pragmatic-drag-and-drop/design-guidelines); [Sunsama daily planning](https://help.sunsama.com/docs/usage-guides/daily-planning/); [Akiflow shortcuts](https://product.akiflow.com/en/help/articles/7262522-keyboard-shortcuts).
- VS Code: [UX guidelines](https://code.visualstudio.com/api/ux-guidelines/overview), [contribution points](https://code.visualstudio.com/api/references/contribution-points), [webview guide](https://code.visualstudio.com/api/extension-guides/webview), [Webview UI Toolkit sunset](https://github.com/microsoft/vscode-webview-ui-toolkit/issues/561).
- W3C: [WCAG 2.2](https://www.w3.org/TR/WCAG22/) (1.4.3, 1.4.11, 1.4.13, 2.4.3, 2.4.7, 2.5.7, 4.1.2, 4.1.3); [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/) (combobox, grid, keyboard interface). Microsoft Edge, *Styling for Windows high contrast with new standards for forced colors*, 2020.
- Hearst, M. *Search User Interfaces*. 2009, ch. 5. Pirolli, P. and Card, S. *Information foraging*. Psychological Review, 1999. Teevan, J., Adar, E., Jones, R. and Potts, M. *Information re-retrieval*. SIGIR 2007. Teevan, J. *The Re:Search Engine*. UIST 2007. Bergman, O. et al. *Improving personal information management by integrating it*. ACM TOIS 26(4), 2008. Jones, W. *Keeping Found Things Found*. 2007. Elavsky, F., Nadolskis, L. and Moritz, D. *Data Navigator*. IEEE VIS 2023.
- Users: [Kanban #4](https://github.com/community-archive/obsidian-kanban/issues/4), [#85](https://github.com/community-archive/obsidian-kanban/issues/85), [#237](https://github.com/community-archive/obsidian-kanban/issues/237); [Tasks #2855](https://github.com/obsidian-tasks-group/obsidian-tasks/issues/2855), [#2856](https://github.com/obsidian-tasks-group/obsidian-tasks/issues/2856), [#3307](https://github.com/obsidian-tasks-group/obsidian-tasks/issues/3307); [Dataview #42](https://github.com/blacksmithgu/obsidian-dataview/issues/42); [Foam #749](https://github.com/foambubble/foam/issues/749), [#1251](https://github.com/foambubble/foam/issues/1251); [Dendron #1978](https://github.com/dendronhq/dendron/issues/1978); Obsidian forum threads on [graph view](https://forum.obsidian.md/t/how-do-you-use-the-graph-view/2785) and [local graph filtering](https://forum.obsidian.md/t/improved-filtering-of-local-graph/35937).
