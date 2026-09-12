# Sidebar UX Recommendations

This document turns the sidebar UX research into an implementation brief. It
covers both sidebar modes:

- **Related Notes**, while a Markdown document is active.
- **Tag Overview**, while a Deckard overview panel is active.

The sidebar should remain a compact, local-first view. It should explain what
it is showing, why the results are relevant, and how to change or undo the
current scope without sending the user to another panel.

## Problems to solve

The sidebar currently has several states that can be difficult to distinguish
in a narrow panel:

- A visible Markdown tab can coexist with no `activeTextEditor` while the
  sidebar webview has focus, causing the sidebar to report that no Markdown
  note is open.
- The native view title and webview heading can repeat the product name.
- Loading, stale context, no tags, no matches, and an actual lack of an active
  document need different messages.
- A result count, matching reason, and relevance details are not always
  available at the same level of the hierarchy.
- Combined Tag Overview filters need to be removable without reopening the
  Dashboard.
- Hover-only controls and focusable `article` cards do not provide the clearest
  keyboard or screen-reader interaction model.

These are scope and interaction problems, not ranking changes. The existing
ranking model, association evidence, and source navigation should remain
unchanged while the sidebar presentation is improved.

## Recommended information hierarchy

### Related Notes mode

```text
RELATED NOTES
Current document: 2026-08-14.md
  [active tags]
  [Show whole document]       only for a selected entry

Sort by [Relevance]
Related entries (N)

[entry title]                 [score]
Primary matching reason
source file / line
heading path
matching tags
```

The context block must identify whether the scope is the whole document or a
selected entry. When an entry is selected, show its source filename and make
the reset action explicit. The first visible reason should be short and
plain-language; the complete score breakdown should remain progressively
disclosed.

### Tag Overview mode

```text
TAG OVERVIEW
Focus tag AND [filter tag] [x] AND [filter tag] [x]
[Clear filters]

Associated tags                 collapsed by default
Matching notes (N)

[note title]
source file / line
matching tags
```

The active focus tag and every additional filter should appear together in one
context block. Each filter needs an individual remove action, and a clear-all
action should return to the unfiltered focus tag. Relationship and association
navigation should remain available, but secondary branches should be collapsed
until requested.

## Proposed behavior changes

### 1. Resolve context from the active tab, not only focus

The host should treat the selected editor tab as the source of truth when the
sidebar owns focus:

1. Prefer the active Markdown text editor when one is available.
2. If focus is in the sidebar, inspect the active tab input and resolve its
   visible Markdown text editor by URI.
3. Reject webview, custom-editor, notebook, terminal, and diff inputs unless
   they have an explicitly supported context.
4. Refresh on active-editor, selection, tab, and tab-group changes.
5. Parse current editor text for unsaved Markdown when the indexed snapshot has
   not caught up, while preserving indexed metadata when it exists.

The implementation should distinguish these states rather than silently
falling back:

| State | Meaning | User-facing message |
|---|---|---|
| `loading` | Index or context resolution is still pending | Loading related notes... |
| `noDocument` | No supported Markdown tab is selected | Open a Markdown note to see related entries. |
| `noTags` | A Markdown document is selected but has no indexed tags | This note has no tags yet. |
| `noMatches` | Tags exist but no other entry matches | No other notes share its tags. |
| `ready` | Results are available | Render the result list and count. |
| `stale` or `error` | Context or indexing failed after prior content was shown | Keep the prior content, show a compact status, and offer retry. |

The sidebar should never display a no-document message merely because the
webview currently has focus.

### 2. Make mode and scope unambiguous

Use one short native view title and one internal webview eyebrow. Do not repeat
the product name if VS Code already prefixes the view title. For example,
prefer `Related Notes` over `Deckard: Related Notes` when the host contributes
the `Deckard:` prefix.

The webview header should identify the mode, while the context block identifies
the document, selected entry, focus tag, and filters. Do not make users infer
scope from the result list alone.

### 3. Keep counts and reasons close to results

Show counts in section headings:

- `Related entries (N)` in Related Notes mode.
- `Matching notes (N)` in Tag Overview mode.

Show one primary reason beneath each Related Notes title, such as
`2 shared tags` or `Shared tag #project/vesper-nine`. Keep the complete
evidence list behind an explicit score control that works on focus and click,
not only hover.

The score control should:

- be a real `button`;
- expose an accessible name and description;
- update `aria-expanded`;
- point to a stable explanation with `aria-describedby`;
- remain within the sidebar bounds at narrow widths.

### 4. Make filters reversible

Tag Overview filters should be represented as compact, labeled chips. Each
chip needs:

- the canonical tag navigation action;
- a separate remove button;
- an accessible label naming the tag being removed.

`Clear filters` should be visible only when additional filters exist. Removing
the focus tag should promote the next remaining tag according to the existing
filter semantics rather than leaving an invalid empty filter array.

### 5. Use explicit interactive semantics

Replace semantically clickable `article` elements with an explicit interaction
model:

- Use a link when the result always navigates to a source location.
- Use a button when the result performs an action without navigation.
- Keep the source line, title, and tag controls as separate focusable targets.
- Do not make an entire card and its nested controls compete for the same
  keyboard interaction.

If cards remain composite, document their keyboard behavior and ensure Enter
and Space do not trigger navigation twice.

### 6. Improve announcements and focus retention

Do not make the whole application root an `aria-live` region while rerendering
the entire sidebar. Instead:

- add a small polite status region for count and state changes;
- preserve focus when a filter is removed or a score explanation is toggled;
- return focus to the next logical chip after removal;
- restore focus to the clear-filters or context control after a full reset;
- announce loading, no-results, and error transitions without interrupting
  normal reading.

This avoids losing keyboard position whenever a new snapshot arrives.

### 7. Keep narrow-panel and theme behavior deliberate

The layout should continue to work at narrow sidebar widths:

- wrap context chips instead of allowing horizontal overflow;
- constrain score explanations to the viewport;
- keep primary labels visible before secondary metadata;
- use compact vertical spacing only after the hierarchy is clear;
- verify all controls against each supported theme, especially LCARS cyan
  surfaces and dark-text overrides.

Native view/title menus should be considered for global actions such as Help,
Dashboard, and Create Daily Note. The webview should prioritize context and
results instead of spending its narrowest horizontal space on global toolbar
actions.

## Suggested implementation order

1. Introduce an explicit host-side context resolver and state model.
2. Add tab and visibility refresh coverage, including sidebar-focused Markdown
   tabs and unsaved documents.
3. Correct the native title/header naming and render context blocks for both
   modes.
4. Add counts, primary reasons, and keyboard-accessible score disclosure.
5. Add removable filter chips and clear-all behavior.
6. Replace composite card semantics with explicit links or buttons.
7. Replace the root live region with a status region and focus restoration.
8. Review narrow widths and every theme in the Extension Development Host.

## Acceptance criteria

- A Markdown tab remains represented in Related Notes when the sidebar has
  focus.
- Switching tabs updates the sidebar without requiring a trip through another
  editor.
- An unsaved Markdown document can provide its own tags and related results.
- The sidebar clearly distinguishes loading, no document, no tags, no matches,
  and ready states.
- Both modes identify their scope before showing results.
- Counts and one primary matching reason are visible without opening a tooltip.
- Score explanations are usable with keyboard focus and click.
- Every Tag Overview filter can be removed independently, and clear-all
  restores the unfiltered focus tag.
- Focus is retained or restored after snapshot rerenders.
- No control clips, loses contrast, or becomes unreachable in supported themes
  or narrow sidebar widths.

## Research basis

The recommendations are based on the existing sidebar audit in
`docs/related-notes-research.md` and the following guidance:

- [VS Code Sidebars UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/sidebars)
- [VS Code Views UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/views)
- [VS Code Webview UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/webviews)
- [WAI-ARIA Button Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/)
- [WAI-ARIA Tooltip Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/)
- [WCAG 2.2 Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [Nielsen Norman Group: Recognition Rather Than Recall](https://www.nngroup.com/articles/recognition-and-recall/)
- [Obsidian Backlinks](https://github.com/obsidianmd/obsidian-help/blob/master/en/Plugins/Backlinks.md)
- [Logseq: How to Filter Linked References](https://github.com/logseq/docs/blob/master/pages/How%20to%20filter%20linked%20references.md)
