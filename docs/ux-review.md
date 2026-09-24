# UX and UI review

A review of Deckard's user-facing surfaces on 2026-09-23, at version 1.19.1
on `dev`, against published usability research. It reads the eight webview
pages, the sidebar views, the status bar, and the manifest, and looks at the
screenshots under `docs/images/`. Each finding says what was observed, where
in the source it comes from, why the research says it matters, and what to
change. The findings are ranked by how many readers they reach and how sure
the evidence is, weighed against the size of the fix.

What was not reviewed: the editor lenses and hovers beyond the screenshots,
the MCP and assistant tools, and the notes graph's force settings.

## What already works

These are worth naming so nothing below reads as a list of what is wrong.

- **Every page declares `lang`, honors `prefers-reduced-motion`, draws a
  visible focus ring on every control and row, and puts a live region under
  its result count.** That is more than most VS Code extensions do.
- **Multi-note writes are previewed in the refactor preview and reversible
  with one command.** Nielsen's third heuristic, user control and freedom, is
  met better here than in most note tools.
- **Faceted refinement with counts** on every search page is the pattern
  Hearst's *Search User Interfaces* (2009) recommends, and the counts prevent
  the dead-end filter that faceted interfaces without counts produce.
- **Destructive actions confirm inline or in a modal** and never fire on
  their own: Reset Home asks in place, Tidy asks with a list, rename asks
  with a diff.
- **Onboarding is layered**: a four-step walkthrough, a sample workspace,
  welcome content in empty sidebar views, and a Help page. Nielsen Norman
  Group's onboarding research favours exactly this mix of an in-context
  first run over a one-time tour.
- **Zen mode folds provenance off-screen rather than removing it**, so it
  stays in the accessibility tree and in find-in-page.

---

## Ranked findings

### 1. The status bar's headline number counts overdue tasks as due today

**Observed.** With five tasks due today and seventeen overdue, the status bar
reads `22 due today, 17 overdue`. The Agenda widget on the same screen reads
`Overdue 17` and `Today 5`. The bar's total is overdue plus today, and it is
labeled "due today".

**Source.** `src/ui/views/taskStatusBar.ts:36-43`, `describeDueTasks`.

**Why it matters.** This is the one number a reader sees all day without
opening anything. Nielsen's first heuristic, visibility of system status,
depends on the status being true. A number that disagrees with the page it
opens costs trust in every other count Deckard shows. Reichheld and
Schefter's work on trust in software (Harvard Business Review, 2000) and
NN/g's *Trustworthiness in Web Design* both find that one visible
inconsistency lowers confidence in an interface as a whole, not just in the
inconsistent part.

**Change.** Say what each number is. `17 overdue, 5 today` when both are
non-zero; `5 due today` when nothing is overdue; `17 overdue` when nothing is
due today. Keep the hover sentence in `describeDueTasksAtLength` in step.

**Effort.** Trivial. One function and its tests.

---

### 2. The base sheet's task provenance color is 1.85:1, and six of eight themes inherit it

**Observed.** The file, heading, and line under every task row is drawn in a
hard-coded `#3d4145` on a `#0D1017` panel. That is a contrast ratio of
1.85:1. Corpo and Synthwave restate it as `var(--muted)` (5.2:1); Replicant,
Oblivion, LCARS, Tomcat, Fellowship, and Cooper do not, and the Replicant
screenshot shows it. The contrast check's baseline also carries 157 accepted
failures, most of them hover and focus pairs.

**Source.** `src/ui/webview/components.ts:522` (`.task-meta`),
`src/ui/webview/themes.ts:85` and `:185` (the two restatements),
`test/ui/contrast-baseline.json`.

**Why it matters.** WCAG 2.2 success criterion 1.4.3 requires 4.5:1 for
text of this size, and 1.4.11 requires 3:1 for the borders and states in
the baseline. Low contrast text is the single most common accessibility
failure on the web: the WebAIM Million (2024) found it on 81% of home pages.
This text is not decoration. It is how a reader decides whether a result is
the one they meant before they open it, which is the whole reason zen mode
was careful to keep it.

**Change.** Replace the literal with `var(--muted)` in the base sheet, which
makes the two theme restatements redundant. Then burn the baseline down by
group: the hover pairs first, since `components.md` already documents the
`--hover-bg` / `--hover-fg` rule they break, and re-record with
`npm run test:contrast -- --update` after each group. Treat a baseline of
zero as a release gate.

**Effort.** Small for the literal. Medium for the baseline, and it can be
done in slices.

---

### 3. Overdue is conveyed by color alone in task lists, and dates are absolute only

**Observed.** In a task list row, an overdue task reads `DUE 2026-09-08` in
red and an on-time task reads `DUE 2026-09-14` in green. The word "overdue"
is not in the row. The Agenda widget puts the row under an "Overdue" group
heading, which carries the meaning, but search results, the Tasks widget,
and the Task Board's list layout show the row on its own. The board's card
does say `overdue, due 2026-09-08`, so the copy already exists.

Dates are always written as ISO dates. The board's screenshot shows nine
overdue cards and asks the reader to subtract each date from today.

**Source.** `src/ui/webview/components.ts:1189` (the row) and `:523-524`
(the colors); `src/ui/webview/components.ts:960` (the board's wording).

**Why it matters.** WCAG 1.4.1, Use of Color, is a level A criterion:
color must not be the only visual means of conveying information. About
8% of men have a red-green color deficiency, and red on a dark panel is
one of the pairs they lose. On dates, NN/g's guidance on timestamps
(Whitenton, *Timestamps and Dates*) is to write relative dates when the
distance from now is what the reader is deciding on, and absolute dates
when they will compare or cite them; here it is the distance. Tversky's
work on mental arithmetic in interfaces and the general finding that each
computation the reader performs is a chance for error both apply.

**Change.** Prefix the overdue state in words, as the board does:
`Overdue 15 days · 2026-09-08` for anything within thirty days, `Overdue ·
2026-06-01` beyond that, and `Due tomorrow`, `Due in 3 days`, `Due Fri 26
Sep` for the near future. Keep the ISO date beside the phrase, not instead
of it, so a reader who cites dates loses nothing. The same function can
serve the board card, the sidebar, and the status bar hover.

**Effort.** Small to medium. One formatting function, used from three
places, and the visual baselines will need re-recording.

---

### 4. The same objects have three names across pages

**Observed.**

| Page | Files | Sections | Tags |
| --- | --- | --- | --- |
| Dashboard header | — | `sections` | `entities` |
| Stats | `Markdown files` | `Note entries` | `Canonical tags` and `All tags` |
| Notes Graph legend | — | `485 NOTES` | `TAGS` |
| Reindex toast | `51 notes` | — | `185 tags` |

So "notes" means files in one place and sections in another, and the
Dashboard's most prominent number, 181, is labeled with a word,
"entities", that the README explains but the page does not.

**Source.** `src/ui/webview/dashboardHtml.ts:921-923`,
`src/ui/webview/statsHtml.ts`, `src/ui/webview/notesGraphHtml.ts`,
`src/extension.ts:544`.

**Why it matters.** Nielsen's fourth heuristic, consistency and standards,
and his second, match between the system and the real world. Krug's *Don't
Make Me Think* puts it directly: a reader should never have to work out
whether two words mean the same thing. Indexing terminology is the kind of
vocabulary Redish (*Letting Go of the Words*) finds users translate silently
and then remember wrongly. The cost is small per instance and paid on every
page.

**Change.** Pick one glossary and use it everywhere, in the pages, the
README, Help, and the toast: **notes** for files, **sections** for headed
entries, **tasks**, and **tags**, with "people, projects, and other tags"
where the entity distinction is needed. The Dashboard's three tiles become
notes, sections, and tasks, which is also what a newcomer expects to see
first. The graph's legend counts sections, so it should say so.

**Effort.** Small to medium. Labels, the Help page, and the tests that
match them.

---

### 5. The Task Board opens with 62 of 66 tasks in one column

**Observed.** The board's default grouping is Status, and a status is a
`#status/` tag most notes never carry. The first paint is one tall "No
status" column and four columns holding one, two, one, and zero cards. The
Due date and Person groupings, which work for any task, are one click away
but not the first thing shown.

**Source.** `src/ui/state/taskBoardState.ts:336, 491`; the default in
`package.json` under `deckard.board.statuses`.

**Why it matters.** A Kanban board earns its layout by spreading work across
columns; one full column is a list drawn expensively. NN/g's work on
first-run and empty states finds that the first screen of a feature sets
the user's model of what it is for, and a screen that looks broken or
pointless is rarely revisited. This is also a progressive-disclosure
question: status is a convention the reader adopts later, so it should not
be the gate to the board's value on day one.

**Change.** Either of these, or both:

- When fewer than, say, a quarter of open tasks carry a status, open the
  board grouped by due date and say so in one line above the columns, with
  "Group by status" as the link.
- Put a short empty-state line in the "No status" column: "Write
  `#status/todo` on a task, or drag a card, to give it a status." The board
  already writes the tag when a card is dropped, so the drag is the
  discoverable path.

**Effort.** Small.

---

### 6. Two keyboard gaps: the tag menu is mouse-only, and the tabs are tabs in name only

**Observed.**

- The tag context menu opens on `contextmenu` and closes on Escape. There
  is no keyboard route to it: not Shift+F10, not the Menu key, not a visible
  button. Every action in it, open, favorite, rename, merge, is therefore
  unreachable without a pointer from that spot.
- The Notes / Tasks switch carries `role="tablist"` and `role="tab"` with
  `aria-selected`, which tells a screen reader user to expect arrow-key
  movement and a single tab stop. Neither is implemented; each tab is a
  separate button in the tab order.

**Source.** `src/ui/webview/components.ts:885-901`
(`installTagContextMenu`), `:1210-1216` (`renderResultTabs`).

**Why it matters.** WCAG 2.1.1, Keyboard, is level A: everything a pointer
can do, a keyboard must be able to do. For the tabs, WCAG 4.1.2, Name,
Role, Value, is the criterion: a role is a promise about behavior, and the
WAI-ARIA Authoring Practices Tabs pattern spells out the behavior that role
promises. A role without its keyboard model is worse than no role, because
a screen reader announces "tab 1 of 2" and the user then presses an arrow
key that does nothing.

**Change.**

- On `keydown` of Shift+F10 or `ContextMenu` on a focused `[data-tag-key]`,
  open the same menu anchored to the element. The board card's `⋯` select is
  precedent for a visible affordance if one is wanted as well.
- Either implement the tabs pattern, roving `tabindex`, Left and Right to
  move, Home and End, `aria-controls` to the panel, or remove the roles and
  let the buttons be a `role="group"` of `aria-pressed` buttons like the
  other segmented controls. The second is honest and takes ten minutes.

**Effort.** Small.

---

### 7. The type scale bottoms out at 9px, and most secondary text is 11px

**Observed.** Across the pages, `font-size` is set to 11px thirty-two times,
10px sixteen times, and 9px twice. The body is 13px. Secondary text is
monospace and muted, which costs further legibility at the same size. The
smallest cases are the calendar's due counts (9px), the Dashboard's section
readouts (9px), and the filter counts, facet counts, and Related Notes'
score and labels (10px).

**Source.** The histogram from `grep -ohE "font-size: *[0-9.]+px"
src/ui/webview/*.ts`; the 9px rules at `calendarHtml.ts:48` and
`dashboardHtml.ts:67`.

**Why it matters.** Legge and Bigelow's review of print size and reading
(*Journal of Vision*, 2011) puts the floor for fluent reading at about 0.2°
of visual angle, which on a laptop at normal distance is roughly 11px, and
finds reading speed falls steeply below it. Platform guidance agrees: Apple's
HIG sets 11pt as the minimum for any text, Material's smallest style is 11sp
and used only for labels. Monospace and reduced contrast both shift the
floor upward. The 10px and 9px text here carries counts a reader acts on,
not decoration.

**Change.** Set a floor of 11px and a named scale: 11 for captions and
counts, 12 for meta lines, 13 for body, 14 and up for headings. Express it
as tokens (`--text-xs` through `--text-lg`) beside the existing `--edge`
and `--control-height`, so density can be tuned once. Consider deriving the
base from `--vscode-font-size` so the pages follow the reader's VS Code
setting the way the editor does.

**Effort.** Medium. Mostly mechanical, and the layout suite will catch the
few places a larger size wraps.

---

### 8. Home carries a permanent instruction bar

**Observed.** A full-width row reading "Home is yours to arrange." with a
Customize button is drawn on every visit, above the widgets, whether or not
Home has been arranged. The same Customize action is in the gear.

**Source.** `src/ui/webview/dashboardHtml.ts:849`.

**Why it matters.** Benway's original banner-blindness study (1998) and
NN/g's replications find that readers learn to skip a fixed row of
instructional text within a few visits, at which point it is pure cost:
vertical space on the page a reader opens most, and one more edge in the
frame zen mode was built to reduce. NN/g's guidance on instructional
overlays and hints is that they should be dismissible, and should stop
appearing once the behavior they teach has been performed.

**Change.** Show the bar until Home is customized once, or until it has been
dismissed, and then not again. Keep Customize in the gear, where it already
is. If a resting affordance is wanted, a small "Customize" text button at the
right of the Home / Tags row costs one line's width and no height.

**Effort.** Trivial.

---

### 9. The Notes Graph opens as an unlabeled hairball

**Observed.** The first paint is 485 nodes with no labels, "Around this
note" unchecked, and the hint "Open a note to draw the graph around it".
Focus, zoom, and Fit controls are present but the reader has to find them.

**Source.** `src/ui/webview/notesGraphHtml.ts`,
`src/ui/state/notesGraphState.ts`.

**Why it matters.** Shneiderman's visual information-seeking mantra,
overview first, zoom and filter, details on demand, is the standard for
this kind of view, and the overview step means an overview a reader can
read, not an overview of everything. Graph visualisation research on
hairballs (for example, Nocaj, Ortmann and Brandes on untangling hairballs,
2014) is consistent: beyond a few hundred nodes, unlabeled force layouts
communicate density and nothing else. The Related Notes sidebar already
knows which note the reader is in.

**Change.** When a Markdown editor is active, open in focus mode around that
note at one hop, with the checkbox already on. At rest in the full view,
label the highest-degree nodes and reveal more labels as the zoom passes a
threshold. Both changes leave the full graph one click away.

**Effort.** Medium. The focus mode exists; this is a default and a labelling
rule.

---

### 10. The commands a reader runs most have no shortcut

**Observed.** Four keybindings are contributed: search, edit or add a task,
and Tab inside quick find. Capture, Create Daily Note, Open Dashboard, and
Undo Last Change have none. The one page-level shortcut is a four-key chord
(Cmd+Shift+Alt+F).

**Source.** `package.json`, `contributes.keybindings`.

**Why it matters.** Nielsen's seventh heuristic, flexibility and efficiency
of use, asks for accelerators for the frequent paths of expert users. In
Card, Moran and Newell's keystroke-level model, reaching for the command
palette and typing a prefix costs several seconds per invocation; for a
capture that happens many times a day that is the difference between
capturing a thought and losing it. Four-key chords are also hard to form
and to remember; VS Code's own conventions prefer a two-step chord with a
prefix.

**Change.** Bind Capture and Create Daily Note, and list every Deckard
shortcut on the Help page in one table. Consider a prefix chord (for
example `Cmd+K` then a letter) for the set, so the bindings are one family
and avoid the four-key chord. Keep them all rebindable and check for
collisions with the default keymap.

**Effort.** Trivial for the bindings, small for the Help table.

---

### 11. The syntax hint under every search box is always on

**Observed.** "Enter searches. Words, #tags, is:open, has:due, in:folder;
AND, OR, NOT. Press / to search." is drawn under the search box on the
Dashboard, every search page, and the Task Board, at rest, whether or not
the box has focus. The placeholder lists most of the same terms. Zen mode
hides the hint, which is a sign it is felt as chrome.

**Source.** `src/ui/webview/components.ts:1790`.

**Why it matters.** Two heuristics pull against each other here, and the
current design picks one absolutely. Recognition over recall argues for
showing the syntax; aesthetic and minimalist design argues that every unit
of information competes with the results below. NN/g's placeholder research
is the tie-breaker: a placeholder vanishes when typing starts, so a separate
hint is right, but the hint is needed at the moment of typing, not at rest.

**Change.** Show the hint on focus and while the box is non-empty, and
collapse it to the Builder button and a `?` at rest. The `.query-error`
slot it shares keeps its behavior, since an error is never chrome.

**Effort.** Small.

---

### 12. Related Notes shows a percentage that implies a precision it does not have

**Observed.** Each related note carries a score such as `33%`, in green,
10px, with a tooltip that breaks the weights down. The three-step weight
rail already exists for the same purpose on Refine and the active tags.

**Source.** `src/ui/webview/sidebarNotesHtml.ts:90`,
`docs/related-notes-associations.md`.

**Why it matters.** Kulesza et al., *Too Much, Too Little, or Just Right?
Ways Explanations Impact End Users' Mental Models* (2013), found that
precise-looking numbers from a heuristic ranker lead users to build wrong
models of it and then to distrust it when two similar notes score 33% and
41%. A qualitative indicator with the breakdown on demand produced better
models and more trust. The score is also the smallest text in the sidebar.

**Change.** Draw the weight rail in place of the percentage and keep the
breakdown in the tooltip, where the exact numbers are useful. The sort by
relevance is unchanged.

**Effort.** Small.

---

### 13. Uppercase and letter-spacing on working labels in the film themes

**Observed.** In every theme but Corpo, column titles, section labels, the
Refine label, and the `TASKS 5 OF 66` style headers are uppercase monospace
at 11px with wide tracking. Corpo turns all of it off with one rule.

**Source.** `src/ui/webview/themes.ts:78` (Corpo's override), the base
typography in `components.ts`.

**Why it matters.** Tinker's reading studies (1963) and Arditi and Cho
(2007) both find all-capitals text read more slowly, with the penalty
growing as size falls; at 11px it is measurable. This is a deliberate look,
and the eyebrows and page titles are the right place for it. The working
labels a reader scans dozens of times, column titles on the board and
group headings in a list, are not.

**Change.** Keep uppercase and tracking on `.eyebrow` and `h1`, and let
column titles, group labels, and the Refine label read as written in every
theme. The palettes and glows are untouched, so no theme loses its
identity. This is the lowest-ranked item because it is a matter of degree
and the themes are a stated feature.

**Effort.** Small.

---

## Suggested order

1, 8, and 10 are an afternoon between them and reach every reader. 2 and 6
are the accessibility items and should precede the next release. 3, 4, and
5 change what the pages say and should be done together so the vocabulary
and date wording land at once. 7, 9, 11, 12, and 13 are polish and can be
taken as their pages are touched.

## Sources

- Nielsen, J. *10 Usability Heuristics for User Interface Design*. Nielsen Norman Group, 1994, revised 2020.
- W3C. *Web Content Accessibility Guidelines 2.2*, criteria 1.4.1, 1.4.3, 1.4.11, 2.1.1, 4.1.2. 2023.
- W3C. *WAI-ARIA Authoring Practices Guide*, Tabs pattern and Menu pattern.
- WebAIM. *The WebAIM Million*. 2024 report.
- Hearst, M. *Search User Interfaces*. Cambridge University Press, 2009. Chapter 8 on faceted navigation.
- Krug, S. *Don't Make Me Think, Revisited*. New Riders, 2014.
- Redish, J. *Letting Go of the Words*. Morgan Kaufmann, 2012.
- Whitenton, K. *Timestamps and Dates in UI*. Nielsen Norman Group.
- Benway, J. P. *Banner Blindness: The Irony of Attention Grabbing on the World Wide Web*. Proceedings of the Human Factors and Ergonomics Society, 1998; and NN/g, *Banner Blindness Revisited*, 2018.
- Legge, G. E. and Bigelow, C. A. *Does Print Size Matter for Reading? A Review of Findings from Vision Science and Typography*. Journal of Vision, 2011.
- Apple Human Interface Guidelines, Typography; Google Material Design 3, Type scale.
- Shneiderman, B. *The Eyes Have It: A Task by Data Type Taxonomy for Information Visualizations*. IEEE Symposium on Visual Languages, 1996.
- Nocaj, A., Ortmann, M. and Brandes, U. *Untangling Hairballs: From 3 to 14 Degrees of Separation*. Graph Drawing, 2014.
- Card, S. K., Moran, T. P. and Newell, A. *The Keystroke-Level Model for User Performance Time with Interactive Systems*. Communications of the ACM, 1980.
- Kulesza, T., Stumpf, S., Burnett, M., Yang, S., Kwan, I. and Wong, W.-K. *Too Much, Too Little, or Just Right? Ways Explanations Impact End Users' Mental Models*. IEEE VL/HCC, 2013.
- Tinker, M. A. *Legibility of Print*. Iowa State University Press, 1963. Arditi, A. and Cho, J. *Letter Case and Text Legibility in Normal and Low Vision*. Vision Research, 2007.
- Nielsen Norman Group. *Onboarding Tutorials vs. Contextual Help*; *Empty States*; *Placeholders in Form Fields Are Harmful*.
