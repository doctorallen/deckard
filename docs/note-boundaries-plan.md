# What counts as a note inside a Markdown file

A proposal for how Deckard decides where one note ends and the next begins.

## Executive summary

Deckard indexes four kinds of thing as entries: a tagged heading, a tagged
line, a task, and a note with nothing but front matter. The tagged line is the
one under question. In this note

```markdown
## Harbor check-in #team/harbor
Sable secured a meeting with Jax and Vero together…

### Sable Ortiz #person/sable-ortiz
#### Consenting-witness meeting #project/argent-protocol
Sable will protect the #feature/joint-summary review with #contact/jax-lumen and #contact/vero-kline before filing it.
```

the last line becomes an entry of its own, titled with the whole sentence and
carrying three tags. The heading that the sentence is *about* —
`#### Consenting-witness meeting` — carries none of them. Searching for
`#feature/joint-summary` returns a sentence rather than the meeting it
describes.

Two facts frame the decision, both measured against the 48 sample notes in
`development/notes`:

- **Tagged lines are a small share of the entries but most of the
  vocabulary.** 74 of 483 entries are tagged lines (15%), yet **109 of the
  184 distinct tags — 59% — appear only on a tagged line and never on a
  heading**. Simply not indexing tagged lines would strand most of the tag
  vocabulary. Whatever we do, those tags have to land somewhere.
- **Notes already nest, and already overlap.** 172 heading entries contain
  another heading entry, nesting up to three deep. In the example above the
  sentence on line 7 is inside *four* entries: the inline entry, the `####`
  meeting, the `###` person, and the `##` check-in — each of whose stored
  text includes it. Containment is not something a change would introduce;
  it is what the format already means.

The research below found a clear split in how other tools answer this, and one
strong consensus. The split: **Obsidian** treats the file as the unit and
never indexes a section separately; **Org mode** and **org-roam** treat the
heading as the unit; **Logseq**, **Roam** and **Joplin's Tag Navigator** treat
the line or block as the unit. The consensus, without exception: **tags flow
downward, from container to contained. No tool moves a child's tags up to its
parent.** Deckard already inherits downward too.

That makes the proposal on the table — roll a line's tags up to its heading —
genuinely novel, and the risk is the obvious one: the heading ends up claiming
a tag its own text never says. That is survivable if the roll-up is
*recorded* rather than pretended, which Deckard's data model already allows
for (`associationTagGroups` is an array of groups, one per line the tags were
written on).

**Recommendation: add `deckard.noteBoundaries`, a three-value setting,
defaulting to `line` for existing workspaces and `heading` for new ones.**
Ship it in the order in Phase 1–3 below, starting with the part that changes
no indexing at all.

---

## What Deckard does today

Parsed from the example above, exactly as the current parser produces it:

| Entry | Lines | Own tags | Inherits |
|---|---|---|---|
| `## Harbor check-in` | 1–7 | `#team/harbor` | — |
| `### Sable Ortiz` | 5–7 | `#person/sable-ortiz` | `#team/harbor` |
| `#### Consenting-witness meeting` | 6–7 | `#project/argent-protocol` | the two above |
| *the sentence* | 7 | `#feature/joint-summary`, `#contact/jax-lumen`, `#contact/vero-kline` | the three above |

Rules in force:

- A heading entry's text runs to the next heading **of any level**, so a
  parent's stored text contains its children's.
- Tags inherit downward (`collectInheritedTagKeys` walks up the parents and
  adds their heading tags).
- Tags written on one line form one *association group*, which is what
  "written together" means for Related Notes.
- `deckard.parseInlineTags` already exists and turns tagged-line entries off
  wholesale — but it does not move their tags anywhere, so turning it off
  today loses 59% of the vocabulary rather than relocating it.
- Tasks are indexed independently of all of this, wherever they sit.

## The two problems

1. **A sentence is not a note.** It is titled with its own prose, it competes
   with real notes in every result list, and the heading that names the thing
   is left untagged. This is the complaint that started the proposal.
2. **Which of the nested entries should answer a search?** A search for
   `#team/harbor` matches the check-in; a search for `#person/sable-ortiz`
   matches an entry *inside* it; both are "the note". Today both are returned,
   independently, and counted separately. Related Notes already prefers the
   deeper one ("the child appears first because it is the more specific
   match") but search results and counts do not.

These are separable. (2) is worth fixing whichever answer (1) gets.

---

## How other tools do it

| Tool | Unit of retrieval | Tag scope | Inheritance | Configurable? |
|---|---|---|---|---|
| **Obsidian** | The file | A tag anywhere tags the file | n/a | No |
| **Org mode** | The heading | The heading it is written on | Downward to subheadings | `org-use-tag-inheritance`, `org-tags-exclude-from-inheritance` |
| **org-roam** | File, *or a heading given an ID* | As Org | As Org | Opt-in, per heading |
| **Logseq / Roam** | The block | The block | Properties inherit to child blocks | No |
| **Joplin Tag Navigator** | The line or paragraph | The line | Downward from headings *and* from indentation | `resultGrouping`: `heading`, `consecutive`, `item`, `none` |

Worth drawing out:

**Obsidian** is the file-unit camp. Headings and blocks are *addressable*
(`[[Note#Heading]]`, `[[Note#^id]]`) but are not indexed as separate notes,
and Dataview's `FROM #tag` yields pages. The cost is that a 3,000-word meeting
note is one result no matter which paragraph matched. Deckard exists partly
because that is unsatisfying.

**Org mode** is the closest thing to a standard for heading-as-unit, and it
has forty years of use behind the choice. Tags belong to a headline; all
subheadings inherit them; two variables control how far that goes. It has also
already met our problem (2): `org-tags-match-list-sublevels` decides whether a
tag match lists a subtree's children as well as its parent. The Org manual's
current advice is that it "probably should always be true" — that is, *show
the sublevels* — and that inheritance should be narrowed with
`org-tags-exclude-from-inheritance` instead. In other words, Org's own answer
to nesting is to keep returning both, and to make inheritance stingier rather
than the results fewer.

**org-roam** is the most interesting precedent for a middle path. A node is a
file *or* a heading that the author has given an ID. Being a note is opt-in,
per heading, and marked in the text. Deckard now has the same marker available:
the `^block-id` from block references.

**Joplin's Tag Navigator** is the closest analogue to Deckard of anything
found: it indexes tagged lines inside larger Markdown notes, inherits tags
downward from headings and from list indentation, and — most usefully — makes
the unit a *display* setting, `resultGrouping`, with values `heading`,
`consecutive`, `item` and `none`. It is direct evidence that making this
configurable is workable and that "group by heading" is a thing people want.

**Nobody rolls tags upward.** Every system moves tags from container to
contained. The proposal to give `#### Consenting-witness meeting` the tags
written in its body is, as far as this research found, unlike any of them. That
is not a reason to reject it — Deckard's premise (entries finer than a file,
coarser than a block) is already unlike any of them — but it is a reason to
keep the provenance rather than pretend the heading was tagged.

---

## Options

### Option 1 — Keep tagged lines as notes *(today)*

Setting value: `line`.

Nothing changes. Right for a workspace written as tagged prose, where the line
genuinely is the atom. 15% of entries and the home of 59% of the tags.

- **For:** no migration, no surprise, and the finest granularity anyone
  offers.
- **Against:** the complaint. Sentences titled with their own prose compete
  with real notes; the heading that names the subject carries nothing.

### Option 2 — Headings are the only boundary; a line's tags roll up

Setting value: `heading`.

A tagged line stops being an entry. Its tags are added to the nearest enclosing
heading entry, as a separate association group so "written together" still
means "written on one line". A file with no headings falls back to one entry
for the file.

- **For:** exactly the requested behaviour. Result lists become lists of
  headings. `#feature/joint-summary` returns the meeting.
- **Against:** no other tool does this, and a heading now matches a tag its own
  text does not contain. The line is no longer separately addressable, so
  "open the match" lands on the heading and the reader hunts for the sentence —
  unless paired with the `#^block-id` work already shipped.
- **Mitigation:** record the roll-up. A tag on a heading knows whether it was
  written there or promoted, so the UI can render a promoted tag differently
  and a future `is:promoted` could exclude them.

### Option 3 — Headings are the boundary; lines become parts, not results

Setting value: `heading`, plus the line kept as an *anchor*.

As Option 2 for retrieval — a search returns headings — but the line survives
in the index as a located fragment of its heading entry: it contributes its
tags, keeps its line number, and a result can open at it and quote it, the way
a block reference does. It simply never appears as a result in its own right.

- **For:** the complaint is fixed without losing "where in the note was this".
  A result can say *Consenting-witness meeting* and still scroll to line 7 and
  show that sentence as the reason it matched.
- **Against:** more work than Option 2. The entry model grows a notion of
  "parts", which touches excerpting, the graph, and Related Notes evidence.

### Option 4 — Opt-in promotion, org-roam style

Setting value: `marked`.

Headings are the boundary, tags roll up — *except* that a line carrying a
`^block-id` stays an entry of its own. Being a note is something the author
declares, in the text, portably.

- **For:** the author decides, per line; the mechanism already exists and is
  already portable to Obsidian; it makes the common case clean and the
  deliberate case possible.
- **Against:** the README's stance is that Deckard reads markers and never
  writes them, so this asks people to write `^ids` in prose — the one thing
  the block-reference work deliberately declined to automate.

### Option 5 — Change only the display

No parsing change at all. Results are grouped by their nearest heading, and a
group of lines is shown under one heading rather than as separate cards. This
is Joplin's `resultGrouping: heading`.

- **For:** cheapest by far, entirely reversible, and it addresses the visible
  half of the complaint (result lists) without touching the index, the counts,
  Related Notes, or the graph. Ships in a day.
- **Against:** the heading still carries none of the tags, so a *count* beside
  `#feature/joint-summary` still counts sentences, and the tag's page is still
  a list of prose.

---

## The nesting question

Whatever the boundary, a heading note contains other heading notes. Three
policies, independent of the options above:

**(a) Return every match, as today.** A search for a tag inherited by a whole
subtree returns the subtree's root and each of its descendants. Honest, and
what Org settled on, but it makes `#team/harbor` return the check-in *and*
everything inside it — and because a parent's stored text contains its
children's, the same sentence is counted several times.

**(b) Deepest match wins.** When an ancestor and a descendant both match, return
only the descendant. Related Notes already ranks this way; this makes search
agree with it. `#team/harbor` returns the deepest entries that carry it.
Risk: the note the reader thinks of as "the check-in" stops being a result for
its own tag.

**(c) Deepest match wins, ancestors collapse into it.** Return the descendant,
and name its ancestors in its heading path — which search pages already draw
(*2026-09-10 › Project Atlas › Check-in*). The reader sees one result per place
the tag really applies, with the context above it.

**(c) is the recommendation.** It is what the heading path was built for, and
it is the only one of the three whose counts mean something simple: *how many
distinct places in the workspace does this tag apply to*.

One caveat to settle either way: a parent heading's stored text currently
includes its children's. If entries are to be counted and excerpted honestly,
a heading entry's own text should stop at its first child heading, with the
subtree reachable but not duplicated.

---

## The setting

```jsonc
"deckard.noteBoundaries": {
  "type": "string",
  "enum": ["line", "heading", "marked"],
  "default": "line",
  "description": "What Deckard treats as a note inside a Markdown file."
}
```

- `line` — a tagged line is its own note. Today's behaviour.
- `heading` — only headings are notes; a tagged line's tags join its heading.
- `marked` — as `heading`, but a line carrying a `^block-id` stays its own note.

Tasks are outside the setting in every value: a task is always its own entry,
wherever it sits. That is already true and should stay true — it is the one
thing every tool in the table agrees on.

`deckard.parseInlineTags` becomes redundant: `false` is `heading` without the
roll-up, which is strictly worse than `heading`. Keep reading it for one
release, mapping `false` → `heading`, then drop it.

### What the setting changes

| Surface | Effect |
|---|---|
| Search results and counts | Fewer, coarser entries. On the sample workspace, 483 entries → 409, and every count beside a tag changes |
| Tag pages | A tag's page lists headings rather than sentences — the visible point of the change |
| Related Notes | Ranking input changes: a heading now carries the tags of its lines. Association groups must stay per-line or "written together" silently becomes "written under the same heading" |
| Tags written together | Reads from those groups, so it is correct only if groups stay per-line |
| Notes Graph | Around 74 fewer nodes; edges move to headings |
| Query blocks, saved searches, MCP and assistant tools | Unchanged in syntax; different results. A saved search keeps working and returns coarser entries |
| Hub notes, daily notes, calendar, templates | Unaffected |
| The full-text cache | Entry ids change, so the cache rebuilds once on the first scan after the setting changes — which the schema check already handles |

### Migration

Changing the setting is a reindex, not a data change: nothing is written to
anyone's notes. Existing workspaces default to `line` so nothing moves under
them; new workspaces default to `heading`. The setting is `scope: resource`
like the rest, so one workspace can differ from another.

---

## Plan

**Phase 1 — group results by heading (Option 5).** Display only. No index
change, no setting semantics to get wrong, and it answers the loudest half of
the complaint. It also puts the grouping UI in place that Phase 2 needs.

**Phase 2 — the setting, with `line` and `heading`.** Roll-up in the parser,
per-line association groups preserved, promoted tags recorded as promoted.
Nesting policy (c). Default `line` for existing workspaces, `heading` for new.

**Phase 3 — `marked`, and lines as parts (Options 3 and 4).** A rolled-up line
keeps its line number so a result can open at it and quote it, and a
`^block-id` line stays a note of its own.

Each phase is shippable alone, and Phase 1 is worth having even if 2 and 3 are
never built.

## Open questions

1. Should a heading with **no tags of its own** become an entry when its lines
   have tags? Under `heading` it must — otherwise the tags have nowhere to go
   — but it means untagged headings start appearing in tag results.
2. Should promoted tags be visible as such in the UI, or silently equal to
   written ones? (Recording them costs nothing; showing them is a choice.)
3. Under `heading`, does a *file* with no headings become one entry, or do its
   tagged lines stay entries by necessity?
4. Is the nesting policy worth its own setting, or should it follow the
   boundary setting?

## Sources

- [Tags — Obsidian Help](https://obsidian.md/help/Editing+and+formatting/Tags)
- [Tag Inheritance — The Org Manual](https://orgmode.org/manual/Tag-Inheritance.html)
- [Matching tags and properties — The Org Manual](https://orgmode.org/manual/Matching-tags-and-properties.html)
- [Org-roam User Manual](https://www.orgroam.com/manual.html)
- [Joplin plugin: Tag Navigator](https://github.com/alondmnt/joplin-plugin-tag-navigator)
- [Logseq: query for blocks with a tag](https://discuss.logseq.com/t/query-for-blocks-with-tag-in-table-view/16630)
- [Comparison of note-taking software](https://en.wikipedia.org/wiki/Comparison_of_note-taking_software)
