# Related Notes Research and Recommendations

This document reviews established approaches to structured daily notes and
local knowledge-system relevance. It recommends practical next steps for
Deckard's local-first Markdown index.

## Summary

Daily notes are commonly date-named capture files containing headings,
paragraphs, lists, and tasks. The useful precedent is to treat the file as a
container and retrieve **sections, blocks, and tasks**, not the whole daily
note as one result. This aligns with Deckard's current entry-level results and
avoids a long daily note's unrelated content influencing every result.

For relevance, direct shared tags should remain the clearest signal. Heading
context, learned tag associations, links, and prose similarity are useful
supporting signals when they are bounded, explainable, and cannot dominate an
exact match.

## 1. Precedents for structured daily notes

### Obsidian

Obsidian's Daily Notes plugin creates or opens a date-named note and supports
templates. Its examples include a heading and a task, establishing a common
pattern for a daily file that mixes journal content and actionable work.

Obsidian Search treats structure as meaningful:

- `block:(dog cat)` requires terms in the same block.
- `section:(dog cat)` requires terms under the same heading.
- `task:`, `task-todo:`, and `task-done:` operate on task blocks.

This is strong precedent for Deckard's rule that a matching child section or
task should be more relevant than a broad daily-note H1.

**Sources**

- [Obsidian Daily Notes](https://help.obsidian.md/plugins/daily-notes)
- [Obsidian Search](https://help.obsidian.md/plugins/search)
- [Obsidian formatting syntax](https://help.obsidian.md/syntax)

### Dataview

Dataview exposes a note's tags, explicit tags, tasks, lists, links, front
matter, and an inferred date from a date filename. It also exposes nested-tag
prefixes such as `#topic`, `#topic/area`, and `#topic/area/item` alongside the
full tag.

**Deckard implication:** retain the written tag, canonical tag, structural
ancestor, and date-file identity separately. These represent different kinds
of context and should not be silently treated as the same evidence.

**Source:** [Dataview metadata](https://blacksmithgu.github.io/obsidian-dataview/annotation/metadata-pages/)

### Org mode and Org-roam

Org mode models headings as a true outline tree: content belongs to the
headline's subtree. It supports headline tags, list-level checkbox tasks, and
hierarchical task state. Org-roam adds date-addressable daily capture while
keeping users' plain-text files as the durable source of truth.

**Deckard implication:** explicit tags on a selected entry and tags supplied
by its parent headings should remain distinct. Parent context is useful, but
should be weaker than a tag written on the selected entry.

**Sources**

- [Org headings](https://orgmode.org/manual/Headlines.html)
- [Org tags](https://www.gnu.org/software/emacs/manual/html_node/org/Tags.html)
- [Org checkboxes](https://www.gnu.org/software/emacs/manual/html_node/org/Checkboxes.html)
- [Org-roam dailies](https://www.orgroam.com/manual.html#org_002droam_002ddailies)

### Markdown interoperability

CommonMark defines nested headings, paragraphs, lists, container blocks, and
fences. GitHub Flavored Markdown adds task-list items. Markdown front matter
is an ecosystem convention rather than part of YAML itself, so conservative
front-matter parsing is appropriate.

**Sources**

- [CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/)
- [GFM task-list items](https://github.github.com/gfm/#task-list-items-extension-)
- [YAML 1.2.2](https://yaml.org/spec/1.2.2/)

## 2. Common relevance approaches

| Method | What it measures | Best use in Deckard | Main safeguard |
|---|---|---|---|
| Exact tag overlap | Tags directly shared by two entries | Primary retrieval signal | Weight selected-entry tags above ancestors |
| Co-occurrence | Tags intentionally written together | Learned associations | Count atomic source units, not whole files |
| Jaccard overlap | Shared tags divided by all distinct tags | Explainable secondary signal | Do not let generic tags dominate |
| PMI with support | How unexpectedly often two tags occur together | Improve learned-association quality | Minimum support and shrinkage |
| TF-IDF / BM25 | Distinctive shared prose terms | Keyword relevance | Index sections/tasks, normalize long notes |
| Link graph / personalized PageRank | Connection paths from the active entry | Future optional signal | Small, capped contribution |
| Temporal decay | Recency | Optional tie-breaker or mode | Prefer date metadata, not only file modified time |

### Direct tags and heading context

Deckard's current asymmetric model is a sound starting point:

```text
Selected entry tag       weight 1.00
Parent-heading tag       weight 0.50
Grandparent-heading tag  weight 0.25
```

An exact candidate match uses the selected tag's weight. A candidate does not
receive a second ancestor pass. This keeps the result centered on what the
person is viewing while preventing broad candidate outlines from gaining
hidden credit.

### Association strength

Raw co-occurrence should only be learned from an atomic authoring unit:

- one heading;
- one tagged prose entry; or
- one task/list item.

Counting two tags merely because they exist somewhere in a large daily note
creates false associations.

Raw counts alone overvalue frequent tags. A later improvement can normalize
association edges using positive pointwise mutual information (PMI), with
minimum support and shrinkage:

```text
PMI(tagA, tagB) = log(P(tagA and tagB) / (P(tagA) * P(tagB)))
```

Only positive, sufficiently supported relationships should be displayed or
used for relevance. This distinguishes a genuinely meaningful pairing from
two popular tags that happen to occur together frequently.

**Source:** [Church and Hanks, Word Association Norms, Mutual Information, and Lexicography](https://aclanthology.org/J90-1003/)

### Diminishing returns

Repeated indirect evidence should help, but it should not eclipse a complete
direct tag match. Deckard now uses a bounded saturating contribution:

```text
appliedAssociation =
  selectedTagTotal *
  (rawAssociation / (rawAssociation + selectedTagTotal))
```

The value increases for every added association but approaches the selected
tag total gradually. This is similar in spirit to BM25's saturating
term-frequency behavior.

**Source:** [Okapi BM25](https://nlp.stanford.edu/IR-book/html/htmledition/okapi-bm25-a-non-binary-model-1.html)

### Text similarity

Deckard currently uses a small binary shared-keyword signal. The established
next step is to score prose at the section/task level with TF-IDF or BM25:

- exclude tags, front matter, code, URLs, and stop words;
- boost title and task-title words over body prose;
- normalize for entry length;
- keep lexical relevance below direct-tag relevance; and
- show the matched terms and contribution in Debug Related Notes.

TF-IDF lowers the impact of common terms. BM25 additionally normalizes for
long documents and gives repeated words diminishing value, both especially
important for large daily notes.

**Sources**

- [TF-IDF weighting](https://nlp.stanford.edu/IR-book/html/htmledition/tf-idf-weighting-1.html)
- [Cosine document similarity](https://nlp.stanford.edu/IR-book/html/htmledition/dot-products-1.html)
- [Okapi BM25](https://nlp.stanford.edu/IR-book/html/htmledition/okapi-bm25-a-non-binary-model-1.html)

## 3. Recommendations for Deckard

### Keep

1. Index sections, tagged prose entries, and tasks separately.
2. Keep direct selected-entry tags stronger than ancestor tags.
3. Learn associations only from explicit same-unit co-occurrence and bounded
   heading context.
4. Keep association relevance bounded with diminishing returns.
5. Keep the Related Notes debug page; transparent scoring is a differentiator.

### Next implementation priorities

1. **Add heading paths to result context.** Display a compact path such as
   `2026-09-10 > Project Atlas > Check-in` beside a related entry. This makes
   daily-note results understandable without opening them.
2. **Normalize learned associations.** Preserve raw evidence counts for
   explanations, but rank association edges with support-aware PMI or a
   conditional-probability measure. Begin with a minimum support threshold of
   two or three distinct atomic source units.
3. **Replace binary keyword matching with section-scoped BM25.** Keep it
   optional and capped at roughly 10–20% of a complete direct-match capacity.
4. **Distinguish link scope.** A link written on the selected entry should be
   stronger than a link elsewhere in its file. Resolve heading targets where
   possible.
5. **Add optional recency carefully.** Use the daily-note date or front
   matter before filesystem modification time. Keep it disabled by default or
   as a small tie-breaker.
6. **Extend Debug Related Notes.** Add source-unit counts, per-tag document
   frequencies, normalized association values, heading paths, and eventually
   lexical-term details.

### Evaluation plan

Build a labeled fixture set with:

- an oversized daily note containing generic headings, nested tagged headings,
  tagged prose, nested task lists, front matter, and fenced code;
- direct-match, ancestor-only, one-association, repeated-association, link,
  keyword-only, and unrelated candidate entries; and
- common tags such as `#daily` and `#work` that should not dominate results.

Measure **Precision@5**: inspect whether the first five results are genuinely
useful. This fits a sidebar where people usually choose from the first screen
of results.

**Source:** [Evaluation of ranked retrieval results](https://nlp.stanford.edu/IR-book/html/htmledition/evaluation-of-ranked-retrieval-results-1.html)

## 4. Recommended product direction

Deckard should remain a transparent, local Markdown tool rather than adopt a
black-box recommendation model. The recommended order is:

```text
exact selected-entry tags
  > explicit parent-heading context
  > normalized, diminishing learned associations
  > direct entry links
  > section-scoped lexical similarity
  > optional recency or graph signals
```

Every score should remain inspectable. The current debug page is the right
foundation: add richer evidence and normalization details as the retrieval
model evolves.

## 5. Sidebar UX research

The sidebar has two different jobs and should make the active job obvious:

```text
Tag Overview
  focus tag and active filters
  associated tags (collapsed by default)
  matching notes and count

Related Notes
  current document or selected entry
  active tags and scope action
  sort control
  related entries and count
```

This hierarchy follows the VS Code sidebar guidance to keep a view focused,
descriptive, and compact, while using progressive disclosure for secondary
navigation. It also follows backlinks patterns in Obsidian and linked-reference
filters in Logseq: context and reversible filters stay beside the result list
instead of being hidden in a separate settings surface.

The audit identified four high-value safeguards:

1. Name the active mode in both the native view title and the webview header.
2. Show result counts and one concise matching reason before requiring users to
   inspect scoring details.
3. Make combined Tag Overview filters removable from the sidebar and provide a
   clear-all action.
4. Keep score explanations available to keyboard users through a focusable
   control rather than relying only on hover.

These changes preserve Deckard's existing ranking, association disclosure, and
source navigation while making scope, filtering, and relevance easier to
recognize in a narrow panel.

**Sources**

- [VS Code Sidebars UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/sidebars)
- [VS Code Views UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/views)
- [VS Code Webview UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/webviews)
- [WAI-ARIA Button Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/)
- [WAI-ARIA Tooltip Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/)
- [WCAG 2.2 Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [Nielsen Norman Group: Recognition Rather Than Recall](https://www.nngroup.com/articles/recognition-and-recall/)
- [Obsidian Sidebar and Pinned Panes](https://github.com/obsidianmd/obsidian-help/blob/master/en/User%20interface/Sidebar.md)
- [Obsidian Backlinks](https://github.com/obsidianmd/obsidian-help/blob/master/en/Plugins/Backlinks.md)
- [Logseq: How to Filter Linked References](https://github.com/logseq/docs/blob/master/pages/How%20to%20filter%20linked%20references.md)
