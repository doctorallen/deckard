# Zen mode

## Why

Deckard's webviews carry a lot of furniture. On the Home dashboard, before a
single note is read, the first screen spends itself on an eyebrow
(`DECKARD / WORKSPACE INDEX`), three metric tiles wearing invented telemetry
codes (`SYS.TAG // 1982-AZ`), a dotted grid backdrop, a bordered row reading
"Home is yours to arrange.", a section label saying `SEARCH` above an obvious
search box, and a permanent line of query syntax under it. Every task row then
repeats its file name, heading, and line number in full. The Search page
states its result count four times — in the tab, in the pane heading, in the
filter switch, and in Refine.

None of it is broken, and most of it earns its place in the first week. It
stops earning it once the shape of the app is known, and what is left is a
frame competing with the notes.

Zen mode turns the frame down without taking anything away: decoration is
hidden, border weight and type treatment are thinned, and per-row provenance
folds to hover and focus so lists get shorter. Every button, filter, count,
and tag stays where it was and keeps working.

This is deliberately **not** a ninth theme. A theme picks the palette; zen
picks how much frame is drawn. They compose, so zen has to work on all eight
existing themes.

The reach is: hide decoration, thin the frame, **and** fold per-row metadata
to hover and focus. The toggle is a global `deckard.zenMode` setting, a row in
each page's view-options gear, and palette commands — the
`deckard.outline.followCursor` pattern for the context key, and
`updateTaskBoardSetting()` (`src/ui/commands/taskBoardActions.ts:52`) for the
gear half, which is already "gear row → message → `writeSetting` → config
listener → re-render" end to end.

## Three constraints that shape the design

**1. Hiding must not hide things from screen readers.** "Without removing
functionality" includes assistive technology. `components.ts:167` already
defines `.visually-hidden` (off-screen, still announced), and its comment
already makes the point that `display: none` would stop a node being
announced. So zen has two hiding verbs:

- `display: none` for pure ornament nothing refers to — `.eyebrow`, the
  `data-code` HUD labels, the grid backdrop.
- The visually-hidden idiom for anything a reader may still want — the folded
  provenance below, and any node carrying an accessible name. The Search
  page's `<h2 id="tasks-heading">` is the `aria-labelledby` target of its
  `<section>` (`searchPageHtml.ts:353-354`); dropping it outright would leave
  the results pane unnamed.

**2. `.task-meta` is not all chrome.** `renderTaskListRow`
(`components.ts:1039-1060`) packs two different things into one line:

```js
'<div class="task-meta">' + dueDate + scheduled + priority + recurrence
  + '<span>' + fileName + '</span>'
  + (sectionHeading ? '<span>' + sectionHeading + '</span>' : '')
  + '<span>line ' + lineNumber + '</span>'
```

The first four are classed (`.due-date`, `.task-detail`) and are the *point*
of a task row — a due date is not noise. The last three are bare `<span>`s and
are provenance. Only the provenance folds, so those three spans need
`class="task-source"`, rather than a `:not(.due-date):not(.task-detail)`
selector that would silently start hiding any detail added later.

**3. `.source` does not mean the same thing everywhere.** On cards and sidebar
notes it is file and line. On the task board, `<p class="source board-details">`
(`components.ts:870`) carries **due dates and overdue state** — and
`renderTaskBoardCard` prefixes the word "overdue" precisely so the information
does not depend on color:

```js
// Color alone carried this before, which says nothing to a reader who
// cannot see it, or on a board grouped by anything but due date.
```

Folding `.board-details` at rest would undo that. **Zen excludes
`.board-details` from the fold.** This is the one place the
"decorative, duplicated" rationale fails, and a blanket `.source` rule would
have walked straight into it.

## How the zen stylesheet reaches a page

Each of the nine `*Html.ts` files builds its whole document as one template
literal and interpolates its own `<style>`, in the order documented in
[components.md](components.md): **base → page rules → theme**. Zen appends a
fourth layer.

**Ship `getZenCss()` unconditionally, scope every rule under `body.zen`, and
gate only the class on `<body>`.** This is not the obvious choice — the repo's
own precedent is that only the *selected* theme's text is emitted — but two
test surfaces make it decisively better:

- **`verifyWebviews.js` matches layout contracts by exact selector string.**
  `effectiveValue()` does `selectors.includes(selector)` on the comma-split
  rule head (`verifyWebviews.js:71`), so `body.zen .metric` simply is not
  `.metric`. Every contract — `['.metric', 'clip-path', 'polygon']`, the
  `main` accent borders, the sidebar's `12px` padding — is untouched **by
  construction**. Bare-selector zen rules would flip all of them the moment
  zen was ever rendered in that check.
- **`checkContrast.js` reads every declared rule**, whether or not the page
  renders a matching element, and harvests custom properties only from
  selectors containing `:root`. So always-shipped `body.zen` rules get
  contrast coverage across all eight themes for free, with no second render
  pass, and `body.zen { --edge: … }` stays invisible to its token map.

It also keeps the `:root` count at two (`verifyWebviews.js:148-149` fails
above two, and base plus theme already use both), makes zen's rules legible
as zen's in view-source, and leaves room for a live
`document.body.classList.toggle('zen', …)` later with no re-architecture.

The cost, stated plainly: roughly 2 KB of inert CSS in the off state. Next to
a 73 KB `dashboardHtml.ts` that is noise.

Cascade position still matters and is not replaced by the specificity
tiebreak. LCARS' `.metric:nth-child(3n + 2)::before` ties with
`body.zen .metric::before`, so **position decides it** — zen must still come
after the theme sheet.

**One hard constraint: `getZenCss()` declares no `color`, `background`,
`background-color`, or `border-color`.** (`background-image: none` is allowed,
and is needed: the `--grid-line` token clears only the base sheet's grid, and
four themes paint their own backdrop onto `body` in their own colors.) Only `display`, the visually-hidden
properties, `padding`, `margin`, `gap`, `font-size`, `text-transform`,
`transform`, the three sizing tokens, and `--grid-line: transparent`. Under
that constraint the contrast matrix provably cannot move, which is what lets
the contrast suite stay a single pass.

## What zen changes

**Decoration hidden** — `.eyebrow`; the `.metric::before` `data-code` HUD
labels (`dashboardHtml.ts:37`); `--grid-line: transparent`; the Refine
instructional paragraph; `.home-hint-bar`.

Three need care rather than a blanket rule:

- **`h1` is shrunk, not hidden.** On the Dashboard it restates the tab title,
  but on the Search page it is the search *subject* — the tag or entity being
  searched (`searchPageHtml.ts:390`). Hiding it globally would delete real
  content there, and would leave every page without its only `h1` landmark.
  Zen takes it to 14px with `text-transform: none`.
- **Hide `.query-hint`, never `.query-error`.** They are the two branches of
  the same slot (`components.ts:1627`) and share the `.query-status` parent.
  A hidden parse error would leave a failed search looking like an empty one.
  The hint is also not wholly duplicated by the placeholder: `AND, OR, NOT`
  and `Press / to search` appear only in the hint, and the placeholder is
  replaced by chips once a term is entered. Hiding it is a real trade,
  justified by Help carrying the full query reference — worth saying so in the
  README line.
- **The Search pane heading folds only in the Tabs layout.** `renderResultTabs`
  is the `else` branch of the split/tabs ternary (`searchPageHtml.ts:358`), so
  `Tasks (N)` collides with `<h2>Tasks (N)</h2>` only when
  `state.layout === 'tabs'`. In Split layout the heading is the only one there.

Home's `.home-hint-bar` contains the **Customize** button, so hiding the bar
does remove a control from the page — but Customize is also the gear's "Home"
row, so nothing becomes unreachable. Worth calling out in the commit, since it
is the one place zen touches a button. Outside zen the bar is no longer
permanent either: it is drawn only while Home still holds the widgets it
started with, and goes for good once Home has been arranged or the reader
chooses **Dismiss**.

**Frame thinned** — `--edge: 2px → 1px`; `--control-height: 30px → 26px`;
`text-transform: none` and `letter-spacing: normal`; `clip-path: none` and
`box-shadow: none` on the surfaces.

**Metadata folded** — `.task-source` and `.source` (excluding
`.board-details`) hidden at rest with the visually-hidden idiom, revealed on
`:hover` **and `:focus-within`** of the containing row.

## The hover and reflow question

Revealing a hidden line on hover makes rows grow, and `test/ui/checkLayout.js`
forces every `:hover` rule on and fails on sideways overflow in a declared
scroller or unscrollable clipped height in a declared clipper.

Zen uses **the visually-hidden idiom plus a reveal on
`:hover`/`:focus-within`** — the same pattern `.is-dragging` already uses:

```css
body.zen .task-row .task-source,
body.zen .card .source,
body.zen .note .source {
  position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%);
}
body.zen .task-row:hover .task-source, body.zen .task-row:focus-within .task-source,
body.zen .card:hover .source,          body.zen .card:focus-within .source,
body.zen .note:hover .source,          body.zen .note:focus-within .source {
  position: static; width: auto; height: auto; overflow: visible; clip-path: none;
}
```

This gives the same density as `display: none` while keeping the text in the
DOM, in the accessibility tree, and in find-in-page. Only sighted mouse
selection at rest is affected. `display: none` would have taken all three
away; reserving the height wins no density at all; and a `title` tooltip
flattens `.due-date.overdue` and `.task-detail.priority-highest` into an
unstyled string and collides with the `title` board cards already carry.

The layout suite passes on all eight themes: growth is downward and vertical only,
`.board-cards` is `overflow-x: hidden` so a taller card cannot widen it, and
`.board-column`'s `grid-template-rows: auto minmax(0, 1fr)` keeps the cards
row the thing that scrolls. Reflow jitter is not a concern either, because the
folded line sits at the *bottom* of its row: a hovered row grows downward, its
top edge does not move, and the pointer never loses the row it is on.

Three guardrails, which are the actual failure modes:

1. **Never `white-space: nowrap` on the revealed line.** `.source` has
   `overflow-wrap: anywhere`; a single-line meta run in the 240px sidebar
   would blow `html`'s `scrollW` and fail the scroller assertion.
2. **Zen must kill the theme's hover slide** —
   `body.zen .row:hover, body.zen .card:hover, body.zen .note:hover, body.zen .task:hover { transform: none; }`.
   Several themes add `translateX(3px)`, which today fits only because the
   sidebar's `main` has 12px of padding to absorb it. Thinning that padding
   without removing the slide pushes a hovered row past the edge. It is also
   the right zen aesthetic, and it needs zen to sit after the theme to win.
3. **Zen's `:hover` rules must be at stylesheet top level, never inside
   `@media`.** `checkLayout.js` walks `sheet.cssRules` and reads
   `rule.selectorText`; a `CSSMediaRule` has none, so a nested `:hover` rule
   is silently never forced and the reveal would go untested.

## Spacing

There are **no spacing tokens** — every padding and gap is a literal, in
`components.ts` and again in each page's override block. Zen restates roughly
a dozen `body.zen`-prefixed rules rather than introducing a `--space-*` scale
first. Tokens would mean touching every literal in `components.ts`, all nine
pages, and all eight themes, in a diff with no behavioral change, while
`verifyWebviews`' contracts assert literal values that would have to become
token-aware.

The set: `main` (24→14px, and the sidebar's 12→8px), `header` padding-bottom,
`.card` (14→9px), `.task` and `.task-row` (10→7px, gap 8→6px), `.cards`
(gap 12→8px), `.metrics` (gap 10→6px), `.metric` (12→8px), `.task-list`
(gap 7→4px), `.board-column` (10→7px), `.board-cards` (gap 8→5px),
`.task-summary` (gap 7→4px).

**Cost:** those literals now live in two places, and nothing makes a future
padding change in `components.ts` propagate to zen. Two cheap mitigations:
keep the whole zen spacing block contiguous and commented ("mirrors the
literals in `getSurfaceCss`/`getTaskListCss`"), and cover zen in the layout
suite so a divergence shows up as a measurement rather than as something a
reviewer has to notice.

## Who needs what

| | stylesheet | `body.zen` | config listener | gear row | message |
|---|---|---|---|---|---|
| dashboard, searchPage, taskBoard | ✓ | ✓ | has theme branch | **✓** | **✓** |
| sidebarNotes, stats, calendar, help, notesGraph | ✓ | ✓ | has theme branch | — | — |
| relatedNotesDebug | ✓ | ✓ | none (one-shot) | — | — |

The gear row goes on exactly the three pages that call `installViewOptions()`
(`dashboardHtml.ts:941`, `searchPageHtml.ts:406`, `taskBoardHtml.ts:348`).
Help and the Notes Graph get the stylesheet only — Help has an eyebrow and an
`h1` but no gear, and the graph overrides `body`/`main` wholesale and has no
header at all. Neither should grow a gear for this; the palette commands are
the reachable toggle everywhere else, which is what the context key is for.

Three shared helpers in `components.ts` cut the per-file duplication:

1. **`getPageTailCss()`** — returns theme CSS plus zen CSS. Replaces the nine
   `${getDeckardThemeCss(getDeckardTheme())}` call sites one-for-one, so
   "zen comes after the theme" becomes a single fact in code rather than a
   convention repeated nine times.
2. **`zenBodyAttribute()`** — `' class="zen"'` or `''`; nine `<body>` tags
   become `<body${zenBodyAttribute()}>`.
3. **`affectsPageChrome(event)`** — `deckard.theme || deckard.zenMode`. The
   eight hosts replace one condition rather than each growing a second `||`.

**The `body.zen` choice pays off a second time in the gear.** Because the
class is on `<body>`, the page script reads
`document.body.classList.contains('zen')` directly — so there is **no
`types.ts` state change and no state-builder change**, only the new
webview→host message. `renderZenOption()` goes in `getComponentScript()` and
each of the three pages adds one array element to its existing
`renderViewOptions([...])` call; the `set-zen-mode` click case goes inside the
existing `installViewOptions()` listener and posts via `vscode` (not the
page-local `post`/`send`, which differ between `taskBoardHtml.ts:77` and
`dashboardHtml.ts:303`). That is zero per-page handler code. Add
`renderZenOption` to `SHARED_HELPERS` in `verifyWebviews.js` so no page can
redeclare it.

## What the suites cover

Zen is CSS plus one class, which makes it easy to break quietly. Four things
hold it in place, and each exists because of a specific way it could go wrong.

**`src/test/zen-mode.test.ts` proves nothing was removed.** It renders the
Dashboard and a search page twice, once with zen and once without, and
compares the full set of controls — every button, input, select, link,
`[data-action]` and focusable element, by tag, action, value and text. The two
lists must be identical. That is the feature's promise stated as an assertion,
and it is what stops zen drifting into feature-removal. The same suite asserts
the sheet declares no color, that `.query-error` and `.board-details` are
absent from it, and that provenance folds off-screen rather than with
`display: none`.

**`verifyWebviews.js` holds the cascade.** Every page's style block must end
with the zen sheet, byte for byte as `getZenCss()` emits it. Reordering
`getPageTailCss()` so zen precedes the theme fails all nine pages, which is
the point: LCARS' `.metric:nth-child(3n + 2)::before` ties with
`body.zen .metric::before` on specificity, so only position decides it.

**`checkLayout.js` holds the hover reveal**, the one genuinely uncertain part.
Every surface runs twice, zen and not, across all eight themes — 40 passes.
The reveal survives: a hovered row grows downward inside a scroller that was
already `overflow-x: hidden`, so nothing overflows sideways and nothing is
clipped beyond reach. The search page is a zen-only surface because its
`.source` sits inside a `.card-header` rather than at the end of a row.

**`checkContrast.js` needs no zen pass.** It reads every declared rule whether
or not the page renders a match, so the always-shipped `body.zen` rules are
covered by the existing eight-theme run. The expected delta is zero new
signatures; one appearing means a color reached `getZenCss()`, and the fix is
the rule, not the baseline.

`src/test/extension.test.ts` counts settings and commands exactly, so it had
to be updated in the same change — 48 settings became 49, and the ordered
command list gained the two zen commands. The e2e suite gained a
`commands.executeCommand` stub so a host that sets a context key can be
tested at all.

## Not in scope

Collapsing toolbars behind the gear was considered and rejected: it would put
frequently used filters two clicks away, which crosses from "less noise" into
"less usable". Spacing tokens are deferred, as above.
