# Search options — research and plan

## Status

Sections 1–7 are implemented; section 8 (natural language to DQL) is not,
as recommended below. Where the implementation departs from the plan:

- **Search lives on the Dashboard's Search tab**, which was the Notes tab.
  It is the search page: it has the full search box, the builder, the facets, the tasks the
  search matches, and **Save**. Find's **Show all**, `Deckard: Search
  Notes and Tasks`, a query block's CodeLens (now **Open in search**), and
  saved searches open there. Tag overviews keep the same search box to
  narrow their own entries.
- **Facets sit on the page, under the search box, not in the Related Notes
  sidebar.** The Dashboard has no sidebar projection, and the facets belong
  beside the results they count. The sidebar still shows associated tags.
- **Quick Find groups by icon while typing.** Without a proposed API, VS
  Code hides a Quick Pick's separators and lifts rows whose label matches as
  soon as anything is typed, so each kind of row carries its own icon. The
  empty picker keeps its group headings.
- **Tab completion in Find** uses a keybinding scoped to Find being open
  (`deckard.quickFindOpen`), plus a **+** button on each tag row.
- **The keybinding** is <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd>
  (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd> elsewhere). VS Code
  binds nothing to it; `cmd+alt+d` was free in VS Code but hides the Dock
  on macOS, and `ctrl+alt+n` belongs to the popular Code Runner extension.
- **The merged box applies to both tabs**, and **Find lists tasks
  directly**, as the open questions below proposed.
- **Most accessed** sorting still uses plain counts. Frecency ranks Find's
  results and its empty state; changing what an existing sort means was
  left for a separate decision.
- **Plain words on the Search tab are matched by the page**, which also
  matches file names and tags, as it did before; tags and conditions apply
  on Enter so a half-typed tag never empties the list.

Advanced search works, but it is slow to use when you already know what you
want. Building a condition in the builder means **Add condition**, pick a
field, pick an operator, and type a value: four interactions for one term. The
exploratory path, opening a tag and adding associated tags, is good and stays
as it is. This plan looks at how other tools make known-item search fast, and
proposes changes that keep DQL and the builder while adding a faster front
door.

## Summary

Deckard serves exploration well and lookup poorly. The recommendation is:

1. **Rank text search properly.** It is the base the rest builds on, and it
   improves the existing command right away.
2. **Add Quick Find**, one live Quick Pick that searches tags, note titles,
   headings, body text, tasks, and saved views as you type, and accepts DQL.
3. **Add `is:`, `has:`, and `in:` shorthands** to DQL, so common filters take
   one short token.
4. **Make the overview's filter box always visible.** Plain words filter
   within the current tags as they do today, and DQL tokens appear as the
   same removable chips the tag intersection already uses. No toggle.
5. **Let builder rows start from a value.** Typing `#atl` or `open` fills in
   the field and operator, so a condition costs typing and Enter.
6. **Show facets with counts on any result set**, not only on single-tag
   views, so exploring and querying become the same thing.
7. **Rank by frecency and keep recent searches.**
8. Later, and opt-in only: **turn natural language into DQL** that you review
   before it runs.

## What exists today

| Entry point | How it works | Friction |
| --- | --- | --- |
| `Deckard: Search Workspace Knowledge` (`src/ui/commands/workspaceSearch.ts`) | An input box, then a separate Quick Pick of results. | Two steps, no results while typing. Ranking problems below. |
| `Deckard: Search Notes and Tasks` (`showQueryOverview` in `src/extension.ts`) | An input box that takes DQL, then opens an overview. | No completion in the input box; you must already know the syntax. |
| `Deckard: Show Tag Overview` | A Quick Pick of tags. | Tags only. |
| Tag Overview **Advanced search** (`tagOverviewHtml.ts`) | A query bar with completion, plus the builder. Hidden until toggled (`queryPanelOpen = false`). | The fast part, the completing query bar, sits behind a button. The builder is a form. |
| Tag Overview per-tab **Search notes** box | Filters within the active tag intersection. | A second, separate search box next to the query bar. |
| Related Notes sidebar | Associated tags for the focus tag; adding one narrows the overview. | Works well. For a query, it only shows associations when the query names exactly one tag. |

Problems in the text search itself (`src/core/storage/searchStore.ts`):

- Each note is one full-text row, so a match is found per file and only then
  mapped to sections.
- Terms are joined with `OR`, so `vendor risk` matches every note containing
  either word.
- The SQL has `LIMIT 50` and no `ORDER BY`, so which 50 files survive is
  arbitrary. The sort in `indexer.search` happens after that cut. A common word
  in more than 50 files can drop the note you want.
- Titles, headings, and tags are weighted the same as body text.
- No prefix matching, so nothing can match while you are still typing a word.
- `indexer.search` guesses at intent with regular expressions (`task`,
  `open`, `last week`). These should become explicit shorthands.

DQL's `text` condition (`queryEvaluator.ts`) is a lowercase substring scan in
memory. It is fine for filtering, but it cannot rank.

Access counters (`preferences.ts`) store counts only, not times, so recency
cannot be used yet.

## Two kinds of search

Marchionini splits search into **lookup** (known-item: you can name what you
want) and **learn/investigate** (exploratory: you browse, compare, and refine
over several steps). Exploratory search mixes queries with browsing. Lookup
wants one precise query and an immediate answer.

Deckard's tag overview and associated tags are an exploratory interface, and
Hearst's Flamenco studies support that design. They found strong preference
for faceted browsing (91% preferred it to the baseline), especially on
multi-facet tasks. Flamenco's stated goals map closely onto what Deckard
already does: fluid alternation between refining and expanding, avoiding empty
result sets, and showing counts before you click ("query previews").

What's missing is the lookup path. Nielsen's response-time limits set the bar.
Under 0.1 s feels instant, and under 1 s keeps your train of thought. Typing
into an input box, pressing Enter, then scanning a second list falls short of
both.

## What other tools do

| Tool | Pattern | Lesson for Deckard |
| --- | --- | --- |
| GitHub issues and code search | One text box with `qualifier:value` syntax, highlighted keywords, autocomplete for qualifiers and values, and `/` to focus. The 2025 rebuild added `AND`/`OR` and parentheses (nesting capped at five levels) while keeping old flat queries working. | Text stays the source of truth, and completion teaches the syntax. DQL is already this shape. |
| Linear | `F` opens filters. Typing a value such as a person, label, or status finds its property, so you never pick the field first. Filters show as chips and live in the URL. An advanced mode adds nested AND/OR groups. "Filter with AI" turns a sentence into filters. | **Value-first** entry: type what you're looking for, not the field it lives in. |
| Sentry | Replaced its search bar with a token-based builder with categorized filter menus, value suggestions, and search history. Power users asked for a plain-text mode back, because negating or editing a token takes several clicks ([getsentry/sentry#82395](https://github.com/getsentry/sentry/issues/82395)). | Don't make chips the only way to edit. Show chips as a view of the text. |
| Obsidian core search | `tag:`, `path:`, `file:`, `line:(…)`, `section:(…)` operators; `tag:` uses the cache rather than text. | `section:` scoping matches Deckard's section-level entries. |
| Omnisearch (Obsidian) | BM25 ranking, weighting filename and headings above body; typo tolerance; keyboard-first quick-switcher UI; inserts links. | Title and heading boosts plus as-you-type results are the main reason people install it. Deckard's own improvements list already names this. |
| Another Quick Switcher (Obsidian) | Custom search commands, heading search, and walking backlinks and links without leaving the dialog. | A switcher can be a navigation tool, not just a search box. |
| fzf | Fuzzy by default; `'exact`, `^prefix`, `suffix$`, `!not`, and `\|` for OR in one line. | Fuzzy subsequence matching is the right default for short targets such as titles and tags. |
| Bear | "Special searches" such as `@todo`, `@today`, `@untagged`, and `@date(…)` that combine with words. | Short shorthands for common filters. Deckard can't use `@` because it means people, so borrow GitHub's `is:` and `has:` instead. |
| Tana | Search nodes: live queries saved in the outline, built from `Cmd+K` → Find. | Deckard already has this as query blocks and saved views. |
| VS Code Quick Open | `Cmd+P` with prefixes (`@` symbols, `#` workspace symbols, `:` line). | The Quick Pick is where VS Code users already expect fast lookup. |

---

## 1. Quick Find

A single command, `Deckard: Find`, that searches as you type.

```
┌─────────────────────────────────────────────────────────────────────┐
│ atlas vend                                                          │
├─────────────────────────────────────────────────────────────────────┤
│ Tags                                                                │
│   # project/atlas                                  12 notes · 9 tasks│
│ Notes                                                               │
│   Vendor review › Atlas              2026-09-04.md · #project/atlas │
│     …the vendor contract for Atlas needs a second…                  │
│   Atlas requirements                 2026-08-02.md                  │
│ Tasks                                                               │
│   ☐ Send vendor list to Ren          📅 2026-09-20 · #project/atlas │
│ ───────────────────────────────────────────────────────────────────  │
│   Show all 14 results in an overview                        ⌥↵      │
└─────────────────────────────────────────────────────────────────────┘
```

**Behavior**

- Results update on every keystroke. Enter opens the selection: a note or
  task at its source line, a tag in its overview, or a saved view.
- The input is DQL. Bare words are text, `#tag` and `@person` are tags, and
  `is:open` and the other shorthands from section 3 work. A partly typed query
  that doesn't parse yet keeps showing the last good results, with the parse
  message as the first row. This is the same rule the overview query bar
  follows.
- A bare word also offers tags whose last segment matches it, so `atlas`
  offers `#project/atlas`. This happens in completion only; DQL itself stays
  exact, so saved queries and query blocks don't change meaning.
- Tab on a tag result writes it into the input (`#project/atlas `) and keeps
  the picker open. That's the same narrowing move as adding an associated tag,
  done from the keyboard.
- An item button **Open in overview** on each tag and note, and a final
  **Show all N results in an overview** row that opens the typed query with
  `showQueryOverview`. A title-bar button does the same.
- With nothing typed, it shows recent searches, favorite tags, and saved
  views (section 7).

**Ranking**, in explainable tiers, with frecency to break ties:

1. Exact title or tag match.
2. Fuzzy subsequence match on titles, headings, and tag names (fzf-style,
   in memory). There are few enough of these to score in JavaScript on every
   keystroke.
3. Body matches from full-text search, ordered by BM25 (section 2).

Reciprocal rank fusion, which merges the ranked lists, is an alternative to
the tiers, and VaultSearch and similar hybrid search plugins use it. Tiers are
easier to explain in a result's description, so start with tiers.

**Implementation**

- `vscode.window.createQuickPick()`, recomputing `items` in
  `onDidChangeValue`, with `busy` set while full-text search runs. Mark items
  `alwaysShow: true` so VS Code's own label filter doesn't hide results that
  Deckard ranked. Use `QuickPickItemKind.Separator` for the groups, and
  `buttons` with `onDidTriggerItemButton` for the per-item actions.
- Debounce full-text search (about 50 ms). Run the in-memory title and tag
  tier immediately, so something useful appears within 100 ms.
- New module `src/ui/commands/quickFind.ts`. Reuse `parseQuery` and the
  evaluator for structured conditions, and `SearchStore` for text.
- `Deckard: Search Workspace Knowledge` becomes Quick Find. Keep the command
  ID so existing keybindings still work.
- Contribute a default keybinding (see open questions) and add a search icon
  in the Related Notes sidebar title bar.

## 2. Rank text search properly

Changes in `src/core/storage/searchStore.ts`:

- **One row per section, not per file**, with columns for title, headings,
  tags, and body, keyed by section ID. Bump `SCHEMA_VERSION`, and the existing
  drop-and-rebuild handles the migration.
- **AND the terms, and treat the last term as a prefix**: `"vendor" "ris"*`.
  If that finds nothing, retry with OR and label the results as partial
  matches.
- **`ORDER BY bm25(notes_fts, 10.0, 5.0, 3.0, 1.0)`**, weighting title,
  headings, tags, and body the way Omnisearch weights filename and headings,
  and apply `LIMIT` after ordering.
- **`prefix='2 3'`** on the FTS5 table, so prefix queries stay fast.
- **Suggest a correction on zero results.** Read the vocabulary from an
  `fts5vocab` table and offer the nearest term within edit distance 2 ("No
  results for *vendr*. Search *vendor*?"). This catches typos without a
  second index.
- Add a **Relevance** sort to overviews when the query contains text terms,
  using these scores. DQL `text ~` can keep its substring filter for matching;
  only the ordering changes.

Cost: more rows make the first build slower, and `docs/todo.md` already tracks
that first build (140 ms at 940 notes). Measure before and after, and move the
store to a worker thread if it crosses the Slow threshold in Deckard's log.

## 3. Shorthand qualifiers in DQL

Common filters in one token, GitHub-style. Each expands to conditions the
evaluator already supports, except `is:note`, which needs a small addition.

| Shorthand | Means |
| --- | --- |
| `is:open` / `is:done` | `task = open` / `task = done` |
| `is:task` | `task = any` |
| `is:note` | Note sections only; tasks excluded. New condition. |
| `is:overdue` | `task = open AND due < today` |
| `is:due` | `task = open AND due <= 7d` |
| `has:due` / `no:due` | `due != none` / `due = none` (also `scheduled`, `priority`) |
| `in:notes/projects` | `path = notes/projects/*` |

- Handle these in `parseWordCondition` before the `FIELD_ALIASES` lookup.
  Today `is:open` fails with "is is not a Deckard query field", so no working
  query changes meaning.
- Complete them in the query bar, Quick Find, and query blocks.
- The formatter writes shorthands back as written, so saved queries stay
  short. The builder shows a shorthand as one read-only row, the same as
  other hand-written conditions it can't split.
- This replaces the regular-expression guesses in `indexer.search`.

## 4. One always-visible filter box in the overview

Merge the per-tab **Search notes** box and the hidden query bar into one
filter box under the title, always shown.

- Plain words behave exactly as the search box does today: they filter
  within the active tag intersection.
- `#tag`, `field = value`, and `is:` tokens are parsed as DQL. Each condition
  appears in the existing chip row as a removable chip, the way Hearst's
  breadcrumbs let you drop one constraint. The text stays the source of
  truth, and removing a chip edits the text, so the Sentry problem doesn't
  arise.
- Tab-completing a tag in the box adds it to the intersection. That's
  identical to clicking an associated tag, so exploration and querying edit
  the same state.
- `/` focuses the box, as in GitHub. Escape clears it.
- The **Builder** button stays next to the box for OR groups. The
  **Advanced search** toggle goes away.

This mostly moves existing pieces: the completion code in
`queryBarSuggestions` and the chip rendering already exist in
`tagOverviewHtml.ts`.

## 5. Value-first builder rows

Keep the builder, but make adding a row a typing action.

- **Add condition** opens a row with one input: "Type a tag, word, or
  field…". The completion list offers whole conditions, each labeled:
  - `#atl` → `tag = #project/atlas`
  - `open` → `task = open`
  - `overdue` → `due < today`
  - `vendor` → `text ~ vendor`
- Choosing one fills in the field, operator, and value dropdowns, which
  remain for editing afterwards.
- Enter in a row's value commits it and opens the next empty row. Backspace
  in an empty row removes it. Cmd/Ctrl+Enter starts a new OR group.

This is Linear's lesson: people know the value, not the field. The shared
completion source also serves Quick Find's value-first suggestions.

## 6. Facets on any result set

Today associated tags appear only for a tag or a query naming exactly one tag.
Extend the sidebar's list into a **Refine** panel for any result set:

| Facet | Values |
| --- | --- |
| Tags | Most common co-occurring tags, grouped by namespace |
| Task state | Open, done |
| Due | Overdue, this week, later, none |
| Updated | This week, this month, older |
| Folder | Top-level folders in the results |

- Every value shows its count within the current results, and zero-count
  values are hidden. These are Flamenco's query previews and its "no empty
  results" rule.
- Click adds an AND condition. Alt-click excludes it (`!=`). Selecting two
  values in the same facet ORs them, the usual faceted-search convention:
  OR within a facet, AND across facets.
- Each click edits the query text, so the result can be saved, pasted into a
  query block, or refined in the builder.
- When the query has exactly one tag, keep the current association ranking;
  it's better than raw counts. Otherwise count tags across the results. That's
  one pass over the result entries' tag sets, which is cheap.

## 7. Frecency and recent searches

- Record a last-access time alongside each count in `preferences.ts` for
  tags, entries, and saved views, and score with exponential decay (Firefox's
  address bar uses the same idea, called frecency). A 14-day half-life is a
  reasonable start.
- Use the score to break ties in Quick Find, to order the Show Tag Overview
  picker, and as the Dashboard's **Most accessed** sort.
- Keep the last 20 queries run from Quick Find or the filter box. Show them
  when either opens empty, with an item button to save one as a view.
- Everything stays in VS Code preferences, as the counts do now.

## 8. Natural language to DQL (opt-in, later)

Linear's "Filter with AI" shows the pattern: a sentence becomes filters that
you can see and edit. Deckard could offer a **Translate to query** row in
Quick Find using the VS Code Language Model API (`vscode.lm`).

- Send only the sentence, a short DQL grammar summary, and the tag names that
  match its words lexically. Never note content.
- Put the resulting DQL in the input for review; never run it silently.
  Linear itself warns that results can be unpredictable.
- Off by default behind a setting such as
  `deckard.search.naturalLanguage`, and update the README's privacy statement,
  which currently says no note content is sent to an AI model.
- Do this last. The shorthands in section 3 cover most everyday cases
  deterministically.

---

## Not recommended

| Idea | Why not |
| --- | --- |
| Chip-only (tokenized) search input | Sentry users asked for plain text back because editing and negating tokens takes clicks. Chips should be a view of the text. |
| Removing the builder | It's still the clearest way to build OR groups and to learn DQL. Speed it up instead (section 5). |
| An in-memory fuzzy engine such as MiniSearch for body text | It has fuzzy search, prefix search, and field boosts, but it would duplicate the SQLite cache in memory. Revisit if FTS5 prefix search and vocabulary suggestions aren't enough. Fuzzy matching on titles and tags alone is small enough without a library. |
| The FTS5 trigram tokenizer by default | It enables substring matching, but the index is much larger, and DQL `~` already does substrings in memory. |
| fzf operators (`'`, `^`, `$`, `\|`) in DQL | A second syntax for things quotes, `-`, and `OR` already do. |
| Leaf-name tag matching inside DQL (`#atlas` meaning `#project/atlas`) | It would change the meaning of saved queries and query blocks when a new tag appears. Offer it as a completion instead (section 1). |
| Embeddings or semantic search | `docs/improvements.md` already decided against it; BM25 plus tags covers most of it. |

## Decisions to confirm

| Decision | Proposal | Why |
| --- | --- | --- |
| Where fast lookup lives | A Quick Pick (`Deckard: Find`) | It's where VS Code users already go, and it opens from anywhere, including a Markdown editor. |
| Search Workspace Knowledge | Replaced by Quick Find, command ID kept | Two text searches with different ranking would confuse. |
| Source of truth for filters | The query text, everywhere | GitHub's approach. Chips, builder rows, and facets all edit the text. |
| Shorthand spelling | `is:`, `has:`, `no:`, `in:` | `@` already means people. `:` is already accepted as `=`, and these words aren't valid fields today, so nothing breaks. |
| Tag leaf matching | Completion only | Keeps DQL deterministic. |
| Advanced search toggle | Removed; the filter box is always visible and the builder is a button | The fast part was the part that was hidden. |

## Sequencing

1. **Text ranking** (section 2). Small, self-contained, and it improves the
   existing command immediately.
2. **Quick Find and shorthands** (sections 1 and 3). The biggest win for
   "I know what I want."
3. **Overview filter box and value-first builder rows** (sections 4 and 5).
4. **Facets on any result set** (section 6).
5. **Frecency and history** (section 7), then **natural language**
   (section 8) if still wanted.

## Open questions

- Which keybinding for Quick Find? It should avoid VS Code's `Cmd+P`,
  `Cmd+Shift+F`, and `Cmd+T`.
- Should the merged overview filter box apply to both the Notes and Tasks
  tabs at once? Today each tab has its own search.
- Should Quick Find include full task results, or only notes and tags with
  tasks one Tab away?

## Sources

- [Marchionini, "Exploratory search: from finding to understanding" (CACM, 2006)](https://dl.acm.org/doi/10.1145/1121949.1121979)
- [Hearst, *Search User Interfaces*, ch. 8: Integrating navigation with search](https://searchuserinterfaces.com/book/sui_ch8_navigation_and_search.html)
- [Flamenco: design recommendations for hierarchical faceted search interfaces](https://flamenco.berkeley.edu/papers/faceted-workshop06.pdf)
- [NN/g: Site search suggestions](https://www.nngroup.com/articles/site-search-suggestions/)
- [NN/g: Response times, the three important limits](https://www.nngroup.com/articles/response-times-3-important-limits/)
- [GitHub: how issues search was rebuilt for nested queries](https://github.blog/developer-skills/application-development/github-issues-search-now-supports-nested-queries-and-boolean-operators-heres-how-we-rebuilt-it/)
- [GitHub: improving code search](https://github.blog/engineering/architecture-optimization/improving-github-code-search/)
- [Linear: Filters](https://linear.app/docs/filters) and [AI filters](https://linear.app/changelog/2023-06-01-ai-filters)
- [Sentry: improved search UI](https://sentry.io/changelog/improved-search-ui) and [plain-text mode request](https://github.com/getsentry/sentry/issues/82395)
- [Obsidian search operators](https://obsidian.rocks/obsidian-search-five-hidden-features/)
- [Omnisearch for Obsidian](https://community.obsidian.md/plugins/omnisearch)
- [Another Quick Switcher for Obsidian](https://github.com/tadashi-aikawa/obsidian-another-quick-switcher)
- [VaultSearch: BM25, fuzzy titles, and reciprocal rank fusion](https://github.com/erayaydn0/obsidian-vault-search)
- [fzf search syntax](https://junegunn.github.io/fzf/search-syntax/)
- [Bear: special searches](https://blog.bear.app/2019/12/bear-how-to-use-special-searches-to-find-the-right-notes/)
- [Tana: search nodes](https://tana.inc/docs/search-nodes)
- [VS Code: Quick Pick UX guidelines](https://code.visualstudio.com/api/ux-guidelines/quick-picks)
- [SQLite FTS5](https://www.sqlite.org/fts5.html)
- [MiniSearch](https://github.com/lucaong/minisearch)
- [Firefox address bar ranking (frecency)](https://firefox-source-docs.mozilla.org/browser/urlbar/ranking.html)
