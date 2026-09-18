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
import { createNonce, getBaseCss, getComponentScript } from './components';
import { getDeckardTheme, getDeckardThemeCss } from './themes';

const nonce = createNonce();
const csp = getContentSecurityPolicy(webview.cspSource, nonce);
```

```html
<style nonce="${nonce}">${getBaseCss()}
  /* only what is specific to this page */
  ${getDeckardThemeCss(getDeckardTheme())}
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
theme sheet.** A page overrides a component by restating the rule after
`getBaseCss()`; a theme overrides tokens for everyone.

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
<div class="segmented task-filter-toggle" role="group" aria-label="Task status">
  <button class="active">All</button>
  <button>Open</button>
  <button>Done</button>
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
| `.task-filter-icon` | The list / open-box / checked-box icons, from `taskFilterIcon()`. |
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
| `.board-card` | A `.task` card with a checkbox, inline-tag title, `.board-details`, and a corner `.board-move` menu. |
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
| `renderTaskFilterSwitch(filter, counts, action)` | The All / Open / Done `.segmented` switch with counts, as a tag overview's Tasks pane and the Task Board's list show it. |
| `installRankedRows(options)` | Ranks rows by dragging them, with a ghost and a placeholder, or by **Move to top** and **Move to bottom** on their context menu. `options.kinds` names each kind of row by selector and dataset key; the page supplies `canRank`, `reorder`, `move`, and any more menu actions. A drag never starts on a control inside a row, such as a button, field, or a `<summary>`, so the control keeps its click. The Dashboard ranks tags, entities, and Home's widgets with it, the Task Board its tasks. |
| `rankKeys(keys, key, target, before)`, `moveKeyToEdge(keys, key, toTop)` | The new order a drag or a menu choice asks for. |

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
npm run test:ui     # renders every webview and checks the guarantees below
npm run test:e2e    # drives the overview host, script and sidebar together
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
without a shared surface class, or loses one of its layout contracts.

Because the webviews are strings, the compiler cannot check any of this. Run
these two after touching `components.ts`.

## Adding a component

1. Add the rule to the matching section of `components.ts` and the helper to
   `getComponentScript()` if it needs behaviour.
2. Delete the local copies from every page that had one.
3. Document it in the table above.
4. Run `npm run test:ui` and `npm run test:e2e`.

If only one page will ever use it, leave it in that page. A component earns
its place here when a second page needs it.
