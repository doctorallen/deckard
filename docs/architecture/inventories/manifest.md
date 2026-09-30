# Manifest cross-reference

This inventory ties every entry in `package.json` that the source must honor to the place in `src/` that honors it: commands, menus, settings, context keys, command re-entry, views, and files. Phase 0 of [the refactor plan](../../implementation/19-refactor.md) takes it before anything moves, so that splitting `src/extension.ts` cannot silently stop registering a command, reading a setting, or setting a context key. It was taken at `dev` 1805a01, and every `path:line` below is 1-based at that commit.

## Summary

| Item | The plan says | At 1805a01 | Verdict |
|---|---|---|---|
| Commands contributed | 96 | 96 | Confirmed |
| Commands registered | 102 | 102, all unconditional, all in `src/extension.ts` | Confirmed |
| Registered but not contributed | 6 | 6 | Confirmed |
| Contributed but not registered | not stated | 0 | |
| Settings declared | 73 | 73 | Confirmed |
| Distinct `deckard.*` settings read | 77 | 73 | Corrected |
| `when` clauses | 134 | 134, of which 27 are the literal `false` | Confirmed |
| Custom context keys | about 28 | 19 set by Deckard, plus 5 `config.deckard.*` keys set by VS Code | Corrected |
| Keys set by a literal `setContext` | 8 | 9 | Corrected |
| Distinct `deckard.*` ids re-entered through `executeCommand` | 18 | 21 as literals, 39 in all | Corrected |
| Panel serializers and `onWebviewPanel` events | 7 | 7 and 7, matched | Confirmed |

The source reads 73 distinct `deckard.*` settings, which are exactly the 73 declared; the plan's 77 matches no count of distinct keys, and 77 is the number of `affectsConfiguration` calls.
The correct context-key count is 19 keys that Deckard sets (16 in `when` clauses and 3 only in walkthrough `onContext:` events) plus 5 `config.deckard.*` keys; the four `deckard.*` tokens after `view ==` are view ids, not context keys.
Nine keys are set by a literal `setContext` call; a grep for `'setContext', 'deckard.` on one line finds seven, because two calls span lines.
18 is the number of distinct ids in single-line literal calls; counting calls that span lines gives 21, and counting constants, template strings, lookup maps, and command runners gives 39.

No setting is read without being declared, no declared setting goes unread, and every context key in a `when` clause has a setter. The behavior questions this inventory raises are gathered in [Behavior questions](#behavior-questions).

## Conventions

- A path without a folder prefix is under `src/`. Test paths are written in full.
- For a call that spans lines, the line given is the one that holds the call's name: `registerCommand(`, `executeCommand(`, or `.get` and its kin.
- A row reached through a helper gives the caller's line, and names the helper.
- `package.json:N` is the line that holds the entry's id.

## 1. Commands

`package.json` contributes 96 commands. The source registers 102, all through `vscode.commands.registerCommand` in `src/extension.ts`: one at line 219 and the other 101 inside the `context.subscriptions.push(...)` blocks between lines 690 and 1267. No registration is conditional. No source uses `registerTextEditorCommand`. Every contributed command is registered, and six registered ids are not contributed.

### Registered but not contributed

These six ids must keep being registered by their exact names after the split. Nothing in `package.json` names them, so no manifest check will catch their loss.

| Id | Registered at | Invoked from | Notes |
|---|---|---|---|
| `deckard.activateNotesGraphNode` | `src/extension.ts:964` | `ui/webview/sidebarNotes.ts:676` | Sidebar asks the graph panel to open a node |
| `deckard.highlightNotesGraphNode` | `src/extension.ts:972` | `ui/webview/sidebarNotes.ts:684` | Sidebar asks the graph panel to highlight a node |
| `deckard.createLinkedNote` | `src/extension.ts:1130` | `ui/commands/linkHealth.ts:338` (code action) | Id held in `CREATE_LINKED_NOTE_COMMAND`, `ui/commands/linkHealth.ts:43` |
| `deckard.createMissingNotes` | `src/extension.ts:1137` | `ui/commands/editorLenses.ts:313` (CodeLens) | Id held in `CREATE_MISSING_NOTES_COMMAND`, `ui/commands/linkHealth.ts:45` |
| `deckard.linkMentions` | `src/extension.ts:1146` | `ui/commands/editorLenses.ts:380` (CodeLens) | Id held in `LINK_MENTIONS_COMMAND`, `ui/commands/unlinkedMentions.ts:10` |
| `deckard.showEntryRelatedNotes` | `src/extension.ts:1231` | `ui/commands/noteActions.ts:47`, `ui/commands/editorReferences.ts:280` (CodeLens), `ui/commands/tagDecorations.ts:491` (hover link) | Also in the hover's `enabledCommands`, `ui/commands/tagDecorations.ts:561` |

### Contributed commands

"Registered at" is the line of the `registerCommand(` call. "Hidden from palette" means `commandPalette` gives it `"when": "false"`; "palette-gated" means it gives another `when`.

| Id | Contributed at | Registered at | Notes |
|---|---|---|---|
| `deckard.showDashboard` | `package.json:219` | `src/extension.ts:919` | `view/title` |
| `deckard.showNotesGraph` | `package.json:225` | `src/extension.ts:941` | `view/title` |
| `deckard.showNotesGraphAroundNote` | `package.json:231` | `src/extension.ts:944` | palette-gated |
| `deckard.showTaskBoard` | `package.json:237` | `src/extension.ts:960` | `view/title` |
| `deckard.showCalendar` | `package.json:243` | `src/extension.ts:955` | `view/title` |
| `deckard.calendar.openInEditor` | `package.json:249` | `src/extension.ts:957` | hidden from palette; `view/title` |
| `deckard.showStats` | `package.json:255` | `src/extension.ts:922` |  |
| `deckard.showHelp` | `package.json:260` | `src/extension.ts:924` | `view/title` |
| `deckard.openWalkthrough` | `package.json:266` | `src/extension.ts:930` |  |
| `deckard.openWhatsNew` | `package.json:272` | `src/extension.ts:937` |  |
| `deckard.showLog` | `package.json:278` | `src/extension.ts:219` |  |
| `deckard.reindexWorkspace` | `package.json:283` | `src/extension.ts:982` |  |
| `deckard.createDailyNote` | `package.json:288` | `src/extension.ts:1003` | keybinding; `file/newFile`, `view/title` |
| `deckard.pinNote` | `package.json:294` | `src/extension.ts:1047` | palette-gated; `deckard.editor.context` |
| `deckard.unpinNote` | `package.json:299` | `src/extension.ts:1063` | palette-gated; `deckard.editor.context` |
| `deckard.previousDailyNote` | `package.json:304` | `src/extension.ts:1012` | `editor/title` |
| `deckard.nextDailyNote` | `package.json:310` | `src/extension.ts:1015` | `editor/title` |
| `deckard.openDailyNoteForDate` | `package.json:316` | `src/extension.ts:1006` |  |
| `deckard.openWeeklyNote` | `package.json:322` | `src/extension.ts:1018` |  |
| `deckard.openMonthlyNote` | `package.json:327` | `src/extension.ts:1021` |  |
| `deckard.noteActions` | `package.json:332` | `src/extension.ts:952` | palette-gated; `editor/title` |
| `deckard.editTask` | `package.json:341` | `src/extension.ts:1030` | palette-gated; keybinding; `deckard.editor.context` |
| `deckard.breakIntoSteps` | `package.json:346` | `src/extension.ts:1036` | palette-gated; `deckard.editor.context` |
| `deckard.addTask` | `package.json:351` | `src/extension.ts:1033` | palette-gated; keybinding; `deckard.editor.context` |
| `deckard.toggleTaskDone` | `package.json:356` | `src/extension.ts:1039` | palette-gated; keybinding; `deckard.editor.context` |
| `deckard.capture` | `package.json:361` | `src/extension.ts:1042` | keybinding |
| `deckard.captureUnderHeading` | `package.json:366` | `src/extension.ts:1074` |  |
| `deckard.writeReview` | `package.json:371` | `src/extension.ts:1024` |  |
| `deckard.rollTasksForward` | `package.json:376` | `src/extension.ts:1009` |  |
| `deckard.newNoteFromTemplate` | `package.json:381` | `src/extension.ts:1077` | `file/newFile` |
| `deckard.newNoteFromTemplateHere` | `package.json:386` | `src/extension.ts:1081` | hidden from palette; `deckard.explorer.context` |
| `deckard.excludeFromIndex` | `package.json:391` | `src/extension.ts:1084` | hidden from palette; `deckard.explorer.context` |
| `deckard.includeInIndex` | `package.json:396` | `src/extension.ts:1087` | hidden from palette; `deckard.explorer.context` |
| `deckard.parkNote` | `package.json:401` | `src/extension.ts:1091` | palette-gated; `deckard.editor.context`, `deckard.explorer.context`, `editor/title/context` |
| `deckard.unparkNote` | `package.json:406` | `src/extension.ts:1094` | palette-gated; `deckard.editor.context`, `deckard.explorer.context`, `editor/title/context` |
| `deckard.parkFolder` | `package.json:411` | `src/extension.ts:1097` | palette-gated; `deckard.explorer.context` |
| `deckard.unparkFolder` | `package.json:416` | `src/extension.ts:1100` | palette-gated; `deckard.explorer.context` |
| `deckard.parkTag` | `package.json:421` | `src/extension.ts:1103` | palette-gated; `view/item/context` |
| `deckard.unparkTag` | `package.json:426` | `src/extension.ts:1113` | palette-gated |
| `deckard.copyMcpSetup` | `package.json:431` | `src/extension.ts:1124` | palette-gated |
| `deckard.resetMcpToken` | `package.json:436` | `src/extension.ts:1127` | palette-gated |
| `deckard.moveTo` | `package.json:441` | `src/extension.ts:1158` | palette-gated; `deckard.editor.context` |
| `deckard.extractHeading` | `package.json:447` | `src/extension.ts:1155` | palette-gated; `deckard.editor.context` |
| `deckard.showTagOverview` | `package.json:452` | `src/extension.ts:1168` |  |
| `deckard.search` | `package.json:457` | `src/extension.ts:1172` |  |
| `deckard.insertQueryBlock` | `package.json:462` | `src/extension.ts:1175` | palette-gated |
| `deckard.searchWorkspace` | `package.json:467` | `src/extension.ts:1178` | keybinding |
| `deckard.quickFind.complete` | `package.json:472` | `src/extension.ts:1183` | hidden from palette; keybinding |
| `deckard.quickFind.openBeside` | `package.json:477` | `src/extension.ts:1186` | hidden from palette; keybinding |
| `deckard.quickFind.insertLink` | `package.json:482` | `src/extension.ts:1189` | hidden from palette; keybinding |
| `deckard.quickFind.actions` | `package.json:487` | `src/extension.ts:1192` | hidden from palette; keybinding |
| `deckard.searchNotes` | `package.json:492` | `src/extension.ts:1195` |  |
| `deckard.linkCurrentHeading` | `package.json:497` | `src/extension.ts:1200` | palette-gated |
| `deckard.moveTagsToFrontmatter` | `package.json:502` | `src/extension.ts:1203` | palette-gated |
| `deckard.renameTag` | `package.json:507` | `src/extension.ts:1206` |  |
| `deckard.mergeTag` | `package.json:512` | `src/extension.ts:1221` |  |
| `deckard.renameHeading` | `package.json:517` | `src/extension.ts:1215` | palette-gated; `deckard.editor.context` |
| `deckard.undoLastChange` | `package.json:522` | `src/extension.ts:1218` | palette-gated |
| `deckard.showEntryRelatedNotesDebug` | `package.json:527` | `src/extension.ts:1249` | hidden from palette |
| `deckard.outline.revealSection` | `package.json:532` | `src/extension.ts:758` | hidden from palette |
| `deckard.outline.openTagOverview` | `package.json:537` | `src/extension.ts:765` | hidden from palette; `view/item/context` |
| `deckard.outline.renameTag` | `package.json:541` | `src/extension.ts:777` | hidden from palette; `view/item/context` |
| `deckard.agenda.editQuery` | `package.json:545` | `src/extension.ts:852` | `view/title` |
| `deckard.clearAgendaQuery` | `package.json:551` | `src/extension.ts:855` | palette-gated; `view/title` |
| `deckard.agenda.setGrouping` | `package.json:557` | `src/extension.ts:847` | `view/title` |
| `deckard.outline.enableFollowCursor` | `package.json:563` | `src/extension.ts:860` | palette-gated; `view/title` |
| `deckard.outline.disableFollowCursor` | `package.json:569` | `src/extension.ts:863` | palette-gated; `view/title` |
| `deckard.focusSection` | `package.json:575` | `src/extension.ts:789` | palette-gated; `deckard.editor.context`, `view/item/context` |
| `deckard.unfoldAllSections` | `package.json:581` | `src/extension.ts:796` | palette-gated; `view/title` |
| `deckard.outline.filterByTag` | `package.json:587` | `src/extension.ts:800` | palette-gated; `view/title`, `view/item/context` |
| `deckard.outline.clearTagFilter` | `package.json:593` | `src/extension.ts:823` | palette-gated; `view/title` |
| `deckard.chooseTheme` | `package.json:599` | `src/extension.ts:927` |  |
| `deckard.enableZenMode` | `package.json:605` | `src/extension.ts:866` | palette-gated; `editor/title` |
| `deckard.disableZenMode` | `package.json:611` | `src/extension.ts:869` | palette-gated; `editor/title` |
| `deckard.tidyPreferences` | `package.json:617` | `src/extension.ts:872` |  |
| `deckard.exportPreferences` | `package.json:622` | `src/extension.ts:875` |  |
| `deckard.importPreferences` | `package.json:627` | `src/extension.ts:878` |  |
| `deckard.restorePreferences` | `package.json:632` | `src/extension.ts:881` |  |
| `deckard.checkSetup` | `package.json:637` | `src/extension.ts:884` |  |
| `deckard.createSampleWorkspace` | `package.json:642` | `src/extension.ts:887` |  |
| `deckard.agenda.editTask` | `package.json:647` | `src/extension.ts:736` | hidden from palette; `view/item/context` |
| `deckard.agenda.breakIntoSteps` | `package.json:653` | `src/extension.ts:745` | hidden from palette; `view/item/context` |
| `deckard.agenda.dueToday` | `package.json:658` | `src/extension.ts:691` | hidden from palette; `view/item/context` |
| `deckard.agenda.dueTomorrow` | `package.json:663` | `src/extension.ts:692` | hidden from palette; `view/item/context` |
| `deckard.agenda.dueNextWeek` | `package.json:668` | `src/extension.ts:693` | hidden from palette; `view/item/context` |
| `deckard.agenda.dueOnDate` | `package.json:673` | `src/extension.ts:694` | hidden from palette; `view/item/context` |
| `deckard.agenda.moveTo` | `package.json:678` | `src/extension.ts:695` | hidden from palette; `view/item/context` |
| `deckard.agenda.reschedule` | `package.json:683` | `src/extension.ts:704` | hidden from palette; `view/item/context` |
| `deckard.rescheduleOverdue` | `package.json:689` | `src/extension.ts:723` |  |
| `deckard.agenda.showMore` | `package.json:694` | `src/extension.ts:718` | hidden from palette |
| `deckard.calendar.openDayPanel` | `package.json:699` | `src/extension.ts:828` | hidden from palette; `view/title` |
| `deckard.calendar.closeDayPanel` | `package.json:704` | `src/extension.ts:831` | hidden from palette; `view/title` |
| `deckard.calendar.hideWeekends` | `package.json:709` | `src/extension.ts:835` | hidden from palette; `view/title` |
| `deckard.calendar.includeWeekends` | `package.json:714` | `src/extension.ts:838` | hidden from palette; `view/title` |
| `deckard.calendar.showRepeats` | `package.json:719` | `src/extension.ts:841` | hidden from palette; `view/title` |
| `deckard.calendar.hideRepeats` | `package.json:724` | `src/extension.ts:844` | hidden from palette; `view/title` |

## 2. Menus and keybindings

Every command id that a menu or a keybinding names is contributed and registered. Both submenus are declared and have menus of their own.

| Where | Entries | Entries with a `when` |
|---|---|---|
| `menus.commandPalette` | 59 | 59 |
| `menus.editor/title` | 5 | 5 |
| `menus.editor/context` | 1 (submenu `deckard.editor.context`) | 1 |
| `menus.deckard.editor.context` | 12 | 8 |
| `menus.explorer/context` | 1 (submenu `deckard.explorer.context`) | 1 |
| `menus.deckard.explorer.context` | 7 | 7 |
| `menus.file/newFile` | 2 | 2 |
| `menus.view/title` | 22 | 22 |
| `menus.view/item/context` | 16 | 16 |
| `menus.editor/title/context` | 2 | 2 |
| `keybindings` | 10 | 7 |

That is 125 command entries and 2 submenu entries across ten menus, plus 10 keybindings: 135 command references, none unresolved. The submenus are declared at `package.json:731` (`deckard.editor.context`) and `package.json:735` (`deckard.explorer.context`).

### Command links in `package.json` text

Walkthrough steps, `viewsWelcome` contents, and setting descriptions link commands as `command:` URIs. There are 20 links to 17 ids. Sixteen ids are contributed. `deckard.agenda.focus` is not a Deckard command: VS Code generates it from the view id `deckard.agenda`, so renaming that view breaks the link.

| Line | Where | Ids linked |
|---|---|---|
| `package.json:117` | walkthrough step `openNote` | `deckard.createDailyNote`, `deckard.createSampleWorkspace` |
| `package.json:130` | walkthrough step `addTags` | `deckard.showHelp` |
| `package.json:141` | walkthrough step `captureTask` | `deckard.capture`, `deckard.agenda.focus` |
| `package.json:154` | walkthrough step `openHome` | `deckard.showDashboard` |
| `package.json:171` | walkthrough step `search` | `deckard.searchWorkspace` |
| `package.json:184` | walkthrough step `makeItYours` | `deckard.chooseTheme`, `deckard.enableZenMode` |
| `package.json:204` | `viewsWelcome` for `deckard.outline` | `deckard.createDailyNote`, `deckard.showHelp` |
| `package.json:208` | `viewsWelcome` for `deckard.agenda` | `deckard.capture`, `deckard.showTaskBoard` |
| `package.json:213` | `viewsWelcome` for `deckard.agenda`, filtered | `deckard.clearAgendaQuery`, `deckard.agenda.editQuery` |
| `package.json:1718` | `deckard.periodicNote.review` description | `deckard.writeReview` |
| `package.json:1757` | `deckard.dailyNote.rollover` description | `deckard.rollTasksForward` |
| `package.json:1771` | `deckard.templatesFolder` description | `deckard.newNoteFromTemplate` |
| `package.json:1956` | `deckard.previewWorkspaceWrites` description | `deckard.undoLastChange` |
| `package.json:2282` | `deckard.mcpServer.enabled` description | `deckard.copyMcpSetup` |

The walkthrough's `onCommand:` completion events name seven ids: `deckard.createDailyNote`, `deckard.createSampleWorkspace`, `deckard.capture`, `deckard.showDashboard`, `deckard.searchWorkspace`, `deckard.search`, and `deckard.chooseTheme`. All seven are registered.

## 3. Settings

`contributes.configuration` declares 73 properties in seven titled groups. The source reads all 73 through `get` or `inspect`, and it reads no `deckard.*` key that is not declared. No declared setting is dead.

The scan found 221 calls: 133 `get`, 8 `inspect`, 3 `update`, and 77 `affectsConfiguration`. Writes through `writeSetting` (`ui/commands/settings.ts:19`) and target lookups through `settingTarget` (`ui/commands/settings.ts:58`) are credited to their callers in the table below.

### Keys read without a literal key

Five calls read a key that is not a literal at the call. Each resolves to declared settings.

| Call | Key expression | Resolves to |
|---|---|---|
| `ui/commands/dailyNote.ts:329` | `setting` from `PERIOD_TEMPLATES[period]` | `deckard.dailyNoteTemplate`, `deckard.weeklyNoteTemplate`, `deckard.monthlyNoteTemplate` (`ui/commands/dailyNote.ts:121`-`123`) |
| `ui/commands/editorReferences.ts:325` | `` `editor.${name}` ``, `name: 'referenceCounts' \| 'hoverPreviews'` | `deckard.editor.referenceCounts`, `deckard.editor.hoverPreviews` (callers at `ui/commands/editorReferences.ts:108`, `202`) |
| `ui/commands/editorLenses.ts:126` | `group.setting` on `getConfiguration('deckard.editor')` | `deckard.editor.taskDependencies`, `dailyNoteActions`, `linkProblems`, `embedProblems`, `unlinkedMentions` |
| `ui/commands/taskBoardActions.ts:65`, `70` | `` `board.${key}` ``, `key: 'statuses' \| 'statusNamespace'` | `deckard.board.statuses`, `deckard.board.statusNamespace` |
| `ui/commands/settings.ts:26`, `62` | `key` parameter of `writeSetting` and `settingTarget` | The callers' literal keys, all declared; see the Writes column |

Three more calls read a literal key through a configuration whose section is not a literal at the call. `ui/commands/taskActions.ts:592` is `readTaskMetadataFormat(configuration)`, and all 15 callers pass a `deckard` configuration. `core/workspace/scanner.ts:286`, `290`, `399`, `412`, `428`, `433`, `439`, `445`, and `451` read through the private `getConfiguration()` at `core/workspace/scanner.ts:558`, which returns the `deckard` section. `core/workspace/scanner.ts:551` reads `exclude` from three sections in turn: `deckard`, `files`, and `search`.

### Keys outside `deckard.*`

| Key | Read at | How |
|---|---|---|
| `files.exclude` | `core/workspace/scanner.ts:551` | `get`, and `affectsConfiguration` at `core/workspace/indexer.ts:563` and `ui/commands/tagDecorations.ts:122` |
| `search.exclude` | `core/workspace/scanner.ts:551` | `get`, and `affectsConfiguration` at `core/workspace/indexer.ts:564` and `ui/commands/tagDecorations.ts:123` |
| `workbench.editor.enablePreview` | `ui/commands/navigation.ts:117` | `get` |
| `editor.folding` | `ui/commands/focusSection.ts:52` | `get`, per language |

### Change listeners on a section prefix

These `affectsConfiguration` calls name a section rather than a setting, so they cover every setting under it. A split that narrows one of them to named keys changes which edits refresh the view.

| Prefix | Called at |
|---|---|
| `deckard` | `ui/commands/activeNoteContext.ts:83`, `ui/commands/editorLenses.ts:95`, `ui/commands/editorReferences.ts:84` |
| `deckard.agenda` | `ui/webview/dashboard.ts:154`, `ui/views/agendaTree.ts:160` |
| `deckard.board` | `ui/webview/taskBoard.ts:120` |
| `deckard.editor` | `ui/commands/taskLineDecorations.ts:58` |
| `deckard.mcpServer` | `ui/commands/mcpServer.ts:82` |
| `deckard.outline` | `ui/views/outlineTree.ts:96` |
| `deckard.parked` | `core/workspace/indexer.ts:566`, `570`, `ui/commands/parking.ts:641` |
| `deckard.tasks` | `ui/webview/taskBoard.ts:121`, `ui/views/agendaTree.ts:161`, `src/extension.ts:261` |

### Declared settings

"Reads" are `get` and `inspect` calls, including `inspect` through `settingTarget`, `settingPlace` (`ui/commands/parking.ts:273`), and `zenModeTarget` (`ui/webview/zenMode.ts:30`). "Writes" are `update` calls, including those through `writeSetting`. "Listeners" are `affectsConfiguration` calls that name the key; a prefix listener above may also cover it. Paths in this table are written from the repository root.

| Setting | Declared at | Reads | Writes | Listeners |
|---|---|---|---|---|
| `deckard.notesFolder` | `package.json:1608` | `src/core/workspace/scanner.ts:399` `src/ui/commands/dailyNote.ts:302` |  | `src/core/workspace/indexer.ts:546` `src/ui/commands/taskLineDecorations.ts:61` `src/ui/commands/repeatRuleHealth.ts:103` `src/ui/commands/excludeFolders.ts:221` `src/ui/commands/tagDecorations.ts:120` |
| `deckard.theme` | `package.json:1614` | `src/ui/webview/themes.ts:166` `src/ui/commands/chooseTheme.ts:64` | `src/ui/commands/chooseTheme.ts:64` | `src/ui/webview/components.ts:1185` |
| `deckard.zenMode` | `package.json:1640` | `src/ui/commands/taskLineDecorations.ts:18` `src/ui/webview/zenMode.ts:18,37,68` `src/ui/commands/tagDecorations.ts:376` `src/ui/commands/editorLenses.ts:123` `src/ui/commands/editorReferences.ts:322` `src/ui/views/outlineTree.ts:362` | `src/ui/webview/zenMode.ts:71,77` | `src/ui/commands/taskLineDecorations.ts:59` `src/ui/webview/components.ts:1186` `src/ui/commands/tagDecorations.ts:117` `src/ui/views/outlineTree.ts:97` |
| `deckard.showWhatsNew` | `package.json:1646` | `src/ui/commands/whatsNew.ts:114` |  | `src/ui/webview/dashboard.ts:155` |
| `deckard.dashboard.openOnStartup` | `package.json:1652` | `src/extension.ts:1272` |  |  |
| `deckard.dailyNoteTemplate` | `package.json:1658` | `src/ui/commands/dailyNote.ts:329` |  |  |
| `deckard.weeklyNoteTemplate` | `package.json:1664` | `src/ui/commands/dailyNote.ts:329` |  |  |
| `deckard.monthlyNoteTemplate` | `package.json:1670` | `src/ui/commands/dailyNote.ts:329` |  |  |
| `deckard.calendar.weekStart` | `package.json:1676` | `src/ui/commands/datePrompt.ts:64` |  | `src/ui/webview/calendar.ts:65` `src/ui/webview/calendarPage.ts:70` `src/extension.ts:257` |
| `deckard.calendar.dayPanel` | `package.json:1693` | `src/ui/webview/calendar.ts:315` `src/extension.ts:829,832` | `src/extension.ts:829,832` | `src/ui/webview/calendar.ts:66` |
| `deckard.calendar.showWeekends` | `package.json:1700` | `src/ui/webview/calendar.ts:305` `src/ui/webview/calendarPage.ts:209` `src/extension.ts:836,839` | `src/ui/webview/calendarPage.ts:209` `src/extension.ts:836,839` | `src/ui/webview/calendar.ts:68` `src/ui/webview/calendarPage.ts:72` |
| `deckard.calendar.showRepeats` | `package.json:1707` | `src/ui/webview/calendar.ts:310` `src/ui/webview/calendarPage.ts:204` `src/extension.ts:842,845` | `src/ui/webview/calendarPage.ts:204` `src/extension.ts:842,845` | `src/ui/webview/calendar.ts:67` `src/ui/webview/calendarPage.ts:71` |
| `deckard.periodicNote.review` | `package.json:1714` | `src/ui/commands/review.ts:41` |  |  |
| `deckard.periodicNote.reviewSections` | `package.json:1720` | `src/ui/commands/review.ts:48` |  |  |
| `deckard.dailyNote.rollover` | `package.json:1741` | `src/ui/commands/rollover.ts:51` |  |  |
| `deckard.dailyNote.rolloverDays` | `package.json:1759` | `src/ui/commands/rollover.ts:529` |  |  |
| `deckard.templatesFolder` | `package.json:1766` | `src/core/workspace/scanner.ts:412` `src/ui/commands/checkSetup.ts:68` |  | `src/core/workspace/indexer.ts:558` |
| `deckard.exclude` | `package.json:1773` | `src/core/workspace/scanner.ts:551` `src/ui/commands/excludeFolders.ts:131,237` `src/ui/commands/parking.ts:376,395` `src/ui/commands/checkSetup.ts:74` `src/extension.ts:333` | `src/ui/commands/parking.ts:408` `src/ui/commands/excludeFolders.ts:172,179,203` | `src/core/workspace/indexer.ts:562` `src/ui/commands/taskLineDecorations.ts:62` `src/ui/commands/repeatRuleHealth.ts:104` `src/ui/commands/excludeFolders.ts:221` `src/ui/commands/tagDecorations.ts:121` |
| `deckard.parked.folders` | `package.json:1783` | `src/core/workspace/scanner.ts:286,290` `src/ui/commands/parking.ts:278,442,472,676` | `src/ui/commands/parking.ts:417,425,486` |  |
| `deckard.parked.tags` | `package.json:1793` | `src/core/workspace/scanner.ts:299` `src/ui/commands/parking.ts:278` | `src/ui/commands/parking.ts:547,558,616` |  |
| `deckard.developerMode` | `package.json:1805` | `src/ui/commands/tagDecorations.ts:539` |  |  |
| `deckard.noteBoundaries` | `package.json:1817` | `src/core/workspace/scanner.ts:433` |  | `src/core/workspace/indexer.ts:551` |
| `deckard.parseInlineTags` | `package.json:1834` | `src/core/workspace/scanner.ts:428` `src/ui/commands/tagDecorations.ts:368` `src/ui/commands/editorReferences.ts:237` |  | `src/core/workspace/indexer.ts:550` `src/ui/commands/tagDecorations.ts:115` |
| `deckard.personMarker` | `package.json:1842` | `src/core/workspace/scanner.ts:445` `src/ui/commands/capture.ts:381` `src/ui/commands/bulkEdit.ts:197` `src/ui/commands/entitySuggestions.ts:51` `src/ui/commands/linkEntity.ts:46` `src/ui/commands/moveTagsToFrontmatter.ts:58` `src/ui/commands/renameTag.ts:895` `src/ui/commands/tagDecorations.ts:392` `src/ui/commands/tagSuggestions.ts:111` `src/ui/webview/sidebarNotes.ts:901` `src/ui/commands/editorReferences.ts:241` `src/ui/commands/bulkEditPrompts.ts:158` `src/ui/commands/checkSetup.ts:75` `src/ui/views/outlineTree.ts:265` |  | `src/core/workspace/indexer.ts:555` `src/ui/commands/tagDecorations.ts:119` `src/ui/views/outlineTree.ts:98` |
| `deckard.entityNamespaceAliases` | `package.json:1850` | `src/core/workspace/scanner.ts:439` `src/ui/commands/bulkEdit.ts:194` `src/ui/commands/entitySuggestions.ts:46` `src/ui/commands/moveTagsToFrontmatter.ts:56` `src/ui/commands/renameTag.ts:892` `src/ui/commands/tagDecorations.ts:384` `src/ui/webview/sidebarNotes.ts:900` `src/ui/commands/editorReferences.ts:239` `src/ui/commands/bulkEditPrompts.ts:155` |  | `src/core/workspace/indexer.ts:552,567` `src/ui/commands/tagDecorations.ts:118` `src/ui/views/outlineTree.ts:99` |
| `deckard.enableTagAutocomplete` | `package.json:1863` | `src/ui/commands/tagSuggestions.ts:55` |  |  |
| `deckard.tagTitleDisplayMode` | `package.json:1870` | `src/ui/webview/sidebarNotes.ts:519` `src/ui/webview/dashboard.ts:449` `src/ui/webview/taskBoard.ts:284` `src/ui/webview/searchPage.ts:581` |  | `src/ui/webview/sidebarNotes.ts:140` `src/ui/webview/dashboard.ts:149` `src/ui/webview/taskBoard.ts:122` `src/ui/webview/searchPage.ts:82` |
| `deckard.tagOverview.hubNoteExpanded` | `package.json:1884` | `src/ui/webview/searchPage.ts:574` |  | `src/ui/webview/searchPage.ts:83` |
| `deckard.tagOverview.includeHubLinks` | `package.json:1890` | `src/ui/webview/searchPage.ts:568` | `src/ui/webview/searchPage.ts:780` | `src/ui/webview/searchPage.ts:84` |
| `deckard.enableHeadingTagRelationships` | `package.json:1896` | `src/ui/webview/searchPage.ts:526` |  | `src/ui/webview/sidebarNotes.ts:144` `src/ui/webview/searchPage.ts:85` |
| `deckard.highlightNoteSections` | `package.json:1908` | `src/ui/commands/tagDecorations.ts:375` |  | `src/ui/commands/tagDecorations.ts:116` |
| `deckard.editor.referenceCounts` | `package.json:1915` | `src/ui/commands/editorReferences.ts:325` |  |  |
| `deckard.editor.hoverPreviews` | `package.json:1922` | `src/ui/commands/editorReferences.ts:325` |  |  |
| `deckard.editor.linkDiagnostics` | `package.json:1929` | `src/ui/commands/linkHealth.ts:293` |  | `src/ui/commands/linkHealth.ts:268` |
| `deckard.updateLinksOnRename` | `package.json:1936` | `src/ui/commands/linkMaintenance.ts:504` |  |  |
| `deckard.previewWorkspaceWrites` | `package.json:1942` | `src/ui/commands/workspaceWrites.ts:152` |  |  |
| `deckard.moveTo.leaveBehind` | `package.json:1958` | `src/ui/commands/moveTo.ts:354` |  |  |
| `deckard.editor.taskDependencies` | `package.json:1972` | `src/ui/commands/editorLenses.ts:126` |  |  |
| `deckard.editor.dailyNoteActions` | `package.json:1979` | `src/ui/commands/editorLenses.ts:126` |  |  |
| `deckard.editor.linkProblems` | `package.json:1986` | `src/ui/commands/editorLenses.ts:126` |  |  |
| `deckard.editor.embedProblems` | `package.json:1993` | `src/ui/commands/editorLenses.ts:126` |  |  |
| `deckard.editor.unlinkedMentions` | `package.json:2000` | `src/ui/commands/editorLenses.ts:126` |  |  |
| `deckard.editor.dimTaskMetadata` | `package.json:2007` | `src/ui/commands/taskLineDecorations.ts:13` |  |  |
| `deckard.editor.taskDueHints` | `package.json:2014` | `src/ui/commands/taskLineDecorations.ts:17` |  |  |
| `deckard.editor.repeatDiagnostics` | `package.json:2021` | `src/ui/commands/repeatRuleHealth.ts:128` |  | `src/ui/commands/repeatRuleHealth.ts:102` |
| `deckard.autoSelectNoteSections` | `package.json:2034` | `src/ui/webview/sidebarNotes.ts:578` |  | `src/ui/webview/sidebarNotes.ts:150` |
| `deckard.enableKeywordLinks` | `package.json:2041` | `src/ui/webview/sidebarNotes.ts:587` `src/ui/webview/dashboard.ts:483` |  | `src/ui/webview/sidebarNotes.ts:134` |
| `deckard.relatedNotesAssociationMinimumSupport` | `package.json:2051` | `src/ui/webview/sidebarNotes.ts:596` `src/ui/webview/dashboard.ts:488` |  | `src/ui/webview/sidebarNotes.ts:135` |
| `deckard.relatedNotesRecencyHalfLifeDays` | `package.json:2063` | `src/ui/webview/sidebarNotes.ts:600` `src/ui/webview/dashboard.ts:492` |  | `src/ui/webview/sidebarNotes.ts:136` |
| `deckard.tasks.addDoneDate` | `package.json:2081` | `src/ui/commands/taskActions.ts:349,496` `src/ui/commands/bulkEdit.ts:192` `src/ui/commands/taskEditor.ts:505` `src/ui/commands/toggleTaskDone.ts:181` `src/ui/commands/assistantWrites.ts:237` |  |  |
| `deckard.tasks.metadataFormat` | `package.json:2088` | `src/ui/commands/taskActions.ts:592` |  |  |
| `deckard.tasks.assigneeFromPersonTag` | `package.json:2103` | `src/core/workspace/scanner.ts:451` |  |  |
| `deckard.tasks.metadataSuggestions` | `package.json:2109` | `src/ui/commands/taskMetadataSuggestions.ts:138` |  |  |
| `deckard.me` | `package.json:2116` | `src/ui/commands/checkSetup.ts:76` `src/extension.ts:228` |  | `src/extension.ts:254` |
| `deckard.tasks.needsNewDateAfterDays` | `package.json:2122` | `src/extension.ts:238` |  | `src/ui/commands/taskLineDecorations.ts:60` `src/ui/webview/calendar.ts:69` `src/ui/webview/calendarPage.ts:73` `src/ui/views/taskStatusBar.ts:186` |
| `deckard.statusBar` | `package.json:2130` | `src/ui/views/taskStatusBar.ts:251` |  | `src/ui/views/taskStatusBar.ts:184` |
| `deckard.taskReminderTime` | `package.json:2136` | `src/ui/views/taskStatusBar.ts:233,331` | `src/ui/views/taskStatusBar.ts:332` |  |
| `deckard.agenda.groupBy` | `package.json:2144` | `src/ui/views/agendaTree.ts:666` | `src/ui/views/agendaTree.ts:707,714` |  |
| `deckard.agenda.groupNamespace` | `package.json:2164` | `src/ui/views/agendaTree.ts:726` | `src/ui/views/agendaTree.ts:704` |  |
| `deckard.agenda.upcomingDays` | `package.json:2171` | `src/ui/webview/dashboard.ts:475` `src/ui/views/agendaTree.ts:861` |  |  |
| `deckard.agenda.query` | `package.json:2179` | `src/ui/webview/dashboard.ts:466,476` `src/ui/webview/taskBoard.ts:302,308,320,329` `src/ui/views/agendaTree.ts:855` `src/ui/views/taskStatusBar.ts:143` `src/extension.ts:856` | `src/ui/webview/taskBoard.ts:331,337` `src/extension.ts:856` | `src/ui/views/taskStatusBar.ts:185` |
| `deckard.board.limits` | `package.json:2185` | `src/ui/commands/taskBoardActions.ts:51` |  |  |
| `deckard.board.statuses` | `package.json:2195` | `src/ui/commands/taskBoardActions.ts:35,65` `src/ui/views/agendaTree.ts:832` | `src/ui/commands/taskBoardActions.ts:70` |  |
| `deckard.board.statusNamespace` | `package.json:2209` | `src/ui/commands/taskBoardActions.ts:31,65` `src/ui/webview/sidebarNotes.ts:607` `src/ui/preview/queryBlocks.ts:76` `src/ui/views/agendaTree.ts:783,834` `src/extension.ts:243` | `src/ui/commands/taskBoardActions.ts:70` | `src/extension.ts:262` |
| `deckard.tasks.onHoldStatuses` | `package.json:2216` | `src/extension.ts:239` |  |  |
| `deckard.tasks.suggestSteps` | `package.json:2229` | `src/ui/commands/taskSteps.ts:368` |  |  |
| `deckard.outline.showTags` | `package.json:2241` | `src/ui/views/outlineTree.ts:354` |  |  |
| `deckard.outline.followCursor` | `package.json:2247` | `src/ui/views/outlineTree.ts:379` | `src/ui/views/outlineTree.ts:397` |  |
| `deckard.outline.inheritedTags` | `package.json:2253` | `src/ui/views/outlineTree.ts:369` |  |  |
| `deckard.outline.showCounts` | `package.json:2260` | `src/ui/views/outlineTree.ts:361` |  |  |
| `deckard.assistantTools` | `package.json:2272` | `src/ui/commands/assistantTools.ts:220` |  |  |
| `deckard.mcpServer.enabled` | `package.json:2278` | `src/ui/commands/mcpServer.ts:93,168` | `src/ui/commands/mcpServer.ts:176` |  |
| `deckard.mcpServer.port` | `package.json:2284` | `src/ui/commands/mcpServer.ts:96,185` |  |  |

`deckard.parseInlineTags` carries a `markdownDeprecationMessage` (`package.json:1838`) and is still read in three places. The message says a `false` value is read as `heading`, so the reads are deliberate.

## 4. Context keys

The 134 `when` clauses are 59 in `commandPalette`, 64 in the other nine menus, 7 in `keybindings`, 2 in `viewsWelcome`, and 2 in `languageModelTools`. No command uses `enablement`, and no view has a `when`. The walkthrough's completion events add three `onContext:` keys.

### Keys Deckard sets

Every key below has at least one setter. `setContext` goes through `vscode.commands.executeCommand('setContext', key, value)` in every case.

| Key | `when` clauses | Used in | Set at | How the key reaches `setContext` |
|---|---|---|---|---|
| `deckard.activeNoteParked` | 4 | `commandPalette` 2, `deckard.editor.context` 2 | `ui/commands/parking.ts:662` | Constant `ACTIVE_NOTE_PARKED`, `ui/commands/parking.ts:622` |
| `deckard.activeNotePinned` | 4 | `commandPalette` 2, `deckard.editor.context` 2 | `ui/commands/pinNote.ts:203` | Constant `ACTIVE_NOTE_PINNED`, `ui/commands/pinNote.ts:148` |
| `deckard.agendaFiltered` | 2 | `viewsWelcome` 2 | `ui/views/agendaTree.ts:275` | Literal, call spans lines |
| `deckard.agendaQuerySet` | 2 | `commandPalette` 1, `view/title` 1 | `ui/views/agendaTree.ts:280` | Literal |
| `deckard.canUndo` | 1 | `commandPalette` 1 | `src/extension.ts:389`, `397` | Literal; the call at 389 spans lines |
| `deckard.excludedFolders` | 2 | `deckard.explorer.context` 2 | `ui/commands/excludeFolders.ts:239` | Literal, call spans lines; an array, tested with `in` |
| `deckard.hasNotes` | 0 | walkthrough `onContext:`, `package.json:124` | `src/extension.ts:370` | Literal |
| `deckard.hasTags` | 0 | walkthrough `onContext:`, `package.json:135` | `src/extension.ts:371` | Literal |
| `deckard.hasTasks` | 0 | walkthrough `onContext:`, `package.json:148` | `src/extension.ts:372` | Literal |
| `deckard.isDailyNote` | 2 | `editor/title` 2 | `ui/commands/activeNoteContext.ts:111` | `ActiveNoteContext.update()`, then the `setContext` helper at `ui/commands/activeNoteContext.ts:15`; the ledger is created at `src/extension.ts:381` |
| `deckard.isNote` | 4 | `commandPalette` 2, `editor/title` 1, `editor/context` 1 | `ui/commands/activeNoteContext.ts:110` | As `deckard.isDailyNote` |
| `deckard.onTaskLine` | 11 | `commandPalette` 4, `deckard.editor.context` 4, `keybindings` 3 | `ui/commands/taskEditor.ts:609` | Constant `ON_TASK_LINE`, `ui/commands/taskEditor.ts:563` |
| `deckard.outlineFiltered` | 4 | `commandPalette` 2, `view/title` 2 | `ui/views/outlineTree.ts:160` | Constant `outlineFilteredContextKey`, `ui/views/outlineTree.ts:25` |
| `deckard.outlineFollowCursor` | 4 | `commandPalette` 2, `view/title` 2 | `ui/views/outlineTree.ts:386` | Constant `outlineFollowCursorContextKey`, `ui/views/outlineTree.ts:23`, through `syncOutlineFollowCursorContext()`, called at `src/extension.ts:755` and `ui/views/outlineTree.ts:101`, `403` |
| `deckard.parkedFolders` | 2 | `deckard.explorer.context` 2 | `ui/commands/parking.ts:683` | Literal; an array, tested with `in` |
| `deckard.parkedNotes` | 4 | `deckard.explorer.context` 2, `editor/title/context` 2 | `ui/commands/parking.ts:671` | Literal; an array, tested with `in` |
| `deckard.quickFindOpen` | 4 | `keybindings` 4 | `ui/commands/quickFind.ts:175`, `183` | Constant `QUICK_FIND_CONTEXT`, `ui/commands/quickFind.ts:31` |
| `deckard.sectionFocused` | 2 | `commandPalette` 1, `view/title` 1 | `ui/commands/focusSection.ts:69`, `77`, `86` | Constant `SECTION_FOCUSED`, `ui/commands/focusSection.ts:6`; lines 69 and 77 go through the injectable `FocusDeps.execute` at `ui/commands/focusSection.ts:29` |
| `deckard.zenMode` | 4 | `commandPalette` 2, `editor/title` 2 | `ui/webview/zenMode.ts:50` | Constant `zenModeContextKey`, `ui/webview/zenMode.ts:5`, through `syncZenModeContext()`, called at `src/extension.ts:756` and `ui/webview/zenMode.ts:79` |

These 19 keys account for 56 of the `when` clauses. Nine are set by a literal key: `hasNotes`, `hasTags`, `hasTasks`, `canUndo`, `excludedFolders`, `parkedNotes`, `parkedFolders`, `agendaFiltered`, and `agendaQuerySet`. The other ten go through a constant, a helper, or the `ActiveNoteContext` ledger.

Two readers outside `package.json` name these keys as text. `EDITOR_CONTEXT` at `ui/webview/helpHtml.ts:43` matches `deckard.onTaskLine` and `deckard.isNote` in palette `when` clauses to decide which commands Help may run. `src/test/extension.test.ts:342` looks for the three `onContext:` keys in compiled text; see section 8.

### Keys VS Code sets from settings

| Key | `when` clauses | Used in |
|---|---|---|
| `config.deckard.assistantTools` | 2 | `languageModelTools` (`deckard_query`, `deckard_list_tags`) |
| `config.deckard.calendar.dayPanel` | 2 | `view/title` |
| `config.deckard.calendar.showRepeats` | 2 | `view/title` |
| `config.deckard.calendar.showWeekends` | 2 | `view/title` |
| `config.deckard.mcpServer.enabled` | 2 | `commandPalette` |

All five settings are declared. The walkthrough also completes on `onSettingChanged:deckard.theme` and `onSettingChanged:deckard.zenMode`, both declared.

### Built-in keys

The remaining clauses use VS Code's own keys: `view` (38 clauses), `editorLangId` (20), `viewItem` (14), `workspaceFolderCount` (9), `resourcePath` (8), `explorerResourceIsFolder` (6), `resourceLangId` (6), `inQuickOpen` (4), `editorTextFocus` (3), `resourceExtname` (3), and `activeWebviewPanelId` (2). Two of them depend on Deckard's own names. `view ==` compares against the view ids `deckard.agenda` (14 clauses), `deckard.outline` (11), `deckard.calendar` (7), and `deckard.relatedNotes` (6). `activeWebviewPanelId =~ /^deckard\./` depends on every panel view type starting with `deckard.`.

### Tree item `contextValue`s

`viewItem` clauses match the `contextValue` a tree item carries. A move that changes one of these strings hides the item's menu entries.

| Value | Set at | Matched by |
|---|---|---|
| `deckardAgendaTask` | `ui/views/agendaTree.ts:610`, `650` | 8 clauses, `viewItem == deckardAgendaTask` |
| `deckardAgendaGroup.overdue`, `deckardAgendaGroup.needsDate` | `ui/views/agendaTree.ts:562`, `564` | `viewItem =~ /^deckardAgendaGroup\.(overdue\|needsDate)$/` and `/^deckardAgendaGroup/` |
| `deckardAgendaGroup` | `ui/views/agendaTree.ts:567` | `viewItem =~ /^deckardAgendaGroup/` |
| `deckardAgendaDoneGroup`, `deckardAgendaDoneTask` | `ui/views/agendaTree.ts:566`, `610`, `650` | No clause, so these items have no menu |
| `deckardOutlineTagged` | `ui/views/outlineTree.ts:138` | 4 clauses, `viewItem == deckardOutlineTagged` |
| `deckardOutlineHeading` | `ui/views/outlineTree.ts:138` | No clause |

### Questions

- `deckard.zenMode` follows the setting only at activation and after Deckard writes it through `setZenMode()`. No configuration listener calls `syncZenModeContext()`, so an edit to `deckard.zenMode` in the Settings editor or `settings.json` leaves the palette's Enable Zen Mode and Disable Zen Mode, and the zen buttons in `editor/title`, reading the old value until the next activation. `deckard.outlineFollowCursor`, the analogous key, does resync on `deckard.outline` changes at `ui/views/outlineTree.ts:101`.
- `deckard.zenMode` is both a setting and a context key of the same name. A rename of either must not assume the other follows.

## 5. Command re-entry

Source re-enters Deckard's own commands through `vscode.commands.executeCommand` and through `command` fields that VS Code runs on a click. A rename of any id below, or a change to the `WriteHistory` design in §2.3 of the plan, must keep these callers working.

### `executeCommand` with a `deckard.*` target

| Caller | Target | Form |
|---|---|---|
| `src/extension.ts:586` | `deckard.showStats` | Literal |
| `src/extension.ts:588` | `deckard.showLog` | Literal |
| `src/extension.ts:741` | `deckard.editTask` | Literal |
| `ui/commands/chooseTheme.ts:66` | `deckard.showDashboard` | Literal |
| `ui/commands/firstIndex.ts:113` | `deckard.showDashboard` | Literal |
| `ui/commands/firstIndex.ts:115` | `deckard.openWalkthrough` | Literal |
| `ui/commands/linkMaintenance.ts:384` | `deckard.renameHeading` | Literal |
| `ui/commands/moveTo.ts:79` | `deckard.extractHeading` | Literal |
| `ui/commands/notify.ts:58` | `deckard.showLog` | Literal |
| `ui/commands/notify.ts:139` | `deckard.reindexWorkspace` | Literal |
| `ui/commands/parking.ts:93` | `deckard.undoLastChange` | Literal |
| `ui/commands/quickFind.ts:359` | `deckard.editTask` | Literal |
| `ui/commands/quickFind.ts:412` | `deckard.renameTag` | Literal |
| `ui/commands/savedSearchHome.ts:27` | `deckard.showDashboard` | Literal |
| `ui/webview/calendar.ts:212` | `deckard.search` | Literal |
| `ui/webview/calendarPage.ts:216` | `deckard.chooseTheme` | Literal |
| `ui/webview/calendarPage.ts:219` | `deckard.showHelp` | Literal |
| `ui/webview/dashboard.ts:534` | `deckard.chooseTheme` | Literal |
| `ui/webview/dashboard.ts:717` | `deckard.openWhatsNew` | Literal |
| `ui/webview/notesGraph.ts:349` | `deckard.showTagOverview` | Literal, call spans lines |
| `ui/webview/notesGraph.ts:422` | `deckard.showTagOverview` | Literal, call spans lines |
| `ui/webview/searchPage.ts:694` | `deckard.chooseTheme` | Literal |
| `ui/webview/searchPage.ts:756` | `deckard.showHelp` | Literal |
| `ui/webview/sidebarNotes.ts:660` | `deckard.showDashboard` | Literal |
| `ui/webview/sidebarNotes.ts:664` | `deckard.showNotesGraph` | Literal |
| `ui/webview/sidebarNotes.ts:668` | `deckard.showTaskBoard` | Literal |
| `ui/webview/sidebarNotes.ts:676` | `deckard.activateNotesGraphNode` | Literal, call spans lines |
| `ui/webview/sidebarNotes.ts:684` | `deckard.highlightNotesGraphNode` | Literal, call spans lines |
| `ui/webview/sidebarNotes.ts:691` | `deckard.createDailyNote` | Literal |
| `ui/webview/sidebarNotes.ts:695` | `deckard.showHelp` | Literal |
| `ui/webview/sidebarNotes.ts:769` | `deckard.search` | Literal, call spans lines |
| `ui/webview/stats.ts:141` | `deckard.search` | Literal |
| `ui/webview/stats.ts:151` | `deckard.mergeTag` | Literal, call spans lines |
| `ui/webview/stats.ts:171` | `deckard.showNotesGraph` | Literal |
| `ui/webview/stats.ts:182` | `deckard.mergeTag` | Literal |
| `ui/webview/stats.ts:189` | `deckard.reindexWorkspace` | Literal |
| `ui/webview/taskBoard.ts:431` | `deckard.chooseTheme` | Literal |
| `ui/webview/taskBoard.ts:437` | `deckard.showHelp` | Literal |
| `ui/webview/taskBoard.ts:580` | `deckard.editTask` | Literal |
| `ui/views/taskStatusBar.ts:325` | `deckard.agenda.focus` | Constant `SHOW_AGENDA`, `ui/views/taskStatusBar.ts:147`; a view focus command |
| `ui/views/taskStatusBar.ts:327` | `deckard.rescheduleOverdue` | Constant `RESCHEDULE_OVERDUE`, `ui/views/taskStatusBar.ts:148` |
| `ui/webview/dashboard.ts:649` | `deckard.parkTag`, `deckard.unparkTag` | Template `` `deckard.${message.type}` `` under `case 'parkTag'` and `case 'unparkTag'`, `ui/webview/dashboard.ts:647` |
| `ui/webview/searchPage.ts:801` | `deckard.parkTag`, `deckard.unparkTag` | Template, cases at `ui/webview/searchPage.ts:799` |
| `ui/webview/searchPage.ts:807` | `deckard.parkNote`, `deckard.unparkNote` | Template, cases at `ui/webview/searchPage.ts:803` |
| `ui/webview/sidebarNotes.ts:713` | `deckard.parkTag`, `deckard.unparkTag` | Template, guarded at `ui/webview/sidebarNotes.ts:712` |
| `ui/webview/dashboard.ts:723` | `deckard.agenda.focus`, `deckard.showStats`, `deckard.createSampleWorkspace`, `deckard.checkSetup`, `deckard.openWalkthrough` | Lookup map at `ui/webview/dashboard.ts:725`-`729`, keyed by `message.view` |
| `ui/webview/dashboard.ts:413` | `deckard.writeReview`, `deckard.mergeTag`, `deckard.showTaskBoard` | `run` callback passed to `runTryNext`; ids at `ui/commands/tryNext.ts:155`, `159`, `163` |
| `ui/commands/noteActions.ts:132` | `deckard.toggleTaskDone`, `deckard.editTask`, `deckard.addTask`, `deckard.showEntryRelatedNotes`, `deckard.relatedNotes.focus`, `deckard.showNotesGraphAroundNote`, `deckard.moveTo`, `deckard.focusSection`, `deckard.unpinNote`, `deckard.pinNote` | `chosen.command` from the quick pick items at `ui/commands/noteActions.ts:36`-`63` |
| `ui/webview/help.ts:112` | Any contributed command Help marks runnable | `message.command`, checked by `isRunnableFromHelp` (`ui/webview/helpHtml.ts:76`) against the manifest, after `parseHelpMessage` (`ui/webview/messages.ts:840`) requires `^deckard\.[\w.]+$` |

That is 39 distinct ids, not counting Help's open set. Two of them, `deckard.agenda.focus` and `deckard.relatedNotes.focus`, are not registered by Deckard: VS Code generates them from the view ids. The other 37 are registered.

### `command` fields and command links in source

VS Code runs these ids when a reader clicks a tree item, a CodeLens, a code action, a status bar item, or a trusted hover link.

| Where | Id | Kind |
|---|---|---|
| `ui/views/outlineTree.ts:140` | `deckard.outline.revealSection` | Tree item |
| `ui/views/agendaTree.ts:579` | `deckard.agenda.showMore` | Tree item |
| `ui/views/taskStatusBar.ts:171` | `deckard.agenda.focus` | Status bar item, through `SHOW_AGENDA` |
| `ui/preview/queryBlocks.ts:130` | `deckard.searchNotes` | CodeLens in the Markdown editor |
| `ui/commands/editorLenses.ts:234` | `deckard.rollTasksForward` | CodeLens |
| `ui/commands/editorLenses.ts:244` | `deckard.previousDailyNote` | CodeLens |
| `ui/commands/editorLenses.ts:254` | `deckard.nextDailyNote` | CodeLens |
| `ui/commands/editorLenses.ts:313` | `deckard.createMissingNotes` | CodeLens, through `CREATE_MISSING_NOTES_COMMAND` |
| `ui/commands/editorLenses.ts:380` | `deckard.linkMentions` | CodeLens, through `LINK_MENTIONS_COMMAND` |
| `ui/commands/editorReferences.ts:280` | `deckard.showEntryRelatedNotes` | CodeLens |
| `ui/commands/entitySuggestions.ts:67` | `deckard.linkCurrentHeading` | Code action |
| `ui/commands/taskEditor.ts:648` | `deckard.editTask` | Code action |
| `ui/commands/taskEditor.ts:656` | `deckard.breakIntoSteps` | Code action |
| `ui/commands/moveTo.ts:450` | `deckard.moveTo` | Code action |
| `ui/commands/linkHealth.ts:338` | `deckard.createLinkedNote` | Code action, through `CREATE_LINKED_NOTE_COMMAND` |
| `ui/commands/tagDecorations.ts:479` | `deckard.showTagOverview` | Hover link |
| `ui/commands/tagDecorations.ts:483` | `deckard.renameTag` | Hover link; `enabledCommands` at `ui/commands/tagDecorations.ts:523` |
| `ui/commands/tagDecorations.ts:491` | `deckard.showEntryRelatedNotes` | Hover link |
| `ui/commands/tagDecorations.ts:502` | `deckard.showEntryRelatedNotesDebug` | Hover link, offered in developer mode |
| `ui/commands/tagDecorations.ts:560` | `deckard.showEntryRelatedNotes`, `deckard.pinNote`, `deckard.unpinNote`, `deckard.showEntryRelatedNotesDebug` | `enabledCommands` of the entry hover |
| `ui/commands/pinNote.ts:141` | `deckard.pinNote`, `deckard.unpinNote` | Hover link |
| `ui/commands/editorReferences.ts:450` | `deckard.showTagOverview` | Hover link; `enabledCommands` at `ui/commands/editorReferences.ts:454` |

## 6. Webviews and views

### Editor panels

Seven panel view types have both a serializer and an `onWebviewPanel:` activation event, and they match one to one. An eighth view type, `deckard.relatedNotesDebug`, has neither, so that panel does not come back after a reload.

| View type | Activation event | Serializer | Created at |
|---|---|---|---|
| `deckard.dashboard` | `package.json:44` | `src/extension.ts:892` | `ui/webview/dashboard.ts:278` |
| `deckard.tagOverview` | `package.json:45` | `src/extension.ts:913` | `ui/webview/searchPage.ts:403` |
| `deckard.stats` | `package.json:46` | `src/extension.ts:896` | `ui/webview/stats.ts:80` |
| `deckard.help` | `package.json:47` | `src/extension.ts:899` | `ui/webview/help.ts:69` |
| `deckard.notesGraph` | `package.json:48` | `src/extension.ts:902` | `ui/webview/notesGraph.ts:214` |
| `deckard.taskBoard` | `package.json:49` | `src/extension.ts:909` | `ui/webview/taskBoard.ts:194` |
| `deckard.calendarPage` | `package.json:50` | `src/extension.ts:906` | `ui/webview/calendarPage.ts:94` |
| `deckard.relatedNotesDebug` | none | none | `ui/webview/relatedNotesDebug.ts:38` |

Two more readers depend on the view types' `deckard.` prefix: `hasVisibleDeckardPage()` at `ui/commands/chooseTheme.ts:54`, which tests `viewType.includes('deckard.')`, and the two `editor/title` zen buttons, whose `when` tests `activeWebviewPanelId =~ /^deckard\./`.

### Sidebar views

`contributes.viewsContainers.activitybar` declares the container `deckard` at `package.json:1393`. `contributes.views.deckard` declares four views. Each has one registration. No source calls `registerTreeDataProvider`.

| View id | Declared at | Type | Registered at |
|---|---|---|---|
| `deckard.relatedNotes` | `package.json:1402` | webview | `registerWebviewViewProvider`, `src/extension.ts:631` |
| `deckard.outline` | `package.json:1409` | tree | `createTreeView`, `src/extension.ts:640` |
| `deckard.agenda` | `package.json:1415` | tree | `createTreeView`, `src/extension.ts:646` |
| `deckard.calendar` | `package.json:1421` | webview | `registerWebviewViewProvider`, `src/extension.ts:636` |

VS Code derives command ids from these names, and the source runs three of them: `workbench.view.extension.deckard` from the container id (`ui/webview/sidebarNotes.ts:239`, `250`), `deckard.agenda.focus` (`ui/views/taskStatusBar.ts:325`, `ui/webview/dashboard.ts:725`, `package.json:141`), and `deckard.relatedNotes.focus` (`ui/commands/noteActions.ts:50`). `viewsWelcome` names `deckard.outline` and `deckard.agenda` at `package.json:203`, `207`, and `212`.

### Language model tools

| Tool | Declared at | `when` | Activation event | Registered at |
|---|---|---|---|---|
| `deckard_query` | `package.json:1435` | `config.deckard.assistantTools` | `package.json:52` | `ui/commands/assistantTools.ts:133`, name from `ui/state/assistantTools.ts:18` |
| `deckard_list_tags` | `package.json:1477` | `config.deckard.assistantTools` | `package.json:53` | `ui/commands/assistantTools.ts:134`, name from `ui/state/assistantTools.ts:19` |
| `deckard_add_task` | `package.json:1507` | none | none | `ui/commands/assistantTools.ts:135`, name from `ui/commands/assistantWrites.ts:38` |
| `deckard_change_task` | `package.json:1536` | none | none | `ui/commands/assistantTools.ts:136`, name from `ui/commands/assistantWrites.ts:39` |

The MCP server reads the same declarations at run time: `src/extension.ts:407` passes `contributes.languageModelTools` to `readManifestTools()`. The two write tools have no activation event and no `when`. `onStartupFinished` activates the extension anyway, so the missing event matters only if that event is ever dropped. With `deckard.assistantTools` off, the write tools stay offered and refuse the call at `ui/commands/assistantTools.ts:170`.

## 7. Other bindings from `package.json` into the tree

| Field | Value | Line | Bound to |
|---|---|---|---|
| `main` | `./dist/extension.js` | `package.json:55` | esbuild entry `src/extension.ts` (`esbuild.js:30`), `outdir: 'dist'`, `entryNames: '[name]'` |
| `icon` | `resources/lockup.png` | `package.json:6` | Marketplace icon |
| `activationEvents` | `onStartupFinished`, seven `onWebviewPanel:`, two `onLanguageModelTool:` | `package.json:44`-`53` | See section 6 |
| `contributes.markdown.markdownItPlugins` | `true` | `package.json:1429` | `activate()` returns `extendMarkdownIt` (`src/extension.ts:1292`), which calls `QueryBlocks.extendMarkdownIt` (`ui/preview/queryBlocks.ts:67`), which adds `addNoteEmbedRenderer` from `ui/preview/noteEmbeds.ts` |
| `contributes.markdown.previewStyles` | `./resources/query-block.css` | `package.json:1431` | Styles the `.deckard-query` markup that `ui/preview/queryBlockHtml.ts` writes |
| `contributes.grammars[0].path` | `./syntaxes/deckard.injection.tmLanguage.json`, scope `markdown.deckard.injection`, injected into `text.html.markdown` | `package.json:102` | Read by `src/test/markdown-injection-grammar.test.ts:112` |
| `contributes.colors` | `deckard.sectionHighlightBackground`, `deckard.sectionHighlightBorder`, `deckard.overdueForeground`, `deckard.taskHintForeground` | `package.json:59`, `69`, `79`, `89` | `ThemeColor` at `ui/commands/tagDecorations.ts:61`, `63`, and `ui/commands/taskLineDecorations.ts:37`, `124` |
| `contributes.walkthroughs[0].id` | `deckard.gettingStarted` | `package.json:110` | `src/extension.ts:933` opens `${extension.id}#deckard.gettingStarted` |
| Walkthrough step ids | `deckard.walkthrough.openNote` and five more | `package.json:115`-`182` | Asserted in order by `src/test/extension.test.ts:325` |
| Walkthrough media | `resources/walkthrough/notes.md`, `tags.md`, `tasks.png`, `home-dark.png`, `home-light.png`, `search.png`, `themes.png` | `package.json:119`, `132`, `143`, `157`-`160`, `173`, `186` | Sizes checked by `src/test/extension.test.ts:348` |
| `contributes.commands[20].icon` | `resources/editor/deckard-light.svg`, `resources/editor/deckard-dark.svg` | `package.json:336`, `337` | Title bar icon of `deckard.noteActions` |
| `contributes.viewsContainers.activitybar[0].icon` | `resources/deckard.svg` | `package.json:1395` | Activity bar |
| `contributes.views.deckard[*].icon` | `resources/views/related-notes.svg`, `outline.svg`, `tasks.svg`, `calendar.svg` | `package.json:1404`, `1411`, `1417`, `1423` | View icons |
| `scripts` | `node esbuild.js`, `tsc -p . --outDir out`, `node test/e2e/run.js`, `node test/ui/*.js`, `node test/perf/indexSpeed.js`, `node scripts/*.mjs` | `package.json:2302`-`2327` | Build and test entry points; see section 8 |

Every path above exists in a checkout at 1805a01, except `dist/extension.js`, which the build writes.

### Files the source reads from the extension folder at run time

These are not named in `package.json`, but they bind a source path to a shipped file, and `.vscodeignore` must keep shipping them.

| Read at | File |
|---|---|
| `src/extension.ts:200`, `ui/webview/help.ts:118` | `CHANGELOG.md` |
| `ui/webview/help.ts:134` | `docs/guide/<page>.md`, kept in the VSIX by `!docs/guide/**` in `.vscodeignore` |
| `ui/commands/sampleWorkspace.ts:53` | `resources/sample/` |
| `ui/webview/help.ts:88`, `ui/webview/searchPage.ts:587`, `ui/webview/stats.ts:95`, `ui/webview/taskBoard.ts:205`, `ui/webview/dashboard.ts:296`, `ui/webview/relatedNotesDebug.ts:44`, `ui/webview/helpHtml.ts:350` | `resources/deckard.svg` |
| `ui/webview/notesGraph.ts:228` | `resources/notes-graph.svg` |
| `ui/webview/calendarPage.ts:133` | `resources/views/calendar.svg` |
| `ui/webview/icons.ts:12`, `21` | `resources/favorite-heart-outline.svg`, `resources/favorite-heart-filled.svg` |
| `core/storage/searchStoreWorkerClient.ts:130` | `searchStoreWorker.js` beside the running module: `dist/` in the VSIX, `out/core/storage/` under test. esbuild builds it from the second entry, `src/core/storage/searchStoreWorker.ts` (`esbuild.js:31`). The worker and its client must stay in one folder, or this lookup must change with them. |

The source also reads the manifest itself at run time: `packageJSON.version` at `src/extension.ts:196`, `222`, `275`, `409`, and `463`; `packageJSON.contributes` for Help at `src/extension.ts:478` and for Choose Theme at `src/extension.ts:928`, which reads the `enumDescriptions` of `deckard.theme` (`ui/commands/chooseTheme.ts:43`).

## 8. Traps

These tests and scripts would fail, or would pass while checking nothing, after a move that changes no behavior.

| Where | What it does | What breaks it |
|---|---|---|
| `src/test/extension.test.ts:333`, `342` | Reads `out/extension.js` as text and asserts `` `'setContext', '${key}'` `` for each walkthrough `onContext:` key: `deckard.hasNotes`, `deckard.hasTags`, `deckard.hasTasks` | Moving the three calls at `src/extension.ts:370`-`372` out of `extension.ts`, passing the key through a constant, or reformatting the call across lines |
| `.vscode-test.mjs:4` | Runs `out/test/**/*.test.js` | Moving a test out of `src/test/` |
| `src/test/naming.test.ts:10`, `src/test/changelog.test.ts:26`, `src/test/help-page.test.ts:16`, `src/test/markdown-injection-grammar.test.ts:112`, `151`, `src/test/tag-decorations.test.ts:121`, `src/test/choose-theme.test.ts:12`, `src/test/icons.test.ts:14`, `src/test/guide.test.ts:13`, `src/test/sample-workspace.test.ts:31`, `src/test/indexCorpus.ts:14` | Find the repository root as `__dirname` plus `..`, `..` | Moving a test file one folder deeper, such as into `src/test/unit/` |
| `src/test/naming.test.ts:11`, `85`-`87` | Reads every `src/ui/webview/*.ts` as text to check button labels | Moving a page out of `src/ui/webview/`: its labels go unchecked, and the test still passes |
| `src/test/naming.test.ts:30`-`44` | Reads `src/extension.ts` and every non-`*Html.ts` file in `ui/commands`, `ui/views`, `ui/preview`, `ui/webview`, and `ui/state` as text to check messages; a missing folder is skipped at line 35 | Moving host code to a new folder, or renaming a file to end in `Html.ts`: coverage drops silently |
| `src/test/icons.test.ts:14`-`18` | Reads `src/ui/webview/*Html.ts` as text and fails on a literal `<svg` | Moving a page builder out of `src/ui/webview/`: the test passes and checks nothing |
| `src/test/guide.test.ts:13` | Reads `docs/guide/*.md` | Moving the guide |
| `test/ui/pages.js`, `test/ui/checkLayout.js`, `test/ui/verifyWebviews.js`, eight files in `test/e2e/`, `test/perf/indexSpeed.js` | `require` 35 compiled modules by path under `out/`, such as `out/ui/webview/dashboardHtml.js` and `out/core/workspace/indexer.js` | Renaming or moving any of those 35 modules; `npm run test:ui`, `test:layout`, `test:visual`, `test:e2e`, and `bench:index` fail to load |
| `test/ui/pages.js:51` | Passes `require('../../package.json').contributes` to `getHelpHtml` | Nothing on a move; listed because it reads the manifest |

The 35 modules are `out/core/changelog.js`, `out/core/markdown/parser.js`, `out/core/storage/parsedFileCodec.js`, `out/core/storage/preferences.js`, `out/core/storage/searchStore.js`, `out/core/timing.js`, `out/core/workspace/indexer.js`, `out/core/workspace/scanner.js`, `out/ui/commands/dailyNote.js`, `out/ui/commands/tagDecorations.js`, `out/ui/state/calendarState.js`, `out/ui/state/dashboardState.js`, `out/ui/state/notesGraphState.js`, `out/ui/state/relatedNotesRanking.js`, `out/ui/state/taskBoardState.js`, and, under `out/ui/webview/`, `activeCalendar.js`, `activeSearch.js`, `calendar.js`, `calendarHtml.js`, `calendarPage.js`, `components.js`, `dashboard.js`, `dashboardHtml.js`, `helpHtml.js`, `notesGraphHtml.js`, `relatedNotesDebugHtml.js`, `searchPage.js`, `searchPageHtml.js`, `sidebarNotes.js`, `sidebarNotesHtml.js`, `stats.js`, `statsHtml.js`, `taskBoard.js`, `taskBoardHtml.js`, and `themes.js`.

Several tests read `package.json` as JSON and pin the manifest itself. They guard behavior and do not break on a move: `src/test/extension.test.ts:92` asserts 73 settings, `src/test/extension.test.ts:117` asserts the ordered list of all 96 contributed ids, and `src/test/naming.test.ts:115` and `138` check command titles. No test asserts that every contributed command is registered; `src/test/extension.test.ts` checks 11 ids through `getCommands(true)`, starting at line 360.

## Behavior questions

- **No dead setting and no undeclared read.** All 73 declared settings are read, and nothing else under `deckard.*` is.
- **No context key without a setter.** All 19 keys that Deckard's `when` clauses and walkthrough events name are set.
- **`deckard.zenMode` does not resync on a settings edit.** The context key is set at activation (`src/extension.ts:756`) and after `setZenMode()` writes (`ui/webview/zenMode.ts:79`), and no configuration listener updates it. See section 4.
- **`deckard.relatedNotesDebug` has no serializer.** The debug panel does not survive a reload. It is a developer tool, so this is likely deliberate.
- **The two write tools have no activation event or `when`.** `deckard_add_task` and `deckard_change_task` rely on `onStartupFinished`. They stay offered to the model when `deckard.assistantTools` is off, unlike the two read tools, and the code then refuses the call (`ui/commands/assistantTools.ts:170`).

## How to regenerate

Run each command from the repository root of a checkout at 1805a01 with `node_modules` installed. None of them writes a file.

Commands contributed and registered (section 1):

```sh
node - <<'EOF'
const fs = require('fs'), cp = require('child_process');
const files = cp.execSync("find src -type f -name '*.ts' -not -path 'src/test/*' | sort", { encoding: 'utf8' }).trim().split('\n');
const consts = {};
for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/export const (\w+_COMMAND) = '([^']+)'/g)) consts[m[1]] = m[2];
const registered = [];
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  for (const m of t.matchAll(/register(?:TextEditor)?Command\(\s*([^,)]+)/g)) {
    const arg = m[1].trim();
    registered.push([consts[arg] ?? arg.replace(/^'|'$/g, ''), `${f}:${t.slice(0, m.index).split('\n').length}`]);
  }
}
const contributed = JSON.parse(fs.readFileSync('package.json', 'utf8')).contributes.commands.map((c) => c.command);
const ids = new Set(registered.map(([id]) => id));
console.log('registered', registered.length, 'distinct', ids.size, 'contributed', contributed.length);
console.log('registered, not contributed', registered.filter(([id]) => !contributed.includes(id)));
console.log('contributed, not registered', contributed.filter((id) => !ids.has(id)));
EOF
```

Menu and keybinding references (section 2):

```sh
node - <<'EOF'
const fs = require('fs');
const c = JSON.parse(fs.readFileSync('package.json', 'utf8')).contributes;
const contributed = new Set(c.commands.map((x) => x.command));
const refs = [...Object.entries(c.menus).flatMap(([menu, items]) => items.filter((i) => i.command).map((i) => [menu, i.command])),
  ...c.keybindings.map((k) => ['keybindings', k.command])];
console.log('menu and keybinding references', refs.length);
console.log('not contributed', refs.filter(([, id]) => !contributed.has(id)));
const submenus = new Set(c.submenus.map((s) => s.id));
console.log('submenu refs', Object.values(c.menus).flat().filter((i) => i.submenu).map((i) => [i.submenu, submenus.has(i.submenu), i.submenu in c.menus]));
const links = [...fs.readFileSync('package.json', 'utf8').matchAll(/command:(deckard\.[\w.]+)/g)].map((m) => m[1]);
console.log('command: links', links.length, 'distinct', new Set(links).size, 'not contributed', [...new Set(links)].filter((id) => !contributed.has(id)));
EOF
grep -n 'command:deckard\.' package.json
```

Settings (section 3). This uses the TypeScript checker, so a key held in a constant or a literal union resolves to its values. It prints the rows it could not resolve; section 3 resolves them by hand. Set `ROWS=/some/file.tsv` to also write every call as a row.

```sh
node - <<'EOF'
const ts = require('typescript'), path = require('path'), fs = require('fs');
const root = process.cwd();
const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile('tsconfig.json', ts.sys.readFile).config, ts.sys, root);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();
const literals = (node) => {
  const type = checker.getTypeAtLocation(node);
  return (type.isUnion() ? type.types : [type]).map((t) => (t.isStringLiteral() ? t.value : `<${checker.typeToString(t)}>`));
};
const section = (e) => {
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) &&
      e.expression.name.text === 'getConfiguration' && e.expression.expression.getText() === 'vscode.workspace')
    return literals(e.arguments[0]).join('|');
  const d = ts.isIdentifier(e) ? checker.getSymbolAtLocation(e)?.valueDeclaration : undefined;
  if (d && (ts.isVariableDeclaration(d) || ts.isParameter(d)) && d.initializer) return section(d.initializer);
  return '?';
};
const rows = [];
for (const sf of program.getSourceFiles()) {
  const rel = path.relative(root, sf.fileName);
  if (!rel.startsWith('src/') || rel.startsWith('src/test/')) continue;
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.arguments[0]) {
      const name = n.expression.name.text;
      const at = `${rel}:${sf.getLineAndCharacterOfPosition(n.expression.name.getStart()).line + 1}`;
      if (['get', 'inspect', 'update', 'has'].includes(name) &&
          /WorkspaceConfiguration/.test(checker.typeToString(checker.getTypeAtLocation(n.expression.expression))))
        rows.push([at, name, section(n.expression.expression), literals(n.arguments[0]).join('|')]);
      if (name === 'affectsConfiguration') rows.push([at, 'affects', '', literals(n.arguments[0]).join('|')]);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
if (process.env.ROWS) fs.writeFileSync(process.env.ROWS, rows.map((r) => r.join('\t')).join('\n') + '\n');
const declared = JSON.parse(fs.readFileSync('package.json', 'utf8')).contributes.configuration.flatMap((g) => Object.keys(g.properties));
const reads = rows.filter((r) => r[1] !== 'affects');
const read = new Set(reads.filter((r) => r[2] === '?' || /^deckard/.test(r[2]))
  .flatMap((r) => r[3].split('|').filter((k) => !k.startsWith('<')).map((k) => `${r[2] === '?' ? 'deckard' : r[2]}.${k}`)));
console.log('calls', rows.length, '| get/inspect/update/has', reads.length, '| affectsConfiguration', rows.length - reads.length);
console.log('declared', declared.length, '| distinct deckard keys read by a literal or literal-union key', read.size);
console.log('read, not declared', [...read].filter((k) => !declared.includes(k)));
console.log('declared, no literal read (resolve by hand)', declared.filter((k) => !read.has(k)));
console.log('non-literal keys (resolve by hand)', reads.filter((r) => r[3].includes('<')).map((r) => r[0]));
console.log('section not literal, taken as deckard (check by hand)', reads.filter((r) => r[2] === '?').map((r) => r[0]));
console.log('other sections', reads.filter((r) => r[2] !== '?' && !/^deckard/.test(r[2])).map((r) => `${r[0]} ${r[2]}.${r[3]}`));
console.log('affectsConfiguration keys that are not declared settings', [...new Set(rows.filter((r) => r[1] === 'affects').map((r) => r[3]))].filter((k) => !declared.includes(k)));
EOF
```

At 1805a01 it prints 221 calls, 68 keys read by a literal key, and five declared keys to resolve by hand (the three period templates and the two `editor.*` keys that `editorReferences.ts` builds), which gives 73. The helper callers credited in the Writes column come from:

```sh
grep -rnE "(writeSetting|settingTarget|settingPlace|zenModeTarget)\(" src --exclude-dir=test
grep -rnA1 -E "writeSetting\($" src --exclude-dir=test
grep -rn "readTaskMetadataFormat(" src --exclude-dir=test
```

`when` clauses and context keys (section 4). The first script counts clauses and the keys they use. The second lists every setter.

```sh
node - <<'EOF'
const fs = require('fs');
const contributes = JSON.parse(fs.readFileSync('package.json', 'utf8')).contributes;
const clauses = [], events = [];
const walk = (o, at) => {
  if (Array.isArray(o)) o.forEach((x) => walk(x, at));
  else if (o && typeof o === 'object')
    for (const [k, v] of Object.entries(o)) {
      if ((k === 'when' || k === 'enablement') && typeof v === 'string') clauses.push([at, v]);
      else if (k === 'completionEvents') events.push(...v);
      else walk(v, at ? `${at}.${k}` : k);
    }
};
walk(contributes, '');
console.log('when/enablement clauses', clauses.length, '| literally false', clauses.filter(([, v]) => v === 'false').length);
const keys = {};
for (const [at, v] of clauses) {
  // Drop right-hand values of ==, !=, =~ so a view id or a viewItem is not taken for a key.
  const bare = v.replace(/(==|!=)\s*[^\s&|)]+|=~\s*\/(?:\\.|[^/])*\/\w*|'[^']*'/g, ' ');
  for (const key of new Set(bare.match(/[A-Za-z_][\w.-]*/g) ?? []))
    if (!['in', 'not', 'true', 'false'].includes(key)) (keys[key] ??= []).push(at);
}
for (const e of events) { const k = /^onContext:(.+)$/.exec(e)?.[1]; if (k) (keys[k] ??= []).push('walkthroughs.completionEvents'); }
for (const [k, uses] of Object.entries(keys).sort()) console.log(k, uses.length);
EOF
node - <<'EOF'
const fs = require('fs'), cp = require('child_process');
const files = cp.execSync("find src -type f -name '*.ts' -not -path 'src/test/*' | sort", { encoding: 'utf8' }).trim().split('\n');
const text = Object.fromEntries(files.map((f) => [f, fs.readFileSync(f, 'utf8')]));
const consts = {};
for (const t of Object.values(text)) for (const m of t.matchAll(/const (\w+) = '(deckard\.[\w.]+)'/g)) consts[m[1]] = m[2];
const line = (t, i) => t.slice(0, i).split('\n').length;
const setters = [];
for (const [f, t] of Object.entries(text)) {
  for (const m of t.matchAll(/(?:executeCommand|execute)\(\s*'setContext',\s*([^,\s]+)/g))
    setters.push([m[1].startsWith("'") ? m[1].slice(1, -1) : consts[m[1]] ?? `<${m[1]}>`, `${f}:${line(t, m.index)}`, m[1].startsWith("'") ? 'literal' : 'indirect']);
  for (const m of t.matchAll(/this\.update\('(deckard\.[\w.]+)'/g)) setters.push([m[1], `${f}:${line(t, m.index)}`, 'ActiveNoteContext']);
}
for (const s of setters.sort()) console.log(s.join('\t'));
const keys = new Set(setters.map(([k]) => k).filter((k) => k.startsWith('deckard.')));
console.log('distinct keys set', keys.size, '| literal', new Set(setters.filter((s) => s[2] === 'literal').map(([k]) => k)).size);
EOF
grep -rhoE "'setContext', 'deckard\.[A-Za-z.]+'" src --exclude-dir=test | sort -u
grep -rn "contextValue" src --exclude-dir=test
```

Command re-entry (section 5). The first line gives the plan's single-line count of 18; the script gives 21 with calls that span lines, then lists every `executeCommand` with its first argument so the constants, templates, maps, and runners can be resolved by hand.

```sh
grep -rhoE "executeCommand\('deckard\.[A-Za-z.]+'" src --exclude-dir=test | sort -u | wc -l
node - <<'EOF'
const fs = require('fs'), cp = require('child_process');
const files = cp.execSync("find src -type f -name '*.ts' -not -path 'src/test/*' | sort", { encoding: 'utf8' }).trim().split('\n');
const literal = new Set();
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  for (const m of t.matchAll(/executeCommand\(\s*'(deckard\.[\w.]+)'/g)) literal.add(m[1]);
  for (const m of t.matchAll(/executeCommand\(\s*([^,)]+)/g))
    if (!m[1].startsWith("'setContext'")) console.log(`${f}:${t.slice(0, m.index).split('\n').length}\t${m[1].trim().replace(/\s+/g, ' ')}`);
}
console.log('distinct literal deckard ids', literal.size);
EOF
grep -rnE "command: *['\"]deckard\.|command: *[A-Z_]+_COMMAND|\.command = [A-Z_]+|enabledCommands|command:deckard\.|createTagCommandUri\('deckard" src --exclude-dir=test
grep -n "run('deckard" src/ui/commands/tryNext.ts
```

Webviews and views (section 6):

```sh
grep -rnE "registerWebviewPanelSerializer|createWebviewPanel|registerTreeDataProvider|createTreeView|registerWebviewViewProvider" src --exclude-dir=test
node -e "const c=require('./package.json');console.log(c.activationEvents);console.log(JSON.stringify(c.contributes.views));console.log(c.contributes.languageModelTools.map(t=>[t.name,t.when]))"
```

File bindings (section 7):

```sh
node -e "const fs=require('fs');const t=fs.readFileSync('package.json','utf8');const walk=(o,p)=>{if(Array.isArray(o))o.forEach((x,i)=>walk(x,p+'['+i+']'));else if(o&&typeof o==='object')for(const[k,v]of Object.entries(o))walk(v,p+'.'+k);else if(typeof o==='string'&&/^\.?\/?(src|dist|resources|syntaxes|docs)\//.test(o))console.log(p,o,fs.existsSync(o.replace(/^\.\//,''))?'exists':'MISSING')};walk(JSON.parse(t),'')"
grep -rnE "joinPath\((this\.)?(context\.)?extensionUri|__dirname|packageJSON" src --exclude-dir=test
```

Traps (section 8):

```sh
grep -rnE "readFileSync|readdirSync|statSync|__dirname" src/test | grep -v "src/test/fixtures/"
grep -rhoE "\.\./\.\./out/[A-Za-z/]+\.js" test | sort -u
grep -oE "load\('[^']+'\)" test/perf/indexSpeed.js | sort -u
```
