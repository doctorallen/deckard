# Related notes, the graph, and the outline

## Related Notes

Related notes are listed in the **Context** view in the Deckard sidebar. The same view shows a search's Refine, a graph node's connections, the calendar page's chosen day, or Home's widgets while one of those is in front.

Open the **Context** view from the Deckard Activity Bar while editing a saved Markdown note; its **Related notes** list suggests note entries that may concern the same work, each showing its first line with shared words marked.

![Deckard Related Notes sidebar showing ranked note entries and matching tags.](../images/related-notes.png)

- **Sort by**: **Relevance**, **Newest**, **Oldest**, or **Most accessed**. The gear beside it sets **Preview** (None, 1 line, or 2 lines) and **Daily notes** (Show or Hide).
- Select a result to open its matching line, or a tag to open its page.
- Each result shows its heading path and main reason for matching; daily notes also show their date, as in `2026-09-10 > Project Atlas > Check-in`. A nested child heading with the same tags as its parent comes first. Results show 50 at a time; **Show more** adds 50.
- **Link button.** Beside each score, it writes a `[[Note#Heading]]` link to that entry at your cursor, replacing any selection. It names the heading without its tags, or the note alone when the heading repeats the note's title. A tagged line or task is linked through the heading above it. When two notes share the name, Deckard writes the link and says which notes it could mean.
- **Parked notes** are not suggested unless the current note is parked; then they come last.
- Home, the Task board, the Notes Graph, and Help are in the **Pages** view above it, and in **Go to…**; see [Getting started](getting-started.md#finding-your-way).

**Untagged notes.** A note with no tags lists up to ten entries with similar wording, under **Similar wording (no tags yet)**, marked weak, and above them **Tags used by similar notes**. Select **Add** beside a tag to write it on the heading or line at the cursor and save the note; the message offers **Undo**, as does **Undo Last Change**. A tagged note never gets this list. `deckard.enableKeywordLinks` turns it off along with the wording signal.

**Linked from** lists notes that link to this one, newest updated first, each with its update time, link count, and linking lines under their headings. The count is the number of notes. **›** on a line unfolds up to fifteen more lines of its section.

- **Open as search** opens `link = [[This note]]` as a search page. Over fifty lines, it reads *12 more not listed.* **Open all as a search**.
- **Daily notes: Hide** leaves daily, weekly, and monthly notes out of related notes and Linked from, which then says *Hiding 8 daily notes.* with **Show them**; Open as search adds `-is:periodic`. The choice is remembered.
- A parked note that links here is listed last, marked **Parked**.

**Mentioned without a link** lists lines that write the note's name as plain text. Select one to open it, or Cmd/Ctrl-click to open it beside the note. **Link** makes one mention a `[[link]]`; **Link all** links every one as a single change that **Undo Last Change** takes back.

### What makes a note related?

| Signal | Example | Importance |
|---|---|---|
| Shared tag | Both entries contain `#project/atlas` | Strongest |
| Parent or child-heading context | Your selected entry sits under a `#project/atlas` parent heading, or a selected heading contains one | Useful, but lighter |
| Associated tag | `#project/atlas` and `#risk/vendor` are often written together | Supporting evidence |
| Entry Wiki link | An entry links to `[[Launch plan#Decision]]` | Small supporting evidence |
| Shared wording | Both entries use distinctive section wording | Adjusts an entry that qualifies another way; never enough alone, unless your note has no tags |

A note with both `#project/atlas` and `#follow-up` ranks ahead of one with only an associated `#risk/vendor` tag. Associations are normalized for support and tag prevalence, so common tags cannot dominate.

Terms on the **Debug related notes** page:

- **Source unit**: one tagged heading, tagged line, task, or heading relationship where a tag is observed; not necessarily a whole file.
- **Raw evidence**: an association's starting strength.
- **Normalized relevance**: raw evidence adjusted for repeated support and how common each tag is.
- **BM25 lexical similarity** (also **BM-25**): a capped text match that weights distinctive shared words over common ones.

The full model is in the [Related Notes association and ranking reference](https://github.com/doctorallen/deckard/blob/master/docs/related-notes-associations.md).

### Focus one note entry

Tagged headings highlight their section; tagged lines and tasks highlight their line. Hover one and choose **Show related notes for [entry]**. The sidebar shows **Selected entry** and the source note, and ranks by the entry's tags first, then tagged parent headings, and for a heading, tagged child headings and child items, as lighter context that decays with distance. Each active tag is listed with a **Rail** marker for its contribution and a count of notes and tasks; hover it for its exact weight. **Show whole document** returns to the normal view.

### Understand a score

Each result has a three-step rail for a strong, moderate, or weak relation. Select it, or use the keyboard, to see the exact score, signals, and weights. For the full calculation, hover a tagged entry and choose **Debug related notes for [entry]**, which shows where each tag came from, heading paths, daily-note context, association support and prevalence, link evidence, lexical terms, recency, and specificity.

### Refine a search from the sidebar

While a [search page](search-pages.md#search-pages) or the Task board is active, the Context sidebar shows that search's [Refine](search.md#refine) options instead. The page keeps its search, terms, and counts; remove terms in its search box. Related tags are listed by how many results carry them, each with a three-step rail; hover for **In 6 of 13 results.** and how often the tags were written together or shared a heading.

- Select a value to add it to the search.
- <kbd>Alt</kbd>-select it to leave those results out.
- <kbd>Shift</kbd>-select it to allow it beside the value of the same kind already chosen.
- Select the open icon beside a related tag to open its page in a new tab.

The page shows one Refine line while the sidebar holds the options, and its full Refine box when the sidebar closes. A Markdown editor brings related notes back.

## Notes Graph

Run `Deckard: Open Notes Graph`, or select the graph icon next to the Dashboard icon in the Context view. Notes and tasks are dots sized by everything each is joined to, grouped into communities by links, headings, and tags. The graph is read-only, and control choices persist per panel.

![Deckard Notes Graph showing clustered note, task, and tag connections.](../images/notes-graph.png)

- **Navigate.** Scroll to zoom, drag empty space to pan, and drag a dot to rearrange its cluster. **Fit** reframes the graph.
- **Select.** Hover a dot to highlight its neighbors and see what joins it, such as `atlas.md:12 · 4 wiki links · 2 headings · 7 tags` or `Tag · on 42 notes and tasks · 5 related tags`. Select a dot to list its connected nodes in the sidebar (**Connected nodes**, shown only while the graph is active). Select the top sidebar item to open it; select another to move the selection, or Cmd/Ctrl-click to open it. Cmd/Ctrl-click a dot to open it, or Alt-click to open it beside the graph. Selecting empty space clears the selection. From the keyboard, Tab to the graph and use the arrow keys to select a dot; Enter or Space opens it, Alt+Enter beside the graph, and Escape clears the selection.
- **Focus.** With a note open, the graph starts around it, one hop out, and follows the editor. Clear **Around this note** for the whole graph. **Hops out** sets the reach: one hop is the note, its tags, and the notes it links to; two adds what those touch, including tags usually written with yours. The line beneath names the note and counts the nodes on screen. **Pass through daily notes**, on by default, hides daily, weekly, and monthly notes but still counts them as a hop. The tag checklist narrows to the neighborhood's tags.
- **Labels.** At rest, the best-connected notes are named; zooming in names the rest. Groups of four or more are named after their most distinctive tags (`atlas · design`), or their best-connected note. Click a group name, or choose it from **Group**, to pick it out; the rest dim.
- **Lines**: solid for a wiki link you wrote, dashed for a heading and its sub-heading, dotted for a shared tag, dash-dot for a path through a daily note in a focused graph. The status line has a legend. **Only links I wrote** draws every wiki link and nothing else, and counts links and notes with none.
- **Filters** search titles and paths, restrict to selected tags, and toggle notes, tasks, tag nodes (off by default), and orphans. Parked notes and tasks, and tags only they carry, stay hidden until **Show parked** is on. **Clear filters** clears tag filters and the picked group.
- **Display** sets node size, link thickness, and **Label fade zoom**. **Headings**: **By zoom** (default) draws a multi-heading file as one dot until you zoom past **Label fade zoom**; **Always** draws every heading; **Never** every file. **Links per note** runs from **Fewer** to **More**. **Advanced** holds **Favor rare tags**, **Links between groups**, and **Show every link**. **Reset graph settings** restores controls, clears filters, and reframes; **Undo** beside it reverses that for a few seconds.
- **Forces** sets cluster centering, cluster cohesion, community spacing, repel strength, link strength, and link distance, live.

## Outline

Open **Outline** from the Deckard Activity Bar to see the active Markdown file's headings as a tree. Drag it into either sidebar.

![Deckard Outline listing a note's headings, with each heading's tags beside it.](../images/outline.png)

- Each heading shows its title, without markers or tags, and its own tags beside it. A heading of only tags shows those tags as its title.
- Untagged headings are kept for structure. Headings in fenced code blocks are ignored, and `Sprint #3` stays in the title. Underlined `Title`/`===` headings are not shown.
- **2/5** means two of five tasks under the heading are done, sub-headings included; **↩3** means links in other notes name it three times. Zen hides them, and `deckard.outline.showCounts` turns them off.
- The tree follows the file as you type.
- Select a heading to jump to it. Right-click a tagged heading for **Open the Tag's Search Page** and **Rename Tag**.
- The eye control sets whether the Outline follows the cursor; **Collapse all** is beside it.
- **Focus Section**, the target button on a heading (also in the editor's **Deckard** submenu and Note Actions), folds the rest of the note away. **Unfold All Sections** or moving to another note ends it. It needs `editor.folding` on.
- **Filter Outline by Tag…**, in the view title or a tagged heading's context menu, shows only headings with that tag or a tag under it (`#project` keeps `#project/atlas`), plus their parents. It stays until **Clear Outline Tag Filter**.

---

← [Home and Stats](home-and-stats.md) · [All topics](README.md) · [Daily notes, reviews, and the calendar](daily-notes.md) →
