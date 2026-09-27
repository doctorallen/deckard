# Piece 9: shared component primitives, implementation plan

Written 2026-09-25 against `dev` at `726d23b` (v1.22.0). Source: 
`docs/ux-fifteen-sources-plan.md`, Piece 9 and Decisions 4 and 5. Everything
below was checked against the current source. Line numbers are at `726d23b`.

---

## 1. Scope

This plan covers **9a–9g**. Decision 5 applies: `getProvenanceCss()`
(`components.ts:686–796`) and the hover-revealed file and line **are not
touched**. That includes its `z-index: 1/2` rules (`components.ts:723, 736,
772`) and the sidebar's `.note:hover { z-index: 20 }`
(`sidebarNotesHtml.ts:109`), which lifts a card over the next one for that
overlay. The z-index scale in 9e leaves all four alone.

What verification found:

| Item | Claim | Verified? | Change to the plan |
| --- | --- | --- | --- |
| 9a | The card ⋯ menu drops the current value and shows no keys | **Yes.** `taskCardMoves` → `option()` returns `undefined` when `value === columnId` (`components.ts:1649`). `openActionMenu` draws plain `role="menuitem"` buttons (`:1538`). The keys `x t m d e 0–5 [ ]` live only in `handleCardKey` (`:1857–1883`) and `aria-keyshortcuts` on the card. | Only the column the card is in is dropped today. The card does not carry its status, priority, or due date, so a board grouped by Status cannot check the current priority. **Added:** the host sends `TaskBoardCard.current`. |
| 9b | Hover paints disabled buttons; Save and Clear leave the tab order and explain themselves only in `title` | **Yes.** `button:hover` (`components.ts:184`) and all seven non-Corpo theme `button:hover, button.active` rules (`themes.ts:185, 242, 294, 355, 431`, LCARS `:484`, Corpo `:99`) have no disabled guard. Only `.pagination` has one (`:278`). Save (`searchPageHtml.ts:177`, `taskBoardHtml.ts:102`) and Clear (`components.ts:2782`) use the `disabled` attribute, toggled in `syncTextButtons` (`:2947`). | History Back and Forward (`searchPageHtml.ts:349–350`) are the same case and are **added**. Pagination steps keep `disabled`, since their reason is plain. |
| 9c | Tags and chips handle long text three ways; `#topic/replicants` breaks in a Related Notes card | **Yes.** There are three ways today: ellipsis (`.refine-value-open > .tag-label`, `sidebarNotesHtml.ts:148`), wrap anywhere (`.active-tag-open > .tag-label` `:150`, `.query-chip-label` `components.ts:2529`, and tags inside `.card-title`, which inherits `overflow-wrap: anywhere` `:417`), and no rule at all (`.tag-open`, `.note .tag-list button`, where Chromium's line breaker splits after the `/`). | None. |
| 9d | About 100 native `title` tooltips, none shown on focus; `renderIconButton` emits the tip | **Partly.** There are 130 `title=` occurrences (graph 47, debug page 13). **`renderIconButton` does not exist.** Icon buttons are hand-written at 7 sites. | **Changed:** 9d **adds** `renderIconButton` and moves the icon buttons onto it. Only titles on focusable controls migrate (see Design). |
| 9e | Three popover styles, three z-indexes | **Yes, and more.** Borders: `.tag-context-menu`/`.action-menu` use 2px amber, z 20; `.rank-context-menu` uses 1px amber-bright, z 20; `.view-options-menu` uses 1px slate, z 3; `.home-widget-options-menu` z 4; `.query-suggestions` 2px amber, z 12; `.relevance-tooltip` z 30; `.key-sheet` z 30; `.drag-ghost` z 10. | None. |
| 9f | Loading uses the dashed empty box, with no `aria-busy` | **Yes.** There are six initial `<main id="app"><div class="empty">Loading …...</div>` blocks (calendar, stats, board, search, dashboard, sidebar), plus Home's `Loading Home…` (`dashboardHtml.ts:893`) and the sidebar's `state === 'loading'` progress line (`sidebarNotesHtml.ts:377–380`). `aria-busy` appears nowhere. | The sidebar's progress line redraws on every scan tick, so a 400 ms reveal would restart forever. It gets an `immediate` variant. |
| 9g | No `button.danger`, no undo/confirm rule | **Yes.** Today: Remove saved search asks through a host modal (`dashboard.ts:510–528`). Reset widgets asks through an inline confirm (`dashboardHtml.ts:897`). Remove widget (`:1074`) and Remove status column (`taskBoardHtml.ts:361`) act at once with no undo. Reset graph is being made undoable by **1j**. | None. |

Nothing was dropped.

---

## 2. Design

### 9e. One popover, one stacking order, one menu item

**Z-index scale.** These are tokens in `getDesignTokens()`, and every
popover-class rule uses them:

| Token | Value | For |
| --- | --- | --- |
| `--z-raised` | `1` | A chosen segment raised over its neighbors (existing `z-index: 1` rules in `.segmented`, `.view-options-choices`, dashboard tabs) |
| `--z-dropdown` | `10` | Attached to a control: the gear's menu, a widget's options, search completions |
| `--z-menu` | `20` | Context and action menus, positioned `fixed` |
| `--z-tooltip` | `30` | `data-tip`, the relevance tooltip, the graph's hover card |
| `--z-modal` | `40` | The `?` key sheet |
| `--z-drag` | `50` | The drag ghost (today it is 10, *under* the menus) |

These stay as they are: the provenance `z-index: 1/2` rules (Decision 5), the
sidebar's `.note:hover { z-index: 20 }` (also provenance), and the graph's
page-local overlay layers 1–2.

**`.popover` base** in `getTagCss()`'s place for menus, which becomes a new
`getPopoverCss()` inside `getBaseCss()`:

```css
.popover { z-index: var(--z-menu); min-width: 150px; padding: var(--space-1);
  border: var(--edge) solid var(--amber); border-radius: var(--control-radius);
  background: var(--panel-raised); color: var(--text);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .45); }
.popover[hidden] { display: none; }
.popover.is-dropdown { z-index: var(--z-dropdown); }
.popover.is-tip { z-index: var(--z-tooltip); max-width: 280px; padding: var(--space-1) var(--space-2);
  border-width: 1px; border-color: var(--line-strong); font-size: var(--text-xs); line-height: 1.4; }
```

The amber edge is the look most readers already see, on the tag menu, the
card menu, and completions. The gear's menu and the rank menu take it on.
Each popover keeps its own class for placement: `.tag-context-menu`,
`.action-menu`, `.rank-context-menu`, `.view-options-menu`,
`.home-widget-options-menu`, `.query-suggestions`, and `.relevance-tooltip`
all gain `popover` in their markup and drop their own border, background,
shadow, and z-index. Corpo's widget-colors rule (`themes.ts:96`) becomes
`.popover, …` so every popover follows VS Code's widget colors, and
`.popover.is-tip` takes `--vscode-editorHoverWidget-*`. Synthwave's and LCARS'
`.rank-context-menu` overrides (`themes.ts:198, 484`) move to `.popover`.

**`.menu-item`**, one row for every menu (tag, action, rank, and the page
context menus on search and sidebar):

```css
.menu-item { display: flex; align-items: center; gap: var(--space-2); width: 100%;
  min-height: 28px; margin: 0; border: 0; padding: 0 var(--space-2);
  text-align: left; text-transform: none; }
.menu-check { flex: 0 0 16px; display: inline-grid; place-items: center; }
.menu-key { margin-left: auto; padding-left: var(--space-3); color: var(--muted); font: var(--text-xs) var(--font-mono); }
button.menu-item:hover .menu-key { color: inherit; }
```

`.tag-context-menu button` and `.rank-context-menu button` are replaced by
`.menu-item`. The target is 28px, above WCAG 2.5.8's 24px.

### 9a. A menu that says what is chosen, and its keys

- An item can carry `{ value, label, checked?, key? }`. A **group** whose items
  carry `checked` (true or false) is a single-select group. Its items become
  `role="menuitemradio"` with `aria-checked`, and every item in the menu gets
  the 16px `.menu-check` column, so labels line up whether or not a check is
  drawn. The check is `strokeIcon(ICON_PATHS.check)`, a new
  `check: '<path d="m3.5 8.5 3 3 6-7"/>'` in `icons.ts`, with
  `aria-hidden="true"`.
- `key` draws `<kbd class="menu-key" aria-hidden="true">1</kbd>` at the right,
  and `aria-keyshortcuts="1"` on the item. **The key also works while the
  menu is open**, so the hint is true in both places. Pressing `1` in the open
  menu chooses High.
- In the card menu, the current status, priority, and due choice are **kept and
  checked**, not dropped. Choosing the checked item closes the menu and
  announces `"Draft spec: Priority is already High."`, with no post.
- The keys shown are exactly those `handleCardKey` already honors:

| Group | Item | Key |
| --- | --- | --- |
| Status | (each status) | none |
| Priority | Highest, High, Medium, Low, Lowest, No priority | `1`, `2`, `3`, `4`, `5`, `0` |
| Due | Due today, Due tomorrow, No due date, Due on a date… | `t`, `m`, none, `d` |
| This board | (other columns) | none |
| Done | Complete it | `x` |

- Due checks **Due today**, **Due tomorrow**, or **No due date** when that is
  the case. A task due on any other day checks nothing in the group, since a
  radio group may have none checked, and its date is on the card.

### 9b. Disabled means no hover, and says why

- **Selector guard.** Every hover rule whose subject can be a disabled control
  (`button`, `select`, `input`, or a class on one) gains a zero-specificity
  guard:
  ```css
  button:hover:where(:not(:disabled):not([aria-disabled="true"])) { … }
  ```
  `:where()` adds no specificity, so every existing cascade outcome,
  `.query-bar-row .query-apply:hover` over `button:hover` for example, stays as
  it is. The guard is a constant, `ENABLED`, in `components.ts` and is exported
  for `themes.ts` and the pages, so it is written once.
- **Rest look.** `button:disabled, button[aria-disabled="true"] { opacity: .5;
  cursor: default; }`. This replaces `button[disabled]` and looks identical.
- **`aria-disabled` with a reason** for controls that hold a place in a bar.
  They stay in the Tab order, focus shows the reason (9d), and a screen reader
  hears "dimmed" plus the reason:

| Control | Enabled tip | Reason when it cannot act (`data-tip-disabled`) |
| --- | --- | --- |
| Save (search page) | `Keep this search, named, on Home` | `Type a search to save it` |
| Save (board) | `Keep this search, named, on Home; it reopens on the Task Board` | `Type a search to save it` |
| Clear | `Clear the search` | `The search is already empty` (no `clearedText`), or `Only this page's own tag is left` (a tag page) |
| Back | `Back to the search before` + key `Alt+←` | `No search before this one` |
| Forward | `Forward to the search after` + key `Alt+→` | `No search after this one` |

- **Blocking.** One capture-phase `click` listener in `getComponentScript()`
  runs `if (event.target.closest('[aria-disabled="true"]')) { preventDefault();
  stopImmediatePropagation(); }`. It is installed before any page listener,
  so no page handler has to remember. Enter and Space on a focused
  `aria-disabled` button raise `click` and are blocked the same way.
  `handleClick`'s existing `disabled` check (`components.ts:3766`) stays for
  the `disabled` ones.

### 9c. One rule for a tag or chip that is too long

- **Single line, ellipsis, namespace first.** `renderTagLabel` (non-SVG) splits
  the namespace's slash out, so a shortened namespace keeps it:
  `<span class="tag-label"><span class="tag-namespace"><span class="tag-namespace-text">#project</span>/</span><span class="tag-value">atlas</span></span>`.
  `.tag-namespace`'s `textContent` is still `#project/`, which keeps
  `search-page-behavior.test.ts:529` and `stats.e2e.js:105` true.
  ```css
  .tag-open, .inline-tag, .query-chip, .query-facet-value { max-width: 100%; min-width: 0; }
  .tag-label { display: inline-flex; max-width: 100%; min-width: 0; vertical-align: bottom; white-space: nowrap; }
  .tag-namespace { display: inline-flex; flex: 0 1000 auto; min-width: 3ch; }
  .tag-namespace-text, .tag-value, .query-chip-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag-value { flex: 0 1 auto; }
  ```
  `flex-shrink: 1000` makes the namespace give way first, down to about
  `#p…/`, and only then does the value shorten. `#topic/replicants` in a
  220px sidebar card now reads whole or as `#to…/replicants`, never split
  over two lines.
- **Where it applies:** `.tag-open` everywhere, `.inline-tag`, the Related
  Notes card tags, the active-tag and Refine rows in the sidebar (so the
  wrap-anywhere exception at `sidebarNotesHtml.ts:150` is removed, and a long
  own tag gets an ellipsis and a tip), query chips (`.query-chip-label`,
  `max-width: 28ch`), and Refine chips. Tags in `.card-title` no longer
  inherit `overflow-wrap: anywhere`, because they have `white-space: nowrap`.
- **Tip only when truncated.** A tag or chip carries
  `data-tip-overflow="#topic/replicants"`. The tip primitive (9d) shows it only
  when a `.tag-namespace-text`, `.tag-value`, or `.query-chip-label` inside
  has `scrollWidth > clientWidth`. The check is lazy, at hover or focus time,
  so nothing is measured on render. The accessible name already holds the
  full tag (`aria-label="Open #topic/replicants overview"`).
- **Dashboard tag rows** (`.tag-name`, `dashboardHtml.ts:114`) are rows, not
  tokens, and keep wrapping.
- **Decision 4 / Piece 4.** This rule is geometry only: `white-space`,
  `overflow`, `flex`, and `max-width`. It declares no color, border,
  background, or padding, so it composes with whatever subtler card-view tag
  Piece 4 designs. Piece 4 must keep the `.tag-label > .tag-namespace >
  .tag-namespace-text + .tag-value` structure and must not set `white-space`
  on tags.

### 9d. `data-tip`: a tooltip that keyboards get too

- **Markup.** Any element can carry `data-tip="Run this search"`, an optional
  `data-tip-key="Alt+←"` (drawn as `<kbd>`), `data-tip-disabled="…"` (used
  while `aria-disabled="true"`), or `data-tip-overflow="…"` (9c).
- **One shared element.** `<div id="deckard-tip" class="popover is-tip"
  role="tooltip" hidden>` is created on first use.
- **Timing.**
  - A keyboard focus shows the tip **at once**. Keyboard modality is tracked
    from the last `keydown` against the last `pointerdown`, so it works in
    jsdom and does not rely on `:focus-visible`.
  - A pointer shows it after **400 ms**, or at once when another tip closed
    less than 300 ms ago (the warm window, so running along a toolbar does not
    wait at every button).
  - Touch (`pointerType === 'touch'`) never shows one.
- **Hoverable and dismissible** (WCAG 1.4.13). `pointerleave` hides it after a
  100 ms grace unless the pointer has entered the tip. **Escape** hides it and
  is consumed (preventDefault plus stopPropagation) **only when a tip is
  showing**, so it does not also close a menu behind it. The tip also hides on
  `pointerdown`, `blur`, scroll, and redraw.
- **Placement.** Centered below the target, 6px off. It flips above when there
  is no room and is clamped 8px inside the viewport.
- **Accessibility.** While shown, the target's `aria-describedby` gains
  `deckard-tip`, and it is removed on hide. This is the ARIA tooltip pattern.
  When the tip text equals the accessible name, as on an icon button whose
  tip is its label, `aria-describedby` is not added, so nothing is read twice.
- **`renderIconButton({ action, label, tip, key, icon, className, attributes,
  pressed, disabledReason })`** is added to `getComponentScript()`. It emits
  `<button type="button" class="icon-button …" data-action aria-label=label
  data-tip=(tip || label) [data-tip-key] [aria-pressed] [aria-disabled +
  data-tip-disabled]>icon</button>`. It **never** emits `title`. A host-side
  twin, `iconButtonHtml()`, serves the pages whose static HTML is built on the
  host (the graph's zoom buttons).
- **What migrates.** A `title` on a **focusable control** (`button`,
  `summary`, `input`, `select`, `a`, `[tabindex]`) becomes `data-tip`, since
  those are what a keyboard reaches and what `title` fails. These keep
  `title`: `<option>` (a native select draws it), non-focusable spans such as
  the priority badge, the weight rail, the tab-search mark, and Stats'
  timestamp, and the Related Notes debug page's `<th>` headers (a developer
  page). The graph's paired `<label title>` and `<input title>` become one
  `data-tip` on the input. The words stay as they are, since Piece 8f rewrites
  them.
- **Updated convention** (`components.md`, "A visible label is the accessible
  name"): "*use `data-tip` for the longer explanation; never `title` on a
  control*".

### 9f. Loading

- **`.loading`**: muted, centered, mono text in the page's normal flow, with
  no dashed box. It is revealed after **400 ms** by a CSS animation step, so
  a page that renders within 400 ms never flashes it:
  ```css
  .loading { display: grid; min-height: 96px; place-items: center; color: var(--muted); font: var(--text-sm) var(--font-mono); opacity: 0; animation: loading-reveal 0s linear 400ms forwards; }
  .loading.is-immediate { opacity: 1; animation: none; }
  @keyframes loading-reveal { to { opacity: 1; } }
  ```
  The reveal is a step, not motion, so the reduced-motion rule (which only
  kills `transition`) does not affect it.
- **Host helper** `loadingHtml(label)` returns `<main id="app"
  aria-busy="true"><div class="loading" role="status"><span>Loading search…</span></div></main>`.
  All six pages use it, with their words normalized to one ellipsis
  character: `Loading calendar…`, `Loading statistics…`, `Loading tasks…`,
  `Loading search…`, `Loading index…`, `Loading related notes…`. The **script
  helper** `renderLoading(label, immediate)` draws the same `div` for Home's
  `Loading Home…` and for the sidebar's indexing progress, which uses
  `immediate` because it redraws every scan tick.
- **`aria-busy`**: one `MutationObserver` in `getComponentScript()` on `#app`
  keeps `aria-busy="true"` exactly while `#app` contains a `.loading`, so no
  page is touched. `#live-status` sits outside `#app` on every page, so
  announcements still go through.
- **Search in flight.** In `createQueryEditor`, `run()` starts a 1 s timer.
  When it fires while `awaitingApply` is still true, it adds `.is-searching`
  to `.query-workspace` and sets `aria-busy="true"` on `#app`. The next
  applied state (the branch that sets `awaitingApply = false`) clears both,
  and `renderBar` draws the class while it is set, so a redraw in between
  keeps it.
  ```css
  .query-workspace { position: relative; }
  .query-workspace.is-searching::after { content: ""; position: absolute; left: 0; right: 0; bottom: -2px; height: 2px; background: linear-gradient(90deg, transparent, var(--accent), transparent); background-size: 40% 100%; background-repeat: no-repeat; animation: searching 1.1s linear infinite; }
  @keyframes searching { from { background-position: -40% 0; } to { background-position: 140% 0; } }
  @media (prefers-reduced-motion: reduce) { .query-workspace.is-searching::after { animation: none; background: var(--accent); opacity: .5; } }
  ```
  This sheet declares a `background` under `.is-searching`, not under
  `body.zen`, so zen's "no colors" rule holds. In zen the bar stays, because
  it is information and not ornament.
- **Piece 10b** puts its "Indexing 412 of 3,760 notes…" count into
  `loadingHtml` / `renderLoading`. 9f gives it the primitive.

### 9g. `button.danger`, and undo or confirm

- **Rule** (`components.md`, new "Destructive actions" section):
  > **Undo what can be undone; confirm only what cannot.** An action whose
  > result can be put back acts at once and offers **Undo** inline for 8
  > seconds. An action that cannot be put back asks first, and the button that
  > commits it is `button.danger`. A danger button is never the only or the
  > first button in its row, and it is never filled at rest.
- **Tone.** A new meaning token, `--destructive: var(--danger)`, is added to
  the table.
  ```css
  button.danger { border-color: var(--destructive); color: var(--destructive); }
  button.danger:hover:where(:not(:disabled):not([aria-disabled="true"])), button.danger:focus-visible { border-color: var(--destructive); background: var(--destructive); color: var(--destructive-fg); }
  ```
  Each theme declares `--destructive-fg`, the ink on the filled hover: `#fff`
  on dark themes, and in Corpo it is `var(--vscode-button-foreground)` over
  `var(--vscode-inputValidation-errorBorder)`. LCARS fills buttons at rest, so
  its danger is `background: var(--favorite-red); color: #050505`. Contrast
  is checked in all eight themes by `test:contrast`.
- **Where it applies:**

| Action | Today | After |
| --- | --- | --- |
| Remove saved search (Home) | host modal, "Remove" | unchanged. The modal is VS Code's own, and the saved search and its widget are gone for good. |
| Reset widgets (Home, customizing) | inline confirm | the confirm's **Reset widgets** becomes `button.danger` |
| Remove widget × (Home, customizing) | acts at once, no way back | acts at once. The edit bar says **"Removed Tasks view."** with **Undo** for 8 s, which puts it back at its place with its width and options. |
| Remove status column × (board gear) | acts at once | acts at once, with **"Removed the review column."** and **Undo** for 8 s |
| Reset graph | 1j makes it "Graph reset. Undo" | 1j's inline undo is moved onto the shared primitive below |

- **Shared inline undo.** `renderUndoNotice(message, action)` returns `<span
  class="undo-notice" role="status">Removed Tasks view. <button type="button"
  data-action="{action}">Undo</button></span>`. The page keeps the undo
  payload, and `undoNotice.start(render)` clears it after 8 s, or on the next
  destructive action. One helper serves Home, the board gear, and the graph
  (after 1j).

---

## 3. Implementation steps

### 9e: popover base, z-index scale, `.menu-item`
- `components.ts`
  - `getDesignTokens()`: add the six `--z-*` tokens.
  - New `getPopoverCss()`, called from `getBaseCss()` after `getTagCss()`. It
    contains the `.popover`, `.is-dropdown`, `.is-tip`, `.menu-item`,
    `.menu-check`, and `.menu-key` rules.
  - Strip border, background, shadow, and z-index from `.tag-context-menu`
    (`:355–372`), `.rank-context-menu` (`:624–626`), `.view-options-menu`
    (`:307`), and `.query-suggestions` (`:2552`). Change the existing
    `z-index: 1` rules to `var(--z-raised)`, `.key-sheet` to `var(--z-modal)`,
    and `.drag-ghost` to `var(--z-drag)`.
  - Markup: add `popover` to `tagContextMenu.className` (`:1429`),
    `actionMenu.className` (`:1500`), the rank menu (`:2318`), the gear's menu
    in `renderViewOptions` (`:2031`, `popover is-dropdown`), and the
    completions (`:2781`, `popover is-dropdown`). Change menu item `<button>`s
    to `class="menu-item"` in `openTagContextMenu`, `openActionMenu`, and the
    rank menu.
- `dashboardHtml.ts:210`: `.home-widget-options-menu` goes to the popover base
  as `is-dropdown`. `sidebarNotesHtml.ts:121`: `.relevance-tooltip` goes to
  `popover is-tip` and keeps its width and placement. `searchPageHtml.ts` and
  `sidebarNotesHtml.ts` page context menus: their items become `menu-item`.
- `themes.ts`: line 96 becomes `.popover, …` plus a `.popover.is-tip`
  hover-widget line. Lines 198 and 484 retarget `.rank-context-menu` to
  `.popover`.
- `notesGraphHtml.ts:90`: `.tooltip` z-index becomes `var(--z-tooltip)`, and
  the overlay layers stay.

### 9d: tip primitive, `renderIconButton`, migration
- `components.ts` `getComponentScript()`:
  - `installTips()` runs once at script start. It does modality tracking,
    handles `pointerover`, `pointerout`, `focusin`, `focusout`, `keydown`
    (Escape), `pointerdown`, and `scroll` (capture) on `document`, and
    provides `showTip(el)`, `hideTip()`, `tipTextFor(el)`, and
    `isTruncated(el)`. `tipTextFor` returns `data-tip-disabled` when
    `aria-disabled="true"` and one is present, otherwise `data-tip`,
    otherwise the `data-tip-overflow` text when `isTruncated(el)`, otherwise
    nothing.
  - `renderIconButton(options)` as designed.
  - A redraw hook: pages call `preserveFocus`-style redraws. `hideTip()` runs
    whenever `#app`'s subtree is replaced, through the 9f `MutationObserver`,
    so a tip never points at a detached node.
- Host-side `iconButtonHtml()` goes in `components.ts` for static HTML.
- **Migration**, one site at a time, dropping `title` and adding `data-tip`:
  - components.ts: board ⋯ (`:1722`, through `renderIconButton`), board
    checkbox (`:1717`), + Add task (`:1759`), Help button (`:2022`, through
    `renderIconButton`), gear `summary` (`:2031`), Search, Clear, and Builder
    (`:2781–2785`), chip remove (`:2875, 2881`), recovery Drop and Clear
    (`:2978, 2981`), facet values (`:3040`), builder NOT (`:3075`), builder
    operator `select` (`:3118`).
  - searchPageHtml.ts: history Back and Forward (`:349–350`, through
    `renderIconButton` with `key`), layout and format toggles (`:414–415`,
    through `renderIconButton` with `pressed`; **keep 1a's icon swap** if
    Piece 1 has landed), Save (`:177`), Bulk edit, Export, and the hub button.
  - taskBoardHtml.ts: Save, Export, the Tasks-view toggle (4h moves it; carry
    `data-tip` either way), Back to ranked order, sort headers, Remove column.
  - dashboardHtml.ts: widget gear `summary` (`:815`), remove × (`:831`), row
    actions (`:627`), paired-tag rows (`:661`), page steps (`:855`), Reset
    widgets (`:898`), and the draggable widget `article` (`:833`, tabindex=0).
  - sidebarNotesHtml.ts: insert-link, relevance score, open-line, open tag in
    new tab, the link-mention buttons, and the entry `article`.
  - statsHtml.ts: all focusable ones (Merge, Read again, open-in-search, and
    the tiles).
  - calendarHtml.ts: day and week buttons, prev and next month, and the month
    title. Day cells keep their tooltip text as `data-tip`; their
    `aria-label` already carries the count.
  - notesGraphHtml.ts: zoom in and out, fit, and reset (through
    `iconButtonHtml`), clear tag filters, and every slider and checkbox
    `input` (the label's `title` is dropped).
- **Not migrated:** `<option title>`, `span.priority-badge`,
  `.tag-weight-rail`, `.tab-search-mark`, Stats' timestamp span,
  `relatedNotesDebugHtml.ts` `<th>`, and the board-settings `<li>` drag hint.
  The last is a non-focusable row; its hint is already said by the ⋯ and the
  settings note.

### 9b: disabled
- `components.ts`
  - `export const ENABLED = ':where(:not(:disabled):not([aria-disabled="true"]))'`.
  - Rewrite `button:hover, select:hover, .tag-open:hover` (`:184`) as
    `button:hover${ENABLED}, select:hover${ENABLED}, .tag-open:hover`.
  - Rewrite `button:hover *` (`:204`) the same way.
  - `.pagination button:hover:not([disabled])` becomes `${ENABLED}`.
  - `button[disabled]` becomes `button:disabled, button[aria-disabled="true"]`.
  - The capture-phase click blocker.
  - `syncTextButtons` (`:2947`) toggles `aria-disabled` for
    `[data-query-needs-text]` and `[data-query-clears]` instead of `disabled`.
  - `renderBar`'s Clear (`:2782`) emits `aria-disabled` plus
    `data-tip-disabled`. The reason comes from a new `clearReason()`: `Only
    this page's own tag is left` when `clearedText()` is non-empty, else
    `The search is already empty`.
  - `handleClick` (`:3766`) also returns early on `aria-disabled="true"`.
- `themes.ts`: every `button:hover`/`select:hover` in Corpo (`:99`), Synthwave
  (`:185`), Tomcat (`:242`), Fellowship (`:294`), Cooper (`:355`), Oblivion
  (`:431`), LCARS (`:484`, including `select.related-notes-sort:hover`), and
  Replicant (through `contentHoverCss`, rows only, so nothing to guard) takes
  `${ENABLED}`. The file imports `ENABLED` from `components.ts`. That needs no
  cycle: `components.ts` imports `themes.ts`, and `ENABLED` moves to a tiny
  new `src/ui/webview/selectors.ts` that both import.
- Pages: `sidebarNotesHtml.ts:102` `button:hover`, and any other
  `button…:hover` a page states (the static test in §4 lists them), take
  `${ENABLED}`.
- `searchPageHtml.ts:177` and `taskBoardHtml.ts:102` Save: `aria-disabled`
  plus `data-tip-disabled="Type a search to save it"`. History Back and
  Forward go through `renderIconButton({ disabledReason })`.
- `test/ui/checkContrast.js`: a `stripWhere(selector)` that removes
  `:where(…)` groups (one level of nested parentheses) before `elementKey`,
  `ancestorKeys`, `specificity`, and `stateOf`. Without it the checker would
  read `button:hover:where(:not(:disabled)…` as the element key `button)`.

### 9a: menu checks and keys
- `src/core/types.ts` `TaskBoardCard`: add `current: string[]`, the move values
  the card already has, such as `['status:doing', 'priority:high', 'due:today']`.
- `src/ui/state/taskBoardState.ts` `createCard`: pass `statusNamespace` through
  `layoutTaskBoard` → `toCard`. Compute:
  - `status:` + (`readTaskStatus(task, ns)` ?? '')
  - `priority:` + (`task.priority` ?? '')
  - `due:today` / `due:tomorrow` when `dueAt` is today or tomorrow; `due:`
    when there is no `dueAt` and no `dueText`; nothing otherwise.
  - `done` when completed.
- `components.ts`
  - `taskCardMoves`: `option(value, label, key)` returns `{ value, label,
    key, checked: current.includes(value) || value === columnId }` for
    Status, Priority, and Due, and nothing is dropped. "This board" keeps
    dropping its own column, which is not a choice there. "Complete it" gains
    `key: 'x'`, "Due on a date…" `key: 'd'`, and priorities
    `'1'…'5'`, `'0'`.
  - `openActionMenu`: a group is radio when any item has `checked` defined.
    Draw `menuitemradio` with `aria-checked`. Reserve `.menu-check` in every
    item when any group is radio. Add `.menu-key` and `aria-keyshortcuts`.
    Keydown: a printable key matching an item's `key` chooses it. Arrow keys
    move focus as now, and focus starts on the **checked** item of the first
    radio group if there is one, else the first item.
  - `openCardMenu`: a choice equal to a checked value announces `"{title}:
    {Group} is already {label}."` and posts nothing.

### 9c: overflow rule
- `components.ts`
  - `renderTagLabel` gets the non-SVG split.
  - `renderTagButton` adds `data-tip-overflow="{label}"`.
  - `renderInlineTitle` and `renderTaskTitle` add it to inline tags.
  - Query chips (`:2881`) add `data-tip-overflow="{label}"` next to their
    `data-tip="Remove {label}"`. For a chip, `tipTextFor` shows the full term
    plus "Remove" on one line when truncated, and just "Remove {label}"
    otherwise.
  - Refine facet values carry it too.
  - `getTagCss()` gets the §2 rules. Drop `overflow-wrap: anywhere` from
    `.query-chip-label` (`:2529`).
- `sidebarNotesHtml.ts:148–150`: delete both `.tag-label` overflow rules (the
  shared rule now covers them), keeping `flex: 1 1 auto` on the row's label.
- **Edge cases:**
  - A tag with no namespace has no `.tag-namespace`, so the value shortens
    alone.
  - `@person` tags match the same regex.
  - The SVG form (graph labels) is unchanged.
  - An inline tag inside a task title stays inline, with `vertical-align:
    bottom` so the nowrap inline-flex does not lift the baseline. The layout
    suite checks both densities.

### 9f: loading
- `components.ts`: host `loadingHtml(label)`, script `renderLoading(label,
  immediate)`, the `.loading` CSS and keyframes, the `#app` observer, and the
  query-editor `searchingTimer` in `run()` plus the clear where
  `awaitingApply = false` (the `appliedSeen = text` branch).
- The six `*Html.ts` initial bodies call `loadingHtml(...)`. `dashboardHtml.ts:893`
  calls `renderLoading('Loading Home…')`. `sidebarNotesHtml.ts:377–380` calls
  `renderLoading(text, true)`.
- **Edge case:** a search whose answer arrives just after the timer fires
  shows the bar briefly. That is acceptable, since the plan's threshold is 1 s.

### 9g: danger and undo
- `components.ts`
  - The `--destructive` token.
  - `button.danger` rules.
  - `renderUndoNotice(message, action)` and a tiny
    `createUndoNotice(render)` holder with `show(message, action, payload)`,
    `take()`, and an 8 s timeout. It cancels its timer on `take()` and on
    `show()` of a newer one.
- `themes.ts`: `--destructive-fg` per theme, the LCARS danger override, and
  Corpo's mapping.
- `dashboardHtml.ts`
  - `remove-widget` records `{ widget, index }` and shows "Removed
    {widget.title}." in `.home-edit-bar`.
  - `undo-remove-widget` re-inserts it at `index` and calls `sendWidgets`.
  - `confirm-reset-widgets` gets `class="danger"`.
  - Leaving customize mode drops the notice.
- `taskBoardHtml.ts`: `remove-status` records `{ status, index }` and shows
  "Removed the {status} column." in `.board-settings`. `undo-remove-status`
  splices it back and calls `setStatuses`.
- `notesGraphHtml.ts`: if 1j has landed, its inline undo swaps to
  `renderUndoNotice`. If it has not, 9g leaves the graph alone and 1j uses the
  helper.

---

## 4. Tests

All four suites (`npm test`, `npm run test:ui`, `npm run test:e2e`,
`npm run test:layout`) plus `npm run test:visual` run for every commit, gated
on exit codes.

**`npm test`** (mocha under vscode-test, jsdom through `webviewPage.ts`):
- `src/test/task-board-page.test.ts`. **Update** the existing menu test
  (`:39`), which today asserts "No status" is absent and reads
  `[role="menuitem"]`. **Add:**
  - The Status, Priority, and Due items are `menuitemradio`. The card's
    current status (`No status`) and `No priority` have `aria-checked="true"`,
    and the others `"false"`.
  - High shows `<kbd>2</kbd>` and `aria-keyshortcuts="2"`. Complete it shows
    `x`.
  - Pressing `2` in the open menu posts `moveTask` with `priority:high`.
  - Choosing the checked item posts nothing and announces "…is already…".
  - Focus opens on the checked item.
- `src/test/task-board.test.ts`: `createCard` fills `current` for status,
  priority, due today, due tomorrow, no date, a far date (no `due:`), and
  done.
- **New** `src/test/components-primitives.test.ts`:
  - **9b static.** For the base sheet, the page sheets, and
    `getDeckardThemeCss(t)` for all 8 themes plus high contrast and zen, every
    selector whose subject compound is `button…`, `select…`, or `input…` and
    contains `:hover` also contains `ENABLED` or `:not([disabled])`.
  - **9b behavior** (search page and board). Save and Clear on an empty
    search carry `aria-disabled="true"`, have no `disabled`, keep
    `tabIndex >= 0`, and carry `data-tip-disabled`. Clicking them posts
    nothing. Typing a term flips them to enabled in place, without a redraw.
  - **9d.** Keyboard-focusing `[data-action="history-back"]` shows
    `#deckard-tip` at once with text `Back to the search before` and `<kbd>`
    `Alt+←`, and the button's `aria-describedby` includes `deckard-tip`.
    Escape hides it and removes the id. `pointerover` with a mouse shows it
    only after 400 ms, using the real timers already used in these tests.
    `pointerType: 'touch'` never shows it. An `aria-disabled` Save shows
    `Type a search to save it`.
  - **9d guard.** Rendered HTML of every page (search, board, dashboard Home
    and Tags, sidebar, stats, calendar, graph, help) with its snapshot has no
    `button[title], summary[title], input[title], select[title], a[title],
    [tabindex][title]`.
  - **9c.** `renderTagLabel('#topic/replicants')` produces
    `.tag-namespace-text`, and `.tag-namespace` text is `#topic/`. A tag
    button carries `data-tip-overflow`. jsdom has no layout, so with
    `scrollWidth` stubbed larger than `clientWidth` the tip shows the full
    tag, and with it equal it shows none.
  - **9e.** Every menu opened (tag context, action, rank) has class `popover`
    and `.menu-item` children. There is no numeric `z-index:` in any sheet
    except the token declarations, the provenance sheet (Decision 5), the
    sidebar `.note:hover`, and the graph's overlay layers, which are an
    explicit allowlist in the test.
  - **9f.**
    - The initial HTML of each page has `main#app[aria-busy="true"] .loading`.
    - After the first state, `aria-busy` is gone.
    - The sidebar's `loading` state renders `.loading.is-immediate` and keeps
      `aria-busy`.
    - After `apply`, advancing 1 s with no answer adds `.is-searching` and
      `#app[aria-busy="true"]`, and the next state clears both.
  - **9g.**
    - Removing a Home widget shows "Removed … Undo". Undo posts
      `setDashboardWidgets` with the widget back at its index.
    - After 8 s the notice is gone.
    - The reset confirm's button has class `danger`.
    - The board's Remove column does the same with Undo.
- `src/test/zen-mode.test.ts`: still passes, since the zen sheet is unchanged.
  It confirms that no color entered it.
- `src/test/icons.test.ts`: the new `check` path goes through `strokeIcon`.

**`npm run test:ui`**:
- `verifyWebviews.js`: the layout contracts still hold.
- `checkContrast.js`: add `stripWhere`. The new `button.danger` rest and hover,
  `.popover.is-tip`, and `.menu-key` are checked in all 8 themes. There must
  be no new entries in `contrast-baseline.json`; if LCARS or Corpo fail, fix
  the tokens, do not re-record.

**`npm run test:e2e`**: `test/e2e` flows that click Save and Clear or read
menu items are updated for `aria-disabled` and `menuitemradio`. Add one e2e
step in the board flow: open ⋯, see the check on the current column, press
`t`, and see the card in Due today.

**`npm run test:layout`** (`test/ui/checkLayout.js`, headless Chrome, 8
themes × zen):
- **9b probe.** For every `button:disabled, [aria-disabled="true"]` on the
  surface, it records computed `background-color`, `border-color`, and
  `color` at rest, forces hover the way the probe already does (`:hover` →
  `.layout-probe-hover`, and it adds that class to the disabled buttons too),
  and fails if any value changed. The board surface (empty query) has an
  `aria-disabled` Save and Clear, and the zen search page has a disabled
  Clear and Back.
- **9c probe.** On `sidebarNotes` (240px), no `.tag-open` is taller than one
  line box (`getClientRects().length === 1` on `.tag-label`), and no tag
  overflows its card sideways.
- `checkRenderedContrast.js` runs unchanged.

**`npm run test:visual`, baselines to re-record** (`test/ui/visual-baseline/darwin`):
- 9c: all 16 `*-sidebarNotes.png` and `*+zen-sidebarNotes.png`, all 8
  `*+zen-searchPage.png`, and the 16 `*-taskBoard.png` only if a card's
  inline tag changes (the probe says). Re-record in their own `test:` commit,
  as this repository does.
- 9b, 9d, 9e, 9f, 9g: **none expected.** The disabled rest look is identical,
  tips, menus, and popovers are closed in every baseline, and loading has
  been replaced by the time of capture. If one moves, investigate before
  re-recording.

---

## 5. Docs

- **`docs/components.md`**:
  - **Design tokens** table: add `--z-raised … --z-drag`, `--destructive` /
    `--destructive-fg`. Amend the `--danger` row: "Overdue. Red means this, and
    the commit button of a delete that cannot be undone (`button.danger`)."
  - **Controls**: a "Disabled" paragraph (the `ENABLED` guard, `aria-disabled`
    with `data-tip-disabled` for a control that holds its place, `disabled`
    for one whose reason is plain), and a `button.danger` row.
  - **Tags**: "One line, always" (the overflow rule and its markup,
    `data-tip-overflow`, and "Piece 4's card-view look must keep this
    structure").
  - New **Popovers and menus** section: `.popover`, `.is-dropdown`,
    `.is-tip`, the z-index scale table, `.menu-item`, and radio groups with
    checks and keys.
  - New **Tooltips** section: `data-tip`, `data-tip-key`,
    `data-tip-disabled`, and `data-tip-overflow`, with timing, Escape, and
    `aria-describedby`. `renderIconButton` / `iconButtonHtml` go in the Page
    script helpers table.
  - New **Loading** section: `loadingHtml`, `renderLoading(label,
    immediate)`, the `#app` observer, and `.is-searching`.
  - New **Destructive actions** section: the undo/confirm rule and table from
    §2, and `renderUndoNotice`.
  - **Conventions**: replace "use `title` for the longer explanation" with
    "use `data-tip` for the longer explanation; a control never carries
    `title`".
- **Help** (`helpHtml.ts`):
  - "The board from the keyboard" card (`:393`) gets the sentence "Each
    card's ⋯ menu checks what the task is now and shows the key for each
    choice; the keys work in the menu too."
  - The Search "Saving a search" card (`:405`) gets "Save stays in place until
    there is a search to save, and says so when focused."
  - A new sentence in Quick start or Tags, "Hover or Tab to any button to see
    what it does."
- **README**:
  - Task board paragraph (`:519`): "…choose a column from the card's **⋯**
    menu, which checks the task's current status, priority, and due date,
    shows each choice's key, and also works from the keyboard."
  - Otherwise no change.
- **`CHANGELOG.md` `## Unreleased`** gets one `### Changed` entry per feature
  commit, in the file's bold-lead style. For example:
  - **"Menus say what is chosen, and their keys."** The board card's ⋯ menu
    checks the task's status, priority, and due date instead of leaving the
    current one out, and shows the key that makes each change.
  - **"Every tip shows on keyboard focus."** Buttons explain themselves on
    focus as well as hover, after a short pause for the pointer, and Escape
    closes the tip.
  - **"A button that cannot act yet says why."** Save, Clear, Back, and
    Forward stay in the Tab order while they cannot act, show why on focus,
    and no longer light up under the pointer.
  - **"A long tag stays on one line."** The namespace shortens first, and the
    full tag shows on hover.
  - **"Menus, the gear, and completions look like one family."**
  - **"Loading waits before it speaks."** A page that loads quickly shows
    nothing; one that does not says so after 0.4 s, and a search still
    running after a second shows a thin bar.
  - **"Removing a Home widget or a board column can be undone."** "Reset
    widgets" is marked as the one that cannot.

---

## 6. Commits

Each commit is shippable on its own and verified with all four suites plus
`test:visual`. Order matters: 9e gives 9a and 9d their popover, and 9d gives
9b and 9c their tip.

1. `feat: menus, the gear, and completions share one popover and one stacking order` (9e)
2. `feat: a button's tip shows on keyboard focus as well as hover, and names its key` (9d: the primitive, `renderIconButton`, `iconButtonHtml`, and the migration of `components.ts`, the search page, and the board)
3. `feat: every page's tips show on keyboard focus, not only under the pointer` (9d: the migration of the dashboard, sidebar, stats, calendar, and graph, plus the no-`title` guard test)
4. `feat: a button that cannot act yet stays in the tab order, says why, and does not light up` (9b, including the `checkContrast.js` `:where` support and the layout probe)
5. `feat: a card's menu checks what the task is now, and shows the key for each choice` (9a)
6. `feat: a long tag stays on one line, shortening its namespace first` (9c)
7. `test: re-record the sidebar and search page baselines for one-line tags` (9c baselines; the board's too if the probe reports them)
8. `feat: a page still loading says so after a moment, and a slow search shows a bar` (9f)
9. `feat: a removal that can be undone offers Undo, and one that cannot asks first in red` (9g)

Nine commits. Per memory, commit messages carry no Co-Authored-By trailer,
and only the work's files are staged.

---

## 7. Size, risks, dependencies, open questions

**Size:**

| Item | Days |
| --- | --- |
| 9e | 0.75 |
| 9d | 2 (primitive 1, migration 1) |
| 9b | 1 (the theme rewrite, the checker's `:where`, the layout probe) |
| 9a | 0.75 |
| 9c | 1 (plus baselines) |
| 9f | 0.75 |
| 9g | 0.75 |
| **Total** | **about 7 days** |

**Risks:**
- **The `:where()` guard and the contrast checker.** The checker parses
  selectors with regexes, and without `stripWhere` it would misread every
  guarded hover rule. It is fixed in the same commit, and a clean
  `contrast-baseline.json` proves it.
- **Specificity drift in 9b.** `:where` adds none, so no cascade outcome
  should change. The 9b layout probe and the visual suite would show a
  changed hover on an enabled button.
- **Tip versus existing hover UIs.** The relevance tooltip and the
  provenance reveal are hover-driven too. The tip does not attach to
  `.relevance-score` (its own tooltip explains it); that button's `title`
  moves to `aria-label` only. Provenance is untouched (Decision 5).
- **`aria-disabled` click blocking** is document-level capture. A page
  handler that listens in capture before the component script could slip
  past. Today none do, since `getComponentScript()` runs first in each page's
  IIFE.
- **Nowrap tags in narrow task-title text** could push a title's last word.
  `max-width: 100%` plus ellipsis bounds it, and the layout probe at 240px
  measures it.
- **Merge conflicts.** 9d edits many of the same lines as Pieces 1a, 4h, 8e,
  and 8f. The mechanism (9d) and the words (8e, 8f) should not be done in the
  same pass on the same line; whichever lands second rebases trivially.

**Dependencies on other workstreams:**
- **Piece 4 (Decision 4, subtler card-view tags).** 9c's rule is
  geometry-only and must be kept by Piece 4's look (markup structure, no
  `white-space`). Either order works. If Piece 4 lands first, 9c's
  sidebar and search-page baselines are re-recorded on top of it.
- **Piece 1a** (format toggle icon swap) touches the same line 9d rewrites;
  keep the swap. **Piece 1j** (graph reset undo) builds the inline undo that
  9g turns into the shared `renderUndoNotice`. If 9g lands first, 1j uses
  the helper.
- **Piece 8e** may relabel Save as "Save search". 9b's tips are unaffected.
  **Piece 8f** rewrites the graph slider words that 9d moves from `title` to
  `data-tip`.
- **Piece 10b** fills 9f's `.loading` with its indexing count and `busy`.
- **Piece 4h** moves the board's Tasks-view toggle into the gear. Its
  `data-tip` goes with it.
- **Piece 11f** (Help command buttons with keybindings) can reuse
  `data-tip-key`.
- **Decision 5**: `getProvenanceCss` and its z-indexes are untouched by
  design.

**Open question for David (one):**
- **Red for a delete button.** The Unreleased CHANGELOG makes red mean
  overdue and nothing else. 9g's `button.danger` would add a second meaning,
  but only on the commit button of a delete that cannot be undone, which
  today is only **Reset widgets** in the confirm step. It is outlined at rest
  and filled only on hover or focus. **Default if unanswered:** do it, and
  amend the `--danger` row to say so. The alternative is `button.danger` in
  the neutral `--text` with a heavier border, carrying the warning in its
  words and position only.
