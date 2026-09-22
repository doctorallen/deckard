# Deckard webview components

Every Deckard panel is a standalone HTML document built from a template
literal in `src/ui/webview/*Html.ts`. Nothing can be imported at runtime, so
anything shared between panels is shared as **text**: one style sheet and one
script, both produced by `src/ui/webview/components.ts` and interpolated into
each page.

That file is the single place to change a component. A page keeps only the
rules and behaviour that are genuinely its own.

```
components.ts   tokens, base stylesheet, shared page script, nonce, CSP
themes.ts       per-theme token overrides, applied after the base sheet
icons.ts        SVG assets shared between pages
```

## How a page is assembled

```ts
import {
  createNonce, getBaseCss, getComponentScript, getPageTailCss, zenBodyAttribute,
} from './components';

const nonce = createNonce();
const csp = getContentSecurityPolicy(webview.cspSource, nonce);
```

```html
<style nonce="${nonce}">${getBaseCss()}
  /* only what is specific to this page */
  ${getPageTailCss()}
</style>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
${getComponentScript()}
  /* only what is specific to this page */
}());
</script>
```

Cascade order matters and is always the same: **base sheet → page rules →
theme sheet → zen sheet.** A page overrides a component by restating the rule
after `getBaseCss()`; a theme overrides tokens for everyone; zen comes last
because what it takes away is largely what a theme adds. `getPageTailCss()`
emits the last two together, so no page has to remember the order.

The page's `<body>` carries `${zenBodyAttribute()}`, which is `class="zen"`
when zen is on and nothing when it is off. See **Zen mode** below.

**A page keeps its own layout.** The base sheet and a page use the same
selector names — `main`, `header`, `.metrics`, `.cards` — so a base rule can
silently replace page layout that merely shares a name with it. Deleting a
page's `main` rule because the base has one is how the Dashboard's three-up
metric strip became a vertical column. Each page therefore ends with a short
layout block restating its own proportions, and `npm run test:ui` asserts
those survive the cascade (see **Layout contracts**).

---

## Contrast, and the hover pair

`npm run test:contrast` renders every page in every theme, resolves the
tokens, and works out what color sits on what background at rest and while a
control is hovered, focused, or active — including the text inside it, which
is what a hover background strands. It fails on anything new; the problems
already there are listed in `test/ui/contrast-baseline.json`, and
`npm run test:contrast -- --update` re-records them once some are fixed. It
also runs as part of `npm run test:ui`.

Hover is where contrast breaks here, because a hover is usually two rules: one
flips a control's background, another colors the control or something inside
it. **Write the pair, never one half.** `--hover-bg` and `--hover-fg` are the
tokens for it, every theme declares both, and anything inside a hovered
control inherits its color.

```css
/* Yes */
.thing:hover { background: var(--hover-bg); color: var(--hover-fg); }

/* No: the theme's hover background may be light, and this is not */
.thing:hover { color: var(--amber); }
```

The check reads each element as the page renders it, with every class it
carries, because that is where two rules meet. A `<button class="row
saved-filter-row home-row">` is both a control and a surface, and the row
rules win its background while the control rules were still coloring its
text — which is how Home's rows came to be all but invisible while hovered.

**A control that is also a surface takes the surface's text.** Its background
never becomes `--hover-bg`, so `--hover-fg` is the wrong color for it, and
what sits inside it follows it as it would inside any hovered control:

```css
/* Yes: the row rules paint it, so it reads as a row */
.home-row, .home-row:hover { color: var(--text); }

/* No: --hover-fg belongs on --hover-bg, and this never has it */
.home-row:hover { color: var(--hover-fg); }
```

## Design tokens

`getDesignTokens()` declares the whole palette on `:root`. Every page gets
every token, so a component can rely on any of them being defined. Themes
re-declare the same names.

| Token | Default | Use |
| --- | --- | --- |
| `--bg` / `--bg-dark` | `#050608` | Page background |
| `--panel` / `--panel-bg` | `#0D1017` | Card and row surfaces |
| `--panel-raised` | `#121620` | Hover and menu surfaces |
| `--panel-deep` | `#050608` | Control and inset surfaces |
| `--text` | `#D9E0E4` | Body text |
| `--muted` | `#7D8792` | Secondary text |
| `--line` / `--slate-border` | `#212936` | Default borders |
| `--line-strong` | `#34445A` | Structural rules |
| `--cyan` / `--cyan-bright` | `#00E5FF` | Links, titles, focus |
| `--green` / `--toxic-green` | `#33FF33` | Positive values, metrics |
| `--amber` / `--amber-bright` | `#FFB000` | Accents, hover, eyebrows |
| `--amber-dim` | `#7A5400` | Muted accent |
| `--favorite-red` | `#D23C28` | Favourite marker |
| `--warning-orange` | `#FF5500` | Warnings |
| `--slate-olive` | `#3E4A42` | Secondary chrome |
| `--grid-line` | `rgba(0,229,255,.04)` | Backdrop grid |
| `--font-display` | VS Code UI font | Interface text |
| `--font-mono` | VS Code editor font | Headings, code, data |
| `--edge` | `2px` | Standard border width |
| `--control-height` | `30px` | Standard control height |

**Paired tokens are not synonyms.** `--amber` and `--amber-bright` share a
default, but themes pull them apart — Synthwave makes `--amber` pink and
`--amber-bright` orange. Pick the one that matches intent, not the one that
happens to look right in Replicant.

Use `--edge` and `--control-height` rather than literal `2px` / `30px` so
density can be changed in one place.

---

## Layout

### `body`, `main`, `header`

Provided by `getShellCss()`. `body` carries the grid backdrop and base font;
`main` is a centred 1000px column with 24px padding; `header` is a flex row
with a `--line-strong` rule beneath it. Below 700px, `main` tightens to 16px
and `header` stacks.

A page that is not a scrolling document overrides these after the base sheet —
the notes graph does exactly that to go full-bleed.

---

## Typography

`getTypographyCss()`. All of these use `--font-mono`.

| Class / element | Purpose |
| --- | --- |
| `h1` | Page title. 22px, uppercase, wraps anywhere. |
| `h2` | Section heading. 14px. |
| `h3` | Sub-heading. 13px. |
| `.eyebrow` | The small amber label above a title, e.g. `DECKARD / SEARCH`. |
| `.lead` | Introductory paragraph, muted, capped at 680px. |
| `.source` | File and line beneath a card title. Muted, 11px. |

To make an element read as data rather than prose, add it to a page-local
`font-family: var(--font-mono)` rule; do not restate the whole type scale.

---

## Controls

`getControlCss()`. `button`, `select`, `input[type="text"]` and
`input[type="search"]` all share one height, border, hover and focus
treatment, so a toolbar reads as one row of controls.

| Class | What it is |
| --- | --- |
| `.toolbar` | Right-aligned wrapping row of controls. `.toolbar label` styles an inline control label. |
| `.control-row` | Left-aligned wrapping row of controls. |
| `.segmented` | **A row of buttons that reads as one control.** Collapses the borders between children and rounds the outer corners. |
| `.icon-button` | A square icon-only control at `--control-height`. |
| `.toolbar-icon` | 16px stroked SVG inside a control. `.settings-icon` switches it to filled. |
| `.view-options` | **The gear every page's view options sit behind**, drawn by `renderViewOptions()`: the `<details>` disclosure and its `.view-options-menu` of `.view-options-group` rows. `.view-options-choices` is a row of small choices inside it, such as List and Board. No theme restyles the gear, so it looks the same on every page. |
| `.filter-count` | Small muted count inside a filter button. |

### `.segmented`

Any group of joined buttons uses this, rather than each page restyling
`button + button`:

```html
<div class="segmented" role="group" aria-label="Task layout">
  <button class="active">List</button>
  <button>Board</button>
  <button>Table</button>
</div>
```

Mark the current button `.active`; the primitive raises it above its
neighbours so its border is not clipped. The second class carries only what is
specific to that group.

Used by: the task filter, the layout and format toggles, the overview tabs, and
the tag-association view switch.

---

## Tags

`getTagCss()` plus the render helpers below. A namespaced tag always dims its
`#namespace/` prefix so the value stays the readable part.

| Class | What it is |
| --- | --- |
| `.tag-open` | A tag rendered as a control that opens its overview. |
| `.inline-tag` | A tag inside a heading or task title, sized to the text around it. |
| `.tag-list` | Wrapping row of tags. |
| `.tag-namespace` | The dimmed `#namespace/` prefix. Emitted by `renderTagLabel`. |
| `.tag-context-menu` | The right-click menu, positioned by `openTagContextMenu`. |

---

## Surfaces

`getSurfaceCss()`.

| Class | What it is |
| --- | --- |
| `.row` | **Any content row a reader can open.** Border, amber hover border, cyan focus ring. `.card` and `.task` are built on the same rule. |
| `.cards` | Grid of cards, 12px gap. |
| `.card` | A `.row` with 14px padding, for a note or result. `.card-title` is its heading. |
| `.task` | A `.row` laid out as a 24px checkbox column plus content. `.task-title`, `.task.completed`, `.task-summary`. |
| `.metrics`, `.metric` | Auto-fitting grid of stat tiles with `.metric-label` and `.metric-value`. |
| `.empty` | Dashed empty state. Always says what is missing and why. |
| `.markdown` | Raw Markdown source, amber left rule. |
| `.rendered` | Rendered Markdown body. |

### Task board

`getTaskBoardCss()` and four script helpers draw the Task Board page's
Kanban board.

| Piece | What it is |
| --- | --- |
| `.board` | The horizontally scrolling row of `.board-column`s, each with a `.board-column-title`, `.board-count`, and `.board-cards`. |
| `.board-column` | Capped at the viewport's height, with `grid-template-rows: auto minmax(0, 1fr)` so the cards row may shrink; an auto row would size to its cards and the column would clip them with nothing to scroll. |
| `.board-cards` | The scroller: `overflow-y: auto` with `overflow-x: hidden` said outright, since `overflow-y` alone computes the other axis to `auto` and a theme's hover slide would then put a scrollbar under the column. A hovered board card keeps `transform: none` for the same reason. |
| `.board-card` | A `.task` card with a checkbox, inline-tag title, `.board-details`, and a corner `.board-move` menu. Each detail span is an `inline-block`: one unit to the line, breaking inside itself only when wider than the column. |
| `renderTaskBoard(board, isVisible)` | Draws the host's `TaskBoardLayout`. `isVisible` hides cards a page filters locally. |
| `renderTaskBoardCard(card, columnId, columns)` | One card. |
| `renderTaskBoardGroupSwitch(groupBy)` | The Status / Priority / Due date `.segmented` switch. |
| `installTaskBoard(post)` | Wires drag and drop, the move menu, checkboxes, card opening, and the group switch, once per page. It posts `openSource`, `toggleTask`, `moveTask`, and `setBoardGroup`. |

The board's controls use their own `data-action` names (`board-toggle-task`,
`board-move`, `set-board-group`), so a page's handlers for its other rows never
act on a board card as well.

### Task list

`getTaskListCss()` and the helpers below draw a list of tasks: the Dashboard's
search results and the Task Board's list layout.

| Piece | What it is |
| --- | --- |
| `.task-list`, `.task-row` | The grid of rows, each a `.row` with a checkbox, title, and `.task-meta` line of due date, details, file, heading, and line. |
| `renderTaskListRow(item, options)` | One row from a `DashboardTask`. `options.draggable` marks a row that can be ranked; `options.titleDisplay` is the `tagTitleDisplayMode`. Its checkbox posts through `data-action="toggle-task"`. |
| `installRankedRows(options)` | Ranks rows by dragging them, with a ghost and a placeholder, or by **Move to top** and **Move to bottom** on their context menu. `options.kinds` names each kind of row by selector and dataset key; the page supplies `canRank`, `reorder`, `move`, and any more menu actions. A drag never starts on a control inside a row, such as a button, field, or a `<summary>`, so the control keeps its click. The Dashboard ranks tags, entities, and Home's widgets with it, the Task Board its tasks. |
| `rankKeys(keys, key, target, before)`, `moveKeyToEdge(keys, key, toTop)` | The new order a drag or a menu choice asks for. |

### Result table

`.result-table` in `getTaskListCss()` styles the Task Board's table layout:
`th` holds a `button[data-action="set-table-sort"]` that fills the cell,
`.is-sorted` marks the sorted column, `.result-row` rows carry the same
`data-task-id`, `data-file-path`, and `data-line` a `.task-row` does so the
page's open and toggle handlers serve both, and `td.is-overdue` and
`td.is-muted` are the two states a cell can be in. The host makes the rows
and cells with the column model in `src/ui/state/resultTable.ts`, which a
query block's `view=table` shares, so the page only draws them.
`.table-columns` is the gear's column picker.

### `.row`

Every openable row uses this, so none of them can quietly ship without the
hover and focus treatment the others have:

```html
<div class="row tag-row" tabindex="0">…</div>
<article class="card note-row">…</article>
```

The second class carries only what is specific to that row — its grid, its
padding, its chamfered corners. The shared class carries the surface.

Used by: cards, tasks, and the dashboard's tag, entity, note, task and
saved-view rows. `npm run test:ui` fails if one of those renders without it.

---

## Zen mode

`getZenCss()`. Deckard's own chrome, turned down: decoration hidden, the frame
thinned, and each row's file and line folded away until the row is hovered or
focused. It is not a ninth theme — a theme picks the palette, zen picks how
much frame is drawn, and the two compose.

**Every rule is scoped under `body.zen`, and the sheet ships whether or not
zen is on.** Only the class is conditional. That is deliberate, and it is what
two checks depend on:

- `verifyWebviews.js` matches a layout contract by its **exact** selector
  string, so `body.zen .metric` is not `.metric` and cannot flip one.
- `checkContrast.js` reads every declared rule whether or not the page renders
  a match, so the zen rules get contrast cover across all eight themes with no
  second render pass.

Scoping also keeps the `:root` count at two. Zen's token overrides go on
`body.zen`, never in a third `:root` block.

**The sheet declares no `color`, `background`, `background-color`, or
`border-color`** — only what it takes to hide, thin, and fold. Under that rule
the contrast matrix cannot move, which is why the contrast check stays one
pass. A new signature there means a color slipped in; fix the rule rather than
re-record the baseline. `src/test/zen-mode.test.ts` asserts this directly.

**Zen hides two ways, and the difference is not cosmetic.** `display: none`
for ornament nothing refers to. The off-screen idiom — `position: absolute`
and `clip-path: inset(50%)`, the same one `.is-dragging` uses — for anything a
reader may still want, so it stays in the accessibility tree, in find-in-page,
and comes back on `:focus-within`. A node that carries an accessible name is
never dropped outright.

Two things look like chrome and are not:

- `.query-error` shares its slot with `.query-hint`. The hint goes; the error
  never does, or a search that failed to parse reads as one that found
  nothing.
- `.board-details` is a `.source`, but it carries the due date and the word
  "overdue". It does not fold. Only `.card .source`, `.note .source`, and the
  `.task-source` spans in `renderTaskListRow` do.

Spacing is restated rather than tokenized: there are no spacing tokens, so
zen's block mirrors the literals in `getShellCss`, `getSurfaceCss`,
`getTaskBoardCss`, and `getTaskListCss`. A padding change in one needs a
change in the other, and the layout suite measures both.

Its `:hover` rules must stay at the top level of the sheet. `checkLayout.js`
forces hovers by rewriting `rule.selectorText`, which a `CSSMediaRule` does
not have, so a `:hover` nested in an `@media` block is never tested.

| Host-side helper | Purpose |
| --- | --- |
| `getZenCss()` | The sheet. Always emitted. |
| `getPageTailCss()` | The theme sheet then the zen sheet, in that order. What each page interpolates after its own rules. |
| `zenBodyAttribute()` | `' class="zen"'` or `''`, for the page's `<body>`. |
| `affectsPageChrome(event)` | Whether a settings change alters how a page is drawn. Each webview host's configuration listener asks this instead of naming `deckard.theme` alone. |

---

## Page script helpers

`getComponentScript()` is inserted into each page's `<script>` immediately
after `acquireVsCodeApi()`, so these are ordinary functions in that scope.

| Function | Purpose |
| --- | --- |
| `escapeHtml(value)` | Escape snapshot data before inserting it as HTML. **Every** value from the host goes through this. |
| `renderTagLabel(label, svg)` | Render a tag's text with a dimmed namespace. Pass `svg: true` for `<tspan>` output inside an SVG node. |
| `renderTagButton(tag, className)` | A complete `.tag-open` control that posts `openTag`. |
| `renderInlineTitle(title, tags, appendMissing)` | Replace tag tokens inside a title with controls, keeping their position. `appendMissing: false` suppresses trailing tags. |
| `renderTaskTitle(html, tags)` | Decorate tags inside already-rendered Markdown without re-escaping it. |
| `formatEntityTitle(kind, name)` | `project` + `skybridge-signal` → `Project: Skybridge Signal`. |
| `taskFilterIcon(filter)` | The `all` / `active` / `completed` icons. |
| `installTagContextMenu(onAction)` | Wire right-click actions for every `[data-tag-key]` on the page. Calls back with `(action, tagKey)`. |
| `renderViewOptions(groups)` | The gear and its menu, from `{ label, html, stacked }` rows. A menu open before a redraw stays open. |
| `renderViewOptionChoices(action, choices, selected, label, attributes)` | A `.view-options-choices` row; each button carries `data-action` and `data-value`. |
| `installViewOptions()` | Closes the gear on a click outside it and on Escape. Call it before the page's own listeners. |
| `renderZenOption()` | The gear's Zen row, ready to drop into a `renderViewOptions()` list. Reads the current state from the body class, so no page carries zen through its state builder, and posts `setZenMode` from `installViewOptions()`, so no page needs a handler. |
| `renderResultTabs(tabs, active, label)` | The Notes and Tasks tabs over a search's results. Each posts nothing; it carries `data-action="set-result-tab"` for the page to switch. |
| `renderWeightRail(level, title)`, `getWeightLevel(weight)` | How much a tag weighs, as a `.tag-weight-rail` of three steps, and the step a weight fills to: three from 0.75, two from 0.375. Related Notes' active tags, Refine, and the sidebar's Refine view draw it. |

### The search box

`getQueryEditorCss()` and `getQueryEditorScript()` are the one search box
search pages, Home's search widget, and the Task Board use, so a search looks
and behaves the same everywhere: the bar and its completions, the builder,
removable terms, and **Refine**. A page creates it with
`createQueryEditor(options)`, draws `renderBar(statusControls)` and
`renderFacets()`, and passes its events through. `options.resultKinds` names
what the page can find, such as `['tasks']` on the Task Board, so the result
count names only those. `options.refineElsewhere()` returns true while the
Related Notes sidebar shows the page's Refine options, and `renderFacets()`
then draws a single line in their place.

The bar is a `.query-bar-shell` field of chips, as a multi-select is: each of
the applied search's top-level terms is a `.query-chip` button with a
`.query-chip-remove` icon, joined by `.query-chip-join` AND, and the text field
after them holds the next term. `data-query-text` on the shell is the whole
search, chips and typed term together. A chosen completion that is a whole
term becomes a chip at once; Enter adds the typed term by AND; Backspace in an
empty field removes the last chip; and a term not added is let go when focus
leaves the box. A search the host could not parse comes back as
`QueryViewState.pending`, with the last good search as `text`.

On the host, every page builds the box's state with `createQueryViewState()`
and its **Refine** counts with `buildSearchFacets()`, from the results that
page shows. A search of tags passes `related` values, ranked by association,
in place of the counted tags.

### Home

The Dashboard's Home is a two-column `.home-grid` of `.home-widget` panels;
`.is-full` spans both columns, and widgets in one row stretch to its height.
In edit mode a widget is `.is-editing` and `.is-draggable`, carries a
`.view-options-choices` width switch and its own `.home-widget-options` gear,
and is ranked with `installRankedRows`. The host projects each widget with
`createDashboardWidgets()` in `dashboardWidgets.ts`.

### Host-side helpers

| Function | Purpose |
| --- | --- |
| `createNonce()` | One nonce per page, gating its inline style and script. |
| `getContentSecurityPolicy(cspSource, nonce, options)` | The shared CSP. `{ images: true }` adds `img-src`, `{ fonts: true }` adds `font-src`. |

---

## Conventions

- **Escape everything from the host.** Snapshot values are data, not markup.
- **Post intent, do not mutate.** A control carries `data-action` and posts a
  message; the host decides and sends new state back. Pages re-render from
  that state rather than editing the DOM in place.
- **A visible label is the accessible name.** Do not add an `aria-label` that
  duplicates or contradicts button text; use `title` for the longer
  explanation.
- **Backslashes in `getComponentScript()` are written doubled.** The string is
  interpolated into a template literal, so `\\s` is what reaches the browser
  as `\s`. This is not theoretical — it has silently broken regexes before,
  and the compiler cannot see it.

## Verifying a change

```
npm run test:ui       # renders every webview and checks the guarantees below
npm run test:e2e      # drives the overview host, script and sidebar together
npm run test:layout   # lays the pages out in headless Chrome and measures them
```

### Layout contracts

`LAYOUT_CONTRACTS` in `test/ui/verifyWebviews.js` names the properties that
decide how each page is laid out — the Dashboard's `repeat(3, …)` metric
strip, Help's two-column `main`, the sidebar's 12px padding — and checks the
value each one ends up with after the whole cascade. Add a contract when a
page depends on layout that a base rule could plausibly override.

`test/ui/verifyWebviews.js` renders all eight pages and fails if any page:
stops rendering, emits a script that does not parse, is missing the design
tokens, carries more than one nonce, declares more than one `:root`,
redeclares a helper the shared script already owns, renders a content row
without a shared surface class, loses one of its layout contracts, or does not
end its style block with the zen sheet.

The contracts are read against the page as it renders **without** zen. Zen's
rules cannot reach them, because a contract matches its selector string
exactly and every zen rule is prefixed — which is the point of the prefix.

### Layout in a browser

The contracts read the stylesheet as text, and the end-to-end suites run
against a DOM with no geometry, so neither can see a column that clips its
own cards or a hover that grows a row past its scroller. `test/ui/checkLayout.js`
renders a page the way the webview does — the host's HTML, the page's own
script, a snapshot the real state builder made — inside an iframe of the size
the surface is drawn at, once per theme, and a probe in the page measures
every scroller and clipping box, resting and with the page's own hover rules
forced onto one row. A scroller that overflows sideways, a box hiding height
it cannot scroll to, or a hover it cannot find to test fails with the
elements named. Add a surface there when a page gains a scroll container.
It needs Chrome (`CHROME_PATH`, or the usual names) and skips itself without
one; CI has it.

Every surface runs twice, once with zen and once without
(`LAYOUT_ONLY=cooper+zen:sidebarNotes` picks one out), because zen is the only
thing here that makes a row grow under the pointer: it folds the file and line
away and gives them back on hover. The search page is a zen-only surface,
since that reveal sits inside a `.card-header` rather than at the end of a
row.

Because the webviews are strings, the compiler cannot check any of this. Run
these three after touching `components.ts`, and `npm test` too when the change
adds a setting or a command — `src/test/extension.test.ts` counts both.

## Adding a component

1. Add the rule to the matching section of `components.ts` and the helper to
   `getComponentScript()` if it needs behaviour.
2. Delete the local copies from every page that had one.
3. Document it in the table above.
4. Run `npm run test:ui`, `npm run test:e2e`, and `npm run test:layout`.

If only one page will ever use it, leave it in that page. A component earns
its place here when a second page needs it.
