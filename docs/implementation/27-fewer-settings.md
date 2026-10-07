# 27 · Fewer settings

Deckard contributes 106 settings. A review of each one
(https://claude.ai/artifact/PHVNUeJm4bk81guCDabaNx) found 43 that a reader
never needs to set: some have one value everyone keeps, some are a choice
the view they shape already offers, and a few are deprecated aliases. This
plan removes those 43, which leaves 63. Each is removed from the manifest,
the settings guide, Help's table (built from the manifest), and the
changelog's Unreleased section says what replaced it.

Three groups, one commit each, then the documents:

- **A. Fixed.** The setting goes and the code behaves as one value.
- **B. Collapsed.** The setting goes into another that already says the
  same thing, or into a convention.
- **C. Moved to the view.** The view's own control already sets it, or
  gains one, and keeps the choice in the preferences blob
  (`core/storage/preferences*`), as every other view choice is kept.

The task status settings (`tasks.onHoldStatuses`, `tasks.writeStatusAs`,
`board.statusNamespace`, `board.statuses`, `board.showCancelled`) are
reworked in another plan and are not touched here.

## A. Fixed at a value

| Setting | Fixed at | How its readers change |
| --- | --- | --- |
| `tagTitleDisplayMode` | `inline` | The four page controllers stop reading it and listening for it; the pages, the domain ranking, and the protocols lose the field and the `separate` branch |
| `previewWorkspaceWrites` | `severalNotes` | `readPreviewMode` and Move to… preview a write that touches several notes, and nothing else |
| `moveTo.leaveBehind` | `link` | Move to… always leaves a link; `leaveBehind` loses its `nothing` mode |
| `updateLinksOnRename` | `true` | Renaming or moving a note always rewrites the links to it |
| `enableTagAutocomplete` | `true` | Tag completion is always offered in a notes file |
| `tasks.metadataSuggestions` | `true` | Task metadata completion is always offered |
| `tagOverview.includeHubLinks` | `true` | A tag's page always lists what its hub links; its Leave Them Out button goes |
| `tagOverview.hubNoteExpanded` | open | The hub starts open; a collapse the reader makes on a tag's page is kept as `hubNoteCollapsed` in the preferences blob, and the next tag page starts as it was left |
| `dailyNote.rolloverDays` | `7` | Roll Forward looks back seven days |
| `agenda.upcomingDays` | `7` | The Tasks view's Upcoming reaches seven days |
| `calendar.showRepeats` | `true` | A repeating task is always drawn on its rule's later dates; the Calendar's Show and Hide Repeats commands and the page's Repeats row go |
| `outline.showTags` | `true` | The Outline always shows a heading's tags |
| `outline.showCounts` | `true` | The Outline always shows its counts; Zen's editor settings no longer list it |
| `outline.inheritedTags` | `false` | The Outline shows a heading's own tags only |
| `weeklyNote.naming` | `range` | A new weekly note is named by its days; both names are still found and read |
| `personMarker` | `@` | Every parse, completion, and decoration uses `@`; the parse cache key no longer carries it |
| `tasks.addDoneDate` | `true` | Completing a task always writes ✅ and the date |
| `tasks.addCancelledDate` | `true` | Cancelling a task always writes ❌ and the date |
| `relatedNotesAssociationMinimumSupport` | `1` | Related Notes ranks with the default of the domain options |
| `relatedNotesRecencyHalfLifeDays` | `0` (off) | Related Notes doesn't decay by age |
| `enableKeywordLinks` | `true` | Related Notes always falls back to shared words |
| `enableHeadingTagRelationships` | `true` | A tag's page always relates the headings that carry the tag |
| `autoSelectNoteSections` | `true` | Context always follows the entry under the cursor |
| `zenMode` | removed | `display.level` is the one source of Zen; the alias, and the one-time move from it, go. The Zen title-bar buttons and commands keep their `deckard.zenMode` context key, set from the step |
| `parseInlineTags` | `true` | A tag on any line makes the line an entry; the parse cache key no longer carries it |
| `statusBar` | `true` | The task status bar item is always contributed; VS Code's own status bar menu hides it |
| `showWhatsNew` | `true` | What's New always shows after an update |
| `tasks.assigneeFromPersonTag` | `false` | Only a written assignee field assigns a task; the parse cache key no longer carries it |
| `developerMode` | removed | The hover's ranking link goes; `Deckard: Open Related Notes Ranking` is in the palette for a Markdown editor and shows the ranking for the entry under the cursor |

## B. Collapsed

| Setting | Into | How its readers change |
| --- | --- | --- |
| `display.fileAndLine` | `display.cardDetails` | An entry's details always show on hover; `cardDetails` says which, and unticking every one draws none. The scale no longer moves File & line, so Zen draws the details on hover as Full does; `data-file-line` is written only as `never` |
| `dailyNoteTemplate` | `Daily.md` | A daily note is made from `Daily.md` in the templates folder when there is one, else from `# {date}` |
| `weeklyNoteTemplate` | `Weekly.md` | A weekly note from `Weekly.md`, else `# {week}` |
| `monthlyNoteTemplate` | `Monthly.md` | A monthly note from `Monthly.md`, else `# {month}` |

The template convention is written up in the daily notes guide: the three
names, the templates folder (`deckard.templatesFolder`), the variables
(`{date}`, `{week}`, `{month}`), and the built-in text when a file isn't
there.

## C. Moved to the view

| Setting | Preference | Scope | The control |
| --- | --- | --- | --- |
| `agenda.groupBy` | `agendaGroupBy` | machine | The Tasks view's Group button |
| `agenda.groupNamespace` | `agendaGroupNamespace` | workspace | The same button's namespace step |
| `agenda.sort` | `agendaSort` | machine | The Tasks view's Sort button |
| `board.parentTag` | `boardParentTag` | machine | The board gear's Cards toggle |
| `calendar.dayPanel` | `calendarDayPanel` | machine | The Calendar view's ⋯ menu, by a context key |
| `calendar.showWeekends` | `calendarHideWeekends` | machine | The Calendar view's ⋯ menu and the page's Weekends row |
| `display.pageWidth` | `pageWidth` | machine | The Page width row in every page's gear |
| `pages.style` | `contextPagesStyle` | machine | A ⋯ button beside the pages at the top of Context: List or Icons |
| `pages.shown` | `contextPagesHidden` | machine | The same menu: a tick for each page |
| `outline.followCursor` | `outlineFollowCursorOff` | machine | The Outline's title-bar eye buttons, by their context key |

- A namespace names workspace content, so `agendaGroupNamespace` is in
  `WORKSPACE_PREFERENCE_KEYS`; every other choice is presentation and
  stays machine-wide.
- Each preference is stored only when it isn't the default, as
  `hideDailyNotes` is, so a blob from before holds nothing new.
- **Carried once.** On the first activation after the update, a value the
  reader set for any of the ten (in the user's settings, the workspace's,
  or a folder's) is written to its preference: the user's once per
  machine, the workspace's once per workspace, a workspace's value over
  the user's. A flag in each store says it was done. The old setting is
  then never read again; VS Code shows it as unknown in settings.json, and
  removing it is the reader's.
- The mapping is pure, `carryMovedSettings` in
  `core/storage/movedSettings.ts`, tested on its own; the composition
  root reads the settings and writes the result.
- Where a view drew from a setting through `config.deckard.*` in a `when`
  clause (the Calendar's menu), a context key set from the preference
  takes its place.

## Tests

- `extension.test.ts` counts 63 settings and no longer names the removed
  ones or the Calendar's repeat commands.
- The setting-scopes tests and the scope suites lose the removed settings;
  a moved one's scope test becomes a preference test.
- The e2e stubs drop the removed keys from their configuration.
- New: the carry mapping, the hub's remembered collapse, the three
  periodic templates read by name, the ranking command from the palette.

## As built

- **The domain keeps its options.** The parser still takes a person
  marker, whether to read inline tags, and whether a person tag assigns;
  the ranking still takes keyword links, an association support, and a
  recency half-life; their tests exercise them. Only the settings that
  reached them are gone, and nothing passes another value.
- **The parse fingerprint keeps the three fixed values** (`inline`, `@`,
  `field-assigns`) where the settings were, so a full-text cache built
  with them as they shipped is still read, and one built with any other
  value is rebuilt once.
- **The Calendar page's gear loses its Repeats row**, and the Calendar
  view's menu its Turn On and Turn Off Repeats.
- **The pages' gear** is a second `<ViewOptions>` on the Context view,
  named `pages` so it stays open or closed apart from Related Notes' gear:
  List or Icons, and a pressed button for each page.
- **Zen's two commands** are registered on their own, beside the view
  toggles, since Zen is Display's step and not a view choice.
- **The carry** is `carryMovedSettingsOnce` in `composition/movedSettings.ts`,
  with `deckard.movedSettingsCarried` set in `globalState` and
  `workspaceState`. It runs as the preferences are made, so the in-memory
  blob holds the carried values before any view is built.
- **The scope suites** lose the outline and agenda grouping suites, and the
  Calendar's rows of the written-where-set suite; `view-choices-scopes`
  runs each pair of commands and watches its context key, and
  `moved-settings-scopes` writes an old setting into the workspace's own
  settings file, which VS Code still reads without a schema, and carries it.
- **The architecture inventories** (`docs/architecture/inventories/`) are
  dated snapshots and keep the settings as they were.
