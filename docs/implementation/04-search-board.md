# Piece 4 and 10a–10d: search results you can scan, a board that keeps up

Implementation plan for `docs/ux-fifteen-sources-plan.md` Piece 4 (4a–4h),
Piece 10 items 10a–10d, and decision 4 (card tags). Planned against `dev` at
`726d23b` (v1.22.0); `git log` was re-read at the end of planning and had not
moved.

---

## 1. Scope

| Item | In | Notes after checking the source |
| --- | --- | --- |
| 4a Clamp to 3 lines, Show all, Preview row | Yes | Confirmed: `renderCard` prints the whole section (`searchPageHtml.ts:268`). |
| ux-research-plan 4b snippet | **Yes, inside 4a** | Confirmed unbuilt: `<mark>` exists (`markWords`, `components.ts:1172`) but the body always starts at its first line. Once 4e builds only 30 cards, a host-side snippet is cheap, and it is what makes a 3-line clamp useful on a word search. |
| 4b Rendered by default | Yes, changed | Confirmed `renderMode: 'markdown'` (`preferences.ts:121`). **Changed:** the plan's "stored preferences keep anyone who chose Source" cannot be done as written. `update()` persists the whole normalized blob (`preferences.ts:988-1001`), so every user who ever changed *any* preference has `renderMode: 'markdown'` stored whether they chose it or not. See the design and the one open question. |
| 4c Top 5 per facet, `+N more` | Yes | Confirmed: related 30 + status 2 + due 4 + updated 3 + folder 8 = 47 (`searchFacets.ts:40-42`). Done in the page scripts; the host still sends up to its limits. Applied values are never in `facet.values` (they are in the box as chips), so "applied values always" already holds and needs nothing. |
| 4d Hub offer as a text button | Yes | Confirmed: the `.hub.hub-empty` amber-barred section (`searchPageHtml.ts:86, 241`). |
| 4e Build cards for the page only | Yes, narrowed | Confirmed: `cardFor` renders, path-walks, and pin-checks every match before `takePage` (`dashboardState.ts:225-253`); tasks too (`:257`); `findsSomething` builds a card per section again (`:1174-1203`); the savedQuery widget asks for `paged: false` and slices 5 (`dashboardWidgets.ts:284-306`). **Dropped:** "filter plain words through the full-text store first". Plain words match by substring (`matchesNoteWords`, `:442-454`; `text.includes(word)`), and FTS5 matches tokens and prefixes, so "plan" finds "airplane" today and would not through FTS. It cannot be a safe pre-filter without changing results and counts. The substring match itself is cheap once it stops rendering. |
| 4f Copy as live query block; Insert Query Block… | Yes | Confirmed: `exportResults.ts` offers table, list, CSV only; no command inserts a fence. |
| 4g Show Results on Home | Yes | Confirmed: `saveSearch` toasts `Saved the search "…".` with no action (`searchPage.ts:827`, `taskBoard.ts:367`). |
| 4h List in Tasks view toggle in the gear | Yes | Confirmed: "Tasks view" sits in the query bar's actions (`taskBoardHtml.ts:103`) and only ever sets `agenda.query` (`taskBoard.ts:303-330`). |
| Decision 4: subtler card tags | Yes | Confirmed: `.tag-open`/`.inline-tag` are `<button>`s that take the control box, and every film theme restyles them as buttons (`themes.ts:184, 240, 293, 353, 429, 484`). |
| 10a Optimistic board move | Yes, remainder | **Partly built.** A *dropped* card already moves at once (`components.ts:1998-2012`). Missing: keyboard and ⋯-menu moves, column counts, a pending mark, a word on failure, and the host's fixed 200 ms debounce on a save Deckard itself made (`indexer.ts:381-390`). |
| 10b Busy Find and search pages | Yes | Confirmed: `quickFind.ts:76`, `searchPage.ts:86, 105, 129` await `indexer.ready` before anything shows. Dashboard, board, Stats, Calendar, and Graph already open at once, but say "Loading index..." with no count. |
| 10c Slim Dashboard payload | Yes | Confirmed: `sortTags`/`sortEntities` copy `sectionIds`, `taskIds`, `filePaths` (`dashboardState.ts:617-622, 943-947`); the page reads only `key`, `label`, `count`, `isFavorite` for tags and `key` for entities (`dashboardHtml.ts:452-465, 928-987`). The Tags panel is built on every render while Home shows (`dashboardHtml.ts:935-966`). The search page's `tag` and `entity` carry the same arrays (`dashboardState.ts:291-297`); slimmed in 4e's commit. |
| 10d `content-visibility`, 100 per column | Yes, first half | "Later, patch by task id" (M) is left out: it is a rewrite of the board's render and waits for a measurement after this lands. |

Items owned elsewhere that this touches: **1a** (swapped Source/Rendered
icons, Piece 1) sits on the same line as 4b; **9c** (token truncation rule)
and **9f** (`.loading` placeholder, `aria-busy`) overlap the card-tag layer
and 10b. See Dependencies.

---

## 2. Design

### 2.1 Search results (4a, snippet, 4b)

**Preview** is a new row in the search page's gear, between Format and Note
columns:

- Label `Preview`, a `renderViewOptionChoices('set-preview', …)` group with
  aria-label `Result preview` and three choices: `None`, `3 lines`, `Full`.
- Stored as a preference, not a VS Code setting (like Format and Sort):
  `searchPreview: 'none' | 'lines' | 'full'`, default `'lines'`, machine-wide
  (not in `workspacePreferenceKeys`).

What a note card shows under its title, file, and heading path:

| Preview | Body |
| --- | --- |
| None | Nothing. The card is title, tags, and where it is written. |
| 3 lines (default) | The body clamped to 3 lines. When the search has words and the first line holding one is below line 3, the clamp shows **the snippet**: the body from the start of that line's paragraph, after a muted `…` line. Under a body that is cut, a **Show all** text button; open, it reads **Show less**. |
| Full | The whole body, as today. No snippet. |

- The per-card toggle: `<button type="button" class="card-more" data-action="toggle-card-body" aria-expanded="false" aria-controls="card-body-N">Show all</button>`, aria-label `Show all of {title}` / `Show less of {title}`. Opening a card shows the whole body (not the snippet), unclamped. Which cards are open is kept in the page by card id until the search changes; a redraw from a save keeps them open.
- The snippet's lead: `<div class="card-snippet-lead"><span aria-hidden="true">…</span><span class="visually-hidden">From further down the entry:</span></div>`.
- The marks (`markWords`) apply as today, in the snippet and in the full body.
- Hub note body is untouched by Preview.

**Format defaults to Rendered** (4b). The gear's Format row is unchanged
(1a swaps its icons). Migration: see 2.9 and the open question.

### 2.2 Refine (4c)

In both `renderFacets` (query editor, `components.ts:2988`) and the sidebar's
`renderRefine` (`sidebarNotesHtml.ts:250`):

- Each facet shows its first 5 values. When it has more, a sixth control
  follows them: `<button type="button" class="query-facet-more" data-action="facet-more" data-facet-id="tags" aria-expanded="false" aria-label="Show 25 more Tags values">+25 more</button>`.
- Expanded, the facet shows all of them and the control reads `Show fewer` (aria-label `Show fewer Tags values`, `aria-expanded="true"`).
- Expanded facet ids are remembered in the page for the session (a `Set` in the page script, not `setState`), so a redraw after a save or a refine keeps them open; the sidebar keeps its own set.
- Focus stays on the control after it toggles (`renderKeepingPlace`).

### 2.3 Hub offer (4d)

The `.hub.hub-empty` section goes. Under the title (after `.entity-meta`
when there is one), a tag page with no hub gets:

```html
<p class="hub-offer"><button type="button" class="hub-offer-button" data-action="create-hub" title="Create a note whose describes: front matter names #project/atlas">Create hub note</button></p>
```

Drawn as text in `--muted` with an underline in `--accent` on hover and
focus, using the doubled-class specificity pattern `.overview-tag-link` already
uses so no theme's `button` rule reaches it. `margin: var(--space-1) 0 0`.

### 2.4 Card tags (decision 4)

**Where:** a tag button inside a card view: `.card` (search results),
`.task-row` (search Tasks tab, board List, Home's task widgets), `.board-card`,
and `.note` (Related Notes). **Not** changed: the editor decorations (keep their
box), Refine values, the sidebar's active-tag list, the Dashboard's Tags tab,
the hub's property values, the query bar's chips.

**What:** written text that opens its page, not a control. At rest: no box,
no fill, monospace at 0.9em, value in `--text`, namespace in `--muted`
(already AA on `--panel` in all eight themes since `09020ca`). Under the pointer
or focus: a faint accent ground and an accent underline, text color unchanged
(so contrast never depends on the hover). Focus ring as every control has.
It stays a `<button>` (clickable, one Tab stop, Enter/Space, context menu
unchanged).

A new layer, `getCardTagCss()` in `components.ts`, laid down in
`getPageTailCss()` **after the theme and high-contrast sheets, before zen**:

```css
/* Tags on cards: written text that opens the tag's page, not a control. A
   card can carry five, and five boxes outweigh the title they sit in. The
   editor keeps its box. After every theme, so no theme's button rule reaches
   them; the body prefix and :not() pair outweigh the page and theme rules
   that color a card's tags (0,4,1). */
body :is(.card, .task-row, .board-card, .note) :is(button.tag-open, button.inline-tag):not(:hover):not(:focus-visible),
body :is(.card, .task-row, .board-card, .note) :is(button.tag-open, button.inline-tag) {
  display: inline;
  min-height: 0;
  margin: 0 0 0 .2em;
  padding: 0 .15em;
  border: 0;
  border-radius: var(--control-radius);
  background: transparent;
  box-shadow: none;
  clip-path: none;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: .9em;
  font-weight: 400;
  letter-spacing: normal;
  line-height: inherit;
  text-align: inherit;
  text-transform: none;
  text-decoration: none;
  vertical-align: baseline;
  overflow-wrap: anywhere;
  transform: none;
  transition: none;
  cursor: pointer;
}
body :is(.card, .task-row, .board-card, .note) :is(button.tag-open, button.inline-tag):is(:hover, :focus-visible) {
  border: 0;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  box-shadow: none;
  color: var(--text);
  text-decoration: underline 1px var(--accent);
  text-underline-offset: 2px;
  transform: none;
}
body :is(.card, .task-row, .board-card, .note) :is(button.tag-open, button.inline-tag):focus-visible {
  outline: var(--focus-width) solid var(--focus);
  outline-offset: 1px;
}
body :is(.card, .task-row, .board-card, .note) :is(button.tag-open, button.inline-tag):not(:hover):not(:focus-visible) .tag-namespace { color: var(--muted); }
/* Separate tags under a title are a line of words, not a row of chips. */
body :is(.card, .note) .tag-list { gap: 0 var(--space-2); }
/* High contrast: a tag reads as a link at rest, since there is no tint. */
body.vscode-high-contrast :is(.card, .task-row, .board-card, .note) :is(button.tag-open, button.inline-tag),
body.vscode-high-contrast-light :is(.card, .task-row, .board-card, .note) :is(button.tag-open, button.inline-tag) { text-decoration: underline 1px; }
@media (forced-colors: active) {
  :is(.card, .task-row, .board-card, .note) :is(button.tag-open, button.inline-tag) { color: LinkText; forced-color-adjust: none; }
}
```

The first rule is written twice, once with `:not(:hover):not(:focus-visible)`
(0,4,2, which outweighs Replicant/Tomcat/Oblivion's
`.card .tag-open:not(:hover):not(:focus-visible)`, LCARS's
`.card-title .inline-tag:not(…)` and `.note .tag-list button`, and the
sidebar's `.note .tag-list button:not(…)` at 0,4,1) and once plain, so the
geometry holds in both states. No `!important`.

Line breaking: `renderTagLabel` (`components.ts:1282`) emits `<wbr>` between
`.tag-namespace` and `.tag-value`, so a tag that does not fit breaks after its
`/`, and `overflow-wrap: anywhere` breaks inside the value only when the value
alone is wider than the line. This fixes `#topic/replicants` breaking
mid-word in a Related Notes card (the 9c finding) for card views; 9c's
ellipsis rule stays 9c's for chips.

Zen needs nothing: zen's sheet does not touch tags, and the treatment is
already the quiet one.

### 2.5 Live query block (4f)

**Export**, on a search page (notes and tasks panes) and on the Task board,
gains a first item when the page has a search:

- label `Copy as live query block`, description `Stays up to date`.
- Writes:

  ````
  ```deckard sort=updated
  #project/atlas is:open
  ```
  ````

  followed by a newline. Options: search page `Sort` `alphabetical` → none
  (a block's natural note order is by title), `created` → `sort=created`,
  `updated` → `sort=updated`, `access` → none. Task board: board layout →
  none; list with `created`/`updated` → `sort=created`/`sort=updated`; table →
  `view=table columns=<the shown columns> sort=<col> dir=<dir>` when sorted.
  The fence grows to four or more backticks if the query contains a run of three.
- Status bar, 5 s: `$(check) Copied a live query block. Paste it into a note to keep this search's results there.`
- A page with no search (every note) does not offer it.

**`Deckard: Insert Query Block…`** (`deckard.insertQueryBlock`), in the palette
when `editorLangId == markdown`:

- Quick pick titled `Insert a query block`, placeholder
  `A saved or recent search, or type one`.
- Items: separator `Saved searches` (name, description = the query), then
  `Recent searches` (the query), newest first, not repeating a saved one.
  While something is typed, a first item `Insert a block for "{typed}"`.
- Chosen: inserts the fence at the cursor. A non-empty cursor line gets the
  block on the next line; a blank line is kept before and after the block;
  the cursor lands after the closing fence. One `editor.edit`, so one Undo.
- No Markdown editor active: `Open a note to insert a query block into it.`
  (Information).

### 2.6 Show Results on Home (4g)

- After Save (search page and board), the message becomes
  `Saved the search "{name}".` with buttons `Show Results on Home` and `Open Home`.
  - `Show Results on Home` appends a `savedQuery` widget for that saved search
    (`width: 'half'`, `count: 5`) unless Home already has one for it, then opens
    the Dashboard on Home.
  - `Open Home` opens the Dashboard on Home.
- Each saved-search row (Home's Saved searches widget and the Tags tab's Saved
  searches list) gains a `Show results` text button beside Remove, title
  `Add a widget to Home that lists what this search finds`, aria-label
  `Show the results of {name} on Home`. It is left out when Home already has
  that widget (`DashboardSavedFilter.onHome: true`).

### 2.7 List in Tasks view (4h)

- The query bar keeps `Save` and `Export tasks`; `Tasks view` leaves it.
- The board's gear gains a row, label `Tasks view`, after Layout:
  `<button type="button" data-action="use-for-agenda" aria-pressed="…">List in Tasks view</button>`, drawn chosen when pressed.
  - Not pressed: title `Make the Tasks view list this search`. Select → sets
    `deckard.agenda.query` as today; message `The Tasks view lists "{query}" now.`
  - Pressed, board search not the default: title
    `The Tasks view lists this search. Select to list every open task again.`
    Select → resets `deckard.agenda.query` to `""` where it is set;
    message `The Tasks view lists every open task again.`
  - Pressed, and both are the default (every open task): `aria-disabled="true"`,
    title `The Tasks view lists every open task, as this search does.`

### 2.8 Board speed (10a, 10d)

**10a.** Every move from the page — drop, `[` `]`, `t` `m`, `0`–`5`, the ⋯
menu — moves the card element at once when the target column is on the board
(prepended, as a drop does today), updates both columns' `.board-count` and
`aria-label`, keeps focus on the card, and marks it
`class="… is-pending" aria-busy="true"` (drawn at 70% opacity; reduced motion
unaffected). A move whose target column is not shown (a priority key on a
status board) marks the card pending in place. The next state replaces the
board, which clears the mark. When the host cannot write the move it posts
`{ type: 'moveRefused', taskId }` before its refresh, and the page announces
`{title} was not moved.`

Host: a write Deckard makes is read back at once. `updateTaskLine` and
`applyWorkspaceWrite` call `noteOwnWrite(uri)` before `document.save()`; the
indexer's save listener, finding the URI in that set, flushes on the next
tick (`setTimeout(…, 0)`) instead of waiting 200 ms. Other saves keep the
debounce.

**10d.** Board cards get
`.task-board .board-card:not(:hover):not(:focus-within):not(.dragging) { content-visibility: auto; contain-intrinsic-size: auto 72px; }`,
excluding the hovered and focused card because `content-visibility` implies
paint containment, which would clip the provenance line a hovered card
carries down over the next one. Open columns show their first **100** cards;
past that, `Show 412 more` (the existing `.board-more` control and
`showColumnRest` message, now per column). A shown column stays shown until
the grouping or the search changes. Done keeps its 20.

### 2.9 Loading (10b)

One string everywhere a page, Find, or view waits on the first scan, the one
the sidebar already uses:

`Indexing this workspace: 412 of 3,760 notes read…` (numbers `en-US`), or
`Indexing this workspace…` before the scan knows its total.

- Find opens at once with `picker.busy = true` and one item carrying that line
  (`alwaysShow`); typing is kept, Enter is ignored while it shows, and the
  results replace it when the index is ready.
- A search page opens at once (new or restored): the placeholder is
  `<main id="app" aria-busy="true"><div class="empty" data-loading>…</div></main>`,
  and the host posts `{ type: 'indexing', progress }` as the scan moves.
  When ready, a tag page resolves its tag; a tag that does not exist closes
  the page with today's warning.
- Dashboard, Task board, Stats, Calendar, and Notes Graph placeholders get the
  same line and `aria-busy` (they already open at once).

### 2.10 Preferences

| Preference (stored, not a VS Code setting) | Type | Default | Meaning |
| --- | --- | --- | --- |
| `renderMode` | `'markdown' \| 'html'` | `'html'` (was `'markdown'`) | Search page Format. |
| `renderModeChosen` | `true \| undefined` | undefined | Set by `setRenderMode`. A stored `'markdown'` without it is read as `'html'` once. |
| `searchPreview` | `'none' \| 'lines' \| 'full'` | `'lines'` | Search page Preview. |

No new VS Code settings. One new command, `deckard.insertQueryBlock`.

---

## 3. Implementation steps

### 4e — build cards for the page only (+ search snapshot slimming)

`src/ui/state/dashboardState.ts`
- Split `createTagOverviewCard` into:
  - `createCardKey(section, …)`: `{ section | file, id, heading, filePath, startLine, createdAt, updatedAt, accessCount }` — no HTML, no heading path, no pin lookup.
  - `completeCard(key, …)`: the full `TagOverviewCard` (rendered HTML via the existing `renderSectionBody` WeakMap, `getHeadingPath`, pin check), called only for the page.
- Generalize `compareTagOverviewCards` to take the key shape (it reads only `heading`, `filePath`, `startLine`, `createdAt`, `updatedAt`, `accessCount`), so sort order is byte-identical.
- `matchesNoteWords` takes the key and reads `section` text through a new `WeakMap<Section, string>` cache of `getSectionBody(rawContent)` (and `getFrontmatterBody` for files, `WeakMap<ParsedFile, string>`).
- `createSearchPageSnapshot`: filter keys → sort keys → `createPaging` → `takePage` → `completeCard` for the page. Tasks: `sortTasks` → `createPaging` → `takePage` → `createDashboardTask` for the page. `taskCounts` still over all tasks.
- `findsSomething` uses keys, never `cardFor`.
- Cache the hub's rendered body per `ParsedFile` (`WeakMap`).
- `tag` becomes `{ key, label, count, isFavorite, hubFilePaths }` and `entity` `{ key, label, kind, name, count }` (new `SearchPageTag`/`SearchPageEntity` types in `types.ts`; `SearchPageSnapshot.tag?: SearchPageTag`).
- `SearchPageOptions.pageSize?: number` overrides the preference. `dashboardWidgets.ts` savedQuery widget passes `{ pageSize: count }` instead of `paged: false`, and reads `noteTotal` from `page.notePaging.total` and tasks from `page.tasks` (same first `count`, same order).
- `searchPage.ts` `currentResults()` is unchanged (it re-evaluates); `openSource` looks up the page's cards, which are still the page.

Edge cases: an empty search (every note) sorts every key but renders 30; a
page number past the end is clamped before `takePage` as today; the hub file
is still excluded from keys.

### 10c — slim Dashboard payload

- `types.ts`: `DashboardTag { key; label; count; isFavorite }`,
  `DashboardEntity { key; label; kind; count; isFavorite }`;
  `DashboardSnapshot.tags: DashboardTag[]`, `entities: DashboardEntity[]`.
- `dashboardState.ts` `createDashboardSnapshot` maps `sortTags(...)` to
  `DashboardTag` (keep `sortTags` returning `TagInfo` for
  `dashboardWidgets.ts:188`); same for entities.
- `dashboardHtml.ts` `render()`: build `tagContent`, `tagNotice`, namespace
  and sort controls only when `dashboardMode === 'browse'`; the metric still
  uses `state.tags.length`.
- `dashboard.ts` `publish()`: unchanged shape otherwise.

### 4b — rendered by default

- `preferences.ts`: default `renderMode: 'html'`; `normalizePreferences`:
  `renderMode: value?.renderMode === 'markdown' && value?.renderModeChosen ? 'markdown' : 'html'`, and keep `renderModeChosen` when true; `setRenderMode` writes `{ renderMode, renderModeChosen: true }`.
- `types.ts` `PersistedPreferences.renderModeChosen?: true`.
- `searchPage.ts:350-356` keeps stripping `renderedHtml` in source mode.
- 1a (icon swap) if Piece 1 has not landed it.

### 4a — clamp, snippet, Preview

Host, `dashboardState.ts`:
- `SearchPageSnapshot.preview: SearchPreview` from `preferences.searchPreview`.
- `completeCard` gains `snippetWords: string[]` = `getTextWords(drafted.node)` ∪ preview words (lowercased, length ≥ 2). When preview is `'lines'` and words exist, `findSnippet(body, words)`:
  - Scan body lines tracking fenced code (```` ``` ```` / `~~~`, CommonMark length rule as `findQueryBlocks` does). First line whose lowercase contains a word: if its index < 3 → no snippet. Else start = that line's paragraph start (walk back over non-blank lines, at most 2), or the opening fence line if inside a fence.
  - `snippet: { rawContent, renderedHtml: renderMarkdown(rawContent), line }` on the card (`line` = source line of the snippet's first line, for tests and later use).
- `TagOverviewCard.long: boolean` = body has more than 3 lines or more than 280 characters, or a snippet exists.
- `searchPage.ts`: `setSearchPreview` message → `preferences.setSearchPreview`; source-mode stripping also blanks `snippet.renderedHtml`.
- `messages.ts` `parseSearchPageMessage`: `{ type: 'setSearchPreview', preview: 'none'|'lines'|'full' }`; `types.ts` union.
- `preferences.ts`: `searchPreview` default/normalize, `setSearchPreview`.

Page, `searchPageHtml.ts`:
- `renderCard`: body wrapper `<div class="card-body" id="card-body-N">` with class `is-clamped` in lines mode when the card is not opened; content = snippet (with lead) when present and not opened, else full body; `card-more` button when `section.long`.
- After render, in lines mode: for each clamped body without a snippet, if `clientHeight > 0 && scrollHeight <= clientHeight + 1`, remove its `card-more` (no-op in jsdom).
- Click: `toggle-card-body` flips the card id in `openedCards`, re-renders keeping place; `openedCards` clears when `state.query.text` changes.
- Gear: `{ label: 'Preview', html: renderViewOptionChoices('set-preview', [['none','None'],['lines','3 lines'],['full','Full']], state.preview, 'Result preview') }`.
- CSS (page): `.card-body.is-clamped > .rendered, .card-body.is-clamped > .markdown { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }`, `.card-snippet-lead { color: var(--muted); font: var(--text-xs) var(--font-mono); margin-top: var(--space-3); }`, `.card-more` as a text button (doubled class, `--muted`, accent underline on hover/focus), `.card-body.is-clamped > .markdown { margin-top: var(--space-3); }`.

### 4c — facets

- `components.ts` query editor: `expandedFacets = new Set()`; `renderFacets` slices `facet.values` to 5 unless expanded, appends the `query-facet-more` control; `handleClick` handles `facet-more`. CSS `.query-facet-more` as a text control, same height as values (26px), `--muted`.
- `sidebarNotesHtml.ts` `renderRefine`: same, with its own set; control class `refine-more`.
- `FACET_VISIBLE = 5` defined once in the component script and read by the sidebar.

### 4d — hub offer

- `searchPageHtml.ts` `renderHub()`: returns `''` when there is no hub; the header builder adds the `.hub-offer` line when `state.tag && !state.hub`. Remove `.hub-empty` CSS. Title attribute names the tag label.

### Card tags

- `components.ts`: `getCardTagCss()`; `getPageTailCss()` becomes theme → control edge → provenance → high contrast → **card tags** → zen; `renderTagLabel` emits `<wbr>` between namespace and value (not in the SVG branch).
- Remove rules the layer supersedes: `getTagCss()` `.card-title .tag-open, .note .tag-list button {…}`; `sidebarNotesHtml.ts:132, 167` (`.note .tag-list button:not(…)`, `.inline-tag {…}` inside notes); `themes.ts` per-theme `.card .tag-open:not(:hover)…` fragments (lines 22, 205, 368, 454) and LCARS `.card-title .inline-tag:not(…)` (493) and `.note .tag-list button` in the LCARS block (484). Leave `.inline-tag` rules outside cards (hub properties).
- `docs/components.md`: cascade order and the Tags table.

### 4f — live query block

- `queryBlockState.ts`: `export function formatQueryBlock(query: string, options: { sort?; direction?; view?; columns? } = {}): string`.
- `exportResults.ts`: `exportResults(what, count, text, liveBlock?: () => string)`; when given, the first item is `{ label: 'Copy as live query block', description: 'Stays up to date' }`; choosing it copies `liveBlock()` and sets the status bar message.
- `searchPage.ts` `exportResults` case: passes `() => formatQueryBlock(this.queryText, sortOptionsFor(preferences.tagOverviewSortMode))` when `this.queryText.trim()`.
- `taskBoard.ts` `exportResults` case: passes a block with options from layout, `taskSortMode`, and `taskTableSort`/`taskTableColumns`.
- New `src/ui/commands/insertQueryBlock.ts`: `insertQueryBlock(preferences)`; registered in `extension.ts`; `package.json` command `deckard.insertQueryBlock` (title `Insert Query Block…`, category `Deckard`), `commandPalette` when `editorLangId == markdown`.

### 4g — Show Results on Home

- `preferences.ts`: `addSavedSearchWidget(filterId): Promise<'added' | 'present' | 'missing'>` — appends `{ id: 'savedQuery-' + base36 time + random, kind: 'savedQuery', width: 'half', count: 5, filterId }` via `normalizeDashboardWidgets`.
- `searchPage.ts`, `taskBoard.ts` `saveSearch`: `showInformationMessage(msg, 'Show Results on Home', 'Open Home')`; first → `addSavedSearchWidget` then `deckard.showDashboard`; second → `deckard.showDashboard`. The Dashboard opens on Home: `DashboardPanel.show()` already opens in the stored mode, so add `showHome()` (sets mode `home`, then show) and a command-free call path through `navigation` or `executeCommand('deckard.showDashboard')` followed by the mode set — implement as `deckard.showDashboard` with an optional `{ mode: 'home' }` argument.
- `dashboardState.ts` `createDashboardSavedFilters`: `onHome` when a `savedQuery` widget names the filter.
- `dashboardHtml.ts` `renderSavedFilterRow`: `Show results` button when `!filter.onHome`; click → `{ type: 'addSavedSearchWidget', filterId }`.
- `messages.ts` `parseDashboardMessage` + `dashboard.ts` handler.

### 4h — List in Tasks view

- `taskBoardHtml.ts`: remove the button from `actions`; add the gear row; click posts `useSearchForAgenda` (unchanged message).
- `taskBoard.ts` `createSnapshot`: add `agendaQueryIsDefault` (normalized agenda query is `''`) beside `agendaListsThisSearch`.
- `useSearchForAgenda()`: when already listed and the agenda query is not default, write `''` to the target where it is set, message `The Tasks view lists every open task again.`; when listed and default, do nothing (the button is disabled).

### 10a — optimistic moves

- `components.ts` `installTaskBoard`: one `applyMove(card, columnId)` used by drop, keys, and the menu: find the column, prepend, remove `.board-empty`, recount (`.board-count` = visible cards + hidden count read from `data-hidden-count`, which `renderTaskBoard` now writes on each column), update the column's `aria-label`, add `is-pending` + `aria-busy`, `focusCard`. `pickTaskDate` and `editTask` are not moves.
- Page message listener (`taskBoardHtml.ts`): `moveRefused` → `announce(title + ' was not moved.')`.
- `taskBoard.ts` `moveTask`: on `false`, post `moveRefused` then `refresh()`.
- New `src/core/workspace/ownWrites.ts`: `noteOwnWrite(uri)`, `takeOwnWrite(uri): boolean` (a `Set<string>` with a 5 s expiry per entry).
- `taskActions.ts` `updateTaskLine` and `workspaceWrites.ts` `applyWorkspaceWrite` (and the older path at `:111-116`): `noteOwnWrite(uri)` before `save()`.
- `indexer.ts`: `onDidSaveTextDocument` → `queueUpsert(uri, undefined, takeOwnWrite(uri))`; `scheduleFlush(now)`: when `now`, clear any pending timer and flush on `setTimeout(0)`.
- CSS in `getTaskBoardCss()`: `.board-card.is-pending { opacity: .7; }`.

### 10b — busy while indexing

- `indexer.ts`: `public get hasIndexed(): boolean`, true after the first `refresh()` completes.
- `components.ts` component script: a listener for `{ type: 'indexing', progress }` that writes `describeIndexing(progress)` into `#app [data-loading]` when present; `describeIndexing` exported to the sidebar (which already writes the same words) so the string lives once. Every page's `render()` sets `app.removeAttribute('aria-busy')`.
- New `src/ui/webview/indexingProgress.ts`: `followIndexing(indexer, post): vscode.Disposable` — posts the progress on each `onDidProgress` until ready.
- Placeholders in `searchPageHtml.ts`, `dashboardHtml.ts`, `taskBoardHtml.ts`, `statsHtml.ts`, `calendarHtml.ts`, `notesGraphHtml.ts`: `aria-busy="true"`, `data-loading`, text `Indexing this workspace…` (replaced by the count, or by the page, as soon as either is known). Coordinate with 9f, which restyles this placeholder.
- `searchPage.ts`: `SearchPanels.showQuery`/`show`: when `!indexer.hasIndexed`, create the panel at once with the raw text, `followIndexing`, then `await ready`, canonicalize (for `show(tagKey)`), dedupe against an existing panel for the same key (reveal it, dispose the new one), then `refresh()`. `restore`: modern `{query, origin}` state attaches at once; the legacy shape still awaits the index. `SearchPanel.refresh` does nothing but post progress until `hasIndexed`.
- `quickFind.ts` `show()`: create the picker at once; while `!hasIndexed`, `busy = true` and the one indexing item, updated on progress; `accept()` returns early; on ready, `busy = false`, `refresh()`.
- Dashboard, board, Stats, Calendar, Graph hosts: `followIndexing` between creating the panel and `await ready`.

### 10d — board cards on screen

- `getTaskBoardCss()`: the `content-visibility` rule.
- `taskBoardState.ts`: `TaskBoardOptions.columnLimit?: number` (default 100) and `shownColumns?: ReadonlySet<string>`; open columns slice to the limit unless shown, with `hiddenCount`. Done keeps `doneLimit`, lifted when `'done'` is in `shownColumns`.
- `taskBoard.ts`: `showEveryDoneTask` becomes `shownColumns: Set<string>`, cleared on `setBoardGroup` and on a changed query; `showColumnRest` adds `message.columnId` (validated in `messages.ts` as a string).
- `renderTaskBoard`: `data-hidden-count` on each column (used by 10a).
- Word filtering while typing on the board still hides only the drawn cards; Enter runs the search on the host. Unchanged.

---

## 4. Tests

### `npm test` (vscode-test, `src/test`)

- `view-state.test.ts`
  - Equivalence: for each sort mode, a 200-section fixture gives the same card ids, order, paging, and counts as a reference built the old way (kept in the test as a helper).
  - Page-only rendering: wrap `rendering.renderMarkdown` (CommonJS export, replaceable) and count calls for an empty search over 1,000 fresh sections at page size 30: at most 30 (+1 hub).
  - `tag`/`entity` on a search snapshot carry no `sectionIds`, `taskIds`, `filePaths`.
  - Snippet: a body with the word on line 8 gives a snippet starting at its paragraph; on line 2 gives none; inside a fence starts at the fence; draft words count; `preview: 'full'` gives none.
  - `long` is set for 4+ lines and for one 300-character line.
  - Existing `page.renderMode === 'markdown'` assertion (`:354`) becomes `'html'`.
- `dashboard-widgets.test.ts`: the savedQuery widget lists the same 5 notes and tasks and the same `noteTotal` as before.
- `dashboard-behavior.test.ts`: snapshot tags are exactly `{key,label,count,isFavorite}`; a size test: 2,000 tags × 40 sections serializes under 300 KB; on Home the DOM holds no `.tag-row`, and switching to Tags draws them.
- `preferences.test.ts`: default `renderMode` is `'html'`; stored `'markdown'` without `renderModeChosen` reads `'html'`; with it stays; `setRenderMode('markdown')` sets it; `searchPreview` default and rejection of junk; `addSavedSearchWidget` adds once, reports `present` the second time, `missing` for an unknown id.
- `search-page-behavior.test.ts` (jsdom `webviewPage.ts`): lines mode draws `.card-body.is-clamped` and `Show all`; the button flips `aria-expanded`, the text, and the clamp, and survives a second `state` message; None draws no body; Full no clamp and no snippet; the snippet lead is present with the snippet; the Preview gear posts `setSearchPreview`; no `.hub-empty`, and `.hub-offer button[data-action="create-hub"]` follows the h1; each `set-mode` button carries its own mode's icon (with 1a).
- `query-builder-webview.test.ts` / `search-refine.test.ts`: a facet of 12 values draws 5 and `+7 more`; clicking draws 12 and `Show fewer`; the state survives a re-render; a facet of 5 has no control.
- `related-notes-behavior.test.ts`: the sidebar Refine does the same.
- `export-results.test.ts`: `formatQueryBlock` for each search-page sort and each board layout; a query with ```` ``` ```` gets a four-backtick fence; the result round-trips through `findQueryBlocks` + `parseQueryBlockInfo` with no warnings.
- New `insert-query-block.test.ts`: inserts at an empty line, after a non-empty line with a blank line between, keeps one Undo step; lists saved before recent without repeats; the typed item; the no-editor message.
- `task-board.test.ts`: a 250-card status column shows 100 with `hiddenCount: 150`; `shownColumns` lifts it; Done still 20; clearing on group change (host test in `task-board-page.test.ts`).
- `task-board-page.test.ts` (jsdom): `]` moves the card to the next column at once, with `is-pending`, `aria-busy`, and both counts updated; a `state` clears it; `moveRefused` announces `… was not moved.`; the gear has `List in Tasks view` with `aria-pressed`, and the query bar has no `use-for-agenda`; disabled when both are default; `Show 150 more` posts `showColumnRest` with its column id.
- `workspace.test.ts`: a save noted by `noteOwnWrite` fires `onDidUpdate` before 200 ms; an ordinary save still waits; the note expires.
- `quick-find.test.ts`: before ready, the picker is shown, `busy`, with the indexing line; Enter does nothing; after ready it lists results for what was typed.
- `extension.test.ts`: `deckard.insertQueryBlock` in the command list; the settings count stays 54.
- `naming.test.ts` (if 8e has extended it to toast buttons): `Show Results on Home`, `Open Home` follow the glossary.

### `npm run test:ui`

- `verifyWebviews.js`: a LAYOUT_CONTRACT that, on the search page, sidebar, and board, `body .card button.tag-open` resolves to `border-style: none` and `background-color: transparent` after the whole cascade, in every theme; a check that `getPageTailCss()` puts the card-tag layer after the theme and before zen.
- `checkContrast.js` picks up the new classes (`.card-more`, `.hub-offer-button`, `.query-facet-more`) from the markup; add them to its pairs if it does not.

### `npm run test:e2e`

- `searchPage.e2e.js`: a new page opens rendered; Preview → None posts and redraws; Show all; Save → the stubbed message returns `Show Results on Home` → a `savedQuery` widget is in preferences and the Dashboard opens on Home; Export offers `Copy as live query block` first and the clipboard holds the fence; a page opened before the stub indexer is ready shows the indexing line, then results.
- `taskBoard.e2e.js`: keyboard move is optimistic, then reconciled; `List in Tasks view` toggles `deckard.agenda.query` both ways; Export offers the block.
- `dashboardHome.e2e.js`: `Show results` on a saved-search row adds the widget and disappears.

### `npm run test:layout`

- `checkLayout.js` `createSurfaces`: add a **non-zen** `searchPage` surface (900×900, `'#project/atlas'`, `hovered: ['.card']`), so card tags, the clamp, and the hub line are measured in all eight themes, not only in zen. Probe: every `.card-body.is-clamped` is no taller than 3 × its line-height + 2px.
- `checkRenderedContrast.js` measures the new surface, and so card tags in every theme, automatically.
- The board surface's hovered `.board-card` keeps passing "nothing clipped" with `content-visibility` (that is the check that proves the `:not(:hover)` exclusion).

### `npm run test:visual` — baselines to re-record (`test/ui/visual-baseline/darwin`)

- `*+zen-searchPage.png` × 8: rendered, clamped, snippet-free fixture, hub line, card tags, facets capped.
- `*-searchPage.png` × 8: **new** (non-zen surface).
- `*-sidebarNotes.png`, `*+zen-sidebarNotes.png` × 16: card tags.
- `*-taskBoard.png`, `*+zen-taskBoard.png` × 16: `Tasks view` leaves the query bar (and card tags where the fixture's cards carry any).

48 in all, recorded in the commits named below; CI keeps Linux's set.

---

## 5. Docs

**README.md**
- *Search pages* (`:590-620`): the Preview row, 3 lines and Show all, the snippet, rendered by default and Format for source; Refine's five-and-more; **Create hub note** under the title (*Hub notes* `:648`); Save's two follow-ups; a sentence that tags on cards are text that opens the tag, and the editor keeps its box.
- *Taking a search's results out* (`:610`): `Copy as live query block`.
- *Query blocks* (`:773`): `Deckard: Insert Query Block…` and Export's block.
- *Task board* (`:517-537`): `List in Tasks view` in the gear replaces the `Tasks view` bullet (`:529`); a card moves at once; a column over 100 cards shows the first 100 and `Show N more`.
- *Commands* (`:100`): `Deckard: Insert Query Block…`.
- *Limitations and troubleshooting*: Find and search pages open during the first index and say how far it has got.

**Help** (`src/ui/webview/helpHtml.ts`)
- *Refine* card (`:404`): five values and `+N more`.
- *Saving a search* card (`:405`): Show Results on Home.
- *Taking a result out* (`:407`): live query block.
- A *Previewing results* card in the search section: None / 3 lines / Full, Show all, the snippet.
- *Tasks view and Task board* (`:389-395`): List in Tasks view.
- *Hub notes* (`:470`): the Create hub note line.
- Command descriptions map (`:73`): `deckard.insertQueryBlock`.

**CHANGELOG.md** `## Unreleased` (one entry per feature commit, under Added/Changed as fits):
- **Search results you can scan.** A result shows three lines of its entry, or the lines where the searched words are, and Show all opens the rest; the gear's Preview chooses None, 3 lines, or Full. Search pages start rendered.
- **Refine shows five of each.** …and `+N more` on request, on the page and in the sidebar.
- **A tag with no hub offers one in a line**, not a panel.
- **Tags on cards are text.** Search results, task rows, board cards, and Related Notes draw a tag as text that opens it; the editor keeps its box.
- **A search becomes a live query block.** Export's first item, and `Deckard: Insert Query Block…`.
- **A saved search can show its results on Home.**
- **List in Tasks view** is a toggle in the Task board's gear.
- **Faster search pages and Dashboard at scale**, with the measured numbers from the commit's own run.
- **A moved card moves at once.** / **Find and search pages open while indexing.** / **Long board columns show 100 cards and the rest on request.**

**docs/components.md**
- *How a page is assembled*: cascade is base → page → theme → high contrast → card tags → zen.
- *Tags*: `getCardTagCss()`, where it applies and where it does not, the `<wbr>`.
- *Page script helpers*: `describeIndexing`, the `indexing` message, `data-loading`.
- *Task board*: `.is-pending`, `data-hidden-count`, `content-visibility` and why hover is excluded.
- *The search box*: `query-facet-more`, `FACET_VISIBLE`.
- *Layout in a browser*: the search page is now a surface in both zen states.

---

## 6. Commits

Each leaves all four suites green (`npm test`, `test:ui`, `test:e2e`,
`test:layout`); a commit that changes pixels is followed at once by its
`test:` re-record commit, as the history does.

1. `perf: a search page builds the cards it shows, not every match` — 4e, search snapshot `tag`/`entity` slimmed, savedQuery widget by page size. CHANGELOG with measured timings.
2. `perf: the Dashboard sends each tag's name and count, and builds the Tags tab only when it is open` — 10c.
3. `feat: search pages start rendered` — 4b (+1a if not landed).
4. `feat: a search result shows three lines, or the lines its words are in, and Show all opens the rest` — 4a + snippet + Preview.
5. `feat: Refine shows five of each kind, and the rest on request` — 4c, page and sidebar.
6. `feat: a tag with no hub note offers one under its title, not in a panel` — 4d.
7. `test: draw the search page without zen, and re-record its baselines` — new non-zen surface + 16 search page baselines.
8. `feat: a tag on a card is written text that opens it, not a button` — decision 4.
9. `test: re-record the baselines for tags on cards` — sidebar 16 (+ search page 16 again).
10. `feat: a search becomes a live query block, from Export or Insert Query Block` — 4f.
11. `feat: a saved search offers to show its results on Home` — 4g.
12. `feat: the Task board lists its search in the Tasks view from a toggle in the gear` — 4h.
13. `test: re-record the board baselines for List in Tasks view` — 16.
14. `feat: a moved card moves at once, and a note Deckard wrote is read back without waiting` — 10a.
15. `feat: Find and search pages open while the workspace is indexing, and say how far it has got` — 10b.
16. `perf: the board draws only the cards on screen, and a long column shows its first 100` — 10d.

---

## 7. Size, risks, dependencies, questions

**Size:** about 9 days.
4e + 10c 1.5 · 4b 0.25 · 4a + snippet 1.5 · 4c 0.5 · 4d 0.25 · card tags 1 ·
baselines 0.5 · 4f 1 · 4g 0.5 · 4h 0.5 · 10a 1 · 10b 1 · 10d 0.5.

**Risks**
- *Clamping rendered HTML.* `-webkit-line-clamp` across nested blocks (lists,
  quotes) is Chromium behavior, not spec; the layout probe's height check is
  the guard, with `max-height: 3lh` as the fallback if a case escapes.
- *Card-tag specificity.* The layer outweighs every rule found today; a theme
  rule added later with more specificity would quietly bring a box back. The
  new layout contract catches that in every theme.
- *4e equivalence.* Sorting keys instead of cards must give the same order;
  the equivalence test pins it for every sort mode.
- *`content-visibility`* changes paint containment; the hover exclusion and
  the layout suite's clipping check cover the provenance overlay, and
  keyboard `scrollIntoView` works with it in Chromium.
- *Own-write fast path.* A save the user makes right after Deckard's write to
  the same file within 5 s also skips the debounce; harmless (one flush).
- *Baseline churn*: 48 images; each re-record commit names what changed.

**Dependencies**
- **Piece 1 (1a)**: the Format icons. Land 1a first, or fold it into commit 3.
- **Piece 9 (9c)**: token truncation for chips. Card tags here wrap after the
  namespace instead; if 9c lands first, keep its chip rule and this layer's
  card rule side by side. **9f**: restyles the placeholder 10b fills; 10b
  sets text and `aria-busy` only, so either order works. **9a/9d** do not touch
  this.
- **Piece 8 (8e)**: glossary wording for the Save toast ("Save search"); the
  message text here already matches 8e's `Saved the search "{name}".`
- **Piece 3 (3f)**: board column headers ("40 · 38 overdue", limits) edit the
  same `renderTaskBoard` header as 10a's count update; whichever lands second
  recounts through the same helper.
- **Piece 10e** (publish to visible views one at a time) is independent but
  compounds 10a's gain.
- **Piece 5 (5a)**: the Export block writes whatever the search is, including
  a future `link =` clause; nothing to coordinate.

**Open question for David**

1. **Rendered for everyone once?** Deckard cannot tell a Source you chose from
   the Source you were given, because every saved preference blob stores
   `renderMode: 'markdown'` whether or not you touched Format. The plan
   switches everyone to Rendered once, and a later Source choice sticks. The
   alternative is to leave every existing user on Source and give only new
   installs Rendered, which means almost nobody who has used Deckard sees
   decision 2. Recommendation: switch everyone once; Source is one click in the
   gear, and the CHANGELOG says so.
