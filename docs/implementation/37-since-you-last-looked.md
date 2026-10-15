# 37 · Since you last looked

A tag's page remembers when the reader last had it open. The next time, a
band under the page's bar says what changed since then, and the new rows
are marked. It is for catching up on a team or project after a few weeks
away. Mockups: the "Four Deckard Ideas" artifact, idea 6.

## The snapshot

One snapshot per tag page, kept in VS Code's workspace state (never in the
notes, never synced into the preferences blob that is backed up), keyed by
tag key:

- `seenAt`: when the visit was counted (epoch ms).
- `entries`: the ids of the note entries the page's search returned, with
  each entry's change time.
- `tasks`: open task ids, and done task ids.
- `fields`: the hub's own field values and reverses, as displayed strings.
- `answered`: answered question ids (once plan 38 lands; absent before).

It is replaced each time a visit counts. There is no history: only the last
visit is kept, and an old value is shown once (D9).

**When a visit counts (D7):** the page has been the active panel for five
seconds. Leaving the page after that marks it seen (the snapshot is
written when the visit counts, and the band clears on the next draw after
the page is left and reopened). **Mark seen** writes it at once.

Snapshots for tags that no longer exist are dropped by the existing
preference tidying (`tidyPreferences`) or a cap of 500 snapshots, oldest
`seenAt` first.

## The band

Under the page's bar, above Refine/fields, when there is a snapshot, the
last visit was more than a day ago (D8), and something changed:

- Title: **Since you last looked · 2 Oct, 12 days ago**, with **Mark seen**.
- Chips, each only when non-zero: *N new mentions* (entries created or
  changed since), *N fields changed*, *N tasks done*, *N tasks added*,
  *N questions answered* (plan 38).
- A chip is a filter: choosing it narrows the Notes or Tasks tab to what
  it counts (as a Refine chip does), and choosing it again clears it.
- In the fields card, a changed field shows **changed · was Alex Rivera**
  after its value, once, from the snapshot.
- In the Notes tab, entries new since the visit are grouped first under
  **New since 2 Oct** with a NEW pill; the rest under **Earlier**. In the
  Tasks tab, added tasks carry the pill.
- A first visit (no snapshot) draws no band; it only records.

## The Hubs view

Each hub row's description says how much is new since the reader last
opened its page (**9 new**, drawn as a highlighted count), or **seen today**,
**seen 9 Oct**, **never opened**. "New" is the band's total. The view's
sort menu gains **What's new**, which puts the most-changed hubs first.

## Zen

The band keeps its date and counts; Mark seen is quieted in place.

## Decisions taken (recommended options)

- **D7** A visit counts after five seconds in front.
- **D8** Every tag page gets the band, only when something changed and the
  last visit was over a day ago.
- **D9** A changed field shows its old value once, from the snapshot.

## Tests

- Unit: computing the diff from two snapshots (new entries, changed field,
  done/added tasks), the one-day rule, the 500 cap.
- Host (single file): a visit counted after the five seconds (fake timers
  or an injected clock), Mark seen.
- Page behavior (jsdom): the band, chips filtering, the NEW group, the
  `was` value.
- Hubs tree: descriptions and the What's new sort.

## As built

Built on `feat/four-ideas`, without the *questions answered* chip, which
plan 38 adds: `SinceChipKind` gains `answered`, `TagVisit.answered` is
already read and kept, and `compareTagPage` says where the count goes.
Where the plan was silent, or the code made its words impractical:

- **What a snapshot keeps.** An index id names an entry or task by its
  line, so a line written above it, or a task's `✅` date, makes it another
  id, and a note's change time is its file's, so it cannot tell one entry of
  a daily note from another. So `src/ui/state/sinceLastLooked.ts` keys:
  - each entry by a hash of its note's path and its heading (or its tagged
    line), with a hash of its lines, its task lines left out, in place of a
    change time. An entry is a *new mention* when its key is new or its
    words changed; a task done or added is counted as a task, not again as
    a mention of the entry it is in, and a question's `Answer:` line is
    left out as its task lines are, so an answer counts once, as a
    question answered (QA);
  - each task by a hash of its note's path and its title, which leaves out
    its metadata, open and done apart. A task added and done since counts
    as done;
  - the second entry of a note under the same heading, and the second task
    or question of the same words, and those after, by the same hash with
    `~1`, `~2`, … after it, so two standups in one note are two (QA). The
    first's key is as before; a visit kept before (no `ordinals`) counts
    those keys, and a first key that has them, as no change, rather than
    new;
  - each field by its name, its values as text: a typed row's fields and
    reverses, else the hub note's front matter.
- **Where it is kept.** `src/core/storage/tagVisits.ts`: a list of every
  tag's visit time, `deckard.tagVisits`, in the workspace's
  `workspaceState`, and each tag's snapshot in a file of the workspace's
  storage folder, `tag-visits/<hash>.json`, read when a page or the Hubs
  view asks for it, written beside itself and moved over, so never read
  half-written. The snapshots were first kept in `workspaceState` under
  keys of their own, but VS Code writes the whole of it again at every
  change, and one person's snapshot measured 52 KB, so 500 made every write
  megabytes (QA). A window with no folder open keeps the times and no
  snapshots, so it draws no band. The keys the first build wrote are
  dropped at start, the times kept. A page's band is drawn once its
  snapshot is read: the page draws, then draws again with it. Tags the index no longer has lose their visits, and the cap of
  500 drops the oldest, whenever a visit is written (two visits counted at
  once are written in turn, so neither's time is lost, QA), rather than in Tidy
  Preferences, which asks before it removes anything and lists favorites,
  pins, and saved searches only.
- **When a visit counts (D7).** Five seconds after the page is put in front
  showing one tag alone; leaving it, or searching something else, before
  then counts nothing. Once counted, it counts again only after the page is
  left and put in front again. The band compares the page with the visit it
  read when it first drew the tag, and reads it again after the page is left
  and put in front again, so the band stays while the reader is on the page
  and is gone on the next draw after they come back (`readSinceBaseline` in
  the controller). The time and timer are injectable (`VisitClock`) for the
  host test.
- **Which pages.** Only the page of one tag on its own: a search that
  narrows the tag, or any other search, has no band and marks nothing.
- **The band** sits between the page bar and the search box. Its date is in
  the reader's short date format, `Fri, Oct 2, 12 days ago`, and loses the
  distance past 31 days, as Deckard's other distances do. The plan's `2 Oct`
  is that format's choice.
- **Chips.** The language cannot say *new since a visit*, so a chip is not
  query text: the page sends `setSinceFilter`, the host narrows the list it
  pages, and the chip is drawn pressed. It shows its tab. Choosing it again,
  searching something else, or coming back to the page lets it go. *N fields
  changed* filters nothing: it opens the hub card, where the fields are.
- **The old value** reads *changed · was Alex Rivera*; a field the visit did
  not have reads *changed · was not set*. A field taken away is counted but
  has no row to show it on.
- **The Notes tab** heads its new notes *New since Fri, Oct 2* and the rest
  *Earlier*, each with its count, in the plain list. With Group by on, each
  group keeps its own order and the new notes carry their *New* mark, with
  no heading.
- **The Hubs view.** A hub's description is its news, then its progress:
  *9 new · 1/2 done (50%)*. A tree's description cannot be colored, so the
  count is not highlighted. Only hubs seen over a day ago are read, one tag
  search each, and never while the view draws (QA: 150 hubs over 6,000
  notes took some 13 s a draw). `HubNewsReader` (`src/ui/state/hubNews.ts`)
  answers the draw from what it counted last, *seen Fri, Oct 9* for a hub
  not counted yet, and counts the hubs the draw asked for 300 ms after it,
  a few at a time, against that index and each hub's last visit, then
  draws the view again. A count from the index before stands until its own
  is ready. Each search is cheaper too: the evaluator builds an index's
  units once a snapshot (`getIndexUnits`), reads a tag value's candidates
  once a search, not once a unit, and reads a unit's links by its key
  rather than copying every unit for a `link` search, so the 150 hubs are
  counted in well under a second; a unit test holds the bound. The band
  reuses its page's own results rather than searching the tag again, unless
  words being typed narrow them. The view had no sort menu, so **Sort
  Hubs By…** (`deckard.hubs.setSort`) is new, in its **⋯**, with **Name** and
  **What's new**; the choice is kept with the visits, in workspace state,
  not in the preferences blob.
- **N questions answered**, added once plan 38 was merged in. A question is
  kept as a task is, by a hash of its note's path and its words
  (`questionVisitKey`), so a line written above it does not make it
  another; `answered` lists the page's answered ones. It is answered since
  when it is answered now and was not at the visit, asked since or not. A
  visit kept before questions has no `answered`, and counts none, rather
  than every answer the page holds. The chip narrows the Questions tab to
  them and shows it, leaving the notes and tasks as they are, and counts in
  the band's total and the Hubs view's *N new*.
