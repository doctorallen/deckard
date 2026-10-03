# Deckard webview components

Every Deckard panel and sidebar view is a page in a webview: a small shell
the host writes, and a bundle, built from `src/webview/<page>/`, that draws
everything in it. What the pages have in common is shared in two forms, and
those are the places to change a component:

- **Components and modules**, in `src/webview/shared/`: Preact components,
  and the modules a page runs on, such as its store, its tips, and its
  menus. A page imports what it draws, and esbuild bundles it into that page.
- **Style sheets**, also in `src/webview/shared/`: the tokens, the base sheet
  and its parts, the component sheets, the themes, and the tail. A page's own
  sheet imports the base, and its shell links the rest.

A page keeps only the rules and behavior that are genuinely its own. A
component lives in `shared/` once a second page draws it.
[architecture/webviews.md](architecture/webviews.md) says how the bundles are
built and loaded, and why; this page says what there is to reuse and how.

| Where | What |
| --- | --- |
| `src/webview/<page>/main.tsx` | The page's entry: its store, its view, and its listeners. Help's is `main.ts`, a typed module with no Preact |
| `src/webview/<page>/page.css` | The page's sheet: `base.css`, the component sheets it uses, then its own rules |
| `src/webview/<page>/*.tsx`, `*.ts` | The page's own components and modules, which no other page draws |
| `src/webview/shared/` | The shared core: the page store, status and busy marks, tips, the key sheet, the undo toast, the gear, buttons and icons, tags, metrics, inline Markdown; and the parts the task, search, and Home pages share |
| `src/webview/shared/calendar/` | What the two calendars and Related Notes' day share |
| `src/webview/shared/*.css`, `shared/themes/`, `shared/calendar/calendar.css` | The sheets every page links, and the component sheets two or more import |
| `src/ui/protocol/<page>.ts` | The page's snapshot and messages, imported by the page and by its host |
| `src/domain/…` | The pure domain modules a page may import (D1 in [layers.md](architecture/layers.md)) |
| `src/ui/webview/<page>Html.ts` | The host's builder for the page's shell, given the look (`PageChrome`: the theme and zen) its host read |
| `src/ui/webview/host/pageShell.ts` | `buildPageShell`, which writes every shell; the shared Content Security Policy; `ShellWebview` and `ShellUri`, the webview and URI a shell is written against, and `joinUnder`, which joins a file onto the extension's folder. It names no `vscode` type, so a page builds without the extension host |
| `src/ui/webview/components.ts` | What the host shares when it writes a shell: the nonce, the loading line, `PageChrome`, and the sheets after a page's own (`deckardThemeCss`, `getPageTailCss`) |
| `src/ui/webview/host/pageChrome.ts` | What reads the look from the settings: `readPageChrome`, which `WebviewHost` calls each time it writes a page, and the event that redraws a page in another look |
| `src/ui/webview/host/surface.ts` | Among the panel and view surfaces, `pageResourceRoots`: the folders a page may load from |

## How a page is assembled

The host writes the shell. `buildPageShell` writes the policy, links the
page's sheet, its theme, and the tail from `dist/webview/`, puts the body in,
and, for a page with a bundle, writes the snapshot as inert JSON when there
is one, then the script:

```ts
// src/ui/webview/statsHtml.ts
return buildPageShell({
  webview, extensionUri, page: 'stats', title: 'Deckard Stats',
  nonce: createNonce(), theme: chrome.theme, zen: chrome.zen,
  bundle: true,
  state: snapshot,
  body: `
${snapshot === undefined ? loadingHtml('Loading statistics…') : '<main id="app"></main>'}
<div id="live-status" class="visually-hidden" role="status" aria-live="polite"></div>
`,
});
```

The page draws itself from one store. `startPage` installs what every page
shares, then draws the view whenever the store changes, synchronously, into
`#app`:

```tsx
// src/webview/stats/main.tsx
const store = startPage<StatsState>({
  initial: { snapshot: readEmbeddedState<DeckardStatsSnapshot>(), ...keptChoices() },
  ready: (state) => Boolean(state.snapshot),
  view: (state) => <StatsPage state={state as DrawnStats} />,
});
const ACTIONS: Record<string, ActionHandler> = {
  'toggle-used-once': () => choose({ showUsedOnce: !store.state.showUsedOnce }),
  // …
};
listenForActions(app, ACTIONS, (event) => { /* a row opens what it counts */ });
onHostMessage<StateMessage<DeckardStatsSnapshot>>('state', (message) => store.update({ snapshot: message.data }));
```

```css
/* src/webview/stats/page.css */
@import "../shared/base.css";
/* only what is specific to this page */
```

Cascade order matters and is always the same: **base sheet → page rules →
theme sheet → control edges → provenance → high contrast → card tags → zen
sheet.** A page overrides a component by restating the rule after the
`@import` of `base.css`; a theme overrides tokens for everyone; card tags come
after every theme so no theme's button rule reaches them; zen comes last
because what it takes away is largely what a theme adds. The shell links the
page's sheet, then its theme, then `tail.css`, which imports everything from
control edges to zen, so no page has to remember the order.

The page's `<body>` carries `class="zen"` when zen is on, written by the
shell from `getPageTailCss({ theme, zen })`. The builder reads neither: its
host reads both with `readPageChrome(themePreview)` as it writes the page,
and passes them in as `chrome`. See **Zen mode** below.

**A page keeps its own layout.** The base sheet and a page use the same
selector names — `main`, `header`, `.metrics`, `.cards` — so a base rule can
silently replace page layout that merely shares a name with it. Deleting a
page's `main` rule because the base has one is how the Dashboard's three-up
metric strip became a vertical column. Each page therefore ends with a short
layout block restating its own proportions, and `npm run test:ui` asserts
those survive the cascade (see **Layout contracts**).

## The shared core

Every page with Preact starts from these, in `src/webview/shared/`.

| Module | What a page uses |
| --- | --- |
| `page.ts` | `startPage({ initial, ready, view, afterDraw })`, the page's one store: `store.update(change)` draws the whole page before it returns ([decision 0014](architecture/decisions/0014-pages-render-synchronously-from-one-store.md)). Until `ready` holds, the shell's loading line stays. `startPage` first installs what every page shares: the indexing line, the busy mark, the guard that stops a click on an `aria-disabled` control, Escape putting the provenance line away, and tips. `readEmbeddedState()` reads the snapshot the shell carried. `listenForActions(root, actions, otherwise)` is the one delegated click listener, and `dispatchAction` runs the handler a `data-action` names, from a key as from a click. `onHostMessage(type, handler)` takes one kind of host message |
| `place.ts` | `readPlace` and `restorePlace`, which the store calls around each draw, so focus goes back only when the draw took away the element that had it, found again by its `data-*` keys (task, card column, tag, widget, column, status, file, line, action, value, kind, section, date) |
| `status.ts` | `announce(text)`, one short thing at a time to a screen reader through `#live-status`; `describeIndexing(progress)`; and `setSearchInFlight(inFlight)` for a page that runs a search |
| `vscode.ts`, `scroll.ts` | `post(message)`, `vscodeApi()`, and `keptState()` and `keepState(change)` over `setState`; `rememberScroll` and `restoreScroll` |
| `tip.tsx` | `installTip()`, which `startPage` runs: the one `#deckard-tip` for every page (**Tooltips** below) |
| `keySheet.tsx` | `installKeySheet(sections)`, `openKeySheet`, and `closeKeySheet`: the `?` sheet of the page's keys |
| `undoToast.tsx` | `createUndoNotice(redraw)` and `<UndoNotice message action buttonClass>` (**Destructive actions** below) |
| `viewOptions.tsx` | The gear, `<ViewOptions groups>`, from `{ label, content, stacked }` rows; a row of choices, `<ViewOptionChoices action choices selected label attributes>`, each button carrying `data-action` and `data-value`; `themeOption()`, the Theme row, one button naming the theme in use, which posts `chooseTheme`; `zenOption()`, the Zen row, which reads the body's class and posts `setZenMode`; and `installViewOptions()`, which closes the gear on a click outside it and on Escape, and posts those two. Call it before the page's own listeners. A gear open before a redraw stays open |
| `buttons.tsx`, `icons.tsx`, `strokeIcons.tsx` | `<IconButton action label icon tip tipKey className attributes pressed disabledReason>`: an icon-only `.icon-button` whose label is its name and, unless `tip` is given, its tip; `pressed` sets `aria-pressed`; `disabledReason` sets `aria-disabled` and `data-tip-disabled`; it never carries `title`. `<HelpButton anchor>`. The glyphs: `<SettingsIcon>` and `<HelpIcon>`, and the stroked set, `<StrokeIcon>` and the named ones (`<SortIcon>`, `<EllipsisIcon>`, `<CheckIcon>`, …) |
| `tagLabel.tsx`, `tagButton.tsx` | `<TagLabel label svg>`, a tag's text with its namespace dimmed, as `<tspan>`s inside SVG with `svg`; `<TagButton tag className>`, a `.tag-open` control that opens the tag; `<TitleWithTags title tags appendMissing>`, a plain title with its tags as controls where they are written, and the missing ones after it unless `appendMissing` is false |
| `metric.tsx` | `<Metric label value query hint code trend>`, one `.metric` tile, a button that opens `query` when there is one; `trend` (`{ points, change, note? }`) adds the twelve-week line and the change in words under the value, the change in the tile's `aria-label`, and `note` to its tip. `<Sparkline points>`: an inline SVG line, 20px high, min to max, a flat run as a midline, the last point in `--accent`, each point carrying a `<title>`, `aria-hidden`. `describeChange(change)`: "+9 in the last 7 days", "−3 in the last 7 days" (U+2212), or "No change in the last 7 days", muted, never green or red, since a rise is not always good news |
| `inline.tsx` | `<Inline tokens>`: a title's `InlineToken[]` drawn as `markdown-it`'s elements and text nodes. Nothing is parsed as HTML |
| `loading.tsx` | `<Loading label immediate>`, the `.loading` line (**Loading** below) |

The parts the task, search, and Home pages share are in `shared/` too, each
named for what it draws:

| Module | What a page uses |
| --- | --- |
| `taskRow.tsx` | `<TaskListRow item draggable titleDisplay leading trailing entry afterSource>` (**Task list** below); `<PriorityBadge priority>`, `<ParkedLabel>`, `formatTaskDate`, `formatSourceLocation`, `trimHeadingPath` and `<HeadingPathSteps steps>`, and `taskTitleOf(element)` |
| `taskTitle.tsx` | `<TaskTitle tokens tags>`: a task's title from its `titleTokens`, its tags as controls where they are written |
| `queryEditor.tsx`, `queryText.ts`, `facets.tsx` | The search box (**The search box** below); query text and the builder's tree, with no page in it; and Refine's values, `<FacetValue>`, `facetValuesShown`, `FACET_VISIBLE`, and the weight rail, `<WeightRail level title>` with `getWeightLevel(weight)`: three steps, three from 0.75, two from 0.375 |
| `tagMenu.tsx` | `openTagContextMenu(event, target)`, Rename tag and Park tag, or Unpark tag on a tag `setParkedTags(keys)` lists; `openContextMenu(event, items)`, whatever a page offers at the pointer; `closeTagContextMenu()` and `tagContextKey()`. A page passes the host's `parkedTags` to `setParkedTags` with each state |
| `menuKeys.ts` | `installMenuKeys()`: the menu key, Shift+F10, and Alt+Enter raise a `contextmenu` on the focused tag, card, list row, or table row, so no menu needs its own keyboard path; `returnFocusFromMenu()`; `walkMenu(menu, event, items)`, the arrows, Home, and End in an open menu, which a board card's menu and the tag menu share |
| `actionMenu.tsx` | `openActionMenu(opener, groups, onChoose)` and `closeActionMenu()`: the menu a card's ⋯ opens (**Popovers and menus** below) |
| `rankedRows.tsx` | `installRankedRows(options)` (**Task list** below), `closeRankMenu()`, `<ContextMenuItem action label>`, `rankKeys`, and `moveKeyToEdge` |
| `searchCard.tsx`, `blockExcerpt.tsx` | `<SearchCard card position display opened>`, a note a search found; `<NoteBody rawContent blocks renderMode>`, a body drawn from its block tokens or as its source in a `<pre>`; `<BlockExcerpt blocks>` |
| `resultTabs.tsx`, `pageSteps.tsx` | `<ResultTabs tabs active label>`, the Notes and Tasks tabs over a search's results: each carries `data-action="set-result-tab"` for the page to switch, the chosen tab is the one tab stop, `installResultTabKeys()` moves between them with Left, Right, Home, and End, and the page marks each panel with `resultPanelAttributes(id)`; `<PageSteps paging action attributes noun>` |
| `markWords.ts` | `markWords(root, words, { wordStart })`: the words wrapped in `<mark>` inside `root`'s text, never in a tag or a control, returning what takes the marks out again before the next draw. `wordStart` matches only where a word starts, so `route` marks `routes` and `art` does not mark `start`: Related Notes passes it, where the words are a model's terms; search pages leave it off |
| `openSource.ts` | `openSourceMessage(element, event)`: the `openSource` message a row's file and line ask for |

The calendars' parts are in `shared/calendar/`: `CalendarSession`, the
store both calendars run on, with the controls and keys both draw;
`<CalendarGrid>` with `<WeekdayRow>` and `<WeekRail>`; `<DayPanel day
shownGroups>` with `installDayPanel`, the chosen day as both calendars and
Related Notes show it; the words and classes both share in `model.ts`; and
`<CalendarIcon>`. The date steps they take are `domain/markdown/calendar.ts`'s.

### How a page uses them

- **Import what you draw.** A page imports a component from `../shared/` and
  draws it in its view; esbuild bundles into the page only what it imports.
  A page imports nothing from host code, from another page's folder, or from
  any package but Preact; `npm run lint` holds that
  ([layers.md](architecture/layers.md)).
- **Controls post intent through `data-action`.** A component writes the
  `data-action` and `data-*` keys the sheets and the tests read, and the
  page's `listenForActions` table says what each does: a tag button is
  `data-action="open-tag"`, and each page posts `openTag` for it. Only the
  gear's Theme and Zen rows post on their own, through `installViewOptions`,
  since no page acts on them differently.
- **A floating layer is a layer of the body.** The tip, the key sheet, the
  undo toast, and the menus are appended to the body, outside `#app`, each
  its own render root, so a redraw of the page does not take them away.
- **What a page changes outside a draw, it undoes before the next.** Preact
  compares props with the last ones it wrote, not with the DOM.
  [webviews.md](architecture/webviews.md#the-notes-graph) lists what the
  pages learned of this.

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

`designTokens.css` declares the whole palette on `:root`. Every page gets
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
| `--favorite-red` | `#D23C28` | Favorite marker |
| `--warning-orange` | `#FF5500` | Warnings |
| `--slate-olive` | `#3E4A42` | Secondary chrome |
| `--grid-line` | `rgba(0,229,255,.04)` | Backdrop grid |
| `--font-display` | VS Code UI font | Interface text |
| `--font-mono` | VS Code editor font | Headings, code, data |
| `--edge` | `2px` | Standard border width |
| `--control-height` | `30px` | Standard control height |
| `--accent` | `var(--amber)` | Eyebrows, chosen marks, the primary button's fill |
| `--danger` | `var(--favorite-red)` | Overdue. Red means this and nothing else; a priority is an outlined `.priority-badge` with an arrow, never a color. A task past `deckard.tasks.needsNewDateAfterDays` is not red: it reads `was due …` in `--muted` (`.due-date.stale`, `.board-details .stale`, `.due.stale` on the calendar) |
| `--favorite` | `var(--amber-bright)` | The favorite heart |
| `--positive` | `var(--green)` | A checked box, a done state |
| `--focus` | `var(--cyan)` | Every focus ring |
| `--space-1` … `--space-6` | `4px`, `8px`, `12px`, `16px`, `24px`, `32px` | The spacing scale. Every padding, gap, and margin in the shared sheet is a step; `src/test/spacing-scale.test.ts` holds it. Zen re-declares the steps on `body.zen` and restates no rule. |
| `--text-xs` … `--text-lg` | `11px`, `12px`, `13px`, `14px` | The type scale. `--text-xs` is the floor: counts, captions, and meta lines; nothing a reader acts on goes below it. `--text-md` is body text. |
| `--z-raised` … `--z-drag` | `1`, `10`, `20`, `30`, `40`, `50` | The stacking order. See **Popovers and menus**. |

**Color a meaning, not a palette entry.** A rule that colors a state takes
`--danger`, `--favorite`, `--positive`, `--focus`, or `--accent`, so red is
overdue and only overdue, and a theme that wants another mapping
re-declares the meaning tokens rather than every rule. A negated search
term is a dashed, struck chip in the muted color, not a red one. The one
filled control on a page is the primary action (`.query-apply`, or a
page's own `.query-primary`); a chosen segment is marked, not filled.

**Paired tokens are not synonyms.** `--amber` and `--amber-bright` share a
default, but themes pull them apart — Synthwave makes `--amber` pink and
`--amber-bright` orange. Pick the one that matches intent, not the one that
happens to look right in Replicant.

Use `--edge` and `--control-height` rather than literal `2px` / `30px` so
density can be changed in one place.

---

## Layout

### `body`, `main`, `header`

Provided by `shell.css`. `body` carries the grid backdrop and base font;
`main` is a centered 1000px column with 24px padding; `header` is a flex row
with a `--line-strong` rule beneath it. Below 700px, `main` tightens to 16px
and `header` stacks.

A page that is not a scrolling document overrides these after the base sheet —
the notes graph does exactly that to go full-bleed.

---

## Typography

`typography.css`. All of these use `--font-mono`.

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

`control.css`. `button`, `select`, `input[type="text"]` and
`input[type="search"]` all share one height, border, hover and focus
treatment, so a toolbar reads as one row of controls.

| Class | What it is |
| --- | --- |
| `.toolbar` | Right-aligned wrapping row of controls. `.toolbar label` styles an inline control label. |
| `.control-row` | Left-aligned wrapping row of controls. |
| `.segmented` | **A row of buttons that reads as one control.** Collapses the borders between children and rounds the outer corners. |
| `.icon-button` | A square icon-only control at `--control-height`. |
| `.toolbar-icon` | 16px stroked SVG inside a control. `.settings-icon` switches it to filled. Every glyph is a component: `<StrokeIcon className>` in `shared/strokeIcons.tsx` wraps a glyph's paths in the one frame, and the named ones (`<SortIcon>`, `<EllipsisIcon>`, `<ChevronRightIcon>`, …) are ready to draw; `<SettingsIcon>` and `<HelpIcon>` are in `shared/icons.tsx`, the calendar's in `shared/calendar/calendarIcon.tsx`, and the Dashboard's own in its `icons.tsx`. No host builder writes an `<svg>`; `src/test/icons.test.ts` fails one that does, and holds the frame to the paths in `src/ui/webview/icons.ts`. |
| `.query-facet` | One Refine group: its label above a `.query-facet-values` row, groups a wide step apart, so a group's edge is a shape. |
| `.view-options` | **The gear every page's view options sit behind**, drawn by `<ViewOptions>`: the `<details>` disclosure and its `.view-options-menu` of `.view-options-group` rows. `.view-options-choices` is a row of small choices inside it, such as List and Board. No theme restyles the gear, so it looks the same on every page. Related Notes has one at the end of its Sort row, holding **Preview** (None, 1 line, 2 lines) and **Daily notes** (Show, Hide). |
| `.note-excerpt` | A Related Notes card's preview, in order: title and actions, file and line, heading path, **excerpt**, reason, tags. `--muted` at `--text-xs`, clamped with `-webkit-line-clamp` to `--preview-lines`, which `main[data-preview-lines]` sets; at 0 it is not drawn. The text comes from `readProseLines` / `formatExcerpt` in `src/domain/markdown/proseExcerpt.ts`, the one place Markdown becomes preview text, and starts at the line holding a shared word when there is one. |
| `.filter-count` | Small muted count inside a filter button. |
| `.command-link` | **A command named in Help's prose that runs it.** The code chip's look in `--cyan`, underlined under the pointer and on focus. Help builds it with `linkCommandNames()` for every `<code>Deckard: …</code>` whose command needs no note in the editor; the host runs it only when `isRunnableFromHelp()` agrees. |
| `kbd.shortcut` | A key binding beside a command's name, written for the platform: Cmd+Shift+Alt+F on macOS, Ctrl+Shift+Alt+F elsewhere. |

**Disabled.** A control that cannot act never lights up under the pointer:
every hover rule on a `button`, `select`, or `input`, in the shared sheet,
a page, or a theme, carries the zero-weight guard `ENABLED`
(`:where(:not(:disabled):not([aria-disabled="true"]))`, named in
`src/ui/webview/selectors.ts`), and `components-primitives.test.ts` fails
one that does not. At rest both kinds are drawn at half opacity.

- **`aria-disabled="true"` with `data-tip-disabled`** for a control that
  holds its place in a bar: Save, Clear, Back, and Forward. It stays in the
  Tab order, focus shows its reason as the tip, and one capture-phase click
  listener, which `startPage` installs, swallows its click, so no page
  handler checks. The query editor's `syncTextButtons` flips `aria-disabled` in
  place as a search is typed.
- **`disabled`** for one whose reason is plain, such as a pagination step at
  the end of the list.

The layout suite forces every `:hover` rule onto each disabled control on
its surfaces and fails if a color changes.

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
neighbors so its border is not clipped.

**Two states, two drawings.** Hover raises the ground (`--hover-bg`,
`--hover-fg`). Chosen, `.active` or `aria-pressed="true"` or
`aria-selected="true"`, keeps the control's own ground and takes the accent
as its border and a bar along its foot (`--chosen-bg`), so a chosen control
under the pointer still reads as chosen and a hovered one does not read as
chosen. Themes re-declare the pairs; none of them redraws the states. There
is no `:active` rule: the contrast suite cannot tell a pressed state from a
resting one, and would read a pressed fill as every button's ground.

**Targets are 24px.** WCAG 2.2's 2.5.8 sets 24 by 24 CSS pixels as the
minimum for a pointer target. A chip is 24px tall, the steppers and the
favorite heart's control are 24px square, and an icon-only control is
`--control-height`. A new control under 24px needs a reason written beside
it. The second class carries only what is
specific to that group.

Used by: the task filter, the layout and format toggles, the overview tabs, and
the tag-association view switch.

---

## Tags

`tag.css` plus the components below. A namespaced tag always dims its
`#namespace/` prefix so the value stays the readable part.

| Class | What it is |
| --- | --- |
| `.tag-open` | A tag rendered as a control that opens its overview. |
| `.inline-tag` | A tag inside a heading or task title, sized to the text around it. |
| `.tag-list` | Wrapping row of tags. |
| `.tag-namespace` | The dimmed `#namespace/` prefix. Drawn by `<TagLabel>`. |
| `.tag-context-menu` | The right-click menu, positioned by `openTagContextMenu`. A `.popover`. |

**Tags on cards are text.** `cardTag.css`, laid down after the themes
and high contrast and before zen: on search results (`.card`), task rows
(`.task-row`), board cards (`.board-card`), and Related Notes (`.note`), a
`button.tag-open` or `button.inline-tag` is monospace text at 0.9em with no
box or fill, its namespace muted; under the pointer or focus it takes a faint
accent ground and an accent underline, its text color unchanged, so its
contrast never depends on the hover. It stays a button: one Tab stop, Enter
and Space, and its context menu. Under high contrast it is underlined at
rest. The editor's decorations keep their box, as do Refine values, the
sidebar's own tag rows, the Dashboard's Tags tab, the hub's properties, and
the query chips. The layout suite fails a card tag drawn with an edge or a
ground at rest, in every theme.

**One line, always.** A tag or chip that is too long for its place keeps to
one line and shortens, the namespace first, down to about `#p…/`, then the
value: `#topic/replicants` in a 220px sidebar card reads whole or as
`#to…/replicants`, never split over two lines. `<TagLabel>` draws
`.tag-label > .tag-namespace > .tag-namespace-text + "/"` then `.tag-value`,
so the slash survives the cut and `.tag-namespace` still reads `#topic/`.
The rule is geometry only (`white-space`, `overflow`, `flex`, `max-width`),
so any look a view gives its tags composes with it; a view's own tag style
must keep the structure and must not set `white-space`. A tag button, a
query chip (at most `28ch`), and a Refine value carry
`data-tip-overflow` with the whole text, which the tip shows only when the
text is cut short. The Dashboard's Tags rows are rows, not tokens, and keep
wrapping. The layout suite fails a tag that breaks over lines or out of its
entry.

---

## Popovers and menus

`popover.css`, inside `base.css`. Everything that floats over a page
is a `.popover`: one amber edge at `--edge`, the raised panel, one shadow.
Each keeps its own class for where it sits (`.tag-context-menu`,
`.action-menu`, `.rank-context-menu`, `.view-options-menu`,
`.home-widget-options-menu`, `.query-suggestions`, `.relevance-tooltip`),
and none of those declares a border, ground, shadow, or z-index of its own.
Corpo draws every popover in VS Code's widget colors, and a tip in its hover
widget colors.

| Class | What it is |
| --- | --- |
| `.popover` | A menu positioned `fixed`, at `--z-menu`. |
| `.popover.is-dropdown` | Attached to a control: the gear's menu, a widget's options, completions. |
| `.popover.is-tip` | A tip: 1px `--line-strong` edge, `--text-xs`, at most 280px. |
| `.menu-item` | One row of any menu, 28px tall. Its label is a `.menu-label`. |
| `.menu-check` | The 16px column a checked item's check sits in (see the card menu). |
| `.menu-key` | The key that does the same, at the row's right, in muted mono. |

**A single choice is checked, not left out.** `openActionMenu(opener,
groups, onChoose)` takes items `{ value, label, checked?, key? }`. A group
whose items say `checked` (true or false) is a single choice: its rows are
`menuitemradio` with `aria-checked`, and every row in the menu keeps a
`.menu-check` column so labels align. `key` draws a `.menu-key` and sets
`aria-keyshortcuts`, and the key chooses the row while the menu is open.
Focus opens on the first checked row. The menu takes its keys only while
focus is in it: Tab closes it and moves on from its control, and focus
moving anywhere else closes it where focus went. A board card's menu checks
the task's own status, priority, and due choice from
`TaskBoardCard.current`, and choosing a checked row posts nothing and says
"…is already…"; so does a card's key for the same choice. A move the page
shows at once takes the card's menu with it, the new choice checked.

**The stacking order** is a token scale, and a rule never writes a number:

| Token | Value | For |
| --- | --- | --- |
| `--z-raised` | `1` | A chosen segment over its neighbors |
| `--z-dropdown` | `10` | Attached to a control: the gear's menu, a widget's options, completions |
| `--z-menu` | `20` | Context and action menus |
| `--z-tooltip` | `30` | Tips, the relevance tooltip, the graph's hover card |
| `--z-modal` | `40` | The `?` key sheet |
| `--z-drag` | `50` | The drag ghost, which sat under the menus at 10 |

### Loading

A page waiting for its first state shows `loadingHtml(label)` from the host:
`<main id="app" aria-busy="true">` holding one `.loading` line, muted mono
text in the page's flow rather than the dashed `.empty` box, revealed after
400 ms by an animation step so a page that draws within that never flashes
it. The words end in one ellipsis character: *Loading search…*,
*Loading tasks…*. A page that draws the line itself draws `<Loading label
immediate>`; `immediate` shows it at once, for a line that redraws every
tick, such as the sidebar's indexing count. One `MutationObserver` on `#app`
(`watchBusy` in `status.ts`, which `startPage` installs) keeps
`aria-busy="true"` exactly while `#app` holds a `.loading` or a search is
still out (`setSearchInFlight`), so no page handles it. A search still out a
second after it ran puts `.is-searching` on its `.query-workspace`: a thin
bar along the box's foot, still under reduced motion, and kept in zen as
information.

While the workspace is first indexed, a host calls `followIndexing(indexer,
post)` (`indexingProgress.ts`) as it attaches its panel: it posts `{ type:
'indexing', progress }` as the scan goes, and the page, through what
`startPage` installs, writes `describeIndexing(progress)` — *Indexing this
workspace: 412 of 3,760 notes read…* — into `#app .loading`, shown at once.
Related Notes says the same through the same function.

### Tooltips

A control explains itself with `data-tip`, never `title`: a native title
never shows on keyboard focus, cannot be hovered, and cannot be dismissed
(WCAG 1.4.13). `installTip()` (`shared/tip.tsx`), which `startPage` runs,
draws one `#deckard-tip` (`.popover.is-tip`, `role="tooltip"`) for every
page; the Notes Graph, which does not start through `startPage`, installs it
itself.

| Attribute | What it does |
| --- | --- |
| `data-tip` | What the control does. |
| `data-tip-key` | The key that does the same, drawn after it as `<kbd>`. |
| `data-tip-disabled` | Why the control cannot act, shown instead while it carries `aria-disabled="true"`. |
| `data-tip-overflow` | The whole of a tag or chip, shown only when its text is cut short. |

A keyboard focus shows the tip at once (keyboard use is read from the last
`keydown` against the last `pointerdown`); the pointer after 400 ms, or at
once within 300 ms of another tip closing, so running along a toolbar does
not wait at every button. Touch never shows one. The tip can be hovered,
hides 100 ms after the pointer leaves both, and hides on a press, a scroll,
and a redraw that removed its control. Escape hides it and is taken only
while a tip shows, so it does not also close a menu behind it. While it
shows, the control's `aria-describedby` names `deckard-tip`, unless the tip
says no more than the control's accessible name.

`<IconButton>` draws an icon-only button whose label is its name and its
tip (**The shared core** above).

Three things keep numbers of their own, and
`src/test/components-primitives.test.ts` lists them: the provenance lift
(`z-index: 1/2`, Decision 5), the sidebar's `.note:hover { z-index: 20 }`,
and the Notes Graph's overlay layers over its canvas.

---

## Surfaces

`surface.css`.

| Class | What it is |
| --- | --- |
| `.row` | **Any content row a reader can open.** Border, amber hover border, cyan focus ring. `.card` and `.task` are built on the same rule. |
| `.cards` | Grid of cards, 12px gap. |
| `.card` | A `.row` with 14px padding, for a note or result. `.card-title` is its heading. |
| `.parked-label` | **Parked**, in muted small text with no box, after a parked result's title on a search card, or first in a task row's `.task-meta` (`<ParkedLabel>`, set from `parked: true` on the card or `DashboardTask`). Its explanation is a `title` on the span, which is not focusable. |
| `.task` | A `.row` laid out as a 24px checkbox column plus content. `.task-title`, `.task.completed`, `.task-summary`. |
| `.metrics`, `.metric` | Auto-fitting grid of stat tiles with `.metric-label` and `.metric-value`. |
| `.empty` | Dashed empty state. Always says what is missing and why. |
| `.markdown` | Raw Markdown source, amber left rule. |
| `.rendered` | Rendered Markdown body. |

### Notes Graph canvas

The graph paints into a canvas, so none of the sheet reaches it. Every color
it paints is read from a token through `themeColor()` on `:root`, with a
system color in its place under forced colors, and the kinds of edge — wiki
link, heading, tag, through a daily note — are told apart by **dash
pattern**, not color, so they survive forced colors, colorblindness, and
every theme; the status line's legend draws the same patterns as inline
SVG. Drawing stays cheap: one batched path per kind of edge and per kind of
node, never a stroke per line. Past 3,000 lines in a frame the dashes are
left off and the kinds differ by alpha alone.

### Linked from

Related Notes' **Linked from** is a `.link-group` per linking note: a
`.link-group-head` with the note's `.link-group-open` button and its
`.link-group-meta` (*3 days ago · 2 links*), then a `.link-list` of
`.link-row`s. A row with a section to show has a `.link-expand` chevron
(`aria-expanded`, *Show the rest of this section*) that unfolds a
`.link-section`; which rows are open is kept across redraws. The group ends in
one `.links-more` foot line whose `.links-search` button posts
`openLinksSearch`; the host builds the search itself. Beside the sort select, the
`.hide-daily-toggle` (`aria-pressed`) posts `setHideDailyNotes`; while it
hides a note, a `.links-hiding` line says how many, with **Show them**.

### A tag's page's quiet lines

Under a one-tag page's hub, the search page's `<TagNotes>` (`searchPage/hub.tsx`) draws `.tag-notes`: one muted
`.tag-note` line per thing worth knowing about how the tag is reached, each
with a `.tag-note-action` text button. It is the pattern for a page-level
hint: a sentence, then at most two actions, never a box. An entry listed
because of such a line carries a `.card-via` note after its location, such
as *Links the hub note* (`via: 'hubLink'` on the card or task).

### Task board

`taskBoard.css` and the Task Board's own modules, in `src/webview/taskBoard/`,
draw the Task Board page's Kanban board. A `.board-column` is a region before it is a list: a ground
half a step above the page in every theme, so the columns read as columns
without their cards.

| Piece | What it is |
| --- | --- |
| `.board` | The horizontally scrolling row of `.board-column`s, each with a `.board-column-title`, `.board-count`, and `.board-cards`. `.board-count` reads `40 / 3 · 38 overdue`: the cards shown, the column's limit when `deckard.board.limits` sets one, and how many are overdue, counted from the cards the page shows. |
| `.board-column.over-limit` | Over its limit: a neutral dashed `--line-strong` outline, never red, since a limit is a note and not an error. |
| `.overdue.quiet` | An overdue card's date when most of its column is overdue and it is not in the longest-overdue third (`card.overdueTone`): `--muted` text after a 6px `--danger` dot, drawn as a border so it is not a background behind the text, the word still "overdue". |
| `.board-column` | Capped at the viewport's height, with `grid-template-rows: auto minmax(0, 1fr)` so the cards row may shrink; an auto row would size to its cards and the column would clip them with nothing to scroll. |
| `.board-cards` | The scroller: `overflow-y: auto` with `overflow-x: hidden` said outright, since `overflow-y` alone computes the other axis to `auto` and a theme's hover slide would then put a scrollbar under the column. A hovered board card keeps `transform: none` for the same reason. |
| `.board-card` | A `.task` card with a checkbox, inline-tag title, `.board-details`, and a corner `.board-move` menu. Each detail span is an `inline-block`: one unit to the line, breaking inside itself only when wider than the column. |
| `.board-steps` | A card whose task has steps: one `.source` line under the details, `.board-steps-label` (`2 of 5 steps`) then `.board-steps-next` (` · next: Draft the email`); the line is one line with an ellipsis, so in a narrow column the next step gives way first. Host-worded by `describeStepParts()` in `domain/markdown/taskSteps.ts` as `card.steps`; the card's `aria-label` gains the label. Muted like the details, so no color of its own. |
| `<TaskBoard snapshot>` (`board.tsx`) | Draws the host's board, each card with `BoardCard`. Words typed in the search box hide the cards, list rows, and table rows that do not show every word, file and line included, as they are typed and after every draw; `followShownCards()` (`boardMoves.ts`) then counts each column again from the cards left, and moves the Tab stop to the first of them when the words hid it. |
| `<GroupSwitch snapshot>` (`board.tsx`) | The Status / Priority / Due date / Person / Tag… `.segmented` switch. **Tag…** (`data-action="pick-board-namespace"`) opens a menu of the namespaces open tasks carry and, grouped by one, reads `#context`, pressed; with none in use it is `aria-disabled` and says why. |
| `installBoardMoves(options)` (`boardMoves.ts`) | Wires a card's keys (Enter opens it, Ctrl or Cmd+Enter beside the board), its move menu, its checkbox, opening it, dragging it between columns (a card's drag carries `application/x-deckard-card` and no plain text, so a field it is dropped on takes nothing, and a column takes no other drag; any drop or new drag lets go of a card a redraw cut short), and the group switch's Tag… menu, once per page, on the document. It posts, through `options.post`, `openSource`, `toggleTask`, `moveTask` (with `from`, the column the card was in), and `setBoardGroup` (with `namespace` for `tag`). A card is keyed by column and task, `boardCardKey(columnId, taskId)`, and carries `data-card-column`, since a task with two tags in the grouped namespace is two cards; `cardColumn` is one of `PLACE_KEYS`, so focus comes back to the same copy. |
| `.board-card` on screen | A card off screen takes `content-visibility: auto` (`contain-intrinsic-size: auto 72px`), so a long column lays out only what shows. A hovered, focused, or dragged card is left out, since the paint containment would clip the file-and-line it carries down; the layout suite's "nothing clipped" check on a hovered card proves it. An open column draws its first 100 cards (`columnLimit`), Done its 20; `showColumnRest` with a column id adds it to the host's `shownColumns` until the grouping or the search changes. |
| `.board-card.is-pending` | A card moved on the page and not yet written: every move — a drop, `[` `]`, `t` `m`, `0`–`5`, the ⋯ menu — puts it at the top of its new column at once, recounts both columns from the cards and the column's `data-hidden-count` and `data-limit`, keeps focus on it, and marks it `is-pending` with `aria-busy` (70% opacity). `x` or the checkbox marks the card `completed` at once the same way, so a second `x` reopens it. An edit rewrites the task's line and so gives it a new id: a card's next edit, made before the host's next state, shows at once and is sent once that state is drawn, to the card written where its task is, with the new id; one the state shows is already made sends nothing. A move to a column the grouping does not draw marks it where it is. The next state replaces the board. A move the host could not write is followed by a `moveRefused` message, which the page says as "… was not moved." A completion or reopening it could not write, from a card, a row, or the table, is followed by `toggleRefused`, said as "… was not completed." or "… was not reopened." |

The card menu ends with a **Note** group holding **Move to…** (`move-to`),
which posts `{ type: 'moveTaskTo', taskId }`; the host runs Move to… on the
task, and the card waits for the next state rather than moving on the page.

The board's controls use their own `data-action` names (`board-toggle-task`,
`board-move`, `set-board-group`), so a page's handlers for its other rows never
act on a board card as well.

### Task list

`taskList.css` and the components below draw a list of tasks: the Dashboard's
search results, a search page's tasks, the calendar's day, and the Task
Board's list layout.

| Piece | What it is |
| --- | --- |
| `.task-list`, `.task-row` | The grid of rows, each a `.row` with a checkbox, title, and `.task-meta` line of due date, details, file, heading, and line. |
| `<TaskListRow item draggable titleDisplay leading trailing entry afterSource>` | One row from a `DashboardTask`. Its due date is the host's `dueLabel`, `Overdue 15 days · 2026-09-08`, worded by `describeDueDate()` in `domain/markdown/dueWording.ts` so every list, the board, the table, and query blocks say it the same way. `draggable` marks a row that can be ranked; `titleDisplay` is the `tagTitleDisplayMode`. A parked task (`item.parked`) says **Parked** first in its meta line. A task with steps has a `.task-detail.task-steps` span after Repeats, the host's `stepsLabel` (`2 of 5 steps · next: Draft the email`). `trailing` is drawn after the words, such as the calendar panel's **Tomorrow** button, and `leading` in place of the checkbox, for a row that cannot be completed from there. Its checkbox posts through `data-action="toggle-task"`. |
| `installRankedRows(options)` | Ranks rows by dragging them, with a ghost and a placeholder, or by **Move to top** and **Move to bottom** on their context menu. `options.kinds` names each kind of row by selector and dataset key; the page supplies `canRank`, `reorder`, `move`, and any more menu actions. A drag never starts on a control inside a row, such as a button, field, or a `<summary>`, so the control keeps its click. The Dashboard ranks tags, entities, and Home's widgets with it, the Task Board its tasks. |
| `rankKeys(keys, key, target, before)`, `moveKeyToEdge(keys, key, toTop)` | The new order a drag or a menu choice asks for. |

### Result table

`.result-table` in `taskList.css` styles the Task Board's table layout:
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

`zen.css`. Deckard's own chrome, turned down: decoration hidden, the frame
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
pass. `background-image: none` is allowed and needed: `--grid-line:
transparent` clears the base sheet's grid, but Cooper, Synthwave, Oblivion and
Tomcat paint their own backdrop onto `body` with their own colors, so zen has
to say it outright. Dropping an image declares no color pair. A new signature there means a color slipped in; fix the rule rather than
re-record the baseline. `src/test/zen-mode.test.ts` asserts this directly.

**Zen hides two ways, and the difference is not cosmetic.** `display: none`
for ornament nothing refers to. The off-screen idiom — `position: absolute`
and `clip-path: inset(50%)`, the same one `.is-dragging` uses — for anything a
reader may still want, so it stays in the accessibility tree, in find-in-page,
and comes back on `:focus-within`. A node that carries an accessible name is
never dropped outright.

Two things look like chrome and are not:

- `.query-error` shares its slot with `.query-hint`. Outside zen the hint
  already rests while the box is idle and empty, through
  `.query-workspace:not(:focus-within):not([data-has-text])`, and comes back
  on focus or once a term is written. Zen hides it outright. The hint goes; the error
  never does, or a search that failed to parse reads as one that found
  nothing.
- `.board-details` is a `.source`, but it carries the due date and the word
  "overdue". It does not fold. Only `.card .source`, `.note .source`, and the
  `.task-source` spans in `<TaskListRow>` do.

Spacing is tokenized: zen re-declares `--space-1` to `--space-6` on
`body.zen`, and every card, row, column, and margin in the shared sheet
follows, so there is no second block of literals to keep in step. The
layout suite measures both densities.

Its `:hover` rules must stay at the top level of the sheet. `checkLayout.js`
forces hovers by rewriting `rule.selectorText`, which a `CSSMediaRule` does
not have, so a `:hover` nested in an `@media` block is never tested.

| Host-side helper | Purpose |
| --- | --- |
| `zen.css` | The sheet, last in `tail.css`, which every page links whether zen is on or not. |
| `getPageTailCss({ theme, zen })` | The sheets after the page's own, its theme then `tail.css`, and the body's ` class="zen"` or nothing. `buildPageShell` writes both. In `components.ts`. |
| `readPageChrome(themePreview)` | The look a page is written in, read now: `getDeckardTheme(preview)` and the `deckard.zenMode` setting. `WebviewHost` calls it each time it sets a page's HTML and passes it to the controller's `html(webview, chrome, state)`. In `host/pageChrome.ts`. |
| `onDidChangePageChrome(listener, themePreview)` | Calls back when a page must be drawn in another look: `deckard.theme` or `deckard.zenMode` changed, or Choose Theme… is previewing a theme on the `ThemePreview` (`themePreview.ts`), which `getDeckardTheme(preview)` reads first. `WebviewHost` listens to it for every page, and a page's `onChromeChange` says what it then does ([webviews.md](architecture/webviews.md#what-a-controller-tells-its-host)). In `host/pageChrome.ts`. |
| `affectsPageChrome(event)` | Whether a settings change alters how a page is drawn; `onDidChangePageChrome` asks it. In `host/pageChrome.ts`. |

---

## The search box

`queryEditor.css` and `shared/queryEditor.tsx` are the one search box
search pages, Home's search widget, and the Task Board use, so a search looks
and behaves the same everywhere: the bar and its completions, the builder,
removable terms, and **Refine**. A page creates it with
`createQueryEditor(options)`, draws `editor.bar(statusControls)` and
`editor.facets()` in its view, tells it of each draw with `beforeRender()`
and `afterRender()` and of each host state with `receive()`, and passes its
events through the `handle*` methods. `options.resultKinds` names
what the page can find, such as `['tasks']` on the Task Board, so the result
count names only those. `options.refineElsewhere()` returns true while the
Related Notes sidebar shows the page's Refine options, and `facets()`
then draws a single line in their place. `options.actions(hasText)` draws
the page's own buttons after Clear, such as the Task Board's Save; one that
needs text carries `data-query-needs-text`. Search is the bar's filled
button (`.query-apply`) unless `options.ownPrimary()` returns true: then a
page's own button marked `.query-primary` is, and Search is drawn as the
others are, as on the Task Board while it edits what the Tasks view lists.
`.search-notice`, in the same sheet, is the line above a search that says
what the reader is looking at, with a way out: the Tags tab's kept search,
and the Task Board's Tasks view strip.

The bar is a `.query-bar-shell` field of chips, as a multi-select is: each of
the applied search's top-level terms is a `.query-chip` button with a
`.query-chip-remove` icon, joined by `.query-chip-join` AND or OR, and the text
field after them holds the next term. A group among the terms is a
`.query-chip-group` frame holding its own chips, joined by its own word, with
a `.query-chip-group-remove` at the end; groups nest as the query does. Each
chip carries `data-without`, the whole search cut as written without that
term, which `getTopLevelTerms()` in `domain/query/queryEdit.ts` works out on the host.
A chip or group turned around with NOT is `.is-negated`, in red.
`scanQuery()` reads the box's pieces: `tag`, `link` (a whole `[[Atlas plan]]`,
spaces and all, so it is one chip), `op`, `paren`, and `word`. After `[[` the bar
and a new builder row complete from `suggestions.values.link`, whose `value`
is the note's name and `label` the link as written. `data-query-text` on the shell is the whole
search, chips and typed term together. A chosen completion that is a whole
term becomes a chip at once; Enter adds the typed term by AND; Backspace in an
empty field removes the last chip; and a term not added is let go when focus
leaves the box. A search the host could not parse comes back as
`QueryViewState.pending`, with the last good search as `text`.

Each Refine facet shows its first `FACET_VISIBLE` (5) values; a sixth
control, `.query-facet-more` (`.refine-more` in the sidebar), reads
**+N more** and then **Show fewer**, drawn by `facetValuesShown(facet,
expanded, className)`. Which facets are open is kept in the page for the
session, so a redraw keeps them open. The host still sends every value.

On the host, every page builds the box's state with `createQueryViewState()`
and its **Refine** counts with `buildSearchFacets()`, from the results that
page shows. A search of tags passes `related` values, ranked by association,
in place of the counted tags.

## Home

The Dashboard's Home is a two-column `.home-grid` of `.home-widget` panels;
`.is-full` spans both columns, and widgets in one row stretch to its height.
In edit mode a widget is `.is-editing` and `.is-draggable`, carries a
`.view-options-choices` width switch and its own `.home-widget-options` gear,
and is ranked with `installRankedRows`. The Dashboard's own modules, in
`src/webview/dashboard/`, draw it. The host projects each widget with
`createDashboardWidgets()` in `dashboardWidgets.ts`.

Above the grid, one `.home-hint-bar` line at a time: after a feature update,
*Updated to Deckard 1.23.* with **What's new** and **Dismiss**
(`.whats-new-bar`, from the snapshot's `whatsNew`); otherwise, until Home is
arranged or the line is put away, *Home is yours to arrange.*

The `tryNext` widget draws one card (`.try-next-text` over `.try-next-actions`)
or, outside Customize, nothing at all: never an empty box. The host chooses
the suggestion (`chooseTryNext()` in `state/tryNext.ts`) and runs its command
from the suggestion it made, never from what the page posts.

The header's `.metrics` are three `<Metric>` buttons (`.metric-open`) —
Overdue, Due today, and Open — each opening the search it counts, scoped by
`deckard.agenda.query`; Stats draws its figures with the same component.

The Tasks view widget ends with a `.home-widget-footer` line: what was done
today, and how many tasks need a new date as a `.text-button` that opens
`is:needs-date`. It is left out when both are zero.

## Host-side helpers

| Function | Where | Purpose |
| --- | --- | --- |
| `buildPageShell(options)` | `host/pageShell.ts` | A page's document: its policy, its sheets in cascade order, its body, and, with `bundle`, its snapshot as inert JSON and its script. Every builder returns it. |
| `getContentSecurityPolicy(cspSource, nonce, extras)` | `host/pageShell.ts` | The one policy. `extras.images` adds images from the extension and the origins it lists, or any HTTPS origin for `true`; `fonts` adds fonts from the extension; `scripts: false` names no `script-src`, for a page that runs none. |
| `pageResourceRoots(extensionUri)` | `host/surface.ts` | The folders a page may load from: `dist/webview` and `resources`. |
| `createNonce()` | `components.ts` | One nonce per page, gating its script. |
| `loadingHtml(label, attributes)` | `components.ts` | A page's `<main id="app">` before its first state: busy, with one `.loading` line. |
| `followIndexing(indexer, post)` | `indexingProgress.ts` | Posts the first scan's progress to a page as it goes (**Loading** above). |
| `describeSteps(steps)` / `describeStepParts(steps)` | `domain/markdown/taskSteps.ts` | A task's steps in words: `2 of 5 steps · next: Draft the email`, `0 of 1 step · next: …`, `All 5 steps done`. Every card, row, and Tasks view line says it through these. |
| `foldSteps(tasks)` / `isPlainStep(task)` | `domain/markdown/taskSteps.ts` | The folding rule: on the Task board and in the Tasks view (and so Home's agenda and the status bar count), a step is left off the list when its task is listed too and it carries nothing of its own to sort by — no due, scheduled, or start date, no priority, no person, no tag on its line. Search pages and query blocks never fold. |

---

## Conventions

### Names

Buttons, menu items, and command titles follow one table, and
`src/test/naming.test.ts` holds it.

| Rule | Yes | No |
| --- | --- | --- |
| A button is sentence case. Only a place or a product keeps its capital: Home, Tags, Deckard, Markdown, CSV. | Bulk edit, Customize, Reset widgets | Bulk Edit |
| One verb per act, everywhere it appears. | Clear (a search), Search (run one) | Clear search, Clear the search, Apply |
| A verb and its object when the object is not on the button's own row. | Export tasks, Reset widgets, Reset graph, Fit graph | Export, Reset, Fit |
| No word does two jobs on one page. | Finish (customizing Home), Done (the board's column) | Done for both |
| A command that opens a page or view says Open. | Open Stats, Open Log | Show Stats |
| A toast button says Open, and names a place. | Open Stats, Open Tasks View | Show Stats, Open Tasks |
| A search kept under a name is a saved search, and keeping one is Save search. | Save search, A saved search needs a name. | Save as a view, Save Deckard filter |
| A mode is entered and left with verbs. | Enter Zen Mode, Leave Zen Mode | Zen Mode |
| A command that will ask a question ends with an ellipsis, in the palette and on a menu alike. | Open a Tag's Search Page… | Open the Tag's Search Page… |
| One name per place. | Tasks view (the sidebar view and the Home widget that mirrors it); search page (a tag's page too) | Agenda; tag overview; tag search |

- **Undo, briefly.** A control that discards the reader's arrangement offers
  Undo inline for 8 seconds, in a `role="status"` span beside it, with the
  focus moved to Undo so Enter takes it back; any later change to the page's
  controls withdraws the offer. See **Destructive actions**.
- **Focus survives a redraw.** Preact keeps the element that has focus when
  a draw keeps it. When a draw takes it away, the store finds the focused
  control again by its `data-*` keys (`PLACE_KEYS` in `shared/place.ts`:
  task, card column, tag, widget, column, status, file, line, action, value,
  kind, section, and `date` for calendar days).
- **Host data is text.** Snapshot values are drawn as text nodes and
  attribute values, which Preact writes as such; a note's Markdown arrives
  as tokens and is drawn as elements (`<Inline>`, `<BlockExcerpt>`). No
  page sets HTML from a snapshot: `markWords` marks text as text nodes, and
  Help's guide page, which the host renders from the guide the VSIX ships,
  is the one piece of HTML a page is handed.
- **Post intent, do not mutate.** A control carries `data-action` and posts a
  message; the host decides and sends new state back. Pages draw again from
  that state rather than editing the DOM in place.
- **A visible label is the accessible name.** Do not add an `aria-label` that
  duplicates or contradicts button text; use `data-tip` for the longer
  explanation. A control never carries `title`, which no keyboard sees;
  `src/test/components-primitives.test.ts` fails one that does. A
  non-focusable span, such as the priority badge, and a select's `<option>`
  may keep one.

### Destructive actions

**Undo what can be undone; confirm only what cannot.** An action whose
result can be put back acts at once and offers **Undo** inline for 8
seconds. An action that cannot be put back asks first, and the button that
commits it is `button.danger`: neutral, with a heavier edge and weight, since
red means overdue and nothing else. A danger button is never the only or the
first button in its row, and it is never filled at rest.

| Action | What happens |
| --- | --- |
| Remove saved search (Home) | VS Code's own modal asks first: the saved search and its widget are gone for good. |
| Reset widgets (Home, customizing) | Asks inline: **Keep them**, then **Reset widgets** as `button.danger`. |
| Remove widget × (Home, customizing) | Acts at once; the edit bar says **Removed Tasks view.** with **Undo**, which puts it back at its place with its width and options. Leaving customizing withdraws it. |
| Remove status column × (board gear) | Acts at once, with **Removed the review column.** and **Undo**. |
| Reset graph | Acts at once, with **Graph reset.** and **Undo**. |

`<UndoNotice message action buttonClass>` draws the `.undo-notice` line;
`createUndoNotice(redraw, returnFocus)` keeps one offer at a time, drawn in
its own `#undo-toast` layer of the body: `show(message, action, payload)`
draws it and moves focus to Undo, `take()` hands back the payload and
withdraws it, and `clear()` withdraws it. The offer lapses after 8 seconds
or at the next removal. Withdrawn with focus on Undo, it gives focus back
to where the removal was made, found as a redraw finds it, again once the
page has drawn what Undo put back; when that is gone, to what
`returnFocus(payload)` names, such as the board's status column now where
the removed one was. Both are in `shared/undoToast.tsx`.

### Messages

A notification's weight says what happened, and `src/test/naming.test.ts`
holds what it can read of the rule.

| Severity | When |
| --- | --- |
| **Error** | What was asked did not happen: nothing was written or opened, or only part of it was written. |
| **Warning** | It was written, with a caveat, or some of it was skipped. |
| **Information** | It is done, nothing needed doing, or there is nothing to do it to yet (open a note first). A refusal that explains a rule, such as a board column that cannot take a card, is Information too. |

A failure says what did not happen and why, in the reader's words, then what
to do, with at most one button for it. The raw error goes to Deckard's log,
and the message offers **Open Log**. A setting is named as the Settings
editor shows it, in quotes, with **Open Setting**. A message's buttons are
Title Case, as VS Code's own are, and say Open rather than Show. No
contractions.

The helpers are in `src/ui/commands/notify.ts`:

| Function | Purpose |
| --- | --- |
| `reportFailure({ outcome, fix?, error?, severity?, action? })` | Shows a failure (Error unless `severity: 'warning'`), logs `error`, and adds **Open Log** when there is one. `describeFailure` is its pure half. |
| `reportStale(uris)` / `describeStale(names)` | The one sentence for a note that changed underneath: *atlas.md changed after Deckard last read it, so nothing was written.*, with **Open Note** for one note. |
| `describeRejectedEdit(name)` | VS Code refused an edit: *VS Code did not accept the change to atlas.md, so nothing was written.* and what to check. |
| `describeMissingTag(key)` | A tag asked for that no note has. |
| `reportNeedsFolder()` / `NEEDS_FOLDER` | Information, with **Open Folder…**, for a command that creates notes with no folder open. |
| `settingLabel(key)` / `openSettingAction(key)` | A setting as the Settings editor labels it (`mcpServer.port` → *MCP Server: Port*), and the button that opens it. |
| `openNoteAction(uri)`, `reindexAction()`, `noteName(uri)` | The Open Note and Reindex buttons, and a note as a message names it. |

## Verifying a change

```
npm run check-types   # the page code against the DOM, and the host against VS Code
npm run test:unit     # the shared components against what they must draw
npm run test:ui       # renders every webview and checks the guarantees below
npm run test:e2e      # drives each host and its page together
npm run test:dom      # every surface's DOM against its golden
npm run test:layout   # lays the pages out in headless Chrome and measures them
npm run test:visual   # draws them in Chrome and compares the pixels to last time
```

### Layout contracts

`LAYOUT_CONTRACTS` in `test/ui/verifyWebviews.js` names the properties that
decide how each page is laid out — the Dashboard's `repeat(3, …)` metric
strip, Help's two-column `main`, the sidebar's 12px padding — and checks the
value each one ends up with after the whole cascade. Add a contract when a
page depends on layout that a base rule could plausibly override.

`test/ui/verifyWebviews.js` renders every page, with what its shell links
inlined, and fails if any page: stops rendering, carries a script that does
not parse, is missing the design tokens, has a style or script without the
page's nonce, declares more than two `:root` blocks, renders a content row
without a shared surface class (in its text, or as any surface draws it),
loses one of its layout contracts, or does not end its sheets with the zen
sheet.

The contracts are read against the page as it renders **without** zen. Zen's
rules cannot reach them, because a contract matches its selector string
exactly and every zen rule is prefixed — which is the point of the prefix.

### Layout in a browser

The contracts read the stylesheet as text, and the end-to-end suites run
against a DOM with no geometry, so neither can see a column that clips its
own cards or a hover that grows a row past its scroller. `test/ui/checkLayout.js`
renders a page the way the webview does — the host's shell, the page's
bundle, a snapshot the real state builder made — inside an iframe of the size
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

### A page that paints

A page is tested by what it does: `openWebviewPage(html, state)` in
`src/test/webviewPage.ts` loads it in jsdom with a stand-in for the webview
API, sends it the host's state, and reads back what it drew and posted.
jsdom has no canvas, so `openWebviewPage(html, state, { canvas: true })`
gives every canvas a 2D context that draws nothing and records each call in
`page.canvasCalls` — `{ op, args, lineDash, strokeStyle, fillStyle,
globalAlpha, lineWidth }` — with `measureText` answering seven pixels a
character. Canvases are 800 by 600, and animation frames wait for
`page.flushFrames(n)`, so a test decides when the Notes Graph draws and then
asserts on the strokes it made.

### Pixels

The contracts measure geometry and the contrast check reads color pairs.
Neither can see a backdrop a theme paints, a glow that came back, or a
control that moved: zen mode shipped with Cooper's dotted grid still showing,
and it took a screenshot to notice. `test/ui/checkVisual.js` takes that
screenshot — the same pages and surfaces the layout check draws, once per
theme and zen state — and compares each to the one recorded under
`test/ui/visual-baseline/<platform>/`. A page that differs by more than a
hundredth of a percent of its pixels fails, with the diff image's path in the
message. That is tight on purpose: on one platform an unchanged page draws
identically, and the smallest real change yet seen — two buttons moving along
a row — was three times that.

Baselines are per platform, because fonts are rasterized by the operating
system and a page drawn on macOS differs from the same page on Linux in every
glyph's edge. The first run on a platform records its own set and says so;
CI keeps Linux's. When a change is meant, `npm run test:visual -- --update`
records what is drawn now, and a baseline nothing draws any more is dropped.
`VISUAL_ONLY=cooper+zen:taskBoard` picks one surface; `VISUAL_KEEP=<dir>`
leaves the screenshots and diffs where they can be opened.

A new surface is added once, in `test/ui/surfaces.js`, and the layout,
visual, and DOM checks draw it from then on.

The compiler checks the page code, but none of this: a rule a theme
overrides, a column that clips, a pixel that moved. Run these after
touching a shared component or sheet, and `npm test` too when the change
adds a setting or a command — `src/test/extension.test.ts` counts both.

## Adding a component

1. Write it in `src/webview/shared/` (or `shared/calendar/` for the
   calendars), as a component named for what it draws, with a doc block that
   says what it draws and what it posts. Its rules go in the component sheet
   it belongs to, or a new sheet that the pages drawing it import after
   `base.css`.
2. Draw it from every page that had its own copy, and delete the copies.
   A copy that drew different markup is a change in what a reader sees:
   `npm run test:dom` names it, and a commit that accepts it says so.
3. Test it on its own: `bundleShared([...])` (`src/test/sharedBundle.ts`)
   bundles the shared modules as a page's build does, and
   `openWebviewPage` runs them in jsdom, as `webview-shared.test.ts` does.
4. Add it to the tables above.
5. Run `npm run check-types && npm run lint`, then `npm run test:unit`,
   `npm run test:ui`, `npm run test:e2e`, `npm run test:dom`, and
   `npm run test:layout`, and `npm run test:visual` when it changes how
   anything looks.

If only one page will ever use it, leave it in that page's folder. A
component earns its place in `shared/` when a second page draws it.
