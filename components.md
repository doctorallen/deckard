# Deckard webview components

Every Deckard panel is a standalone HTML document built from a template
literal in `src/ui/webview/*Html.ts`. Nothing can be imported at runtime, so
anything shared between panels is shared as **text**: one style sheet and one
script, both produced by `src/ui/webview/components.ts` and interpolated into
each page.

That file is the single place to change a component. A page keeps only the
rules and behaviour that are genuinely its own.

```
components.ts   tokens, base stylesheet, shared page script, nonce, CSP
themes.ts       per-theme token overrides, applied after the base sheet
icons.ts        SVG assets shared between pages
```

## How a page is assembled

```ts
import { createNonce, getBaseCss, getComponentScript } from './components';
import { getDeckardTheme, getDeckardThemeCss } from './themes';

const nonce = createNonce();
const csp = getContentSecurityPolicy(webview.cspSource, nonce);
```

```html
<style nonce="${nonce}">${getBaseCss()}
  /* only what is specific to this page */
  ${getDeckardThemeCss(getDeckardTheme())}
</style>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
${getComponentScript()}
  /* only what is specific to this page */
}());
</script>
```

Cascade order matters and is always the same: **base sheet → page rules →
theme sheet.** A page overrides a component by restating the rule after
`getBaseCss()`; a theme overrides tokens for everyone.

**A page keeps its own layout.** The base sheet and a page use the same
selector names — `main`, `header`, `.metrics`, `.cards` — so a base rule can
silently replace page layout that merely shares a name with it. Deleting a
page's `main` rule because the base has one is how the Dashboard's three-up
metric strip became a vertical column. Each page therefore ends with a short
layout block restating its own proportions, and `npm run test:ui` asserts
those survive the cascade (see **Layout contracts**).

---

## Design tokens

`getDesignTokens()` declares the whole palette on `:root`. Every page gets
every token, so a component can rely on any of them being defined. Themes
re-declare the same names.

| Token | Default | Use |
| --- | --- | --- |
| `--bg` / `--bg-dark` | `#050608` | Page background |
| `--panel` / `--panel-bg` | `#0D1017` | Card and row surfaces |
| `--panel-raised` | `#121620` | Hover and menu surfaces |
| `--panel-deep` | `#050608` | Control and inset surfaces |
| `--text` | `#D9E0E4` | Body text |
| `--muted` | `#7D8792` | Secondary text |
| `--line` / `--slate-border` | `#212936` | Default borders |
| `--line-strong` | `#34445A` | Structural rules |
| `--cyan` / `--cyan-bright` | `#00E5FF` | Links, titles, focus |
| `--green` / `--toxic-green` | `#33FF33` | Positive values, metrics |
| `--amber` / `--amber-bright` | `#FFB000` | Accents, hover, eyebrows |
| `--amber-dim` | `#7A5400` | Muted accent |
| `--favorite-red` | `#D23C28` | Favourite marker |
| `--warning-orange` | `#FF5500` | Warnings |
| `--slate-olive` | `#3E4A42` | Secondary chrome |
| `--grid-line` | `rgba(0,229,255,.04)` | Backdrop grid |
| `--font-display` | VS Code UI font | Interface text |
| `--font-mono` | VS Code editor font | Headings, code, data |
| `--edge` | `2px` | Standard border width |
| `--control-height` | `30px` | Standard control height |

**Paired tokens are not synonyms.** `--amber` and `--amber-bright` share a
default, but themes pull them apart — Synthwave makes `--amber` pink and
`--amber-bright` orange. Pick the one that matches intent, not the one that
happens to look right in Replicant.

Use `--edge` and `--control-height` rather than literal `2px` / `30px` so
density can be changed in one place.

---

## Layout

### `body`, `main`, `header`

Provided by `getShellCss()`. `body` carries the grid backdrop and base font;
`main` is a centred 1000px column with 24px padding; `header` is a flex row
with a `--line-strong` rule beneath it. Below 700px, `main` tightens to 16px
and `header` stacks.

A page that is not a scrolling document overrides these after the base sheet —
the notes graph does exactly that to go full-bleed.

---

## Typography

`getTypographyCss()`. All of these use `--font-mono`.

| Class / element | Purpose |
| --- | --- |
| `h1` | Page title. 22px, uppercase, wraps anywhere. |
| `h2` | Section heading. 14px. |
| `h3` | Sub-heading. 13px. |
| `.eyebrow` | The small amber label above a title, e.g. `DECKARD / SEARCH`. |
| `.lead` | Introductory paragraph, muted, capped at 680px. |
| `.source` | File and line beneath a card title. Muted, 11px. |

To make an element read as data rather than prose, add it to a page-local
`font-family: var(--font-mono)` rule; do not restate the whole type scale.

---

## Controls

`getControlCss()`. `button`, `select`, `input[type="text"]` and
`input[type="search"]` all share one height, border, hover and focus
treatment, so a toolbar reads as one row of controls.

| Class | What it is |
| --- | --- |
| `.toolbar` | Right-aligned wrapping row of controls. `.toolbar label` styles an inline control label. |
| `.control-row` | Left-aligned wrapping row of controls. |
| `.segmented` | **A row of buttons that reads as one control.** Collapses the borders between children and rounds the outer corners. |
| `.icon-button` | A square icon-only control at `--control-height`. |
| `.toolbar-icon` | 16px stroked SVG inside a control. `.settings-icon` switches it to filled. |
| `.view-options` | The gear `<details>` disclosure and its `.view-options-menu` / `.view-options-group` panel. |
| `.filter-count` | Small muted count inside a filter button. |

### `.segmented`

Any group of joined buttons uses this, rather than each page restyling
`button + button`:

```html
<div class="segmented task-filter-toggle" role="group" aria-label="Task status">
  <button class="active">All</button>
  <button>Open</button>
  <button>Done</button>
</div>
```

Mark the current button `.active`; the primitive raises it above its
neighbours so its border is not clipped. The second class carries only what is
specific to that group.

Used by: the task filter, the layout and format toggles, the overview tabs, and
the tag-association view switch.

---

## Tags

`getTagCss()` plus the render helpers below. A namespaced tag always dims its
`#namespace/` prefix so the value stays the readable part.

| Class | What it is |
| --- | --- |
| `.tag-open` | A tag rendered as a control that opens its overview. |
| `.inline-tag` | A tag inside a heading or task title, sized to the text around it. |
| `.tag-list` | Wrapping row of tags. |
| `.tag-namespace` | The dimmed `#namespace/` prefix. Emitted by `renderTagLabel`. |
| `.tag-context-menu` | The right-click menu, positioned by `openTagContextMenu`. |

---

## Surfaces

`getSurfaceCss()`.

| Class | What it is |
| --- | --- |
| `.row` | **Any content row a reader can open.** Border, amber hover border, cyan focus ring. `.card` and `.task` are built on the same rule. |
| `.cards` | Grid of cards, 12px gap. |
| `.card` | A `.row` with 14px padding, for a note or result. `.card-title` is its heading. |
| `.task` | A `.row` laid out as a 24px checkbox column plus content. `.task-title`, `.task.completed`, `.task-summary`. |
| `.task-filter-icon` | The list / open-box / checked-box icons, from `taskFilterIcon()`. |
| `.metrics`, `.metric` | Auto-fitting grid of stat tiles with `.metric-label` and `.metric-value`. |
| `.empty` | Dashed empty state. Always says what is missing and why. |
| `.markdown` | Raw Markdown source, amber left rule. |
| `.rendered` | Rendered Markdown body. |

### `.row`

Every openable row uses this, so none of them can quietly ship without the
hover and focus treatment the others have:

```html
<div class="row tag-row" tabindex="0">…</div>
<article class="card note-row">…</article>
```

The second class carries only what is specific to that row — its grid, its
padding, its chamfered corners. The shared class carries the surface.

Used by: cards, tasks, and the dashboard's tag, entity, note, task and
saved-view rows. `npm run test:ui` fails if one of those renders without it.

---

## Page script helpers

`getComponentScript()` is inserted into each page's `<script>` immediately
after `acquireVsCodeApi()`, so these are ordinary functions in that scope.

| Function | Purpose |
| --- | --- |
| `escapeHtml(value)` | Escape snapshot data before inserting it as HTML. **Every** value from the host goes through this. |
| `renderTagLabel(label, svg)` | Render a tag's text with a dimmed namespace. Pass `svg: true` for `<tspan>` output inside an SVG node. |
| `renderTagButton(tag, className)` | A complete `.tag-open` control that posts `openTag`. |
| `renderInlineTitle(title, tags, appendMissing)` | Replace tag tokens inside a title with controls, keeping their position. `appendMissing: false` suppresses trailing tags. |
| `renderTaskTitle(html, tags)` | Decorate tags inside already-rendered Markdown without re-escaping it. |
| `formatEntityTitle(kind, name)` | `project` + `skybridge-signal` → `Project: Skybridge Signal`. |
| `taskFilterIcon(filter)` | The `all` / `active` / `completed` icons. |
| `installTagContextMenu(onAction)` | Wire right-click actions for every `[data-tag-key]` on the page. Calls back with `(action, tagKey)`. |

### Host-side helpers

| Function | Purpose |
| --- | --- |
| `createNonce()` | One nonce per page, gating its inline style and script. |
| `getContentSecurityPolicy(cspSource, nonce, options)` | The shared CSP. `{ images: true }` adds `img-src`, `{ fonts: true }` adds `font-src`. |

---

## Conventions

- **Escape everything from the host.** Snapshot values are data, not markup.
- **Post intent, do not mutate.** A control carries `data-action` and posts a
  message; the host decides and sends new state back. Pages re-render from
  that state rather than editing the DOM in place.
- **A visible label is the accessible name.** Do not add an `aria-label` that
  duplicates or contradicts button text; use `title` for the longer
  explanation.
- **Backslashes in `getComponentScript()` are written doubled.** The string is
  interpolated into a template literal, so `\\s` is what reaches the browser
  as `\s`. This is not theoretical — it has silently broken regexes before,
  and the compiler cannot see it.

## Verifying a change

```
npm run test:ui     # renders every webview and checks the guarantees below
npm run test:e2e    # drives the overview host, script and sidebar together
```

### Layout contracts

`LAYOUT_CONTRACTS` in `test/ui/verifyWebviews.js` names the properties that
decide how each page is laid out — the Dashboard's `repeat(3, …)` metric
strip, Help's two-column `main`, the sidebar's 12px padding — and checks the
value each one ends up with after the whole cascade. Add a contract when a
page depends on layout that a base rule could plausibly override.

`test/ui/verifyWebviews.js` renders all seven pages and fails if any page:
stops rendering, emits a script that does not parse, is missing the design
tokens, carries more than one nonce, declares more than one `:root`,
redeclares a helper the shared script already owns, renders a content row
without a shared surface class, or loses one of its layout contracts.

Because the webviews are strings, the compiler cannot check any of this. Run
these two after touching `components.ts`.

## Adding a component

1. Add the rule to the matching section of `components.ts` and the helper to
   `getComponentScript()` if it needs behaviour.
2. Delete the local copies from every page that had one.
3. Document it in the table above.
4. Run `npm run test:ui` and `npm run test:e2e`.

If only one page will ever use it, leave it in that page. A component earns
its place here when a second page needs it.
