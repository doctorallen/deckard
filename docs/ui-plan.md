# UI plan: layout, color, controls, and naming

A plan, not a change. It follows the UX pass recorded in `ux-review.md`
and looks at what that pass left alone: how the pages are laid out, how
color is used, how controls are drawn and sized, and what the buttons and
commands are called. It was written on 2026-09-24 at `e790367` on `dev`,
from the pages as the visual baselines draw them
(`test/ui/visual-baseline/darwin`), the Dashboard screenshots under
`docs/images`, and the sheets in `src/ui/webview`.

Each proposal says what was measured, why the research says it matters,
what to change, and how big the change is. Nothing here has been
implemented. The proposals are grouped into five pieces of work, ordered by
how much they earn against what they cost, and the last section says what
was considered and left out.

## What was measured

| Measure | Value | Source |
| --- | --- | --- |
| Distinct spacing values (padding, margin, gap) | 20, from 1px to 48px; 8px, 6px, 10px, and 12px each used 40 to 90 times | `grep` over `src/ui/webview/*.ts` |
| Distinct control heights | 6: 22, 24, 26, 28, 30, 32px | same |
| Distinct border radii in the base and pages | 0, 2 (token), 3, 4, 5, 50%; LCARS's 15px and 18px | same |
| Icons in the shared set | 4: settings, help, task board, notes graph | `src/ui/webview/icons.ts` |
| Color token uses | amber 97, muted 96, cyan 73, text 67, line 63, red 36, green 29 | same |
| Meanings carried by `--favorite-red` | 4: overdue, high priority, negated search term, favorite | `components.ts`, `dashboardHtml.ts` |
| Meanings carried by `--amber` | 4: eyebrow, hover border, chosen segment, primary button outline | same |
| Page column widths | 1000px (base), 1100px (Stats), full-bleed (Task Board, Graph), two-column (Help) | `main` rules |
| Distinct labels for clearing a search | 3: Clear, Clear search, Clear the search | button inventory |
| Command titles beginning Open / Show | Open ×10, Show ×2 (Stats, Log) | `package.json` |

---

## Piece 1. A spacing and sizing scale

**Observed.** Spacing is written as literals, twenty different ones, with
no token between them; `components.md` says so ("there are no spacing
tokens"), and zen mode restates every literal it changes by hand. Controls
come in six heights. The base sheet declares `--control-height: 30px` and
`--edge`, and the last pass added a type scale, but a card's padding, a
list's gap, a toolbar's gap, and a chip's height are each their own number.

**Why it matters.** Wathan and Schoger, *Refactoring UI*, make the case
that a fixed spacing scale is the single change that most improves how
consistent an interface reads, because the eye picks up a 6px gap beside an
8px one as untidiness without being able to say why. Material's 4dp grid
and Apple's 8pt grid exist for the same reason. A scale also makes density
a setting rather than a rewrite: zen mode currently tightens padding by
restating literals in a second block, which the components doc calls out
as a maintenance hazard.

**Change.**

- Declare `--space-1` to `--space-6` as 4, 8, 12, 16, 24, 32px beside the
  type tokens, and `--control-height` (30px) and `--control-height-compact`
  (24px) as the only two control heights. Chips and small steppers take
  the compact height; everything else the standard one.
- Convert the page sheets to the scale mechanically, rounding each literal
  to the nearest step: 3 and 5 to 4, 6 and 7 to 8, 9 and 10 to 8 or 12 by
  role, 14 to 16, 18 and 20 to 16 or 24.
- Let zen override the tokens (`body.zen { --space-3: 8px; }`) instead of
  restating rules, which shrinks the zen sheet and keeps the layout suite
  measuring one thing.
- Guard it with a test like the type-floor one: no `padding`, `margin`,
  or `gap` literal outside the scale in a page sheet.

**Size.** Medium. Mechanical, but every page, and the layout and visual
suites will both need a pass and a re-record.

---

## Piece 2. Color: one meaning per hue, and a primary action

**Observed.**

- `--favorite-red` marks an overdue date, a high priority, a negated
  search term, and a favorite heart. `--amber` is the eyebrow, the hover
  border, the filled "chosen" segment, and the outline of the Search
  button. Green is a checkbox, a metric value, a due date that is not
  overdue, the version number, and the calendar's due marks.
- The primary action is the least emphasized control on the page: Search
  is an amber outline, while a chosen filter segment (Status, Notes (29))
  is filled amber. Filled means "selected" here and "do this" in every
  toolkit a reader has used. Corpo inverts it again: Search takes VS Code's
  filled button color, and the rest of its toolbar has no button chrome
  at all, so Clear, Save, Tasks view, and Export read as plain text.
- Replicant's accents are fully saturated on near-black: cyan `#00E5FF`
  and green `#33FF33` at 100% saturation, on `#050608`. Synthwave's pink
  and cyan are the same. Fellowship and Tomcat sit at 30 to 68%.
- The board's second "Done" column: a status named `done` written on a
  task gets a column labeled Done beside the built-in Done column, so
  the baseline board shows two.

**Why it matters.** Ware, *Information Visualization*, and every color
coding guideline since: a hue can carry one meaning per interface, and a
reader who has learned that red means overdue will read a favorite heart
or a negated chip as urgent. Nielsen's fourth heuristic is the same point
from the other side. On saturation, Material's dark theme guidance and the
polarity research it cites (Piepenbrock, Mayr, Mund and Buchner, 2013)
find that fully saturated light colors on very dark grounds produce
halation, a visible bleed around glyphs that costs legibility at small
sizes, and recommend desaturating accents on dark surfaces; the effect is
strongest for the exact cases here, thin monospace text in pure cyan and
green. On the primary action, Apple's HIG defines prominence levels and
NN/g's button guidance both say one filled button per view, the one the
reader most likely wants, and selection states drawn some other way.

**Change.**

- Give each state its own token, mapped by theme: `--danger` (overdue,
  high priority), `--negative` (a NOT term; a hatched or struck chip
  border rather than red), `--favorite` (the heart), `--positive` (done,
  a checked box), `--accent` (eyebrows, chosen segments), `--focus`. Every
  theme declares all of them; most will alias two to one color, which is
  fine as long as overdue and favorite do not share.
- Desaturate the dark themes' accents to roughly 70 to 80% saturation and
  lift the lightness a little, checked against the contrast suite, so
  Replicant's cyan becomes nearer `#3ED4E8` than `#00E5FF`. Keep the
  glows and grid; they are the theme. Cooper stays gold on black, as
  agreed.
- Draw the primary action filled with `--accent` and everything else
  outlined, and draw a chosen segment as an outlined control with a
  stronger border and an underline or dot, not a fill. Corpo's toolbar
  buttons get the same secondary chrome as its Search button, from VS
  Code's `button.secondaryBackground` it already reads.
- Reserve `done` as a status name on the board, or fold a task tagged
  `#status/done` into the built-in Done column, so there is one.

**Size.** Medium. Tokens are a rename; the desaturation is a per-theme
tuning pass with the contrast suite as the gate; the primary/selected
inversion touches the segmented control and `.query-apply` once, in the
shared sheet.

---

## Piece 3. Layout: columns, regions, and repeated counts

**Observed.**

- The Task Board in Corpo has no column surfaces: five headers float over
  one field of cards, and a column's extent is inferred from alignment.
  Replicant, Fellowship, and Synthwave draw column frames, so the board
  reads differently theme to theme.
- Page width varies by page: 1000px on the Dashboard, search pages, and
  Help's main column; 1100px on Stats; full-bleed on the Board and Graph.
  On a wide editor the Dashboard sits in a 1000px column with a third of
  the panel empty either side while the Board stretches to the edges.
- A search page says its result count three times on one screen: the
  Notes (29) tab, the Notes (29) pane heading, and "29 notes · 54 tasks"
  in the Refine strip. The Board says "54 tasks" top right and again in
  the column counts.
- The Refine strip wraps its groups (Tags, Tasks, Due) as one run of
  chips with the group labels inline, so a group's boundary is a word,
  not a shape. The Sort control sits alone at the right of the Builder
  row, not with the other view controls in the gear.
- Home's widgets are a fixed two-column grid; on a narrow panel each
  half-width widget squeezes its rows.

**Why it matters.** The Gestalt principle of common region (Palmer, 1992)
is the strongest grouping cue we have: elements inside a shared boundary
are read as a group before proximity or alignment is considered. A Kanban
column without a region is a column only to someone who already knows it
is one. On width, the line-length research behind the 1000px choice
(Dyson and Haselgrove, 2001) applies to prose, and a board or a grid of
cards is not prose; what matters for those is that the page is consistent
with itself. Tufte's data-ink ratio is the argument against the third
count: every repeated number is ink a reader has to discount.

**Change.**

- Give board columns a surface in every theme: a panel background one
  step above the page and a hairline border, drawn by the shared
  `.board-column` rule so themes tint it rather than invent it. Corpo takes
  VS Code's `sideBar.background` or `editorWidget.background`.
- One width rule: document pages (Help, Stats, a search page) take the
  1000px column; working surfaces (Dashboard Home, Board, Graph) take the
  panel width with a 1400px cap, and Home's grid gains a third column
  above 1200px and drops to one below 720px.
- Say a count once per region: the tab carries it, the pane heading
  drops it (the tab is the heading in the tabs layout), and the Refine
  strip's count is kept only in the split layout where there are no tabs.
  On the Board, the header count stays and the column counts stay; they
  are different numbers.
- Draw Refine's groups as labeled regions (a small heading above each
  group, groups separated by the scale's largest gap) rather than a run.
  Move Sort into the gear with the other view options, where the columns
  and layout choices already are, and leave the Builder row to Builder
  and the hint.

**Size.** Medium. The column surface and the counts are small; the width
rule and Refine's regions are a day each with the layout suite watching.

---

## Piece 4. Controls: size, chrome, and icons

**Observed.**

- Several controls sit under 24px: the × on a search chip is 16px, Home's
  paging steppers are 22px, the board card's ⋯ menu is a bare `<select>`
  the height of its text, and the Related Notes rail button is 24px wide
  by the text's height. The favorite heart is a 16px mask inside a
  control.
- Icon-only controls appear in three styles: the sidebar toolbar (five
  16px glyphs in 30px squares, names in `title` only), the gear
  (`<details>` summary), and the board card's ⋯ (a `<select>` with a
  hidden first option). The shared icon set holds four glyphs, so the
  Dashboard's widget steppers, the search page's layout toggles, and the
  Graph's zoom controls each draw their own.
- The segmented control's "chosen" state and a button's hover state both
  turn the control amber, so a chosen segment that is hovered and an idle
  chosen segment look the same, and a hovered unchosen one looks chosen.
- Corpo's toolbar controls have no border and no background at rest, so
  a row of them reads as text with spaces; Search alone is a button.

**Why it matters.** WCAG 2.2 added 2.5.8, Target Size (Minimum), at level
AA: 24 by 24 CSS pixels for any pointer target, with exceptions for inline
text and for targets spaced far enough apart. Fitts's law is the older
version of the same rule: time to acquire a target grows with distance
over width, and a 16px × next to a 24px chip is the hardest target on the
page. Norman's signifiers are the case for button chrome: a control that
does not look pressable is not found by a reader who does not already know
it is there, which the Corpo toolbar tests on every visit. On states,
Material's state-layer model and Fluent's both keep "selected" and
"hovered" visually separable, because a reader hovers to find out what a
click will do and needs the answer before clicking.

**Change.**

- Bring every pointer target to 24px: the chip × becomes a 24px hit area
  around a 16px glyph, the steppers go to 24px, the ⋯ becomes a real
  button that opens the same menu (the keyboard path from the last pass
  already exists), and the heart's control is 24px square.
- One icon set, one size, one stroke: extend `icons.ts` with the chevrons,
  the layout and format glyphs, zoom in and out, fit, close, and the
  ellipsis, all 16px on a 1.5 stroke, and have every page take them from
  there. A `renderIconButton(icon, label)` helper draws the square, sets
  `aria-label`, and gives the tooltip.
- Separate hover from chosen: chosen is the accent border plus a marker
  (underline or filled dot); hover is the raised panel background with
  the text color kept; pressed is the accent fill for the duration of
  the press. Themes re-declare the three pairs as they do `--hover-*`
  now.
- Corpo's secondary buttons take VS Code's secondary button colors at
  rest, which the theme already reads for Search.

**Size.** Small to medium. Target sizes and the icon set are a day; the
state model is a shared-sheet change plus a theme pass.

---

## Piece 5. Names: buttons, commands, and the words for places

**Observed.**

- Three labels clear a search: Clear (search page, Board), Clear search
  (Graph), Clear the search (a title). Two run one: Search (the bar) and
  Apply (the Builder).
- Capitalization splits: Bulk Edit against Create hub note, Clear tag
  filters, Reset graph settings, Group by due date, Tasks view.
- Done ends Home's customizing and is also the board's last column, in
  the same view. Reset puts Home's widgets back, resets the Graph's
  settings, and resets the MCP token. Export appears on the search page
  and the Board without saying what it exports.
- Commands: ten begin Open and two begin Show (Show Stats, Show Log) for
  the same act. "Deckard: Zen Mode" is a noun beside "Leave Zen Mode", a
  verb. "Open a Tag's Search Page" in the palette is "Open the Tag's
  Search Page…" on the Outline's context menu. Two search commands are
  told apart by a parenthesis: "(find as you type)" and "(write a
  query)".
- The same place has two names: the widget is Agenda and the view it
  opens is Tasks; the page is a "search page" in the README, a "tag
  search" in its eyebrow, and a "tag overview" in the command id and the
  code.

**Why it matters.** NN/g's guidance on button labels: a label is a verb
phrase that says what happens, the same phrase for the same act
everywhere, and never the same word for two acts on one screen. Apple's
HIG sets title-style capitalization for buttons and menu items; Material
and Fluent set sentence case; either is fine, and the mix is not. Nielsen's
fourth heuristic covers the rest, and Redish's finding that readers
silently translate an interface's vocabulary and then remember their
translation, not the words, is the cost of Agenda/Tasks and search
page/overview.

**Change.**

- A naming table in `components.md`, and the buttons made to match it:
  sentence case for every button and menu item (Bulk edit); one verb per
  act (Clear for a search everywhere, Search for running one, so Apply
  goes); a verb and object where the object is not obvious (Export
  results, Export tasks; Reset widgets, Reset graph); and no word doing
  two jobs on one page (Home's customizing ends with Finish, not Done).
- Commands: Open for anything that opens a page or view, including Stats
  and Log; verbs for modes ("Enter Zen Mode", "Leave Zen Mode"); the same
  title in the palette and on a context menu; and the two search commands
  named by what they are, "Find in Notes" for the quick pick and "Search
  Notes" for the query page, with the parentheticals dropped into their
  Help descriptions.
- One name per place: the widget becomes Tasks, matching the view it
  opens; the page is a search page in the eyebrow, the README, and the
  Help, with "overview" kept only in identifiers that persisted state
  depends on.
- A test that reads every rendered button's text and every command title
  and fails on a capitalized second word, a known synonym, or a command
  that begins Show.

**Size.** Small. Strings, a table, and one test; the Agenda rename touches
the widget kind's title only, not its id.

---

## Order

1. **Piece 5, names**, first: smallest, no visual risk, and it settles the
   vocabulary the other pieces' docs and tests will use.
2. **Piece 4, controls**: the target sizes are an accessibility item and
   the state model is a prerequisite for piece 2's primary/selected fix.
3. **Piece 2, color**: tokens, then the primary action, then the theme
   desaturation with the contrast suite as the gate.
4. **Piece 1, spacing scale**: mechanical and wide; do it when the sheets
   are otherwise quiet, and re-record the visual baselines once.
5. **Piece 3, layout**: the column surfaces and the repeated counts can go
   with piece 2; the width rule and Refine's regions last, since they move
   the most pixels.

Each piece is a PR of its own. Every one changes how pages look, so each
ends with `npm run test:visual -- --update` and the baselines committed.

## Considered and left out

- **Rounded corners everywhere.** The chamfered cards and square controls
  are the film themes' identity; Corpo already takes VS Code's 2px. No
  change proposed.
- **Replacing the monospace headings.** Mono for data and display is a
  deliberate voice; the last pass already took the capitals off working
  labels. No change proposed.
- **A light Corpo tune-up.** Corpo in a light VS Code theme has no
  problems the contrast baseline does not already list, and those are
  VS Code's own pairs.
- **A ninth theme or a theme editor.** Out of scope; eight is plenty, and
  the token work in piece 2 is what would make a theme editor possible
  later.
- **The remaining 153 contrast baseline entries.** Still the right next
  accessibility job, and piece 2's desaturation will change most of the
  Replicant and Fellowship pairs, so it should follow piece 2 rather than
  precede it.

## Sources

- Wathan, A. and Schoger, S. *Refactoring UI*. 2018. Spacing and sizing systems; color palettes with one job per hue; visual hierarchy of actions.
- Google. *Material Design 3*: layout grid, dark theme color (desaturated accents, tonal surfaces), state layers.
- Apple. *Human Interface Guidelines*: buttons and prominence, typography and capitalization, layout.
- Microsoft. *Fluent 2* and the VS Code extension UX guidelines for webviews: use of theme colors, primary and secondary buttons.
- W3C. *WCAG 2.2*, success criterion 2.5.8 Target Size (Minimum); 1.4.3 and 1.4.11.
- Fitts, P. M. *The information capacity of the human motor system in controlling the amplitude of movement*. Journal of Experimental Psychology, 1954.
- Palmer, S. E. *Common region: A new principle of perceptual grouping*. Cognitive Psychology, 1992.
- Ware, C. *Information Visualization: Perception for Design*. 3rd ed., 2012. Color coding and the number of distinguishable categories.
- Piepenbrock, C., Mayr, S., Mund, I. and Buchner, A. *Positive display polarity is advantageous for both younger and older adults*. Ergonomics, 2013.
- Dyson, M. C. and Haselgrove, M. *The influence of reading speed and line length on the effectiveness of reading from screen*. International Journal of Human-Computer Studies, 2001.
- Tufte, E. R. *The Visual Display of Quantitative Information*. 1983. Data-ink.
- Norman, D. *The Design of Everyday Things*. Revised 2013. Signifiers.
- Nielsen, J. *10 Usability Heuristics*; Nielsen Norman Group, *Button Labels*, *Visual Hierarchy*, *Icon Usability*.
- Redish, J. *Letting Go of the Words*. 2012.
