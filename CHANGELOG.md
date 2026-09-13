# Changelog

## Unreleased

### Added

- **Notes Graph**: `Deckard: Open Notes Graph` (also available from a graph
  icon beside the Dashboard icon in Related Notes) opens a zoomable
  force-directed map of every indexed note, task, and tag connection, with
  Obsidian-style Filters, Display, and Forces panels, hover neighbor
  highlighting, click-to-select, sidebar-hover graph highlighting, and
  Cmd/Ctrl-click-through to source lines and tag overviews. Tag nodes act as
  separated cluster anchors. Each note or task receives a primary tag
  community with stronger local gravity, while secondary tags remain lighter
  cross-community bridges. Notes and tasks can be independently hidden from
  the Filters panel. While the graph tab is active, the sidebar lists direct
  connected notes, tasks, and tags using shared sidebar card styles; Markdown
  editors retain the existing Related Notes ranking. The selected-node header
  opens that node's note/task source or tag overview directly.
- Release preparation now derives semantic versions from Conventional Commit
  messages.
