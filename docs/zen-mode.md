# Zen mode

## Why

Deckard's pages carry a lot of frame. Before a single note is read, Home
spends its first screen on an eyebrow, metric tiles wearing invented
telemetry codes, a grid backdrop, and a line of query syntax under the search
box; the Task board stands up twenty-odd controls above its first card; and
a search page draws ten Refine chips before its first result. None of it is
broken, and most of it earns its place in the first week. It stops earning
it once the shape of the app is known, and what is left is a frame competing
with the notes.

Zen turns the frame down without taking anything away. It is three layers
(plan 29, "Zen"):

1. **Visual.** Decoration is hidden, the lines that teach are hidden, the
   spacing is compact, cards are flat and tags are text.
2. **Data never hides.** Every count, date and state line is drawn, with
   Zen on or off.
3. **Controls are quieted in place.** The page's bar, the search field and
   whatever is shaping the page stay drawn. The rest of a page's tools are
   drawn at no opacity and show where they stand when their area is pointed
   at or tabbed into, and Refine and the Notes Graph's Focus and Filters
   start folded.

Zen is not a ninth theme. A theme picks the palette; Zen picks how much frame
is drawn. They compose, so Zen works on all eight themes, and it declares no
color.

## The switch

Zen is one boolean, `deckard.display.zen`, an application setting written to
the user's settings (plan 29, R5). It replaced `deckard.display.level` (Full,
Quiet, Zen) and the seven `auto` settings the step moved.

- **Pages:** every page's **⋯** draws one **Zen** checkbox under
  Appearance, `zenOption()` in `src/webview/shared/viewOptions.tsx`, ticked
  from the body's `zen` class. Its click posts `setZenMode`, and the host
  writes the setting.
- **The palette:** `Deckard: Toggle Zen` alone. `deckard.enableZenMode` and
  `deckard.disableZenMode` are hidden from it (`when: false`) and stay as
  the title bar's when-swapped pair at `navigation@90`, on the
  `deckard.zenMode` context key, since an extension cannot declare a
  toggled menu item.
- **The move:** `carryRenamedSettingsOnce`
  (`src/composition/movedSettings.ts`) reads the old settings once per
  machine and once per workspace. Quiet and Zen both come to Zen on; Full
  writes nothing. One notice says Display moved whenever any of the eight
  was set.

A change to the setting draws every open page anew from its host
(`affectsPageChrome` in `src/ui/webview/host/pageChrome.ts`), so a page
never switches in place: it starts in the new state, folds and all.

Deckard's Zen quiets Deckard's pages; VS Code's Zen Mode (`⌘K Z`) hides the
workbench around them, and the two combine.

## How Zen reaches a page

There is no Zen sheet and no `getZenCss()`. Every page links the same tail
after its theme (`src/webview/shared/tail.css`, named by `getPageTailCss()`
in `src/ui/webview/components.ts`), and every rule Zen turns on is in it,
scoped under a marker on `<body>`. The page shell writes the markers from
the display choices its host resolved: `ZEN_CHOICES` in
`src/ui/state/displayLevel.ts`.

| Marker | What it turns on | Sheet |
| --- | --- | --- |
| `data-styling="plain"` | No ornament, plain type, thin frames | `display.css` |
| `data-help="hidden"` | `.help-text` lines hidden | `display.css` |
| `data-density="compact"` | The denser spacing scale | `display.css` |
| `data-cards="flat"` | Rows parted by a divider | `displayLooks.css` |
| `data-tags="text"` | Tags as text in the tag color | `displayLooks.css` |
| `data-controls="quiet"` | Zen's reveal regions (layer 3) | `reveal.css` |

`body.zen` is a marker only (`bodyMarkers` in `components.ts`): no sheet
hangs a rule on it. Page scripts read it where they need to know whether
Zen is on: ⋯'s checkbox, and where a fold starts.

Every marked rule ships whether or not its marker is set, which pays twice:

- **`verifyWebviews.js` matches layout contracts by exact selector string**,
  so `body[data-styling=plain] .metric` simply is not `.metric`, and no
  contract can flip when Zen is rendered.
- **`checkContrast.js` reads every declared rule**, whether or not the page
  renders a match, so the marked rules get contrast coverage in all eight
  themes with no second pass.

Position still matters. LCARS' `.metric:nth-child(3n + 2)::before` ties
with `body[data-styling=plain] .metric::before` on specificity, so
`display.css` must come after the theme; it is the tail's last sheet, and
`verifyWebviews.js` fails any page whose sheets don't end with it.

**`display.css` declares no `color`, `background`, `background-color`, or
`border-color`** (`background-image: none` is allowed, since four themes
paint their own backdrop onto `body`). Under that rule the contrast matrix
cannot move.

## What Zen changes

### Layer 1: visual

- **Ornament hidden:** an eyebrow's trail (DECKARD ▾ stays, since it is the
  way to every other page), the metric codes, and the grid backdrop.
- **Plain type:** no `text-transform` or `letter-spacing` on chrome. The
  `h1` shrinks rather than going, since on a search page it is the subject
  being searched and the page's only landmark. The reader's own note text
  is never transformed, at any step.
- **Help text hidden:** every line marked `.help-text` (plan 29, R9), which
  is never a control or anything holding one. `.query-error` shares the
  hint's slot and never carries the class, or a search that failed to parse
  would look like an empty one.
- **Compact spacing**, flat cards, tags as text.

### Layer 2: data never hides

Counts stay ('54 tasks', '40 · 6 overdue', facet counts and tab counts),
dates are written in full ('overdue 5 days · 2026-09-16'), and state lines
such as 'No tasks.' are drawn through the shared `EmptyState`. A board
card's `.board-details` carries the due date and the word "overdue" and is
never folded.

### Layer 3: controls are quieted in place

Never quieted:

- the page bar: DECKARD ▾, the title, the one `.primary`, its secondaries
  and ⋯, identical with Zen on and off;
- the query field with its attached Builder, its → and its chips;
- content switches: Notes | Tasks, Home | Tags, Month | Week;
- links that carry data: progress links, Home tiles, widget title links,
  'Show N more', and Create hub note;
- the page's own job: the Calendar day panel's Create or Open, the Graph's
  zoom, Fit graph and Reset graph, Context's page icons, and everything on
  Task Statuses and Stats.

Everything else under the bar takes the shared reveal rule
(`src/webview/shared/reveal.css`), in regions that act only under
`data-controls="quiet"`: a tool carries `data-zen-reveal`, and its area
`data-zen-region`.

| Region | Tools |
| --- | --- |
| The search box (`.query-workspace`) | The Task board's Board \| Table, Group, Sort and Can start now |
| Each `.board-column` | Its + |
| A search page's results heading (`.overview-tabs-row`, `.overview-pane-header`) | Sort and Bulk edit |
| Home's `.dashboard-tabs-row` | Customize |
| Context's `.context-pages-band` and `.related-notes-controls` | The two gears, and the Related Sort |
| Each week's `.calendar-row`, on the page and in the sidebar | The week mark |

A tool whose current value is shaping the page is marked
`data-reveal-keep` by its renderer and stays drawn: Can start now while
pressed, a board Sort that isn't Rank (ranking works only under Rank, so a
hidden Sort would leave drags that do nothing unexplained), a table sorted
by a column, a search page's Sort when it isn't A-Z, Context's Related Sort
when it isn't Relevance, the band's gear while no page is chosen, and a
week mark whose week has a note.

A segmented group is one target: the attribute is on the `.segmented`,
never on one segment, and no `[aria-pressed=true]` override is used, since
it would draw a lone chosen segment.

Folded in place:

- **Refine** is a `<details>` (`details.query-facets-fold`) at every step,
  open at Full and closed under Zen, so Full and Zen draw the same
  controls. Its summary reads 'Refine', with '· N set' while the search
  holds N of its values past the page's own. Only the facet groups are in
  the fold: the lead lines and the match count stay outside it. The Task
  board shares `facets()`, so its Refine folds the same way. With the
  Context sidebar holding Refine, the page draws none, so there is nothing
  to fold.
- **The Notes Graph's Focus and Filters** start closed under Zen, as
  Display always does. 'Filters · N set' counts the filters away from a new
  graph's, and 'Focus · around this note' says the graph is local.
- A fold is kept as the reader left it across a draw, read from the DOM, as
  ⋯ keeps its menu. A Zen toggle draws the page anew, so it starts at the
  new state's default. No state is persisted for it.

## What Zen hides, and how it comes back

Zen never removes a control from the DOM, the Tab order or the
accessibility tree, never moves one into ⋯, and never hides one with
`display: none` or `visibility: hidden`. What it does hide comes back where
it stands:

| Hidden at rest | How it comes back |
| --- | --- |
| A tool in a Zen region | **Pointer:** the region's `:hover`. **Keyboard:** the region's `:focus-within`, or the tool's own `:focus-visible`; Tab lands on every one. An open menu (`[aria-expanded=true]`) or disclosure (`[open]`) stays shown. **Touch:** the rule is inside `@media (hover: hover)`, so a screen that doesn't hover draws everything |
| A row's own action: Tomorrow or Next day, the board card ⋯, a table row's ⋯ | The same rule at every step (R11), on the row. The board card ⋯ is the one `tabindex="-1"` control; it opens with Shift+F10, the menu key, Alt+Enter and right-click on its card |
| Refine's facets, Focus and Filters | Their summary, always drawn, which says what the fold is doing |
| A `.help-text` line | Help on this page; it is never a control or a state |
| Ornament | Nothing: it said nothing |

Typing doesn't reveal. A region's `:focus-within` doesn't count while focus
is in its `.query-input` (`:not(:has(.query-input:focus))`), so searching on
the Task board keeps it at six controls: DECKARD ▾, Add task, ⋯, Builder,
the field and →. Zen regions never nest, since a tool hides while any region
around it is at rest.

Collapsing toolbars behind ⋯ was considered and rejected: it would put
frequently used filters two clicks away, which crosses from "less noise" into
"less usable".

## What the suites cover

Zen is CSS and markers, which makes it easy to break quietly.

**`src/test/zen-controls.test.ts`** draws Home, a search page, the Task
board as a board and as a table, the calendar page, the sidebar Calendar,
Context and the Notes Graph with Zen on and off, without VS Code, so it runs
with the unit suites:

- **Zen keeps every control on the page:** the set of controls (every
  button, input, select, link, summary, `[data-action]` and focusable
  element, by tag, action, value, type and words) is identical.
- **Sheets:** no rule Zen turns on sets `display: none` or
  `visibility: hidden` on a button, input, select, link, summary or
  `[data-action]`, in any page's sheets or any theme. Every rule that draws
  a `[data-reveal]` or `[data-zen-reveal]` at no opacity names its region
  and shows on its `:hover`, `:focus-within`, `:focus-visible`,
  `[data-reveal-keep]` and `[aria-expanded="true"]`, and sits in
  `@media (hover: hover)`.
- **Rendered pages:** every reveal target is inside its region, none sits on
  a `.segmented` member, none is `tabindex="-1"` but the board card ⋯, and
  no control is drawn with no box under Zen that is drawn at Full, by the
  page's computed styles.
- What each page quiets and keeps: the Task board's six controls at rest,
  the kept Sorts and Can start now, the week marks, the folds and their
  summaries.

**`src/test/zen-mode.test.ts`** (under VS Code) holds the switch: the
setting, the body's marker, ⋯'s checkbox and what it posts, and that
`display.css` declares no color.

**`verifyWebviews.js`** holds the cascade: every page's sheets end with
`display.css`.

**`checkLayout.js`** lays out every surface with Zen off and on, in all
eight themes. In a Zen pass it hovers the surface's Zen regions
(`zenHovered` in `test/ui/surfaces.js`) with its row. **`checkContrast.js`**
needs no Zen pass, since it reads every marked rule; a new signature there
means a color reached `display.css`, and the fix is the rule.
