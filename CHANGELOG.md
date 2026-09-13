# Changelog

## Unreleased

### Added

- **Outline**: a new **Outline** view beside Related Notes lists the active
  Markdown file's headings as a tree, and can be dragged into either the
  primary or the secondary sidebar like VS Code's own Outline. Heading markers
  and tags are removed from each title and the heading's own tags are shown
  beside it, so structure and labels read as two columns. Untagged headings are
  kept as structure, a heading written as nothing but tags shows those tags as
  its title, headings inside fenced code blocks are ignored, and a numeric hash
  such as `Sprint #3` stays in the title. The tree is built from editor text,
  so it follows the file as you type rather than waiting for a save. Selecting
  a heading jumps to its line, right-clicking a tagged heading offers **Open
  Tag Overview** and **Rename Tag**, and the eye control in the view title
  switches whether the Outline follows the cursor. `deckard.outline.showTags`,
  `deckard.outline.followCursor`, and `deckard.outline.inheritedTags` control
  what it shows.

- **Advanced filtering in Entity Overview**: the overview page now carries a
  Deckard query behind an **Advanced search** control, so a view is no longer limited to
  one intersection of tags. A query combines conditions with `AND`, `OR`,
  `NOT`, and parentheses — for example
  `(tag = #project/atlas AND tag = @ren-kade) OR (tag = #risk/vendor AND text ~ "elevator")`.
  Conditions can match `tag`, `text`, `task`, `kind`, `file`, `path`,
  `created`, and `updated`; a bare `#tag` or `@person` is a tag condition and a
  bare or quoted word is a text condition. Equality is written `=`, with `:` still accepted as a synonym. The query bar
  and each builder row's value field complete field names and the values that
  field accepts, and a visual builder edits the same query as OR groups of
  AND rows. Selecting a tag and adding a related tag from the sidebar is
  unchanged: those views still show their original tag chips, and a query that
  is only a tag intersection reopens as that ordinary overview. `Deckard:
  Search Notes and Tasks` opens a standalone query view, and **Save filter**
  now saves a query as well as a tag set.

- **Notes Graph**: `Deckard: Open Notes Graph` (also available from a graph
  icon beside the Dashboard icon in Related Notes) opens a zoomable
  force-directed map of every indexed note, task, and tag connection, with
  Obsidian-style Filters, Display, and Forces panels, hover neighbor
  highlighting, click-to-select, sidebar-hover graph highlighting, and
  Cmd/Ctrl-click-through to source lines and tag overviews. Tag nodes are
  rendered as separated virtual anchors. Notes and tasks are assigned to
  deterministic visual communities from structural and prevalence-adjusted tag
  evidence, while secondary tags remain lighter cross-community bridges. Notes
  and tasks can be independently hidden from
  the Filters panel. While the graph tab is active, the sidebar lists direct
  connected notes, tasks, and tags using shared sidebar card styles; Markdown
  editors retain the existing Related Notes ranking. The selected-node header
  opens that node's note/task source or tag overview directly. The graph also
  exposes connection density, tag prevalence bias, secondary bridge strength,
  and an all-links comparison toggle for experimenting with the
  prevalence-aware local backbone, plus visual community detection with
  virtual tag anchors, cluster cohesion and community spacing controls, and a
  Reset graph settings button that restores defaults, clears filters, and
  reframes the view.
- Release preparation now derives semantic versions from Conventional Commit
  messages.

### Changed

- Webview styling and page-script helpers are now shared from
  `src/ui/webview/components.ts` instead of being repeated per page, so one
  change reaches every panel. See [components.md](components.md). Pages
  previously carried their own copies that had drifted apart: the eyebrow
  label had five different treatments, borders were 1px on some pages and 2px
  on others, and half the pages declared only part of the design-token set.
  They now share one palette, one type scale, one set of controls, and one
  `.segmented` primitive for joined buttons.

### Fixed

- The Dashboard's index metrics are a horizontal three-up strip again, and its
  chamfered tiles, 1180px width and dashed header rule are back. Sharing the
  webview styles had replaced page layout wherever a page's selector matched a
  base one, which also flattened Help's two-column layout and widened the
  sidebar's padding. Each page now restates its own layout, and
  `npm run test:ui` checks those survive the cascade.

- Tag rows in the Dashboard's Tags tab now highlight their border on hover,
  matching notes, tasks, entities and saved views. They were the only row type
  without the treatment. Every openable row now shares one `.row` component,
  and `npm run test:ui` fails if a new one ships without it.

- The Related Notes sidebar now follows an advanced query. It previously kept
  projecting the tag the page was opened on, so applying a query left the
  sidebar showing stale notes.

- The advanced filter's completion list no longer preselects an entry, so
  pressing Enter in the query bar runs the query that was typed instead of
  silently accepting a completion. Tab still completes.
- A query that does not parse now reports its error while the page keeps
  showing the results of the last query that did, instead of emptying.
- Choosing a completion with the mouse applies it. Pressing the mouse on the
  list no longer moves focus out of the field, which previously committed the
  row and rebuilt it before the click could land.
- Editing a query no longer opens a second overview. A query that narrows to
  an intersection led by the page's own tag returns to its chips in place.

- Entity titles and namespace labels in the Dashboard and Entity Overview
  webviews are capitalized again. The word-boundary escape in their title
  formatter was consumed by the surrounding template literal, so
  `#project/skybridge-signal` rendered as `project: skybridge signal`.
