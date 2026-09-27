# Piece 12 — The Graph and Stats explain themselves

Implementation plan for `docs/ux-fifteen-sources-plan.md` Piece 12, written
against `dev` at `726d23b` (v1.22.0). Everything below was checked against
the source on 2026-09-25.

## 1. Scope

| Item | Status after verification |
| --- | --- |
| 12a Edge kinds drawn apart, legend, **Only links I wrote** | **Confirmed.** `draw()` in `notesGraphHtml.ts:1370-1396` strokes every edge in one batched path in `colors.edge`, whatever its `types`. The legend (`:161`) names only node kinds. Kept, with one addition: the pass-through edges a focused graph adds (`types: []`, `notesGraphState.ts:572`) get their own pattern, since they are neither links nor tags. |
| 12b Node size and tooltip from indexed degree, by kind | **Confirmed.** `nodeRadius()` (`:1352`) and the tooltip (`:1811-1818`) read `degrees[]`, which counts only the edges `selectSalientEdges` kept, so both change with the Connection density slider. The host already computes a stable `node.degree` (`notesGraphState.ts:applyDegrees`) that the page ignores. |
| 12c Community labels at the centroid, from top tags, over a faint hull; click filters | **Confirmed.** Communities are computed (`buildCommunities`, `:568`) and only counted in the status line (`:1525`). Changed: the "hull" is a disc (centroid, radius from the members' spread), not a convex hull, so it costs one pass per frame and one batched fill. Community hue stays out, per "Considered and left out". |
| 12d Stats leads with **Needs attention**; every tile opens its list; empty view panels collapse | **Confirmed**, plus a bug found: the **Tasks** tile opens `has:task` (`statsHtml.ts:160`), which the parser rejects — `has:` accepts due, scheduled, start, done, priority, id, dependsOn (checked by running `parseQuery('has:task')` from `out/`: one error diagnostic). Fixed first as its own commit with `is:task`. **Files** stays a plain number: there is no list of files to open, and a duplicate of the Notes search would mislead. |
| 12e 12-week sparklines under Notes, Tasks, Open tasks, "+9 this week" | **Kept, with one wording change:** the windows are rolling seven-day spans ending today, so the last point is never a partial week, and the text is "+9 in the last 7 days" — the same correction 1g makes to Refine's "This week". This also removes any dependency on 2e's week start. |
| 12f-1 Files as nodes at overview, headings on zoom | Kept, planned last (M–L). |
| 12f-2 **Tags written together** matrix on Stats | Kept (M). |
| 12f-3 Tag usage histogram, "used once" bar opens them for merging | Kept (S). |
| 12f-4 Relation-strength rail becomes part-of-whole, "in 6 of 13" | **Confirmed**: `createRelatedFacetValues` (`dashboardState.ts:381-420`) sets `strength = normalizedWeight / strongest`. Kept (S). |

Nothing dropped.

## 2. Design

### Colors (all eight themes)

No new colors and no new tokens. The canvas already reads tokens through
`themeColor()` from `:root`, where every theme (corpo, replicant, synthwave,
tomcat, fellowship, cooper, oblivion, lcars) declares them, and falls back
to system colors under `forced-colors`. New reads:

| Use | Token | Forced colors |
| --- | --- | --- |
| Group disc fill | `--line-strong` at `globalAlpha .07` | none drawn |
| Group disc edge | `--line-strong` at `.22`, 1px screen | `GrayText` |
| Group label ink | `--text` (`colors.label`) | `CanvasText` |
| Group label halo (stroke under text) | `--bg-dark` (`colors.background`) | `Canvas` |
| Sparkline stroke | `--muted` (SVG, `stroke: var(--muted)`) | `CanvasText` |
| Sparkline end point | `--accent` | `Highlight` |
| Histogram bars, matrix cells | `--cyan`, cell opacity in 5 steps (one hue, sequential) | `CanvasText` with the count printed |

Edge kinds are told apart by **dash pattern**, not color, so they survive
forced colors, colorblindness, and every theme. Deltas under sparklines stay
in `--muted` text: a rise in open tasks is not good news, so no green/red.

### 12a — Edge kinds

An edge's kind is its strongest type: `wiki-link` > `heading` >
`associated-tag`/`tag-membership` > joined (empty `types`).

| Kind | Pattern (screen px, divided by `k` in world space) | Base alpha |
| --- | --- | --- |
| Wiki link | solid | `edgeAlpha` × 1.6 (capped .7) |
| Heading | dashed `[5, 3]` | `edgeAlpha` |
| Tag | dotted `[1, 3]`, round caps | `edgeAlpha` × .8 |
| Through a daily note | dash-dot `[8, 3, 1, 3]` | `edgeAlpha` |

Legend (status line, after the node swatches), each a 16×8 inline SVG line
sample in `--muted` with the same `stroke-dasharray`, `aria-hidden`, then the
word: **Wiki link**, **Heading**, **Tag**, and **Through a daily note** only
while the snapshot has such edges. The canvas `aria-describedby` already
points at `#graph-legend`.

New toggle in **Filters**, after Show orphans:

- `Only links I wrote` — id `only-written-links`, setting `onlyWrittenLinks`
  (default `false`, persisted with the others, reset by Reset graph).
- title: "Draw only the wiki links written in your notes. Headings and tags
  still place each note, but are not drawn."

When on, edges are every candidate edge whose `types` include `wiki-link`
(salience budget bypassed, so a hub's twentieth link is not dropped);
tag-anchored clustering is unchanged, so nodes stay where they were. Show
orphans still applies. Status line in this mode: "2 wiki links · 483 nodes
with none".

Status line otherwise: "{n} notes · {n} tasks · {drawn} of {indexed} links
drawn · {g} groups". ("communities" becomes "groups" to match 12c.)

### 12b — Size and tooltip

Host adds per node `links?: { wiki?: number; heading?: number; tag?: number;
related?: number }` (zeros omitted) in `applyDegrees`: `wiki` = edges with
`wiki-link`, `heading` = edges with `heading`, `tag` = `tag-membership`
edges, `related` = `associated-tag` edges (tag nodes only). An edge with two
types counts once in each. Workspace-wide, so a focused graph keeps the
same numbers (`createLocalGraphSnapshot` reuses node objects).

`nodeRadius(i) = (2 + Math.sqrt(Math.min(node.degree, 100))) * nodeSize`.
The cap keeps a shown tag carried by 400 entries from covering its group.

Tooltip meta, zero kinds left out, singular/plural by count:

- Note: `atlas.md:12 · 4 wiki links · 2 headings · 7 tags`
- Task: `Task · atlas.md:30 · 1 wiki link · 3 tags`
- Tag: `Tag · on 42 notes and tasks · 5 related tags`
- Nothing: `atlas.md:12 · No links`

### 12c — Groups named where they sit

Computed once per `rebuildView` (not per frame):

- **Name.** For each community with ≥ 4 notes and tasks, score each tag key
  its members carry: `inGroup² / carriedAnywhere` (frequent here, rare
  elsewhere). The label is the top tag; a second is added, `atlas · design`,
  when it scores at least half the first. Tag labels come from
  `snapshot.tags`, shown without the `#`, namespace kept
  (`project/atlas`). A group whose members carry no tag is named after its
  best-connected note: `around Meeting notes`. Names over 28 characters are
  cut with `…`.
- **Group key** for filtering and persistence: the top tag key, or the id
  of that best-connected note.

Per frame, in `draw()` before edges: one O(n) pass accumulates each
community's centroid and mean squared distance; a disc of radius
`max(12, 1.5 × rms)` is added to one path, filled once and stroked once.
Labels at rest only (`k < labelThreshold`), faded out over the last 0.4 of
zoom before the threshold; at most 16, largest group first, placed greedily
with a screen-space rectangle test so no two overlap; hub labels (now 8 at
rest, down from 12) are placed after them through the same test. Label:
`--text-sm`, weight 700, `strokeText` in the background color at 3px under
`fillText`.

**Picking a group out.** A click on a label (hit-tested against the rects
kept from the last draw, before `nodeAt`) or a choice in a new **Group**
`<select>` in Filters (id `group-filter`, first option "All groups", then
"atlas · design (34)" by size) sets `settings.group` to the group key: nodes
outside it dim exactly as a tag filter dims them, and the camera fits the
group. The select is the keyboard route. When a rebuild no longer has that
key, the filter clears itself and the status line says "Group no longer
there — showing all". Clear tag filters is renamed **Clear filters** and
also clears the group.

The Relationships panel text replaces "visual communities" with "groups"
and adds: "Each group is named after the tags its notes carry more than the
rest of the workspace does."

### 12d — Stats: Needs attention first

Order of the page: header → **Needs attention** → tiles → Most viewed.

**Needs attention** (`<section aria-labelledby="attention-heading">`, h2
"Needs attention") holds, in this order, only the panels that have rows:

1. **Notes Deckard could not read** (today's panel, moved).
2. **Links that open no note** — added by 5g; this piece leaves the slot.
3. **Tags that look alike** (moved).
4. **Notes nothing links to** (moved; first 10 rows, then a
   "Show 40 more" button revealing the rest of the 50 sent, then today's
   "And N more.").

Each panel heading carries its count: "Tags that look alike (3)". With none
to show, the section is one line: "Nothing needs attention: every note was
read, no two tags look alike, and every note is linked from another."

**Tiles** — each opens what it counts:

| Tile | Opens | Hint (title and aria) |
| --- | --- | --- |
| Files | nothing (plain number) | — |
| Notes | search `is:note` | Open a search for every note |
| Tasks | search `is:task` (fixes `has:task`) | Open a search for every task |
| Open tasks | search `is:open` | Open a search for every open task |
| Tags | quick pick of every tag, then its page | Choose a tag to open |
| Namespaced tags | quick pick of the namespaced tags, then its page | Choose a namespaced tag to open |
| Wiki links | the Notes Graph with **Only links I wrote** on | Open the Notes Graph showing only the links you wrote |
| Unlinked notes | moves focus to **Notes nothing links to** | Go to the list of notes nothing links to |

**Most viewed**: panels with rows render as today. The empty ones fold into
one muted line under the section: "Nothing viewed yet among canonical tags
and note entries. Views are counted when you open a tag's page or a note
entry from a search page." (lists only the empty ones; all three empty →
"Nothing viewed yet. …").

### 12e — Sparklines

Host adds `trends: { notes: StatsTrend; tasks: StatsTrend; openTasks:
StatsTrend }`, `StatsTrend = { points: number[]; change: number }`: 13
points, the count as it stood 84, 77, … 7, 0 days ago (now); `change =
points[12] - points[11]`.

- Notes: sections with `createdAt ≤ t` (no date → counted throughout).
- Tasks: tasks with `createdAt ≤ t`.
- Open tasks: tasks created by `t` and not done by `t`, where done is
  `doneAt`, else the note's `updatedAt`, else not counted in any past week.
- A `createdAt` in the future (a daily note written ahead) counts as now;
  the last point is set to the tile's own value so the two always agree.
- Known and said: an entry added to an old note counts from that note's
  date, since the index dates entries by their note. The tile's `title`
  says "By the date each note was written, over the last 12 weeks."

Under the value: a 100%×20px inline SVG polyline (`preserveAspectRatio=none`,
`vector-effect: non-scaling-stroke`, 1.5px, `--muted`), y scaled min–max (a
flat series draws a midline), and a 3px end dot in `--accent`; then the
text "+9 in the last 7 days" / "−3 in the last 7 days" (U+2212) / "No change
in the last 7 days" in `--muted`, `--text-xs`. The SVG is `aria-hidden`; the
tile's aria-label becomes "Notes, 485, +9 in the last 7 days. Open a search
for every note". Each point also carries an SVG `<title>` — "12 weeks ago:
402" … "Now: 485" — hit through a transparent 8px-wide rect per point, so
hovering shows the value (the chart's hover layer).

The sparkline markup is a shared helper `renderSparkline(points)` in
`getComponentScript()` so 3c's Home tiles can reuse it.

### 12f — Later

- **Relation rail as part of the whole.** Refine's related tags:
  `strength = count / resultTotal`; the rail fills by `getWeightLevel`
  unchanged; the chip's aria text says "in 6 of 13 results" instead of
  "related 2 of 3", and its title leads with "In 6 of 13 results. " before
  `describeAssociation`. Sort: count, then association weight, then label.
  Search page and sidebar Refine both, since both call the same helper.
- **Tag usage histogram** on Stats, below Most viewed, h2 "How often tags are
  used": six bars — used once, 2, 3–5, 6–10, 11–25, 26 or more — each a
  button with its count as a direct label ("Used once: 41 tags"). The
  "Used once" button unfolds a list of those tags beneath, each with its
  lookalike if `findTagMergeCandidates` has one ("→ #project/atlas
  [Merge]") or **Merge into…** (`deckard.mergeTag` with the source only,
  which asks for the target). Other bars open the tag quick pick filtered to
  that band.
- **Tags written together** matrix on Stats: the 12 most-used tags, an
  upper-triangle grid, each cell the number of entries carrying both, shaded
  in five opacity steps of `--cyan`, the number printed in the cell when ≥
  1, cells as buttons opening `#a #b` (implicit AND). Row and column labels
  are the tags. A "Show as a table" toggle renders the same pairs as a
  sorted list for screen readers and narrow panels (< 600px shows the list
  only). Pair counts come from the host (`index.sections`/`tasks` tags),
  computed only for those 12 tags: 66 pairs.
- **Files as nodes at overview.** A Display row **Headings**, segmented:
  `By zoom` (default) / `Always` / `Never`. Grouped, a note's `section:`
  nodes fold into one node per file (`file:` id, title the file name, size
  from the sum of its sections' `links`), heading edges inside the file
  disappear, edges to other files are merged with their types unioned.
  `By zoom` switches at `labelThreshold` with ±0.15 hysteresis, rebuilding
  with positions carried: a file node starts at its sections' centroid, and
  unfolded sections start around their file's position. The 51 files / 485
  nodes of the screenshot workspace draw as 51 at rest.

## 3. Implementation steps

### Shared test harness (first)

`src/test/webviewPage.ts`: an option `openWebviewPage(html, state, {
canvas: true })` that, in `beforeParse`, replaces
`HTMLCanvasElement.prototype.getContext` with a recording 2D stub: every
method is a no-op that appends `{ op, args, lineDash, strokeStyle,
globalAlpha }` to `page.canvasCalls`; `measureText` returns `{ width:
text.length * 7 }`; `requestAnimationFrame` is run by a `page.flushFrames(n)`
helper. This lets the graph's drawing be tested by what it draws for the
first time; the existing source-text checks in
`messages-rendering.test.ts` for the graph can then be retired as each
behavior gains a drawn test.

### 12a

- `src/ui/webview/notesGraphHtml.ts`
  - Markup: `only-written-links` toggle; legend line samples; CSS
    `.legend-line` (inline-block 16×8, `forced-color-adjust: none` under
    forced colors handled by the SVG's `currentColor`).
  - `defaults.onlyWrittenLinks = false`; `bindToggle('only-written-links',
    'onlyWrittenLinks', true)`; add to the reset id list.
  - `rebuildView`: after `allCandidateEdges`, if `onlyWrittenLinks`,
    `candidateEdges = allCandidateEdges.filter(hasType('wiki-link'))`; the
    clustering edges (`clusteringEdges`) are unchanged.
  - `edges.map` stores `kind` (0 wiki, 1 heading, 2 tag, 3 joined) computed
    once per rebuild, so `draw()` never scans `types`.
  - `draw()`: replace the one path with a loop over the four kinds (base)
    and one more pass (highlighted, solid, as today, so a selected node's
    links read as a single highlight). Up to five strokes per frame, each
    `setLineDash(pattern.map(v => v / k))`; reset `setLineDash([])` before
    nodes. Culling as today.
  - `updateStatus()` wording above; legend "Through a daily note" hidden
    unless an edge of kind 3 exists.
- Performance: dashed strokes cost more than solid on thousands of
  segments. Measured before merging on the 5,000-note synthetic workspace
  (K's generator): if a static frame's draw exceeds 8 ms, patterns are
  dropped below `k < 0.3`, where a dash is under a pixel anyway, and kinds
  are then told apart by alpha only; the legend stays.
- `src/ui/webview/notesGraph.ts`: `show(options?: { onlyWrittenLinks?:
  boolean })`; after the first `state` post, `postMessage({ type:
  'applyFilters', onlyWrittenLinks: true })`. `deckard.showNotesGraph`
  passes an object argument through (validated: only that boolean).
- Page handles `applyFilters`: sets the setting and checkbox, persists,
  rebuilds.

### 12b

- `src/core/types.ts`: `NotesGraphLinkCounts` and `links?` on
  `NotesGraphNode`; doc comment on `degree` says it is every indexed edge.
- `src/ui/state/notesGraphState.ts` `applyDegrees`: one pass over edges
  incrementing `degree` and the per-kind counts; attach `links` only when
  non-empty. Payload: about 30 bytes a node.
- Page: `nodeRadius` reads `nodes[i].degree`; hub-label ranking and label
  sort use it too (so labels stop changing with the density slider);
  `degrees[]` stays for the simulation's spring bias. `showTooltip` builds
  the text with a `countWords(links, kind)` helper.

### 12c

- Page: `nameGroups()` after `buildCommunities` in `rebuildView` produces
  `groups[] = { key, name, size }` indexed by community; needs a
  `tagLabelByKey` map built when a snapshot arrives.
- `draw()`: group pass (discs) before edges; labels after nodes, before
  hub labels; keep `labelRects` for hit-testing.
- `pointerdown`/`endPointer`: a click with no drag that lands in a label
  rect sets the group filter.
- `isDimmed` adds `groupMatch` (a `Uint8Array` by node index, rebuilt with
  the filter).
- `defaults.group = ''`; persisted; cleared by Reset and Clear filters.
- `renderGroupList()` fills the `<select>` after each rebuild, keeping the
  selection when its key survives.
- Edge cases: fewer than 2 groups → no labels, no select (hidden); a
  focused graph names its groups the same way; forced colors → no disc fill.

### 12d

- `src/ui/webview/statsHtml.ts`: `render()` reordered; new
  `attentionSection()` builds the panels; tile map above with new
  `data-action`s `open-tag-list` (with `data-namespaced`), `open-graph`,
  `jump` (`data-target`); `jump` focuses the target heading (`tabindex=-1`).
  "Show N more" toggles a class on the list. Empty Most viewed panels fold.
- `src/ui/webview/messages.ts` `parseStatsMessage`: `openTagList {
  namespaced: boolean }`, `openNotesGraph { onlyWrittenLinks: true }`.
- `src/core/types.ts`: the two message types.
- `src/ui/webview/stats.ts`: `openTagList` shows a quick pick of
  `index.tags` (or `index.entities`), label, "N entries", then `onOpenTag`;
  `openNotesGraph` runs `deckard.showNotesGraph` with the option.
- `test/ui/checkLayout.js`: a **stats** surface (1100×900, scrollers
  `html`, hovered `.metric-open`) built from `createDeckardStatsSnapshot`
  on the layout index, so the reordered page and the sparklines are
  measured in every theme and zen state.

### 12e

- `src/ui/state/dashboardState.ts`: `createStatsTrends(index, now)` — one
  pass over sections and tasks computing each item's bucket
  (`ceil((now - at) / 7d)`, clamped 0..13) for "exists from" and "done
  from", then suffix sums into 13 levels. O(sections + tasks). `now` is a
  parameter (default `Date.now()`) so tests are fixed.
- `DeckardStatsSnapshot.trends`; `createDeckardStatsSnapshot(…, now?)`.
- `src/ui/webview/components.ts` `getComponentScript()`:
  `renderSparkline(points)` and `describeChange(change)`; CSS `.sparkline`,
  `.metric-change` in the shared sheet so Home can use them.
- `statsHtml.ts` `metric()` gains an optional `trend`.

### 12f

- Rail: `dashboardState.ts createRelatedFacetValues` strength and sort;
  add `total` to the facet value so both Refine renderers
  (`components.ts:3035`, `sidebarNotesHtml.ts:237`) say "in 6 of 13".
- Histogram: `createTagUsage(index)` → `{ bands: [{ label, min, max,
  count }], usedOnce: [{ key, label, lookalike? }] }` capped at 100 rows;
  Stats renders as buttons in a CSS grid of bars (height by `count / max`).
- Matrix: `createTagPairs(index, 12)` → `{ tags: [key,label,count][],
  pairs: number[][] }`; render as a `<table role="grid">` of buttons,
  sequential opacity steps `.1 .25 .45 .7 1`.
- Files as nodes: page-only change in `rebuildView` (fold sections by
  `filePath` when grouped) plus a zoom watcher in `zoomAt` that triggers a
  rebuild across the threshold with hysteresis; `file:` nodes that already
  exist (files with no headings) are reused.

## 4. Tests

All in `npm test` unless noted; each commit runs all four suites and gates
on their exit codes.

| Commit | Test |
| --- | --- |
| fix Tasks tile | `stats.test.ts`: every tile's `data-query` parses with no error diagnostics (runs `parseQuery` on each) — catches the next `has:task`. |
| harness | `webviewPage` self-test: a page that draws a line records `moveTo`/`lineTo`/`stroke`. |
| 12a | `notes-graph-behavior.test.ts` with `canvas: true`: a snapshot with one wiki link, one heading, one tag edge draws one solid, one `[5,3]`, one `[1,3]` stroke; **Only links I wrote** leaves only the solid stroke and the status says "1 wiki link"; the toggle persists and Reset clears it; the legend lists Wiki link, Heading, Tag and not "Through a daily note" until a joined edge arrives; `applyFilters` turns it on. |
| 12b | `notes-graph-state.test.ts`: `links` counts per kind, an edge of two types counted in both, a local snapshot keeps workspace counts. Behavior: tooltip text for note, task, tag, no-link node; moving Connection density does not change the text. |
| 12c | Behavior: two tagged groups draw two labels named after their distinctive tags (not a tag every note carries); a click on a label's rect dims the other group and sets the select; a rebuild without that group clears the filter with the notice; the select lists groups by size and is keyboard-operable. |
| 12d | `stats.test.ts` (jsdom): Needs attention precedes `.metrics`; empty → the one line; each tile posts its message (`openSearch` with `is:note`/`is:task`/`is:open`, `openTagList`, `openNotesGraph`); Unlinked notes moves focus; empty view panels fold into one line naming only the empty ones; `parseStatsMessage` accepts the new messages and rejects malformed ones. `npm run test:layout` gains the stats surface. |
| 12e | `stats.test.ts`: `createStatsTrends` with a fixed `now` — levels for notes created 3 weeks and 2 days ago, a task done 10 days ago by `doneAt`, one done without `doneAt` using `updatedAt`, one with a future `createdAt`; last point equals the tile count. Page: "+2 in the last 7 days", "−1 …", "No change …"; aria-label carries it. `test:ui`'s contrast check reads the new `--muted` delta text. |
| 12f rail | `search-refine.test.ts`: strength is count/total, sort by count, aria "in 6 of 13 results". |
| 12f histogram | bands for 1,2,4,7,30 uses; used-once list pairs with its lookalike; Merge posts `mergeTags`. |
| 12f matrix | pair counts; cell posts `openSearch` `#a #b`; table toggle. |
| 12f files | behavior with `canvas: true`: at `k` below threshold a two-heading file draws one node; above threshold + 0.15 it draws two; within hysteresis no rebuild. |

**Visual baselines** (`npm run test:visual`, darwin): the graph is not
among the visual surfaces, so 12a–12c re-record nothing. 12d adds the stats
surface, so its commit is followed by `test: record the Stats baselines`
(16 new files: 8 themes × zen off/on). 12e and each Stats 12f item
re-record those 16. The rail changes Refine chips: re-record the
`*+zen-searchPage` (8) and `*sidebarNotes` / `*+zen-sidebarNotes` (16) sets
that differ.

## 5. Docs

- **README** `## Notes Graph`: rewrite the second bullet's "sized by
  connection count" to "sized by everything it is joined to in the index";
  a bullet for the legend and **Only links I wrote**; a bullet for groups
  (named by distinctive tags, click or the Group list to pick one out);
  the Display bullet for **Headings** (12f). `## Stats`: lead with Needs
  attention, what each tile opens, sparklines and what they count, and the
  12f sections. Replace `docs/images/stats.png` and `notes-graph.png` at the
  end (screenshot workspace).
- **Help** (`helpHtml.ts:453-454`): Notes Graph card adds "Solid lines are
  wiki links you wrote; dashed are headings; dotted are shared tags. Only
  links I wrote hides the rest." Stats card leads with "What needs
  attention first".
- **CHANGELOG** `## Unreleased` → `### Added`/`### Fixed` one entry per
  commit, e.g. **"The Notes Graph tells its lines apart."**, **"Stats'
  Tasks total opens its tasks."** (Fixed).
- **components.md**: under *Page script helpers*, `renderSparkline` and
  `describeChange`; under *Surfaces*, a "Notes Graph canvas" note: edge
  kinds by dash pattern not color, every canvas color read from a token via
  `themeColor()` with a forced-colors fallback, one batched path per kind;
  under *Verifying a change*, the `canvas: true` harness option.

## 6. Commits

1. `fix: Stats' Tasks total opens every task, rather than a search it could not read`
2. `test: a page's canvas can be drawn into a recording, so the graph is tested by what it draws`
3. `feat: the Notes Graph draws wiki links, headings, and tags apart, and can show only the links you wrote`
4. `feat: a graph node is sized by everything it is joined to, and says by what`
5. `feat: the Notes Graph names its groups where they sit, and one can be picked out`
6. `feat: Stats leads with what needs attention, and every total opens what it counts`
7. `test: record the Stats baselines`
8. `feat: Stats shows how notes, tasks, and open tasks moved over twelve weeks`
9. `test: re-record the Stats baselines for the twelve-week lines`
10. `feat: a related tag in Refine says how many of the results carry it`
11. `test: re-record the Refine baselines for the related-tag rail`
12. `feat: Stats shows how often each tag is used, and merges the tags used once`
13. `feat: Stats shows which tags are written together`
14. `test: re-record the Stats baselines for tag use`
15. `feat: zoomed out, the Notes Graph draws each file as one node and opens it into headings as you zoom in`

Commits 1–9 are the core; 10–15 are 12f, each independent.

## 7. Size, risks, dependencies, questions

**Size.** Core (1–9): about 6.5 days — harness 0.5, 12a 1, 12b 0.5, 12c 2,
12d 1, 12e 1.5. Later (10–15): about 6 days — rail 0.5, histogram 1,
matrix 1.5, files as nodes 3. **Total ≈ 12.5 days.**

**Risks.**
- Dashed strokes on large graphs (measured; fallback above).
- Group names that read wrong on a real workspace (one tag everywhere):
  the distinctiveness score addresses it; checked on the screenshot
  workspace and the 1,000-note synthetic one before merging.
- Sparkline history is reconstructed from today's notes, so deleted notes
  are missing from past weeks; said in the tile title.
- Files-as-nodes re-seeds positions at a zoom boundary; hysteresis and
  carried positions keep it from jumping, but it needs hands-on tuning.

**Dependencies.**
- **Piece 8f** rewrites the Display sliders' labels in the same file: land
  either first and rebase; the new controls here go in Filters, not Display.
- **Piece 1j** (Reset undo): the new `onlyWrittenLinks` and `group` settings
  are in `defaults`, so its snapshot-and-restore covers them.
- **Piece 10f** (host-side filtering, skip unchanged posts): `links` adds
  about 30 bytes a node to the payload it measures; if 10f moves filtering
  to the host, **Only links I wrote** moves with it.
- **Piece 5g** fills the second Needs attention slot; **5a**'s link field
  would let the Wiki links tile open a search instead of the graph.
- **Piece 3c** reuses `metric()` and can reuse `renderSparkline`.
- **Piece 9d** (`data-tip`): sparkline point titles move to it when it lands.

**Open questions for David.** None.
