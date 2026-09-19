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
a tag its own text never says. Measured against the sample notes the risk
turns out to be small (no heading absorbs more than one tagged line, no tag
matches more than it did, and the direction is only unsafe if promoted tags
are allowed to keep propagating downward — 6 cases, all of them people). See
*Which way should tags flow?* below for the numbers. It is survivable if the
roll-up is *recorded* rather than pretended, which Deckard's data model
already allows for (`associationTagGroups` is an array of groups, one per line
the tags were written on).

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

## Which way should tags flow?

The research turned up one unanimous convention — tags flow from container to
contained — and the proposal runs the other way. This section takes that
seriously, because the two directions are not mirror images.

### The asymmetry

Downward inheritance is **truth-preserving**. "This paragraph sits inside a
section about Harbor" is true of every part of that section, however long it
is, and stays true as the section grows. Nothing a writer adds later can make
it false.

Upward promotion is **not**. "This section is about `#contact/jax-lumen`" is
inferred from one sentence out of however many. Add nineteen more sentences
about something else and the claim gets weaker, silently. Containment licenses
the first inference and not the second.

That asymmetry is the whole argument, and it is why no tool in the table does
it. It does not mean Deckard should not — it means promotion has to be treated
as *evidence about* a heading rather than as a tag the author wrote on it.

### Downward, as today

**For.** Safe, monotone, familiar, and the only rule under which a deeper
entry is strictly more specific than its parent. It is what makes the heading
path (*Harbor check-in › Sable Ortiz › Consenting-witness meeting*) mean
something.

**Against.** It does not answer the complaint at all. Inheritance decides what
a unit *carries*; it has no opinion on what the unit *is*. Left alone, the
sentence stays a note. It also inflates: a tag on a root heading matches every
descendant, which is where `#team/harbor` gets to 122 matches in 48 notes.

### Upward, as proposed

**For.** It puts the tag on the thing that has a name. A heading has a title;
a sentence has only its own prose, which is why the result list reads as it
does in the screenshot. Retrieval by tag is worth exactly as much as the
titles it returns.

It also matches how the sample notes are actually written: the heading names
the occasion, the sentence names the people and artefacts. Nobody writes
`#### Consenting-witness meeting #project/argent-protocol #feature/joint-summary #contact/jax-lumen #contact/vero-kline` — they write the heading, then the sentence.

**Against.** The claim it makes is weaker than the claim downward inheritance
makes, and nothing in the index records that. A promoted tag and a written tag
would be indistinguishable to search, to counts, and to Related Notes ranking,
where a shared tag is the strongest signal there is. A heading that merely
mentions someone would rank like one titled with them.

And it loses the line. Today a result for `#feature/joint-summary` opens at
line 7; promoted, it opens at the heading and the reader hunts. (Option 3
exists to answer exactly this.)

### Does a promoted tag keep flowing down?

This is the fork that matters most, and it is invisible until you look for it.
If a line's tags join its heading, and headings inherit downward, then a tag
written on one line reaches that heading's *other* children — siblings of the
line it came from.

Measured on the sample notes, the two orders differ by **6 (entry, tag)
pairs**. Small. But look at what they are:

```
Review authority #risk/fatigue            <-  #person/orion-pike
Evidence governance #risk/chain-of-custody <-  #person/leena-sato
Ethical command control #risk/coercion     <-  #person/nia-calder
Source governance #risk/retaliation        <-  #contact/miko-tern
Rest-rule governance #risk/fatigue         <-  #person/nia-calder
Ethics governance #risk/decommissioning    <-  #person/sable-ortiz
```

Every one is a person or a contact attaching to a neighbouring subsection they
were never named in. The rate is negligible; the kind of error is not. A false
"this section is about Nia Calder" is a claim about a person, and those are
the ones worth being strict about.

**So: promote, but do not propagate.** A promoted tag belongs to the heading
that absorbed it and goes no further. Ancestors keep inheriting only what was
written on them. This is the `B2` column in the numbers below.

## What this does to the sample content

48 notes, 409 heading entries, 74 tagged-line entries, 184 distinct tags.
"Rolled up" means: tagged lines stop being entries, their tags join the
nearest enclosing heading, and promoted tags do not propagate further.

| | Today | Rolled up |
|---|---:|---:|
| Entries | 483 | 409 |
| Tagged lines with no heading to roll into | — | **0** |
| Headings that gain a tag | — | 74 of 409 (18%) |
| Tags gained, per affected heading | — | avg 2.0, max 3 |
| Headings with no tags of their own that become tagged | — | **0** |
| Headings absorbing more than one tagged line | — | **0** |
| Tags whose match count grows | — | **0** |
| Tags whose match count shrinks | — | 25 |
| Tags whose match count is unchanged | — | 147 |

Four of those numbers settle arguments:

**Every tagged line has a heading to roll into (0 orphans).** The fallback for
a file with no headings is a real requirement but not a real situation here.

**No untagged heading becomes tagged (0).** Open question 1 is, for this
corpus, moot: every tagged line already sits under a tagged heading, so
promotion never drags an untitled section into a tag's results.

**No heading absorbs more than one tagged line (0 of 74).** This is the
strongest result. The feared failure — a heading turning into a bag holding
everything its body mentions — does not occur once. Promotion here is very
nearly a relabelling: the sentence's tags become the enclosing heading's, and
nothing is mixed with anything else. The worst case in the whole workspace is:

```
"Buyer voiceprint #project/ashen-mirror"
   own:   #project/ashen-mirror
   gains: #feature/signal-reconstruction, #person/mara-vale, #contact/courier
```

which reads as a fair description of that section rather than a dilution of it.

**No tag matches more things than before (0 grew).** Promotion consolidates;
it does not inflate. What shrinks is the count of tags that were being counted
once per tagged line:

```
#team/harbor          122 -> 89
#team/wardens         121 -> 88
#person/mara-vale      70 -> 54
#person/sable-ortiz    69 -> 52
#project/ashen-mirror  41 -> 29
```

Those drops are not lost matches. They are the same places, counted once each
instead of once per sentence.

And the tag from the screenshot:

```
#feature/joint-summary    today 1    rolled up 1
```

**The count does not change. The entry does.** Today it is the sentence
*"Sable will protect the #feature/joint-summary review with…"*. Rolled up it
is *Harbor check-in › Sable Ortiz › Consenting-witness meeting*. That single
line is the entire case for the change: the search was never finding too much
or too little, it was returning the wrong kind of thing.

### What follows

1. **Promote, do not propagate.** Ancestors inherit written tags only.
2. **Record the promotion.** A heading's tag knows whether it was written or
   absorbed. Costs one flag; buys honest UI, an `is:promoted` filter later,
   and the next point.
3. **Weight a promoted tag below a written one in Related Notes.** A shared
   written tag is the author saying two things are about each other. A shared
   promoted tag is two sections mentioning the same name. The ranking already
   distinguishes evidence by strength; this is one more kind.
4. **Keep the line's position** so a result can open where the tag was
   written, which is Option 3 and the reason it is in Phase 3 rather than
   dropped.

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
