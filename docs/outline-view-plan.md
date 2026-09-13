# Outline view — implementation plan

A per-document heading tree that lives in its own view, shows heading text
without the `#` markers and without inline tags, and shows each heading's tags
beside it. The user can drag it between the primary (left) and secondary
(right) sidebar exactly like VS Code's own Outline, because any contributed
view is draggable between containers — no API work is needed for that.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Rendering | **Native `TreeView`** (`deckard.outline`) | Free twisties, keyboard navigation, type-to-filter, `reveal()`, collapse-all, and drag-between-sidebars. This is the one Deckard surface where matching VS Code beats matching Deckard's theme. |
| Contents | **Headings only** | Every ATX heading, tagged or not, nested by level. Untagged headings stay in as structure so tagged children don't float to the root. |
| Freshness | **Live while typing** | Re-parse the active document with `indexer.parse()` on a debounced `onDidChangeTextDocument`. The workspace index still only updates on save; the outline does not depend on it. |

Consequence of the TreeView choice: tags render as `TreeItem.description`
(dimmed text after the label), not as themed `.tag-open` chips. Tag actions
move to the item's right-click menu. No webview is added, so
`npm run test:ui` is unaffected.

---

## 1. Where it lives

### `package.json` — view

Add a second view to the existing `deckard` container. No `"type"` key, which
is what makes it a native tree rather than a webview:

```json
"views": {
  "deckard": [
    { "id": "deckard.relatedNotes", "name": "Deckard", "icon": "resources/deckard.svg", "type": "webview" },
    { "id": "deckard.outline", "name": "Outline", "icon": "resources/deckard.svg", "contextualTitle": "Deckard Outline" }
  ]
}
```

VS Code gives `deckard.outline.focus` and the drag-to-either-sidebar behaviour
for free, and it remembers where the user dropped it.

> Alternative considered: contributing into the built-in `explorer` container
> so it sits next to VS Code's Outline. Rejected — it splits Deckard's views
> across two containers, and the user can drag it there themselves in two
> seconds.

### `package.json` — commands and menus

```json
"commands": [
  { "command": "deckard.outline.revealSection",   "title": "Deckard: Reveal Outline Section" },
  { "command": "deckard.outline.openTagOverview", "title": "Open Tag Overview…" },
  { "command": "deckard.outline.renameTag",       "title": "Rename Tag…" },
  { "command": "deckard.outline.toggleFollowCursor", "title": "Deckard: Follow Cursor in Outline", "icon": "$(selection)" }
],
"menus": {
  "commandPalette": [
    { "command": "deckard.outline.revealSection",   "when": "false" },
    { "command": "deckard.outline.openTagOverview", "when": "false" },
    { "command": "deckard.outline.renameTag",       "when": "false" }
  ],
  "view/title": [
    { "command": "deckard.outline.toggleFollowCursor", "when": "view == deckard.outline", "group": "navigation" }
  ],
  "view/item/context": [
    { "command": "deckard.outline.openTagOverview", "when": "view == deckard.outline && viewItem == deckardOutlineTagged", "group": "deckard@1" },
    { "command": "deckard.outline.renameTag",       "when": "view == deckard.outline && viewItem == deckardOutlineTagged", "group": "deckard@2" }
  ]
}
```

### `package.json` — settings

```json
"deckard.outline.showTags":       { "type": "boolean", "default": true,  "description": "Show each heading's tags beside it in the Deckard Outline." },
"deckard.outline.followCursor":   { "type": "boolean", "default": true,  "description": "Select the Deckard Outline heading containing the editor cursor." },
"deckard.outline.inheritedTags":  { "type": "boolean", "default": false, "description": "Include front-matter tags inherited by every heading in the Deckard Outline." }
```

`deckard.tagTitleDisplayMode` is deliberately **not** consulted: the outline
always strips tags from the label, because that separation is the feature.

---

## 2. Data model — pure and testable

New file `src/ui/state/outlineState.ts`, mirroring how `dashboardState.ts`
keeps projection logic out of the VS Code layer.

```ts
export interface OutlineNode {
  /** Stable across line shifts: slugged heading path plus sibling occurrence. */
  id: string;
  label: string;          // heading text, no '#' markers, no tags
  tags: TagReference[];   // headingTags, plus front matter when enabled
  level: number;          // 1–6
  line: number;           // section.startLine, one-based
  endLine: number;
  children: OutlineNode[];
}

export function buildOutline(
  file: ParsedFile,
  options: { personMarker?: string; inheritedTags?: boolean },
): OutlineNode[];
```

Construction:

1. `file.sections.filter((s) => !s.isInline)` — inline tagged entries and tasks
   are not headings and are out of scope for this pass.
2. Sort by `startLine`.
3. Nest with a level stack: pop while `top.level >= section.headingLevel`, then
   push. This tolerates skipped levels (`###` directly under `#`) the way VS
   Code's outline does. `section.parentSectionId` is also available and would
   work, but the stack needs no id lookups and no map.
4. `label = stripTags(section.heading, personMarker)`. `section.heading` is
   already the text after the `#` markers (`headingPattern` capture group 2),
   so nothing extra is needed to satisfy "the `#` from the headings don't need
   to be shown". `stripTags` is exported from `core/markdown/parser` and
   already leaves numeric hashes such as `#1` and dates alone.
5. `tags = section.headingTags ?? []`, plus `file.frontmatterTags` when
   `inheritedTags` is on.
6. `id`: `slug(labelPath).join('/')` with a `~n` suffix when a parent has
   several identically named children. Deliberately **not** `section.id`, which
   hashes `filePath:line:text` and therefore changes on every line shift —
   using it would reset expand/collapse state on each keystroke.

Everything above is a pure function of `ParsedFile`, so it is unit-testable
without the `vscode` module.

---

## 3. The provider

New file `src/ui/views/outlineTree.ts`.

```ts
export class OutlineTreeProvider
  implements vscode.TreeDataProvider<OutlineNode>, vscode.Disposable
```

State: `documentUri`, `roots: OutlineNode[]`, `parents: Map<string, OutlineNode>`
(built during construction so `getParent` is O(1)), and a debounce handle.

- `getChildren(node)` → `node ? node.children : this.roots`
- `getParent(node)` → `this.parents.get(node.id)` — **required** for `reveal()`
- `getTreeItem(node)`:

```ts
const item = new vscode.TreeItem(
  node.label,
  node.children.length
    ? vscode.TreeItemCollapsibleState.Expanded
    : vscode.TreeItemCollapsibleState.None,
);
item.id = node.id;
item.description = showTags ? node.tags.map((tag) => tag.label).join(' ') : undefined;
item.iconPath = new vscode.ThemeIcon('symbol-string');   // what Markdown headings use
item.contextValue = node.tags.length ? 'deckardOutlineTagged' : 'deckardOutlineHeading';
item.tooltip = new vscode.MarkdownString(
  `${'#'.repeat(node.level)} ${node.label}\n\n${node.tags.map((t) => '`' + t.label + '`').join(' ')}`,
);
item.command = {
  command: 'deckard.outline.revealSection',
  title: 'Reveal',
  arguments: [this.documentUri, node.line],
};
```

`revealSection` takes the **document URI**, not an indexed `filePath`, so
untitled and out-of-workspace Markdown files work. It opens via
`vscode.window.showTextDocument` + the same centre-on-line behaviour as
`openSourceAt`; factor that positioning out of `openSourceAt` into a small
`revealLine(editor, line)` helper both call, rather than duplicating it.

The tree is created in `extension.ts` so the view handle is available for
`reveal()` and the empty-state message:

```ts
const outline = new OutlineTreeProvider(indexer, tagPanels);
const outlineView = vscode.window.createTreeView('deckard.outline', {
  treeDataProvider: outline,
  showCollapseAll: true,
});
outline.attach(outlineView);
context.subscriptions.push(outline, outlineView);
```

Also add `outline` to the `ExtensionServices` interface and to `deactivate()`,
matching how every other service is torn down.

---

## 4. Freshness

Rebuild triggers, all funnelled into one `scheduleRebuild(document)`:

| Event | Delay |
| --- | --- |
| `onDidChangeActiveTextEditor` | immediate |
| `onDidChangeTextDocument` (active document only) | debounced 200 ms |
| `onDidSaveTextDocument` | immediate (cancels a pending debounce) |
| `onDidChangeConfiguration` for `deckard.personMarker`, `deckard.entityNamespaceAliases`, `deckard.outline.*` | immediate |
| `view.onDidChangeVisibility` → visible, while a rebuild was skipped | immediate |

Rebuild is `indexer.parse(document.uri, document.getText())` → `buildOutline`
→ `this.onDidChangeTreeData.fire()` (full refresh; the tree is small enough
that granular invalidation buys nothing). Skip the work entirely while the view
is not visible and set a dirty flag instead.

Gate on `isMarkdownFile(document.uri)` from `core/workspace/scanner`, not on
`isNotesFile` — the outline is a view of whatever Markdown file is open, even
one outside the configured notes folder. Non-Markdown editors leave the last
outline in place? No: clear it and set the message, so the tree never lies
about which file it is describing.

Empty states go on `TreeView.message`:

- no Markdown editor → `Open a Markdown file to see its outline.`
- Markdown with no ATX headings → `This file has no headings.`

---

## 5. Follow cursor and reveal

On `onDidChangeTextEditorSelection` for the active editor, when
`deckard.outline.followCursor` is on and `outlineView.visible`:

1. Find the deepest node whose `[line, endLine]` contains the cursor line.
2. `outlineView.reveal(node, { select: true, focus: false, expand: true })`.

No feedback guard is needed: a click reveals the node whose range already
contains the cursor, so the follow pass selects the same node and `focus:
false` keeps the tree from stealing focus. The follow is debounced at ~100 ms
so held arrow keys don't thrash `reveal`.

The title toggle is two commands sharing one handler — `enableFollowCursor`
and `disableFollowCursor` — because a `view/title` item takes its icon from
its command, so a single command cannot show both states. Both write the
setting at global scope and update the `deckard.outlineFollowCursor` context
key that decides which of the two is shown.

---

## 6. Tag interactions

Tags are dimmed text on the item, so the actions live in the right-click menu
(`contextValue === 'deckardOutlineTagged'`):

- **Open Tag Overview…** — one tag opens it directly; several show a
  `showQuickPick` of the heading's tags first. Calls the existing
  `tagPanels.show(tagKey)` through the same callback shape `SidebarNotesView`
  already uses, so the outline does not reach into `TagOverviewPanels` itself.
- **Rename Tag…** — same quick-pick step, then `renameIndexedTag(indexer, key)`.

Both commands receive the `OutlineNode` as their argument from the tree.

---

## 7. Edge cases to handle explicitly

| Case | Behaviour |
| --- | --- |
| Heading that is only tags (`## #project/atlas`) | `stripTags` returns empty. Fall back to the joined tag labels as the label and leave the description empty, so the row is never blank. |
| Duplicate sibling heading text | `~2`, `~3` … suffix on the node id only; the label is untouched. |
| Skipped levels (`###` under `#`) | Level stack nests it under the `#`. |
| Headings inside fenced code blocks | Already excluded — `findHeadings` takes `fencedLines`. This is strictly better than a naive regex outline and worth a line in Help. |
| Setext headings (`Title` + `===`) | Not shown. `headingPattern` is ATX-only, so this matches the rest of Deckard's indexing. Document as a known limitation. |
| Unsaved edits, and files outside the notes folder | Work, because the provider parses editor text and navigates by URI rather than by indexed `filePath`. An untitled buffer only appears once its name ends in `.md`, since `isMarkdownFile` reads the URI rather than the language mode. |
| Front matter | Already skipped by the parser. |
| Very large files | Full rebuild is linear and debounced; no incremental parsing needed. |
| View dragged to the secondary sidebar | Same provider instance, no change. Verify manually once. |

---

## 8. Files touched

| File | Change |
| --- | --- |
| `package.json` | `views` entry, 4 commands, `view/title` + `view/item/context` + `commandPalette` menus, 3 settings |
| `src/ui/state/outlineState.ts` | **new** — `OutlineNode`, `buildOutline` (pure) |
| `src/ui/views/outlineTree.ts` | **new** — `OutlineTreeProvider`, follow-cursor, rebuild scheduling |
| `src/ui/commands/navigation.ts` | extract `revealLine(editor, line)` from `openSourceAt`; add a URI-based reveal entrypoint |
| `src/extension.ts` | construct, `createTreeView`, register 4 commands, add to `ExtensionServices` + `deactivate` |
| `src/test/outline-tree.test.ts` | **new** — see below |
| `src/ui/webview/helpHtml.ts` | required by CONTRIBUTING: new user-facing feature |
| `README.md` | feature + the three settings |
| `CHANGELOG.md` | `feat:` entry (drives the minor version bump) |

Not touched: `test/ui/verifyWebviews.js`, `components.ts`, `themes.ts` — no
webview is added, so the layout contracts and component rules don't apply.

---

## 9. Testing

`src/test/outline-tree.test.ts`, in the style of the existing
`markdown-parser.test.ts`, driving `buildOutline` over fixture Markdown:

- nesting by level, including a skipped level
- `label` has no `#` markers and no tags; `tags` carries them instead
- a numeric hash (`## Sprint #3`) stays in the label
- a tags-only heading falls back to its tag labels
- a heading inside a fenced block is absent
- duplicate sibling headings get distinct ids
- ids are unchanged after inserting a blank line above the first heading
  (the collapse-state guarantee)
- front-matter tags appear only when `inheritedTags` is on

Provider-level checks worth an integration test in the same file: the tree
clears when the active editor is not Markdown, and `getParent` returns a chain
that terminates at a root (otherwise `reveal` silently does nothing).

Then: `npm run compile`, `npm test`, and a manual pass in the Extension
Development Host for drag-to-right-sidebar, follow-cursor, and collapse-all.

---

## 10. Suggested order

1. `outlineState.ts` + its tests — no VS Code surface yet, fastest feedback.
2. `package.json` view + `OutlineTreeProvider` with static-on-activation
   rebuild; confirm the tree appears and can be dragged to either sidebar.
3. Rebuild scheduling (live typing, save, config, visibility) + empty-state
   messages.
4. `revealSection` + `revealLine` extraction.
5. Follow cursor, the title toggle, `showCollapseAll`.
6. Tag context menu commands.
7. Help, README, CHANGELOG.

Steps 1–4 are the usable feature; 5–6 are the polish that makes it feel like
the built-in Outline.

---

## 11. Deliberately deferred

- **Tasks and inline tagged entries in the tree.** `buildOutline` takes the
  whole `ParsedFile`, so adding `file.tasks` and `isInline` sections under
  their heading later is an additive change behind a
  `deckard.outline.include` setting — no restructuring.
- **Sort by name / filter box.** VS Code's outline has them; add only if the
  position-ordered tree proves awkward in practice.
- **`DocumentSymbolProvider`.** Would put tag-stripped headings into
  breadcrumbs and Go-to-Symbol for free, but it also merges with the built-in
  Markdown provider and would show every heading twice. Revisit only if
  breadcrumbs become a real want.
- **Themed chips.** Would require the webview route; the trade was made
  knowingly in favour of native tree behaviour.
