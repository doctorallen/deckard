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
