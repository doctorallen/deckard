# Search pages and tag overviews

## Search pages

Every search opens a **search page** in its own tab; a tag's overview is the search page for that tag. Open one by Cmd/Ctrl-clicking a tag in the editor, selecting a tag anywhere Deckard shows one, searching from Home or [Find](search.md#find), or running `Deckard: Search Notes and Tasks`, `Deckard: Open a Tag's Search Page`, or `Deckard: Open Search Page`. A search already open comes forward. Parked notes and tasks are listed last, marked **Parked**.

![Deckard Tag Overview showing matching notes, active tasks, and display controls.](../images/tag-overview.png)

- **One tag is its overview.** The page's title is the tag or the entity it names, with its [hub note](#hub-notes) above the entries.
- **Anything more is a search.** Add another tag, words, or a condition such as `is:open`, and the title says **Search**; the [search box](search.md#the-search-box) and **Builder** show every filter. **Clear** returns to the original tag.
- **Refine** shows five values of each kind, with **+N more**. On a page of one tag, or tags joined by AND, it offers related **Tags** first.
- **Notes and Tasks** are two tabs or side by side. The Tasks list shows every task the search found, with checkboxes that update the Markdown.
- **Sort** notes alphabetically, by creation date, by update date, or by most accessed, under the search box.
- Each result shows three lines, or the paragraph holding the searched words after a muted **…**. **Show all** opens the rest. The gear's **Preview** chooses **None**, **3 lines**, or **Full**.
- Searched words are marked, and each result's header shows its file, line, and headings (folded in zen mode).
- **Paging.** Results show a page at a time with **Previous**, **Next**, page numbers, and the range (*271–300 of 3,760*). Notes and tasks page separately. **Per page** chooses 10, 30, 50, 100, or 200, starts at 30, and is remembered. Counts and Refine cover the whole search.
- **View options** (the gear): **Tabs** or **Side by side**, rendered or Markdown source (**Format** → Source, remembered), and one to four columns for notes and for tasks.
- **Save** keeps the search, then offers **Show Results on Home** (a widget of its results) or **Open Home**. A saved search of tags follows them when they are renamed.
- **Opening results.** Select an entry to jump to its heading. A click opens a preview tab, reused by the next result; a double-click keeps the tab; Cmd/Ctrl-click opens it beside the page. This also holds on the Task board, Home, Stats, and the Notes Graph, where Alt-click opens beside it.
- **‹** and **›** beside the gear, <kbd>Alt</kbd>+<kbd>←</kbd> and <kbd>Alt</kbd>+<kbd>→</kbd>, or the mouse's back and forward buttons move through the page's searches.

Opening a tag's page or a section records access for the access sort.

### Taking a search's results out

**Export**, beside **Bulk edit** on a search page and beside **Save** on the Task Board, copies or saves everything the search found as a Markdown table, a Markdown list of links, or CSV. With a search, it first offers **Copy as live query block**, which copies the search and its sort as a [query block](query-blocks.md#query-blocks). Nothing else leaves the machine.

### Editing a search's results

**Bulk edit**, beside a results pane's heading, makes one edit to everything the search found. Refine the search until the results are the ones you mean, then:

| Results | What can be done to them |
| --- | --- |
| Tasks | **Complete**, **Reopen**, **Set a due date**, **Add a tag** |
| Notes | **Add a tag**, written at the end of each heading line |

- Deckard lists the results, all chosen; unpick any to leave alone.
- Completing works as a checkbox does, including done dates and a repeating task's next occurrence.
- A tag goes at the end of the line, and a line that already has it is left alone.
- A task or heading edited since Deckard indexed it is skipped and counted.
- The edit is one write: [previewed](#previewing-and-undoing-a-write) when it reaches more than one note, and undone by `Deckard: Undo Last Change`.
- It applies to the whole search, not the page on screen. A page with no search of its own (every note) edits only the results shown.
- To move notes into a folder, use the Explorer; Deckard [carries their links along](organizing.md#renaming-notes-and-headings).

### Hub notes

A hub note describes a tag and opens at the top of its overview. Add `describes:` to the note's front matter:

```markdown
---
describes: project/atlas
status: active
owner: "@dana"
---
# Atlas

Migration of billing onto the new ledger.
```

- The `#project/atlas` overview shows the note first, with its other front-matter fields as properties. Tag values such as `@dana` open their own overviews. The hub's entries are not listed again below.
- Write the tag without `#`, or quote it; YAML reads an unquoted `#` as a comment. Quote people: `describes: "@dana"`. A list such as `describes: [project/atlas, proj/atlas]` describes several tags.
- An overview without a hub offers **Create hub note** under its title. It writes one to the notes folder, never overwriting a note, starting from a template named after the tag's namespace (such as `project.md`) if there is one; see [Templates](notes-and-links.md#templates).
- When several notes describe a tag, the first by path leads and the others are listed beneath it.
- Hovering the tag in the editor names its hub, renaming the tag updates `describes:`, and filtered and query views leave the hub out.
- Select the hub's title row to collapse or expand it until the overview closes. `deckard.tagOverview.hubNoteExpanded` sets whether hubs start open (default: open).
- **Progress.** A tag with tasks shows a bar under its hub, and how far along they are: *2 of 6 done · 1 overdue · next due in 3 days*. **Show overdue** searches its overdue tasks. Its tasks are those a search for the tag finds, steps aside. The hub note says the same on its first line in the editor (`deckard.editor.hubProgress`), and Home's [Progress widget](home-and-stats.md) lists every project's.
- **Untagged mentions.** For a tag name of three letters or more, the page says how many entries write it as a plain word: *12 entries mention "atlas" without the tag.* **Show them** runs `text = atlas -#project/atlas`, without the hub, so **Bulk edit → Add a tag** can tag them. `@dana` counts "dana" the same way.
- **Hub links.** The page also lists entries and tasks that link to the hub note without the tag, marked *Links the hub note*, with a line under the hub: *Also listing 5 entries that link to Atlas plan without the tag.* **Leave them out** turns `deckard.tagOverview.includeHubLinks` off. While on, counts, tabs, pages, Bulk edit, and Export include them.

### The Hubs view

The **Hubs** view in the Deckard sidebar is a tree of your projects, people, and other topics, each with the notes about it filed underneath, like pages under pages in Notion's sidebar. A topic appears once it has a [hub note](#hub-notes). It starts collapsed; expand it, or drag it where you like.

```
HUBS
▾ People
  ▸ Dana Reyes
▾ Projects
  ▾ Atlas                    1 of 2 done
      Kickoff
    ▸ Ledger migration
      Vendor review
  ▸ Borealis
```

- Each tag namespace with a hub note heads a group: **Projects** for `#project/…`, **People** for `@` tags, and **Other tags** for a hub of a tag without one.
- Under each hub are the notes about its tag: those whose front matter or first heading carries it. A line that mentions the tag in passing, such as in a daily note, does not file its note there; the tag's page still finds it.
- A note can name its place outright with `up:` in its front matter, such as `up: "[[Ledger migration]]"` or a list of several. It is then filed only there, whatever its tags. A note named by `up:` that is no hub is listed under **Other notes**.
- A hub goes under another hub only when its `up:` names it, as a sub-project's does. The tags in a hub's own front matter, such as a team's `regulars:` or a person's `team:`, describe it and do not move it. A note about two projects is under both.
- Select a note to open it. A hub shows how far along its tag's tasks are, and its tag button opens the tag's page.
- **Breadcrumbs.** A note's first line says where it sits, such as **Projects › Atlas › Ledger migration › Cutover plan**, and opens the note above it. `deckard.editor.breadcrumbs` turns them off.

### Merging tags

Rename a tag to one that exists, or run `Deckard: Merge Tag…` and pick the tag to keep. Deckard shows how many entries each tag has, how many have both, and the kept tag's new total, and asks first: renaming back cannot separate them.

- Where both tags sit on the same heading, task line, or front-matter list, the old one is removed. Inside a sentence it is replaced.
- Favorites, access counts, Dashboard tag selections, and saved searches move to the kept tag, as they do on a plain rename.

### Previewing and undoing a write

Renaming a tag, merging tags, and renaming a heading rewrite notes you never opened.

- **Preview.** A write reaching more than one note opens in VS Code's refactor preview, each change under its note. Uncheck any to leave it out, then apply. Deckard reports only what landed.
- `deckard.previewWorkspaceWrites` sets when this happens: `severalNotes` (the default), `always`, or `never`.
- **Deckard: Undo Last Change** restores the notes from before that write, after saying how many. A note changed since, in the editor or on disk, is left alone and counted. A move made with **Move to…**, tasks carried forward, and a heading renamed with its links go back together or not at all: if one of their notes changed since, Undo puts nothing back and names that note, and works again once the note is as Deckard left it. Favorites and saved searches that followed a renamed tag move back.
- Only the last write is kept. For anything earlier, use version control.

Set `deckard.enableHeadingTagRelationships` to `false` to refine by the tags the results carry instead of by related tags.

---

← [Search](search.md) · [All topics](README.md) · [Query blocks](query-blocks.md) →
