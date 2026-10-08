# 29 · Simplification and focus

Three review rounds and two audits looked at Deckard's features, its pages and Zen mode, after a run of releases (2.0.0 to 2.4.0) added many surfaces. The finding: Deckard's controls all carry the same weight, a few jobs are duplicated, and Zen hides counts and dates while keeping every button. This plan applies the result. The review, with its mockups, is https://claude.ai/artifact/CXwinaqv8rmiDRUeE2VynW (David, 2026-10-07); this document is the spec the build follows.

## Rules

- **One action model on every page, at every display level.** Global navigation in DECKARD ▾ at the left; at most one filled `.primary` (only for an action that commits something), up to three secondaries and one ⋯ at the right; per-row actions revealed on hover or focus.
- **Zen quiets, never removes.** Zen keeps the page bar and every count, date and state line, and quiets the rest in place: drawn at opacity 0 and revealed where it stands on hover or focus of its area. Nothing leaves the DOM, the tab order or the accessibility tree, and nothing moves into ⋯.
- **Judged on merit.** Each item weighs the reader's benefit against its cost. Churn and new UI are costs, never vetoes.

## Decisions

- **Card details on hover: in flow or overlay.** A reserved line under each card's date, revealed on hover or focus, and used only when at least one card detail is switched on. With nothing switched on, no space is reserved.
- **Remove the 15 per-feature editor switches.** Keep the 15 editor switches visible.
- **Where Quiet readers land when the display scale collapses.** Map Quiet to Zen on.
- **Customize Home's visible door.** A ⋯ row plus a quiet 'Customize' text link beside the Home | Tags tabs.
- **Line 1: one problems lens, or round 2's quieter line.** 'Linked from N' plus one problems lens.
- **Table ranking: pointer drag now or later.** Ship drag with keyboard ranking if the fix stays small; otherwise keyboard first. List doesn't go until the Table can rank.
- **Builder.** A labeled addon with a hammer icon, joined to the start of the search field (the input-group pattern GitHub uses for Filters). Pressed while open; the builder opens under the field.
- **Refine.** Keeps its own box. With the Context sidebar open, the page draws no Refine section; the tag page's lead lines and the Nothing matched recovery stay, since the sidebar does not show them.

## Order of work

### 1. Evidence and fixes, nothing moved between surfaces (next minor)

First the evidence: hide #layout-probe in the visual pass (it shows in corpo+zen-taskBoard, corpo+zen-calendarPage and others), regenerate the baselines, and recount with the per-row rule.

Then the fixes:
- R1: Search and Clear go, and Save stays put.
- R2: .primary.
- R5, part 1: Zen shows counts and dates.
- R9: .help-text, EmptyState, note text never transformed, the Help h1.
- R11: Month/Week once, plus the shared reveal rule for Next day, the card ⋯ and the row ⋯, with R24 (b)'s sheet asserts for it.
- R20: widget titles become links.
- R12: Context icon-row default, customizeHome state removed.
- R13 (part): collapsed for new installs.
- R17: the reserved details line, used only when details are switched on.
- R19 (parts): grid fix, Esper toast, notice order.
- R6 (parts): Refactor heading action, task actions in notes only, Writing text.
- R8 (parts): copyMcpSetup gating, Unpark gated on something parked.

*Why:* These answer David's complaint quickly. The primary stands out once Search loses its fill, and the per-card and per-row buttons leave the board and the Calendar at rest. Each change is small and moves nothing into a new place. The reveal rule gets a release of use at Full before Zen builds on it.

### 2. One release: settings, removals and the page bar (R25)

- Settings and removals:
  - R5: deckard.display.zen, 11 display settings become 4, Enter/Leave Zen hidden from the palette, Quiet mapped to Zen on.
  - R6: the Off preset, with the switches kept, and line 1 with 'Linked from N' and the problems lens.
  - R8: palette hides, the Favorites manager, Start here, empty sections removed.
  - R16: names and tasks.viewQuery.
  - R7: catalog 21 to 14, with stored-widget migration.
  - R13: day panel and Weekends pair removed.
  - R15: Graph tuning deleted.
  - R19: Story Tour removed, sample moved to a fixture.
- The Table and List:
  - R21: the Table ranks in Rank order.
  - Then R4 removes List.
- The page bar:
  - R3: shared page bar and ⋯, key sheet on the Search page, Graph eyebrow, Customize Home as a ⋯ row and a quiet link, sidebar-open baselines.
  - R4: Add task primary, Board | Table, Group select, column + header icon, Done fits.
  - R10: hub link, Export into ⋯, Sort placement.
  - R14: one note-action table, daily ‹ › gated on the preset.
  - R18: sidebar title icons and welcome views.
- Zen:
  - R22: Zen reveal regions and the keep marker.
  - R23: Refine and Graph folds.
  - R24: the full contract test and the docs/zen-mode.md and themes-and-zen.md rewrites.
- One movedSettings carry, one notice, and one Highlights section that names each moved family and describes the final layout.

*Why:* Steps 2 and 3 of round 2 depend on each other. The Zen checkbox needs ⋯, and Board | Table needs the bar. Zen's reveal regions sit on the same markup and baselines as the bar. Shipping them together means no interim UI, one round of 'where did X go', and one review by David before the full suite runs once.

### 3. Follow-up, only if needed

R21's pointer drag on Table rows, if it was deferred. Nothing else is planned.

*Why:* This keeps the combined release from waiting on the one uncertain piece of work, the <tr> drag ghost, without losing the keyboard ranking that List's removal depends on.

## Recommendations

### R1. Query bars lose Search and Clear

*Problem.* In Corpo, the blue-filled Search button is the loudest control on Home, the Search page and the Task Board, although the hint says Enter searches. Clear shows even when there is nothing to clear.

At every display step, remove the Search and Clear buttons. Add a small → glyph at the right end of the field that keeps data-action=apply-query. Add an × that appears only when canClear() is true. Remove .query-apply's fill in both rules, so the page's real .primary (R2) is the only fill. Attach Builder to the start of the field as a labeled addon (a hammer icon, drawn as a new StrokeIcon in shared/strokeIcons.tsx, plus the word 'Builder'), the input-group pattern GitHub uses for 'Filters' beside its issue search. It keeps its label, shows a pressed state while the builder is open instead of swapping its text to 'Hide builder', and the builder panel opens directly under the field. It is part of the field group, so it stays drawn under Zen. Save stays where it is until the page bar (R3) gives it a ⋯ row. Update search.md:27 and search-pages.md:10 and write one Highlights bullet.

*Evidence.* corpo-taskBoard.png, corpo-searchPage.png, corpo-dashboardHome.png and their +zen versions (a filled Search on each); queryEditor.tsx:629, :666-671; themes/corpo.css:88

### R2. One .primary class on the --chosen pair, only for actions that commit

*Problem.* Three idioms mean 'primary' and none is right. .query-apply makes Search the de facto primary, Task Statuses' Save uses an unstyled .is-primary, and Home borrows the selected-segment .active.

Rename .query-primary to one .primary in shared/control.css (background var(--chosen-bg), color var(--chosen-fg), with a darker 1px border in Fellowship). Assign it to:
- Task Board Add task
- Tasks-view edit mode Save to Tasks view
- Task Statuses Save
- the Calendar day panel's Create, only while no daily note exists
- Get Started's 'Create today's note', only while the workspace has no notes

Nothing else gets it. Add a test that a drawn page has at most one .primary, and add .primary to contrast-shapes.json for every theme.

*Evidence.* queryEditor.css:70-71; designTokens.css:80-87; themes/corpo.css:24-25; taskStatuses/main.tsx:254; home.tsx:100; widgetBodies.tsx:37; dayPanel.tsx:126-141; corpo-taskStatuses.png

### R3. One shared page bar: one ⋯ replaces the gear and ?; Customize Home becomes a ⋯ row and a quiet link

*Problem.* Each page builds its own utility row. Theme, Page width and Display are copied into every gear. Home has no ?, the Graph has no header, and the Search page splits the gear and ‹ › ? across two rows. On Home, the only bordered button in the tab row is Customize Home, an occasional setup action drawn at the same weight as the tabs, and the gear's 'Home: Customize' row is a second door to the same thing.

Build one shared page bar:
- On the left, DECKARD ▾ (navigation only) and the title.
- On the right, at most one .primary, up to 3 secondaries, and one ⋯ that replaces both the gear and ?.

Build ⋯ by extending the ViewOptions popover. Its rows are flat and grouped in this order:
1. page actions
2. View rows
3. Appearance (Theme…, the Zen checkbox, Page width where it applies)
4. 'Help on this page'
5. 'Keyboard shortcuts ?' on pages with a key sheet

Install the key sheet on the Search page too, and list '/' only where a search box exists. The tooltip and aria-label of ⋯ name the page's top rows.

Per page:
- **Notes Graph:** gains the eyebrow and ⋯.
- **Stats:** Reindex goes into ⋯.
- **Home:** the first ⋯ row is 'Customize Home…', followed by Walkthrough. The bordered button in the tab row and the gear's 'Home: Customize' row both go. An unbordered 'Customize' text link stays at the right of the tab row as the visible door (your decision). The empty-grid 'Customize' link (home.tsx:111) and Get Started stay. The in-page Add widget / Reset / Finish bar while arranging is unchanged.

The bar is identical with Zen on and off (R22), and Zen's contract is R24. Add sidebar-open baselines for Search, Board and Calendar with this change. Update home-and-stats.md:15 and :55. Announce the changes with Highlights bullets only.

*Evidence.* shared/viewOptions.tsx:1-38; actionMenu.tsx (flat groups only); goToMenu.ts:83-99; keySheet.tsx:18-26; dashboard/header.tsx:39-46 (gear row), :104-106 (bordered button); home.tsx:111 (empty-grid Customize link); commit 6b004d5e; corpo-dashboardHome.png and corpo+zen-dashboardHome.png (Customize Home bordered at tab weight)

### R4. Task Board: Board and Table, Add task primary, column + visible at Full

*Problem.* The bar has five equal buttons, and the filled Search outranks Add task. Grouping takes 5 buttons, the layout switch is hidden in the gear, and List repeats the Tasks view and the Search page's Tasks tab. The Done column is clipped at 1400 px.

Remove the List layout, but only once the Table ranks in Rank order (R21), so the one global rank keeps a flat view.

Page bar: Add task as .primary, then ⋯. The ⋯ holds Save search…, List in Tasks view and Export tasks… as flat rows, plus View rows (Show parent tag, Status columns…, Columns… for Table). Tasks-view edit mode keeps Save to Tasks view as its primary.

Status row: the hint (Builder is now attached to the field, R1), a visible Board | Table segment, Group as one compact select, the Sort select and Can start now.

Columns:
- Each column's '+' becomes a small header icon that is always visible at Full. Under Zen it is revealed on column hover or focus (R22).
- Done never gets a +.
- The reason it stays visible at Full: it is the only one-step add into Waiting, Blocked and the other columns (there is no n key), and a first-time reader can't discover a button they never see.
- Give columns a narrower minimum width so Done fits at 1400 px.

The card ⋯ follows R11's reveal at every step.

Result: 22 controls become 16, counted the same way as today's 22, where each segment member counts as one.

*Evidence.* corpo-taskBoard.png and corpo+zen-taskBoard.png (22 controls; 5 '+ Add task'; Done clipped); taskBoard/main.tsx:107-115, :157-166; board.tsx:266-268, :325-335; boardMoves.ts:521-540 (no n key); layouts.tsx:29-31

### R5. Zen: one switch; never removes or moves a control, never hides data

*Problem.* Display is over-built: 3 steps, 7 'auto' sub-settings, a Reset/Customize line in every gear, a previewing Choose Display… picker and a remembered beforeZen step. The palette shows two Zen rows at a time. Zen also hides real data: facet, tab and column counts, '40 · 6 overdue', and the absolute due date.

Step one is the one-line fix: STEP_VALUES.zen gets counts:'shown' and dates:'both'.

Then, in the single migration release (R25):
- Replace display.level and its 7 sub-settings with deckard.display.zen through the existing movedSettings carry, with one notice. Both Quiet and Zen map to Zen on (your decision).
- Remove Choose Display…, the Reset/Customize line, beforeZen, and the counts and dates selectors.
- Keep cardDetails, dateFormat and shortDateFormat. That takes 11 display.* settings to 4.
- Give enableZenMode and disableZenMode commandPalette when:false, and keep them as the when-swapped title-bar pair.
- In pages, Zen is one checkbox in ⋯ Appearance.

Contract: Zen never removes or moves a control. It hides only by the in-place reveal rule or an in-place fold (R22, R23), and the contract test is R24. The three Display-row tests (:176, :184, :197) are rewritten.

Keep the name, and add one sentence to themes-and-zen.md separating it from VS Code's Zen Mode.

*Evidence.* src/ui/state/displayLevel.ts:43-56 (zen counts 'hidden', dates 'relative'); zenMode.ts BEFORE_ZEN_KEY; package.json:717-730 and the enable/disableZenMode editor/title pair; corpo-taskBoard.png vs corpo+zen-taskBoard.png (counts and absolute dates gone, all 22 controls kept)

### R6. Editor: the preset gains Off, the switches stay, and one problems lens on line 1

*Problem.* The Editor section has 18 settings. Line 1 of a note can stack up to 7 lenses, and a missing link is reported three ways. The heading action is a QuickFix with no diagnostic, so a lightbulb shows on ordinary headings, and task code actions appear in any .md file. Round 2's fix removed the link-problem and mention lenses outright. That left no in-note signal for unlinked mentions while the Context sidebar is closed, and no in-note bulk 'Create missing notes'.

Settings:
- Keep deckard.editor.preset with Full, Tasks, Writing and a new Off.
- Keep the 15 per-feature switches and highlightNoteSections visible in Settings, as overrides of the preset (your decision). The section stays at 18 settings.
- Make each switch's description say it overrides the preset, and fix their Settings UI defaults so a switch the preset turns off doesn't show as on.

Line 1:
- Keep navigation (a breadcrumb, or daily ‹ › with 'Carry in N' on today's note) and hub progress on hubs.
- Keep 'Linked from N' as its own one-click lens.
- Replace the four problem lenses ('N links open no note', 'Create N missing notes', 'Mentioned in N notes without a link', 'Link N mentions') with one problems lens, drawn only when there is a problem, for example '2 missing · 4 unlinked'.
  - With one kind of problem, it does what today's lens does.
  - With two, it opens a QuickPick with each fix: Show broken links, Create missing notes, Show unlinked mentions, Link mentions.
- The preset governs it as one group.
- The missing-link diagnostic and its 'Create note' quick fix stay.
- editor-lenses.md names Context's 'Mentioned without a link' group (with Link all) as the fuller view.

Code actions:
- The heading action becomes Refactor.
- Task actions are offered only where deckard.isNote holds.

Text: fix the Writing enumDescription, and rewrite docs/editor-lenses.md.

*Evidence.* editorLenses.ts:76-85, :336-388, :425-458; editorReferences.ts:136-146; editorPresets.ts:11-27, :40-44; sidebarNotes/links.tsx:117-122 (Context's 'Mentioned without a link' with Link all); docs/editor-lenses.md:11

### R7. Home widget catalog: 21 kinds to 14

*Problem.* Home offers 21 widget kinds, several repeating other surfaces: Workspace (Home tiles and Stats), Related notes (Context), Quick add (Add Task works anywhere since 2.4.0), and three tag-cleanup widgets that Stats covers.

Delete Workspace, Related notes, Quick add, Tags written together, Tags without a hub and New tags. Convert stored Stale tasks widgets into Tasks widgets holding the equivalent 'updated' search, sorted Least recently updated, after confirming that a task's updated date matches what Stale tasks uses. Keep Tasks view, Saved search results (it lists notes) and the tag and search pairs as separate kinds. Name the deleted kinds in the migration release's Highlights. Add migration and catalog tests.

*Evidence.* widgetCatalog.ts:49-71; widgetBodies.tsx:56-87, :243-285; preferencesSchema.ts:115-123; stats/attention.tsx:125; stats/tagUse.tsx:49; hubs/register.ts:37-61

### R8. Palette and Settings: hide true duplicates, one Favorites manager row, Unpark only when something is parked

*Problem.* Several always-visible palette rows duplicate Find, the / menu or a page button. Four rare Favorites maintenance rows and two Unpark rows show in every palette browse, even with nothing parked. Copy MCP Server Setup is hidden until the server is on, although the guide tells readers to run it to turn the server on. Settings has two empty sections.

Palette:
- Hide (when:false, still callable): mergeTag, showNotesGraphAroundNote, insertQueryBlock, importObsidianStatuses, openDailyNoteForDate, showTagOverview, linkCurrentHeading, showEntryRelatedNotesDebug, and Enter/Leave Zen (R5).
- Remove createSampleWorkspace (R19) and chooseDisplay (R5).
- Add one 'Deckard: Manage Favorites, Pins, and Searches…' QuickPick of Tidy…, Export…, Import… and Restore from a Copy…. Each runs today's command, and those four commands get when:false.
- Set deckard.hasParkedFolders and deckard.hasParkedTags from the parked settings, and show unparkFolder and unparkTag only while they are true.
- Keep openWhatsNew, createHubNoteForTag and moveTagsToFrontmatter visible.
- Gate copyMcpSetup on config.deckard.assistantTools.
- Merge no toggle ids.

Settings:
- Add 'Start here' (notesFolder, theme, me, periodicNotes.folder).
- Delete the empty Related Notes and Outline sections.
- Keep shortDateFormat and both calendar exports, and fix shortDateFormat's 'Pages view' text.

Update commands.md and Help's 'every palette command has a row' test.

*Evidence.* package.json:734-754 (tidy/export/import/restorePreferences with no when); park/unpark folder and tag on workspaceFolderCount > 0; parkNote/unparkNote on deckard.activeNoteParked; services.ts:298, :1121 (Tidy runs after update); package.json:1036 (copyMcpSetup); docs/guide/commands.md:27-34

### R9. What Zen quiets: one .help-text class, one EmptyState component, plain type, note text never transformed

*Problem.* Zen's hint hiding matches only three selectors, so many teaching lines still show. Empty states mix state and teaching in one string across 19 .empty sites and 8 other classes. Styled themes upper-case the reader's own text. Under Cooper Zen, buttons and tabs still shout, and in Help under Zen the h1 is smaller than the h2.

Hint lines:
- Add one .help-text class and hide it with body[data-help=hidden] .help-text {display:none}.
- Tag the missed lines.
- Never put .help-text on a control, on an element that contains one, or on .query-error.

Empty states:
- Add a small shared <EmptyState state teach action/> (about 15 lines). It draws the state line, which always shows, an optional .help-text teaching line, and at most one next-step button.
- Route every site R9 touches through it, and test the component, not each site.
- Impose no copy template.
- The board's empty-column teaching line becomes 'Drag a card here, or right-click one.' (R11).

Note text: never transform or letter-space text rendered from the reader's notes, at any step or theme.

Zen typography: under Zen, body[data-styling=plain] * gets text-transform:none and letter-spacing:normal. Cooper at Full keeps its caps.

Fix Help's Zen h1/h2 sizes.

*Evidence.* display.css:44-45, :61-64; grep of src/webview (19 class="empty", plus board-empty, home-widget-empty ×3, query-facets-empty ×3, note-empty, pages-empty, views-empty, empty-state); board.tsx:309; layouts.tsx:50-53, :67; corpo+zen-taskBoard.png (three empty-column sentences); cooper+zen-taskBoard.png; cooper+zen-help.png

### R10. Search page: Export joins Save in ⋯; Bulk edit stays by its pane; Create hub note is a link

*Problem.* Create hub note is drawn as a bordered button right under the title. Sort hides in the gear although it orders the Notes list. Bulk edit and Export are drawn beside every pane, twice on one line in Side by side, and Export is rare and output-only. Context's Related sort is a full-width select.

- **Create hub note:** draw it as a text link under the title, only on a tag page with no hub, and never in ⋯. Under Zen it stays drawn, because it signals that the tag has no hub.
- **⋯ page-action rows:** 'Save search…', 'Export notes…' (when there are note results) and 'Export tasks…' (when there are task results). That matches the board's Export in ⋯ (R4).
- **Bulk edit:** stays beside the pane heading it acts on (the tab row in Tabs, each pane header in Side by side), as a small quiet button. Under Zen it is revealed on the results heading.
- **Refine with the Context sidebar open:** the page draws no Refine section, not even an 'In the Context sidebar' line, since the reader can see Refine in the sidebar. Two things stay on the page because the sidebar doesn't show them: the tag page's lead lines (look-alike tags, and 'N entries mention "x" without the tag' with Show them), drawn as a plain line under the search card, and the 'Nothing matched' recovery. The match count is already screen-reader-only in this state (queryEditor.tsx:738) and stays that way.
- **Sort:** moves out of the gear onto the results row beside Notes | Tasks, shown with the Notes results.
- **Context:** the Related select becomes a compact 'Sort:' select at the Related notes heading.
- **Progress line:** stays.

Update search-pages.md and write a Highlights bullet.

*Evidence.* searchPage/results.tsx:84-98, :118-130 (PaneActions per pane); header.tsx:49-61, :183-185; hub.tsx:189 (Bulk edit tip); corpo-searchPage.png and corpo+zen-searchPage.png (bordered Create hub note; Bulk edit and Export notes); corpo-searchPageGrouped.png; corpo-sidebarNotes.png

### R11. One reveal rule for every row action: Next day, the board card ⋯ and the Table row ⋯

*Problem.* The Calendar's day panel draws a labeled Next day button on up to 10 rows. The board draws a ⋯ on every card at every step, about 21 in the baseline and about 50 on a full board, although right-click and Shift+F10 already open the same menu. Month/Week is drawn in the header and again in the gear.

Calendar:
- The header reads ‹ Today › Month | Week ⋯. Remove Layout from the gear, and put Show weekends in ⋯.
- Keep the m and w keys.
- The move button keeps its labels and meaning: 'Tomorrow' on today or a past day, 'Next day' on a future day. It moves the row's own due or scheduled field.

One shared reveal rule, `[data-reveal]` inside `[data-reveal-region]`, modeled on .insert-link:
- It draws a control at opacity 0 at rest, and shows it on region :hover, :focus-within, its own :focus-visible, or while [aria-expanded=true]. It always shows under @media (hover:none) and on [data-reveal-keep].
- It applies at every step to .day-move, the board card ⋯ (.board-move) and RowMenuButton on Table rows (and List rows until List goes).
- The card ⋯ keeps tabindex=-1, Shift+F10, the menu key, Alt+Enter and right-click. The Table row ⋯ stays a tab stop.
- Zen adds its own regions on top of this rule (R22).

Add contrast and visual coverage for the revealed state. The key sheet lists Shift+F10. Add no new row menus.

*Evidence.* calendarPage/view.tsx:51-53, :60-70; dayPanel.tsx:25-47; calendarState.ts:56-69; taskBoard.css:110-127 (.board-move always drawn); board.tsx:207-215 (tabindex -1, aria-haspopup, aria-expanded); boardMoves.ts:714-720 and taskBoard/main.tsx:494-503 (right-click opens the same menu); layouts.tsx:16-27; sidebarNotes/notes.css:95-97; corpo-taskBoard.png, corpo+zen-taskBoard.png (a ⋯ on every card), corpo-calendarPage.png (10 Next day)

### R12. Context: the icon row by default; only the customizeHome state goes

*Problem.* Context opens with 8 labeled page rows plus a gear, about 210 px of a 700 px sidebar, with truncated hints. Whenever Home is merely in front, Context swaps to the widget catalog, which '+ Add widget…' already provides.

Change readPagesStyle's default from 'list' to 'icons' for readers who never chose, with hints in tooltips and aria-labels. The rows form stays in the band gear. Add no view-title icons, because VS Code draws them only on hover by default, so they could not replace a route that is visible at rest. Remove Context's customizeHome state. Keep the Refine and calendar-day handoffs, because without them Context shows only 'Open a Markdown note…' whenever a page is in front, and the board and Calendar would lose width. Update getting-started.md 'Finding your way'.

*Evidence.* src/ui/state/contextPages.ts:14-16; pages.tsx:52-57; corpo-sidebarNotes.png and corpo+zen-sidebarNotes.png vs corpo-sidebarNotesCalendarDay.png; sidebarNotesController.ts:684-700, :793-797; dashboardController.ts:280-287

### R13. Sidebar Calendar: keep the month, drop its day panel, start collapsed

*Problem.* A day's list can be drawn in three places. The sidebar view carries its own Day Panel and Weekends title pairs and a click mode that changes what a click does, and it starts expanded.

Remove the sidebar view's day panel, openDayPanel/closeDayPanel and the view-title Weekends pair. Weekends is one shared choice set from the Calendar page's ⋯. Keep deckard.calendar as a month grid where a click opens that day's note, a week mark opens the weekly note and the month name opens the monthly note, with one inline title icon (Open Calendar page). Contribute it with visibility 'collapsed', which affects only new installs. One notice line in the migration release.

*Evidence.* package.json view/title 1_calendar entries and views (no visibility); preferencesViewChoices.ts:25; daily-notes.md:70-87; corpo-calendar.png

### R14. One note-action table; daily ‹ › in the title bar only when the lens is off

*Problem.* Note Actions and the right-click Deckard submenu list different things. A daily note shows up to four Deckard title-bar icons, and ‹ › repeat the daily-note lens.

Build Note Actions, the right-click Deckard submenu and the Note page's ⋯ from one table in one order. Show previousDailyNote@10 and nextDailyNote@11 only when deckard.editor.preset turns the daily-note lens off (Writing or Off), through one context key. Keep openNotePage@13: it is a note's reading-mode switch, the same kind of action as VS Code's Markdown Preview icon. A daily note in Full drops from four icons to two.

*Evidence.* package.json editor/title @10-@13; deckard.editor.context (15 entries); noteActions.ts:38-65; editorPresets.ts:43

### R15. Notes Graph: delete the physics tuning

*Problem.* With every group open, the Graph's panel has about 43 controls, including 6 Forces sliders, an Advanced group and four paragraphs of Relationships prose.

Delete Forces and Advanced and fix their values at today's defaults. Display keeps Node size, Links per note and Headings, and drops Link thickness and Label fade zoom. Reword the Headings 'By zoom' tooltip (controls.tsx:415) and connections.md:80, which name Label fade zoom, so they describe the fixed zoom. Move the Relationships prose to Help. Show Clear filters only while a filter is set. Nothing migrates, because the values are webview setState. The eyebrow and ⋯ come with R3, and the Zen folds with R23.

*Evidence.* notesGraph/settings.ts:15-39; controls.tsx:141-154, :366-391, :413-415, :424-460; docs/guide/connections.md:80; corpo-notesGraph.png, corpo+zen-notesGraph.png

### R16. One name per surface

*Problem.* Home is 'Open Dashboard', 'Deckard Dashboard', 'Dashboard: Home' and 'Home' in different places, and the guide still names removed surfaces.

Use 'Open Home', the tab 'Deckard Home', the header 'Home' and the guide title 'Search pages', with 'Dashboard' kept as a palette keyword. Rename deckard.agenda.query to deckard.tasks.viewQuery through the one-time carry. Command ids stay. Fix connections.md:70, getting-started.md:26, home-and-stats.md:5, settings.md:67 and themes-and-zen.md:74.

*Evidence.* package.json showDashboard; dashboardHtml.ts:21; dashboard/header.tsx:72; corpo-dashboardHome.png

### R17. Card details get a reserved line, shown on hover, only when details are switched on

*Problem.* On hover, the card-details line is drawn over the next row and hides its title and due date on Home, the board and search results.

When deckard.display.cardDetails has at least one detail ticked, every row and card keeps one line for its details under its date line, at every display level. The text is drawn at opacity 0 and shown on the row's hover or focus through the shared reveal rule (R11), and always under (hover:none). Nothing moves and nothing is covered.
- With nothing ticked, no space is reserved, and rows stay as compact as they are without details today. The file and line stay in the accessibility tree for screen readers, as the setting already promises.
- The line holds the ticked details in one line (file and line, then created, then updated), truncated with an ellipsis.
- Remove the overlay and its Escape dismissal from provenance.css, and rewrite its header comment.
- Add layout cases for details on and off, and close the open decision in docs/ux-fifteen-sources-plan.md:472.

*Evidence.* corpo+zen-dashboardHome.png (Board task 6's details cover the next row's date); corpo+zen-taskBoard.png (Later task 1 over task 2); provenance.css:1-15

### R18. Sidebar view chrome: two inline icons, welcome text about the view

*Problem.* The Tasks view's title shows 4 inline icons, two of which open the board. The Outline shows an eye pair, and its empty state and the Hubs welcome over-explain.

Tasks: Group by and Open Task Board stay inline. Edit What the Tasks View Lists… and Sort by… go to the view's ⋯. Outline: Filter by Tag and Collapse All stay inline, and Follow Cursor moves to ⋯ as the when-swapped pair. The Outline welcome becomes text only. The Hubs welcome becomes one sentence plus a 'Create Hub Note for Tag…' button.

*Evidence.* package.json view/title agenda.* and outline.* entries; viewsWelcome deckard.outline and deckard.hubs

### R19. First run: one sample, fewer toasts, Get Started without an empty grid

*Problem.* Two sample workspaces compete, up to four toasts can arrive together after a first index, and an empty Home draws Get Started above a grid of empty widgets.

Remove createSampleWorkspace and its docs rows, and move resources/sample into a test fixture. Remove the Esper Themes startup toast. Show at most one remaining notice per activation (status import or move, then the summary, then unknown statuses), and the status-tag notice once per workspace. Draw the widget grid only when totalNoteCount > 0 or while customizing.

*Evidence.* setup/register.ts:26-30; src/test/indexCorpus.ts:47; firstIndex.ts:96-141; esperThemes.ts:44-66; statusMove.ts:336-375; dashboard/home.tsx:90-104

### R20. A widget that leads somewhere makes its title the link

*Problem.* Linking widgets draw a separate bordered 'Tasks view →' or 'All tags →' button. In Corpo, widget titles are already drawn in link blue (--amber maps to the link color) but cannot be clicked, which is a false affordance beside a real button.

For widgets with an OPEN_LINKS destination (the Tasks view, Tasks, the tag lists, a saved search, Today), the h2 title becomes a text button with a trailing › ('Tasks view 53 ›'), with an underline on hover and a focus ring. The bordered 'X →' button goes. Widgets with no destination keep a plain title. While arranging, the title is plain, and the grip and controls keep the header. Under Zen the title link stays drawn, because it carries a count.

*Evidence.* widgets.tsx:24-27 (OpenLink draws a bordered 'label →'), :36-56 (OPEN_LINKS), :280-284; dashboard/page.css:128 (.home-widget-title color var(--amber)), :131; corpo-dashboardHome.png and corpo+zen-dashboardHome.png (blue 'Tasks view' title beside a bordered 'Tasks view →')

### R21. The Table ranks in Rank order, so List's flat ranking survives

*Problem.* There is one global rank, shared by the board, List and the Tasks view. canRank allows ranking only in List. Once R4 removes List, every remaining ranking surface is grouped, so a reader could no longer order all their open tasks in one list.

Register Table rows as a third rankedRows kind ({selector: '.result-table tr.result-row[data-task-id]', key: 'taskId'}). Extend canRank to the Table while it is in Rank order with no header sort, just as the board ranks only while sorted by Rank. Drag, Alt+↑/↓ and the rank menu then work as they did in List. With a header sort on, rows don't drag, and the 'Sort by rank' link is the way back.

Sequencing: List is not removed until at least Alt+↑/↓ and the rank menu work on Table rows. Pointer dragging ships in the same change if the <tr> ghost-width fix stays small; otherwise keyboard and menu ranking ship with List's removal and drag follows (your decision). Add tests for the table kind.

*Evidence.* shared/rankedRows.tsx:17-28, :222-233 (the placeholder is a row clone); taskBoard/main.tsx:277-282; layouts.tsx:29-31 (canRank is list and rank only), :57-112, :121-127 ('Rank order' label and 'Sort by rank' link); docs/guide/task-board.md:45, :50-51

### R22. Zen quiets controls in place under an unchanged page bar

*Problem.* On Corpo, today's Zen leaves all 22 Task Board controls, about 21 card ⋯ and 5 '+ Add task' standing, and drops the counts and absolute dates instead. That is the reverse of what David asked for. Zen differs from Full mostly in hint lines and spacing.

The full rules are in the zenModel. In summary:
- The page bar is identical with Zen on and off.
- Under the bar, a control is drawn at rest only if it is the query field and its →/chips, a content switch, a link that carries data (progress links, tiles, widget title links, Show N more, Create hub note), or a control whose value shapes the page. The renderer marks those `data-reveal-keep`: Can start now while pressed, an active progress link, a non-default Sort, a non-Relevance Related Sort, and week marks with a note.
- Everything else is revealed in place through R11's shared rule, with Zen-only regions:
  - the board's query card (Board | Table, Group, Sort, Can start now)
  - each board column (its +)
  - the Search results heading (Sort, Bulk edit)
  - Home's tab row (Customize)
  - Context's band (gear) and Related heading (Sort, gear)
  - Calendar week rows on both the page and the sidebar view
- A segmented group reveals as one unit. No [aria-pressed=true] override is used, because it would draw a lone chosen segment (board.tsx:333).
- Zen moves nothing into ⋯ and removes nothing from the DOM, the tab order or the accessibility tree.

Counts at rest, Full → Zen: Task Board 16 → 6, Search page 27 → 15, Home 12 → 11, Context 11 → 8, Notes Graph about 26 → 9 (with R23); the other pages are unchanged.
- Typing doesn't reveal: a region's :focus-within doesn't fire while focus is in its query field, so searching keeps the board at 6 controls (audit addition).

*Evidence.* corpo+zen-taskBoard.png (22 controls, about 21 card ⋯, 5 '+ Add task'; no column counts or absolute dates); corpo+zen-searchPage.png; corpo+zen-dashboardHome.png; corpo+zen-calendarPage.png (week icons, 10 Next day); corpo+zen-sidebarNotes.png; displayLevel.ts:52-55; sidebarNotes/notes.css:95-97; board.tsx:207-215, :325-335; searchPage/header.tsx:80-95

### R23. Under Zen, Refine and the Graph's Focus and Filters fold where they stand

*Problem.* Refine is the densest block on the Search page: 10 chips plus group labels, about 60 px on Corpo Zen. A Zen reader is there for the results. On the Graph, Focus and Filters are open by default, about 20 controls beside the canvas.

Refine:
- Refine becomes a <details> at every step, which keeps Full and Zen's control sets identical.
- Its summary reads 'Refine', plus '· N set' while facets are active.
- It is open by default at Full and closed under Zen.
- Open or closed carries across redraws from the DOM (the ViewOptions wasOpen pattern), with no new persisted state. Toggling Zen resets it to the new state's default.
- With the sidebar open, the page draws no Refine section at all (R10), so there is nothing to fold.
- Only the facet groups go inside the fold. The lead lines (look-alike tags, and 'N entries mention "x" without the tag' with its Show them button) and the match count ('N notes · N tasks') stay outside it, always drawn, so the fold never hides data.
- The Task Board's Refine uses the same facets() (taskBoard/main.tsx:236), so with a search applied the board gets the same fold under Zen.

Graph:
- Under Zen, Focus and Filters start closed, as Display already does.
- The Filters summary reads '· N set' while any filter differs from its default, and the Focus summary reads '· around this note' while the local graph is on, so a filtered or focused graph is never unexplained.

*Evidence.* queryEditor.tsx:755-786 (Refine is a <section>); notesGraph/controls.tsx:141-152, :244, :271 (ControlGroup is already a <details>; Focus and Filters open); shared/viewOptions.tsx:26; corpo+zen-searchPage.png (Refine at y≈236-295); corpo+zen-notesGraph.png

### R24. Zen's contract: nothing removed, nothing moved, everything reachable in place

*Problem.* The existing test asserts only that Zen draws the same control set as Full. Now that Zen hides controls at rest, nothing checks that a hidden control can still be found by mouse, keyboard and touch. docs/zen-mode.md still describes getZenCss and deckard.zenMode, which no longer exist.

zen-mode.test.ts:
- **(a)** Keep the identical-control asserts (renamed 'Zen keeps every control on the page') and add the Task Board and Calendar page.
- **(b) Sheet check:**
  - No Zen-scoped rule sets display:none or visibility:hidden on button, input, select, a, summary or [data-action].
  - Every opacity:0 rule has matching region :hover, :focus-within and :focus-visible reveals.
  - The [data-reveal-keep], [aria-expanded=true] and (hover:none) overrides exist.
- **(c) On each rendered page, Zen on and off:**
  - Every reveal target has an ancestor of its region.
  - No reveal attribute sits on a .segmented member.
  - No reveal target has tabindex=-1, with one explicit exception (the board card ⋯ and its Shift+F10 and right-click routes), checked at Full too.
  - No control has an ancestor with computed display:none or visibility:hidden, except a closed <details> with a drawn summary.
- **(d)** checkLayout.js's hover pass forces :hover on one element per surface only. Add the Zen region selectors as extra hover targets for the Zen passes in surfaces.js; (b), (c) and R11's contrast and visual coverage cover the rest.

Docs:
- Rewrite docs/zen-mode.md. 'Not in scope' becomes 'What Zen hides, and how it comes back'. Note that body.zen is a marker only (components.ts:93).
- Change themes-and-zen.md's 'Kept: every button…' line as the zenModel says.

*Evidence.* src/test/zen-mode.test.ts:121-133, :159-173, :235-246; src/ui/webview/components.ts:88-96 (zen class is a marker); checkLayout.js:223-228; docs/zen-mode.md; docs/guide/themes-and-zen.md:80-83

### R25. Ship the settings removals and the page bar as one release

*Problem.* Round 2's step 2 (settings and removals) and step 3 (page bar) depend on each other. R5 puts the Zen checkbox 'in ⋯ Appearance' before ⋯ exists, and R4 removes List while the layout row stays in the gear until step 3. Shipped apart, the same controls would move twice in consecutive releases.

Ship step 1 as planned. Then build round 2's steps 2 and 3, plus R22-R24, as one minor release with one movedSettings notice and one Highlights section that names each moved family and describes the final layout once. David chooses the interval.

*Evidence.* r2-final.json roadmap steps 2 and 3; R5 ('Display becomes one Zen checkbox in the ⋯ Appearance group'); R4 (Board | Table arrives with the page bar); CHANGELOG 2.0.0-2.4.0 (five releases in four days)

## Zen


`deckard.display.zen` (boolean) replaces `display.level` and its 7 sub-settings through the existing movedSettings carry with one notice (R5). It is opt-in. The default view is set by R1-R4, not by Zen.

### Zen: Layer 1: visual (unchanged from round 2, R9)
- Plain type in every theme: no text-transform or letter-spacing on chrome. Cooper at Full keeps its caps.
- `.help-text` lines are hidden.
- Compact density, flat cards, and tags as text.
- The reader's own note text is never transformed, at any step.

### Zen: Layer 2: data never hides
- Counts stay: '54 tasks', '40 · 6 overdue', facet counts and tab counts.
- Dates stay in full: 'overdue 5 days · 2026-09-16'.
- State lines ('No tasks.') and `.query-error` always show. They are drawn through the shared EmptyState component (R9).
- This ships first, as a one-line change: STEP_VALUES.zen gets counts:'shown' and dates:'both'.

### Zen: Layer 3: controls are quieted in place (R22)
**Never hidden:**
- The page bar: DECKARD ▾, the title, the one `.primary`, up to 3 secondaries and ⋯. It is identical with Zen on and off.
- The query field with its attached Builder, its → and its chips.
- Content switches: Notes | Tasks, Home | Tags, Month | Week.
- Links that carry data: progress links, Home tiles, widget title links (R20), 'Show N more', and Create hub note (it says 'this tag has no hub').
- Any control whose current value shapes the page. The renderer marks it `data-reveal-keep`. This covers:
  - Can start now while it is pressed
  - an active progress link
  - a Sort that is not at its default (on the board, ranking works only under Rank, so a hidden non-Rank Sort would leave drags that do nothing unexplained)
  - Context's Related Sort when it is not Relevance
  - week marks that have a note (`.has-note`)

- The page's own job: the Calendar day panel's Create or Open, the Graph's zoom −/+, Fit graph and Reset graph, Context's page icons, and everything on Task Statuses and Stats.

**Revealed in place:** everything else under the bar.
- It is drawn at opacity 0 and shown on `:hover` or `:focus-within` of its own `[data-reveal-region]`, or on its own `:focus-visible`.
- `[aria-expanded=true]`, `[data-reveal-keep]` and `@media (hover:none)` always show it.
- A segmented group is revealed as one unit: the attribute sits on the `.segmented` element, never on one member. A `[aria-pressed=true]` override is not used, because it would draw a lone chosen segment button (board.tsx:333, searchPage/header.tsx:89).
- This is the same shared rule R11 uses at every step. Zen only adds its regions.
- Typing doesn't reveal. A region's :focus-within does not fire while focus is in its query field (scope it with `:not(:has(.query-input:focus))`, or make the status row its own focus region), so searching on the board keeps it at 6 controls. Each control's own :focus-visible still reveals it.

**Folded in place (R23):**
- Refine is a `<details>` at every step. It is open at Full and closed under Zen. Its summary reads 'Refine' and '· N set' while facets are active.
- Only the facet groups go inside the fold. The lead lines (look-alike tags, and 'N entries mention "x" without the tag' with its Show them button) and the match count ('N notes · N tasks') stay outside it, always drawn, so the fold never hides data.
- The Task Board's Refine uses the same facets() (taskBoard/main.tsx:236), so with a search applied the board gets the same fold under Zen.
- On the Graph, Focus and Filters start closed under Zen. Filters reads '· N set' while any filter is set, and Focus reads '· around this note' while the local graph is on.
- The open or closed state carries across redraws (wasOpen from the DOM). Toggling Zen resets it to the new state's default.

**Never:** removing a control from the DOM, the tab order or the accessibility tree; moving a control into ⋯; or hiding by `display:none` or `visibility:hidden`.

### Zen: Per page (controls at rest, Full → Zen)
- **Task Board 16 → 6**: DECKARD ▾, Add task, ⋯, Builder, field, →.
  - Query-card region: Board | Table, Group, Sort and Can start now. Sort stays drawn while it isn't Rank, and Can start now while it is pressed. Group is revealed even when it isn't Status, because the column headers already name the grouping.
  - Column region: that column's +. Done has none.
  - Card ⋯: already revealed at every step (R11).
- **Search page 27 → 15**: DECKARD ▾, ‹ ›, ⋯, Create hub note link, Builder, field, tag chip ×, →, the Refine summary (folded over 10 facets), the 3 progress links, Notes | Tasks.
  - Revealed: Sort and Bulk edit (results-heading region).
- **Home 12 → 11**: DECKARD ▾, 3 tiles, ⋯, Home | Tags, Builder, field, →, the 'Tasks view 53 ›' title link.
  - Revealed: the Customize text link (tab-row region).
- **Calendar page 10 → 10**. Week marks without a note are revealed on week-row hover; marks that have a note stay drawn. The same rule applies to the sidebar Calendar, which shares WeekRail. Next day is revealed at every step (R11).
- **Note page 5 → 5**: everything is in the bar.
- **Context 11 → 8**: the 8 page icons stay. The band gear is revealed on the band region. The Related Sort select and its gear are revealed on the Related heading, and the select stays drawn when it isn't Relevance.
- **Notes Graph about 26 → 9**: DECKARD ▾, ⋯, the Focus, Filters and Display summaries, zoom −/+, Fit graph and Reset graph.
- **Task Statuses and Stats**: unchanged. Every control on them is the page's job.
- **Sidebar Calendar**: unchanged except that week marks without a note are revealed on week-row hover.

### Zen: How everything stays reachable
- **Mouse**: point at the area and its tools appear where they always are.
- **Keyboard**: Tab lands on every revealed control, and focus reveals it. The board card ⋯ is the one tabindex=-1 exception. It opens with Shift+F10, the menu key, Alt+Enter and right-click, at every step.
- **Touch**: `@media (hover:none)` draws everything.
- **Folds**: a closed `<details>` always has a drawn summary.

### Zen: Commands
- The palette shows only 'Deckard: Toggle Zen'.
- Enter Zen and Leave Zen get commandPalette when:false and stay as the when-swapped title-bar pair at navigation@90, because extensions cannot declare toggled.
- In pages, Zen is one checkbox in ⋯ Appearance.
- No ids change.
- themes-and-zen.md gains one sentence: ⌘K Z hides the workbench, Deckard's Zen quiets Deckard's pages, and the two combine.

### Zen: Contract test (R24)
- **(a) 'Zen keeps every control on the page'**: today's identical-control asserts (zen-mode.test.ts:159-173), extended to the Task Board and the Calendar page.
- **(b) Sheet check**:
  - No Zen-scoped rule sets display:none or visibility:hidden on button, input, select, a, summary or [data-action].
  - Every opacity:0 rule names a [data-reveal] or [data-zen-reveal] with matching region :hover, region :focus-within and :focus-visible reveals.
  - The [data-reveal-keep], [aria-expanded=true] and (hover:none) overrides exist.
- **(c) Rendered pages with Zen on and off**:
  - Every reveal target has an ancestor of its region.
  - No reveal attribute sits on a member of a .segmented group.
  - No reveal target has tabindex=-1. The board card ⋯ is the only exception, checked at Full too.
  - No control has an ancestor with computed display:none or visibility:hidden, other than a closed <details> with a drawn summary.
- **(d)** checkLayout.js's hover pass forces :hover on one element per surface only. Add the Zen region selectors as extra hover targets for the Zen passes in surfaces.js; (b), (c) and R11's contrast and visual coverage cover the rest, with no new Chrome suite.
- **Docs**:
  - docs/zen-mode.md is rewritten. 'Not in scope' becomes 'What Zen hides, and how it comes back'. The doc says `body.zen` is a marker only (components.ts:93), and getZenCss is gone.
  - themes-and-zen.md's 'Kept: every button…' becomes 'Drawn: the page's bar, the search field and anything that is filtering the page, with every count and date. Point at or tab into an area to see the rest.'

## Action model

The same three tiers on every Deckard page, at every display step. Zen changes only what is drawn at rest under the bar (R22). It never changes the tiers or where a control lives.

1. **Global (left).** DECKARD ▾ and the title. DECKARD ▾ stays navigation only: every page, then Go to…. It is the same list as Context's band and Go to… (deckardPages.ts), so a reader learns one list. The Notes Graph gains the eyebrow.

2. **Page (right of the title).**
   - **Primary:** at most one filled `.primary` (the --chosen pair). It is used only for an action that commits something:
     - Task Board 'Add task'
     - 'Save to Tasks view' in edit mode
     - Task Statuses 'Save'
     - the Calendar day panel's 'Create' while the day has no note
     - Get Started's 'Create today's note' while the workspace has no notes
   - **No primary:** the Search page, Graph, Stats, Help, Note page, and Home with notes. Navigation never gets the fill.
   - **Secondaries:** up to 3: ‹ › history, ‹ Today ›, Month | Week, Open in Editor.
   - **⋯:** one ⋯, the ViewOptions popover with its summary changed to ⋯, replaces both the gear and ?. Its rows are flat and grouped in this order:
     1. This page's actions:
        - Save search…
        - Export notes… or Export tasks… (Search page and Task Board)
        - List in Tasks view
        - Reindex
        - Customize Home… and Walkthrough (Home)
     2. View rows.
     3. Appearance: Theme…, the Zen checkbox, Page width where it applies.
     4. 'Help on this page'.
     5. 'Keyboard shortcuts  ?' on pages with a key sheet (Task Board, Calendar, Search page).
   - **No submenus in ⋯.** Each candidate holds 2 or 3 rows, and a labeled group already reads as a section. The tooltip and aria-label of ⋯ name the page's top rows.
   - **Query fields:** no Search or Clear buttons. Enter or a small → glyph runs the search, and an × appears only when canClear() is true. Builder is a labeled addon attached to the start of the field.
   - **Sort:** a compact native select beside the list it orders, never in ⋯.
   - **Actions beside their pane:**
     - Bulk edit stays beside the pane it acts on, as a small quiet button.
     - Export is rare and output-only, so it lives in ⋯ on both pages that have it.
     - Create hub note is a text link under the title, because it is also a state signal.
     - Home's Customize is a ⋯ row plus a quiet text link at the right of the tab row.
   - **Links that lead somewhere are the thing itself:** a widget's title is its link (R20). There is no separate 'X →' button.

3. **Row.** No new row menus.
   - One shared reveal rule (`data-reveal` in a `data-reveal-region`, R11) draws per-row actions only on row hover, focus-within or focus-visible, or while their menu is open, and always under (hover:none). It applies to:
     - the Calendar day panel's move button
     - the board card ⋯
     - the Table row ⋯
   - The move button keeps its labels and meaning: 'Tomorrow' on today or a past day, 'Next day' on a future day. It moves the row's own due or scheduled field.
   - The card ⋯ stays tabindex=-1 and opens with Shift+F10, the menu key, Alt+Enter and right-click. The Table row ⋯ stays a tab stop.
   - The board's column '+' is always visible at Full, as a small header icon. It is the only one-step add into a column (there is no n key), and it is how a first-time reader learns that this is possible. Zen reveals it on column hover or focus.
   - The Table ranks by drag, Alt+↑/↓ and the rank menu while in Rank order (R21).

**Announcing the moves:** one Highlights section in the single release that moves controls (R25), with one bullet per family. The ⋯ tooltip names the moved rows. No toast, no dot and no first-open line.

## Per page

| Page | Today | Proposed | Zen | Primary |
|---|---|---|---|---|
| Task Board | 22 | 16 | 6 | Add task (filled --chosen). In Tasks-view edit mode: Save to Tasks view, and Add task goes plain |
| Search page | 29 | 27 | 15 | None |
| Home | 13 | 12 | 11 | None while the workspace has notes. In an empty workspace, Get Started's 'Create today's note' is the one primary, and no widget grid is drawn |
| Calendar page | 11 | 10 | 10 | Day panel 'Create', only while the chosen day has no daily note ('Open' is plain) |
| Note page | 6 | 5 | 5 | None (Open in Editor is navigation, a plain secondary) |
| Task Statuses | 10 | 9 | 9 | Save (replacing the unstyled .is-primary) |
| Notes Graph | 28 | 26 | 9 | None |
| Stats | 2 | 2 | 2 | None |
| Context sidebar | 11 | 11 | 8 | None |
| Sidebar Calendar view | 5 | 4 | 4 | None |

Controls are counted at rest with the Context sidebar closed: every page-level control, including in-field glyphs and each segment button. Repeated per-row controls are counted separately.

## Ruled out

- **Zen moves controls into ⋯ or removes them from the page** (Round 1 Zen model). R3 already puts tertiary actions in ⋯ at every step. Moving more by mode would make Zen readers learn a second layout and break keyboard reach. In-place reveal gets the same quiet at rest without either cost.
- **Borderless secondary buttons under Zen** (C26 (part)). Under the new Zen, the only secondaries drawn at rest are navigation and content switches, where the border and the pressed state show which choice is in force. The rest are out of sight until their area is hovered. A second button style would cost contrast entries and baselines in all eight themes for little visible gain.
- **Rename Zen or decide whether it exists** (D3). The redefined Zen does at page level what VS Code's Zen Mode does for the workbench, so the shared name helps. Renaming would add a second migration notice in the same release. On Corpo it now takes the board from 16 controls to 5, so it earns its place.
- **New ⋯ menus on Calendar day-panel rows and Home task rows** (C2, D4). These surfaces are for glancing and rolling tasks forward. A per-row ⋯ would add a second affordance to the densest repeated surface. The board menu's 'Due today/tomorrow' is relative to today, so on a future day it would pull a task earlier, and on a scheduled-only task it would add a due date. That conflicts with Next day's meaning in the same row.
- **Submenus in ⋯ (Save ▸, Appearance ▸)** (Round 1, C6/C9/K1/D2). Each candidate holds 2-3 rows, so the extra click costs more than the rows it hides. ⋯ is a labeled popover, not an ActionMenu, so a submenu would need cascading-menu work in actionMenu.tsx or a menu nested in a popover. On the Note page, Stats and the Graph, Appearance is most of ⋯.
- **Theme, Zen and Help in DECKARD ▾; a toggled Zen icon; a '.' key** (C6, C9, K1, K7, D2). DECKARD ▾, Go to… and Context's band are one list from deckardPages.ts, and settings rows in one host would split it. 'Help on this page' depends on the page. Zen is already one click through the title-bar pair, extensions cannot declare a toggled state, and nothing is bound to '.'.
- **An unread dot or a first-open line on ⋯** (S10 (part)). A dot is an attention signal on the control meant to recede, and it needs per-page state that must be removed a release later. A first-open line shows only after the reader has already found ⋯. The ⋯ tooltip and aria-label name the moved rows permanently, and the Highlights announce them.
- **Fold the arranging-mode widget controls (½ | Full, gear, ×) into a widget ⋯** (C16 (arranging part)). They are drawn only while Customize Home is active, which is the one time the reader wants them, so folding adds a click to every resize and remove and quiets nothing at rest.
- **Merged Home widget kinds** (C8). The catalog is seen only in the + Add widget select while customizing. Merging curated and automatic lists, or folding the Tasks view's grouping and footer into a Tasks widget, would move complexity into per-widget modes. Saved search results lists notes, which a Tasks body cannot.
- **New Stats sections for tag cleanup** (C17). A tag without a hub is not a problem, so that section would almost never be empty and would weaken Needs attention. Typos are already caught by 'Tags that look alike' and 'Tags used once', and Create Hub Note for Tag… lists unhubbed tags.
- **Merge the when-swapped toggle command pairs into single ids** (C13). Every pair is already when-swapped, so the palette shows one row per switch, and the title bar needs the pair because extensions cannot declare toggled. Merging means id churn and aliases for no visible gain.
- **A 'Park or Unpark…' picker** (C13). It would add a step to every park action to save rows that fuzzy search already groups. Gating Unpark Folder and Unpark Tag on something being parked (R8) removes the dead rows with no added step.
- **Fold 'Linked from N' into the line-1 summary lens** (C10b, X6 (part)). It is the line-1 lens readers click most, and folding it in makes that click two whenever a note also has a problem. It also forces a count to be shared across two providers. It stays its own lens (R6).
- **Remove deckard.openNotesIn, or replace the hub pair with 'Open the Other Way'** (C21, X4). The whole mechanism is about 30 lines, and Shift-click stays either way, so removing it saves almost no code. Without it, anyone who reads on the Note page pays a modifier on every open. The hub pair is mutually exclusive, so the menu always shows one correctly named row.
- **Remove deckard.display.shortDateFormat** (C22). It does a job dateFormat can't: a weekday date for narrow places. The default 'YYYY-MM-DD' has no weekday, and 'L' to 'llll' are locale-defined, so a year-less form can't be derived from them.
- **Merge Export Tasks as Calendar… with calendar.exportFile/exportQuery** (C22). They do different jobs: a one-off file through a save dialog, versus a file Deckard keeps current for a calendar app to subscribe to. The kept-current path has to be stored anyway, so the setting can't go.
- **A shorter / menu** (S11). It is a completion list shown only after '/' at the start of a line, and it filters as you type, so its length costs nothing until shown. Folding the query entries into 'Query…' would add a prompt to each.
- **Quiet by default in code repositories** (S9). '.git' is a CODE_MARKER, so git-backed vaults, a common setup, would start paused and look broken on first run. The scope status item, the write question and 'Not a Notes Workspace' already give a one-click exit.
- **Graph tuning in a popover, or 'Only links I wrote' moved into Focus** (X2). Deleting Forces and Advanced (R15) removes them from the panel and also removes their code and tests, and Links per note covers dense vaults. The checkbox belongs with the other 'what is drawn' filters, so moving it gains nothing.
- **A Story Tour replacement chapter** (X7). Help already has a page for each part of Deckard, so a narrative chapter would duplicate it. The tour's value was real files to try, which the Work Sample and the walkthrough keep.
- **Hide openWhatsNew from the palette** (C30, K16, C13). Home doesn't open on startup by default, so the palette row is the main route to the changelog after an update. The command also clears Home's banner, so it stays registered anyway.
- **Remove Context's page list and add view-title icons** (C14, N5, F7). The band is the only visible, at-rest, one-click route from the sidebar to Deckard's pages while a note is in the editor. VS Code draws view-title icons only on hover by default, so they would hide that route. The icon-row default (R12) recovers most of the height.
- **Retire the sidebar Calendar view** (C5). It is the only month visible beside a note, with daily-note dots and due counts, and one click opens a day, week or month note. Without it, every past note costs a tab switch and two extra steps. R13 drops its day panel and starts it collapsed.
- **Stop handing Refine and the Calendar day to Context** (S1, D1). With a page in front there is no text editor, so Context would show only 'Open a Markdown note…'. The handoffs fill that dead view and give the board and the month about 300 px back. Only the customizeHome state goes (R12).
- **Remove Open as Page and the daily ‹ › from the title bar outright** (C15). Open as Page is a note's reading-mode switch, like VS Code's Preview icon, and burying it costs page readers a pick and a step. The ‹ › repeat the lens only while it is drawn, so they are gated on the preset (R14) rather than stranding Writing readers.
- **Remove the status-bar task item or its amber background** (S8). It shipped in 1.18.0. It is the only at-rest signal that splits overdue from due today and names the overdue tasks. It hides when nothing is due, needsNewDateAfterDays caps chronic amber, and any reader can hide it in one click.
