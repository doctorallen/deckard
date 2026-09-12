# Related Notes: Association and Ranking Reference

This document explains how Deckard decides that one note entry is related to
another. It is a technical reference for the Related Notes sidebar and the
**Debug related notes** page. The implementation is intentionally local and
deterministic: Markdown is indexed on the user's machine and the ranking
calculation runs locally.

The short version is:

1. An exact shared tag is the strongest signal.
2. Tags inherited from the selected entry's parent headings or found below a
   selected heading provide lighter context.
3. Associated tags, intentional Wiki links, distinctive shared words, and
   optionally recency add supporting evidence.
4. The final score is bounded, explainable, and displayed with the evidence
   that produced it.

## Implementation map

The behavior described here is implemented in these files:

- [`src/core/markdown/parser.ts`](../src/core/markdown/parser.ts) parses
  headings, tagged lines, tasks, front matter, and canonical tag keys.
- [`src/core/workspace/indexer.ts`](../src/core/workspace/indexer.ts) builds
  the directed tag-association index.
- [`src/ui/webview/sidebarNotes.ts`](../src/ui/webview/sidebarNotes.ts)
  creates selected-entry context and its distance weights.
- [`src/ui/state/dashboardState.ts`](../src/ui/state/dashboardState.ts)
  finds candidate entries and calculates Related Notes evidence and scores.
- [`src/ui/webview/relatedNotesDebugHtml.ts`](../src/ui/webview/relatedNotesDebugHtml.ts)
  renders the diagnostic page.

The formulas in this document describe the current implementation. They are
not claims that Deckard implements a general-purpose search engine or a
standard graph database.

## 1. What counts as a note entry?

Deckard indexes several kinds of entries:

- ATX headings such as `# Project` through `###### Detail`.
- Tagged prose lines, when `deckard.parseInlineTags` is enabled.
- Checklist tasks such as `- [ ] Review the proposal #follow-up`.

Each heading has a structural parent. The parent is the nearest preceding
heading with a smaller heading level, including when one or more untagged
headings occur between the child and its tagged ancestor. This is a structural
relationship, not a text similarity guess. The [CommonMark ATX heading
specification](https://spec.commonmark.org/0.31.2/#atx-headings) describes the
Markdown heading syntax that provides this outline structure.

For example:

```markdown
# Program #project/atlas

## Decisions

### Vendor review #risk/vendor

The review line is tagged #follow-up.
```

The `Vendor review` heading is a child of `Decisions`, which is a child of
`Program`, even though `Decisions` has no tag. The tagged prose line is an
inline entry under the nearest containing heading.

### Explicit tags versus inherited context

Deckard keeps two ideas separate:

- **Explicit tags** are written on the heading, tagged line, or task itself.
- **Inherited tags** come from front matter or a containing heading and make
  the entry easier to find in a tag overview.

Inherited and front-matter tags can participate in direct matching, but they do
not create a synthetic tag association by themselves. Association evidence is
created from explicit tag groups and explicit heading relationships. This
prevents a note-wide front-matter tag from falsely implying that every local
tag was intentionally written beside it.

Tag aliases are resolved to canonical keys during parsing. For example, if
`proj` aliases to `project`, `#proj/atlas` and `#project/atlas` use the same
internal key for matching and association lookup, while the source spelling
can remain available for display.

## 2. The selected-note scope and context weights

Related Notes can use either the whole active document or one selected entry.
When an entry is selected, Deckard creates a temporary scoped view containing
the selected entry and the tags that provide context around it.

| Context | Weight | Meaning |
|---|---:|---|
| Selected entry | `1.00` | The tag is explicitly written on the entry being viewed. |
| Parent heading at depth `d` | `0.5 / d` | The tag comes from a tagged ancestor heading. |
| Child heading at depth `d` | `0.5 / d` | The tag comes from a tagged descendant heading. |
| Child item at depth `d` | `0.5 / d` | The tag comes from a tagged inline item or task. Child items begin one level farther away than their containing heading. |

This produces the following common values:

- Direct selected tag: `1.00`.
- One parent or child heading away: `0.50`.
- Two headings away: `0.25`.
- An item directly below the selected heading: `0.25`, because child items
  receive an additional level of decay.
- An item below a child heading: `0.1667`, calculated as `0.5 / 3`.

If the same tag is found in several places, the strongest occurrence wins. A
tag written on the selected entry therefore remains full strength even if the
same tag also appears on a distant parent or child.

For the example above, selecting `Vendor review` gives:

| Tag | Source | Weight |
|---|---|---:|
| `#risk/vendor` | Selected heading | `1.00` |
| `#project/atlas` | Parent heading, two outline steps away through `Decisions` | `0.25` |
| `#follow-up` | Tagged line below the selected heading | `0.25` |

Selecting `Program` instead would treat `#risk/vendor` as a child-heading tag
at `0.50`. A task nested below `Vendor review` would be a deeper child item
when `Program` is selected.

## 3. Association source units

An association is a learned relationship between two different canonical tag
keys. Associations are directed internally: the index stores both
`#project/atlas -> #risk/vendor` and
`#risk/vendor -> #project/atlas`, so either tag can be the selected tag.

### What is a source unit?

A **source unit** is one distinct atomic place where Deckard can observe tags.
It is not necessarily a whole file. Current source units include:

- one explicit tag group on a heading;
- one explicit tag group on a tagged prose line;
- one explicit tag group on a task; and
- one structural relationship between a tagged child heading and a tagged
  ancestor heading.

The index can register an empty heading or task group while it is building the
workspace totals. Empty units do not create an association edge and do not
increase either tag's appearance count, but they can be included in
`totalSourceUnitCount`.

For each explicit group, Deckard deduplicates repeated occurrences of the same
canonical tag key. It then creates every pair of different tags in that group.
The pair is recorded in both directions.

For example:

```markdown
# Launch #project/atlas #risk/vendor

- [ ] Review supplier #project/atlas #risk/vendor
```

creates two source units:

```text
section:<heading-id>:group:0  -> #project/atlas, #risk/vendor
task:<task-id>:group:0        -> #project/atlas, #risk/vendor
```

The pair has support `2`, not `4`: the two directions are separate lookup
edges, but they refer to the same two authoring units.

Heading proximity creates another kind of source unit. If a child heading has
`#risk/vendor` and its tagged parent has `#project/atlas`, Deckard registers a
source unit containing both tags and adds weaker evidence for the pair. A
heading relationship at depth `d` contributes `0.5 / d` raw weight instead of
the full `1.0` co-occurrence weight.

### Association fields

The diagnostic page exposes the following values for each selected-tag and
candidate-tag pair:

| Diagnostic term | Internal value | Explanation |
|---|---|---|
| Shared source units | `count` | Number of distinct source units containing the pair. This is the association's support count. |
| Tag appearances | `tagSourceUnitCount / associatedTagSourceUnitCount / totalSourceUnitCount` | Number of source units containing the selected tag, the candidate tag, and all indexed source units. |
| Raw connection | `weight` | Sum of the pair's unadjusted co-occurrence and heading-proximity evidence. |
| Adjusted connection | `normalizedWeight` | Raw connection adjusted for support and how broadly the tags occur. |
| Co-occurrences | `coOccurrenceCount` | Number of explicit tag groups in which the pair was written together. |
| Heading relationships | `headingRelationshipCount` | Number of explicit tagged parent/child heading relationships supporting the pair. |

The total source-unit count is shown for orientation. The normalization
formula uses the selected tag count, candidate tag count, and pair support; it
does not simply divide by the total number of files.

## 4. Raw evidence and adjusted association relevance

### Raw connection strength

Raw evidence is the starting strength before prevalence and support
adjustments:

- an explicit co-occurrence contributes `1.0`;
- a heading relationship at depth `d` contributes `0.5 / d`;
- repeated source units add their evidence;
- co-occurrence and heading evidence are retained separately for diagnostics.

Suppose three source units support the same pair:

| Source unit | Relationship | Raw contribution |
|---|---|---:|
| Heading group | Tags written together | `1.00` |
| Task group | Tags written together | `1.00` |
| Tagged child/parent headings | One heading step apart | `0.50` |
| **Total raw connection** |  | **`2.50`** |

Raw evidence answers: "How much direct authoring or structural evidence did we
observe?" It does not yet answer whether that evidence is distinctive.

### Adjusted connection strength

Deckard applies two adjustments:

```text
overlapRatio = support / max(1, selectedTagSourceUnits, candidateTagSourceUnits)
supportConfidence = support / (support + 1)

adjustedConnection =
  rawConnection
  * overlapRatio
  * (0.5 + supportConfidence / 2)
```

The first factor rewards pairs that occur together across a large share of the
units where either tag appears. The second factor gives one-off relationships
useful but cautious weight and approaches `1.0` as repeated support grows.

Using the three-unit example where each tag appears in exactly three source
units:

```text
support = 3
selectedTagSourceUnits = 3
candidateTagSourceUnits = 3
rawConnection = 2.50

overlapRatio = 3 / max(3, 3, 3) = 1.00
supportConfidence = 3 / (3 + 1) = 0.75

adjustedConnection = 2.50 * 1.00 * (0.5 + 0.75 / 2)
                   = 2.50 * 0.875
                   = 2.1875
```

If the candidate tag appears in 30 source units but the pair still appears in
only three, the overlap ratio becomes `3 / 30 = 0.10`. The same raw evidence
then becomes `0.21875`. This is why a generic tag that appears everywhere does
not automatically create a strong relationship.

This is a Deckard-specific normalization strategy. It is conceptually related
to the information-retrieval principle that rare terms are more
discriminating than common terms; the [Stanford Information Retrieval book's
discussion of inverse document frequency](https://nlp.stanford.edu/IR-book/html/htmledition/inverse-document-frequency-1.html)
provides background for that broader principle.

## 5. How a candidate note receives its score

Deckard builds a candidate reference for each matching section and standalone
task in every other indexed file. A task already represented by a matching
section is not duplicated as a second sidebar result.

A candidate can qualify through any of these signals:

- an exact shared tag;
- a learned tag association;
- a direct entry Wiki link;
- a file-level Wiki link;
- section-scoped lexical similarity; or
- an already eligible candidate receiving an optional recency boost.

Recency is a score component, not an eligibility condition. A note with no
shared tag, association, link, or lexical match does not appear solely because
it is recent.

### Direct shared tags

For each exact tag match:

```text
directTagWeight += 2 * selectedTagWeight
```

Examples:

- a selected-entry tag at `1.00` contributes `2.00`;
- a parent-heading tag at `0.50` contributes `1.00`;
- a child item at `0.25` contributes `0.50`.

Direct tags are deliberately stronger than indirect evidence.

### Association paths

For each selected tag and candidate tag with an indexed association:

```text
associationPathContribution =
  adjustedConnection * selectedTagWeight
```

The debug page lists this value per pair. All qualifying paths are then
combined into `normalizedAssociationWeight`. The final association component
uses diminishing returns:

```text
totalSelectedWeight = sum(selected tag weights)

appliedAssociationWeight =
  totalSelectedWeight
  * normalizedAssociationWeight
  / (normalizedAssociationWeight + totalSelectedWeight)
```

This function keeps adding value as evidence grows but approaches the total
selected-tag weight instead of growing without bound.

Example:

```text
selected weights = 1.00 + 0.50 = 1.50
normalized association paths = 0.60

applied association weight =
  1.50 * 0.60 / (0.60 + 1.50)
  = 0.4286
```

Indirect associations can improve a candidate, but they cannot replace a
complete direct-tag match.

### Wiki links

Intentional links provide supporting evidence:

- an entry-scoped link to the selected entry, or a reciprocal link to the
  candidate entry, contributes `0.5`;
- a file-level link between the two notes contributes `0.1` when there is no
  stronger entry link.

File names, `.md` suffixes, and heading targets are normalized before matching.
An entry link can therefore target a note by path, filename, or heading title.

### The final relevance score

Let:

```text
D = directTagWeight
A = appliedAssociationWeight
E = direct entry-link weight
F = file-link weight
X = lexical weight
R = recency weight
T = total selected-tag weight
```

The pre-penalty score is:

```text
baseScore =
  round(
    min(1, (D + A + E + F + X + R) / max(1, T * 2))
    * 100
  )
```

The score is bounded at `100`. When a candidate is a broad section and a more
specific descendant contains the same matching tags, Deckard applies a
specificity penalty of `0.05`, which is five points after rounding:

```text
displayedScore = max(0, baseScore - 5)
```

This makes the more specific child entry appear ahead of a broad parent when
both match the same tags.

## 6. BM25-style lexical similarity

### What BM25 means

BM25, also written BM-25, is a classic search-ranking family for estimating
which documents best match a set of query terms. The [Elasticsearch similarity
documentation](https://www.elastic.co/docs/reference/elasticsearch/index-settings/similarity)
describes BM25 as a TF/IDF-based similarity with term-frequency saturation and
document-length normalization. The [Apache Lucene BM25 documentation](https://lucene.apache.org/core/9_9_0/core/org/apache/lucene/search/similarities/BM25Similarity.html)
and [Lucene similarity overview](https://lucene.apache.org/core/9_9_0/core/org/apache/lucene/search/similarities/package-summary.html)
describe the same general ideas: repeated terms help, but with diminishing
returns, and longer documents are normalized.

Deckard uses a small BM25-style implementation, not a full search-library
analyzer. It is intentionally capped and is always weaker than a direct tag
match.

### Deckard's text preparation

For the active scope and every candidate section or task, Deckard:

1. Lowercases terms.
2. Keeps ASCII words beginning with a letter and containing at least three
   characters; hyphenated words are allowed.
3. Removes tags, Wiki links, URLs, fenced code, and front-matter content from
   body text.
4. Ignores a small list of common words such as `about`, `before`, `their`,
   `which`, and `with`.
5. Adds title terms twice as an explicit boost, giving headings and task titles
   more influence than ordinary body words. The combined title-and-body text
   also contains the title once, so a title term can occur three times in the
   resulting term list.
6. For a normal heading, excludes nested child sections from the parent's
   lexical content so a parent does not receive credit for text that belongs
   to its children.

The corpus contains all indexed sections and tasks. Document frequency counts
how many of those corpus entries contain a term. The active entry or active
document supplies the query terms.

### The formula used by Deckard

For each query term that occurs in a candidate:

```text
lengthFactor =
  1.2 * (1 - 0.75 + 0.75 * candidateLength / averageLength)

inverseFrequency =
  ln(
    1 + (documentCount - documentFrequency + 0.5)
        / (documentFrequency + 0.5)
  )

termContribution =
  inverseFrequency
  * (frequency * 2.2)
  / (frequency + lengthFactor)
```

The candidate's raw term contributions are summed and compressed:

```text
lexicalWeight = min(0.3, rawTermWeight / (rawTermWeight + 1))
```

The constants `1.2`, `0.75`, and `2.2` provide term-frequency saturation and
length normalization. The `0.3` cap keeps text similarity below direct tags
and links. The debug page lists the per-term `termContribution`; the overall
`lexicalWeight` in the evidence summary is the capped value used in ranking.

### Lexical example

Suppose the selected entry contains:

```text
Supply continuity review for the northern route
```

and a candidate contains:

```text
The northern route needs a supply continuity review.
```

The terms `supply`, `continuity`, `review`, and `northern` can match. If
`review` occurs in many indexed entries but `continuity` occurs in only two,
the IDF portion gives `continuity` more influence. Repeating `review` can
increase its contribution, but the frequency term saturates instead of
doubling forever. The final lexical component still cannot exceed `0.3`.

The [Stanford IR book's inverse-document-frequency explanation](https://nlp.stanford.edu/IR-book/html/htmledition/inverse-document-frequency-1.html)
explains why a rare term carries more discriminating information than a term
that appears in most documents.

## 7. Optional recency

Recency is disabled by default. Set
`deckard.relatedNotesRecencyHalfLifeDays` to a positive number to enable it.
Deckard chooses the candidate file's date in this order:

1. A `date`, `created`, or `updated` ISO date in front matter.
2. A `YYYY-MM-DD` filename or level-one heading, commonly used for daily
   notes.
3. The indexed file modification time.

The weight is:

```text
ageDays = max(0, now - candidateDate)
recencyWeight = 0.1 * 2 ^ (-ageDays / halfLifeDays)
```

After one configured half-life, the recency contribution is half as large.
Its maximum is `0.1`, so it remains a tie-breaker rather than overpowering
tags or links.

## 8. Ordering and tie-breakers

The default **Relevance** ordering compares candidates by:

1. Displayed relevance score.
2. Weighted direct-tag match count.
3. Raw association weight.
4. Overall overlap score.
5. Number of explanatory reasons.
6. File path, source line, and title for deterministic output.

The sidebar also supports **Newest**, **Oldest**, and **Most accessed**. Those
sort modes apply their date or local section-access comparison first, then use
the same relevance tie-breakers. Access counts are local preferences and do
not change the evidence calculation.

## 9. How to read the Debug related notes page

### Selected tag weights

This table describes the query context, not a candidate note:

- **Tag** is the canonical tag key used for matching.
- **Weight** is the strongest selected, parent, child-heading, or child-item
  weight for that tag.
- **Context** tells where the strongest occurrence came from.
- **Why** gives the distance-decay explanation.

### Matched tags

An exact candidate tag match shows:

- the candidate tag;
- the selected context weight;
- the fixed direct multiplier `2.00`; and
- the direct contribution, calculated as `selected weight * 2.00`.

### Association paths

Each row is one selected-tag/candidate-tag association path. Read the columns
as follows:

- **Shared source units**: how many distinct authoring units supplied the
  relationship.
- **Tag appearances**: selected-tag count, candidate-tag count, and total
  indexed source-unit count.
- **Raw connection**: unadjusted co-occurrence and heading-proximity weight.
- **Adjusted connection**: support and popularity-adjusted weight.
- **Selected weight**: the context weight of the selected tag.
- **Contribution**: adjusted connection multiplied by selected weight.

The **How association weight is applied** disclosure explains how all rows are
combined with diminishing returns. The math is intentionally hidden until it
is needed, because the result's plain-language reason is usually more useful
than the formula.

### Lexical evidence and the evidence summary

The lexical table lists shared terms and their raw term contributions. The
summary below the reasons shows the bounded lexical weight actually added to
the candidate score. It also shows direct tags, associations, links, recency,
and any specificity adjustment.

## 10. Configuration and troubleshooting

| Setting | Default | Effect on Related Notes |
|---|---:|---|
| `deckard.enableKeywordLinks` | `true` | Enables the capped lexical text signal. Disable it to use tags, associations, and Wiki links without text similarity. |
| `deckard.relatedNotesAssociationMinimumSupport` | `1` | Requires an association to appear in at least this many distinct source units. Raising it suppresses one-off learned associations without removing them from the index. |
| `deckard.relatedNotesRecencyHalfLifeDays` | `0` | Enables the optional recency contribution when greater than zero. |
| `deckard.parseInlineTags` | `true` | Controls whether tagged prose and list lines become separate indexed entries and association source units. |
| `deckard.enableHeadingTagRelationships` | `true` | Controls the Associated tags views in Tag Overviews. Heading relationships are still represented in the index used for relationship evidence. |
| `deckard.entityNamespaceAliases` | `{ "org": "organization" }` | Canonicalizes namespace keys before direct matching and association lookup. |

If an expected relationship is missing, check the following:

1. Are both tags explicit on the same heading, line, task, or tagged
   parent/child heading relationship? Inherited front-matter context alone
   does not create an association.
2. Is the candidate tag actually indexed in the candidate entry? A tag on a
   different section may be a different source reference.
3. Is `relatedNotesAssociationMinimumSupport` higher than the pair's
   **Shared source units** count?
4. Is `enableKeywordLinks` disabled, or is the shared wording removed by tag,
   link, code, front-matter, or stop-word filtering?
5. Is a namespace alias causing two source spellings to use one canonical key?

If a candidate has no exact shared tag, it can still appear through an
association, Wiki link, or lexical match. Recency can then add a small amount
to its score. That is why the Debug page may show a candidate with an empty
**Matched tags** table.

## 11. Worked end-to-end example

Consider the selected entry:

```markdown
## Vendor review #risk/vendor

Check supply continuity for the northern route.
```

Its parent context is:

```markdown
# Launch program #project/atlas
```

The selected context is therefore:

```text
#risk/vendor       1.00  selected entry
#project/atlas     0.50  one parent heading up
```

Now compare this candidate:

```markdown
### Supplier continuity #project/atlas

The northern route needs a supply continuity review.
```

Assume the candidate has:

```text
exact #project/atlas match: 2 * 0.50 = 1.00
normalized association paths: 0.40
total selected weight: 1.50
direct entry link: 0.00
file link: 0.00
lexical weight: 0.12
recency weight: 0.00
```

The association cap is:

```text
1.50 * 0.40 / (0.40 + 1.50) = 0.3158
```

The unpenalized score is:

```text
round(min(1, (1.00 + 0.3158 + 0.12) / (1.50 * 2)) * 100)
= round(1.4358 / 3.00 * 100)
= 48
```

If this candidate is a broad section with a more specific descendant that
also contains `#project/atlas`, its displayed score becomes `43` after the
five-point specificity penalty. The child entry can then rank ahead because it
is the more precise source for the same matching tag.

This example shows why a parent-context tag can still be useful without being
treated as a full-strength selected tag: it contributes to direct matching,
association weighting, and the score denominator at half strength.

## 12. Online references

These references explain the external concepts used by, or related to, the
implementation:

- [CommonMark Spec: ATX headings](https://spec.commonmark.org/0.31.2/#atx-headings)
  - Markdown heading syntax and outline structure.
- [Elasticsearch: Similarity settings](https://www.elastic.co/docs/reference/elasticsearch/index-settings/similarity)
  - BM25 as a TF/IDF-based similarity, with term-frequency saturation and
    document-length normalization.
- [Apache Lucene: BM25Similarity](https://lucene.apache.org/core/9_9_0/core/org/apache/lucene/search/similarities/BM25Similarity.html)
  - Reference documentation for BM25 term-frequency and length-normalization
    behavior.
- [Apache Lucene: Similarity package overview](https://lucene.apache.org/core/9_9_0/core/org/apache/lucene/search/similarities/package-summary.html)
  - Overview of ranking models and BM25 tuning parameters such as `k1` and
    `b`.
- [Stanford Information Retrieval book: Inverse document frequency](https://nlp.stanford.edu/IR-book/html/htmledition/inverse-document-frequency-1.html)
  - Why terms that occur in fewer documents provide more discriminating
    evidence.

The external references describe general information-retrieval ideas. The
source links at the top of this document are authoritative for the exact
Deckard formulas, constants, parsing choices, and score caps.
