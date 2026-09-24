/**
 * Shared building blocks for every Deckard webview.
 *
 * Each webview is a self-contained HTML document, so anything they have in
 * common has to be shared as text rather than as modules the browser can
 * import. This file is that shared layer: one design-token set, one style
 * sheet for the elements every page uses, and one script of the helpers the
 * page scripts all need.
 *
 * A page keeps only the styles and behaviour that are genuinely its own.
 * Changing a component here changes it everywhere.
 */

import * as vscode from 'vscode';
import { helpIcon, settingsIcon } from './icons';
import { getDeckardTheme, getDeckardThemeCss } from './themes';
import { isZenModeEnabled } from './zenMode';

/**
 * The palette every webview starts from.
 *
 * Themes in `themes.ts` re-declare these after the base sheet, so a token may
 * only be introduced here. Several pairs look like aliases at their default
 * values — `--amber` and `--amber-bright` are both #FFB000 — but themes
 * deliberately pull them apart, so they are separate tokens, not synonyms.
 */
export function getDesignTokens(): string {
  return `
:root {
  color-scheme: dark;
  --bg: #050608;
  --bg-dark: #050608;
  --panel: #0D1017;
  --panel-bg: #0D1017;
  --panel-raised: #121620;
  --panel-deep: #050608;
  --text: #D9E0E4;
  --muted: #7D8792;
  --line: #212936;
  --slate-border: #212936;
  --line-strong: #34445A;
  --cyan: #00E5FF;
  --cyan-bright: #00E5FF;
  --green: #33FF33;
  --toxic-green: #33FF33;
  --amber: #FFB000;
  --amber-bright: #FFB000;
  --amber-dim: #7A5400;
  --favorite-red: #D23C28;
  --warning-orange: #FF5500;
  --slate-olive: #3E4A42;
  --grid-line: rgba(0, 229, 255, .04);
  --font-display: var(--vscode-font-family, ui-sans-serif, sans-serif);
  --font-mono: var(--vscode-editor-font-family, ui-monospace, monospace);
  --edge: 2px;
  --control-height: 30px;
  /* The corner a control takes. The ends of a group of segments follow it,
     so a theme that squares its buttons squares the group too. */
  --control-radius: 2px;
  /* What a control looks like while it is hovered, pressed, or active. A
     theme re-declares the pair, never one half, so the text stays readable
     on whatever the background becomes. */
  --hover-bg: #121620;
  --hover-fg: #FFB000;
  /* What a chosen segment looks like: the tab, filter, or option in force.
     A theme re-declares the pair, never one half. */
  --chosen-bg: #FFB000;
  --chosen-fg: #050608;
}`;
}

/**
 * The page shell: reset, the grid backdrop, and the document rhythm.
 *
 * A page that is not a scrolling document — the notes graph — overrides
 * `body` and `main` after this.
 */
export function getShellCss(): string {
  return `
* { box-sizing: border-box; }
body {
  margin: 0;
  min-width: 280px;
  background-color: var(--bg);
  background-image:
    linear-gradient(var(--grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
  background-size: 24px 24px;
  color: var(--text);
  font-family: var(--font-display);
  font-size: 13px;
}
main { position: relative; max-width: 1000px; margin: 0 auto; padding: 24px; }
header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 18px;
  padding-bottom: 16px;
  border-bottom: var(--edge) solid var(--line-strong);
}
@media (max-width: 700px) {
  main { padding: 16px; }
  header { align-items: start; flex-direction: column; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; scroll-behavior: auto !important; }
}`;
}

/**
 * Type scale shared by every page.
 */
export function getTypographyCss(): string {
  return `
h1, h2, h3, .eyebrow, .source, .metric-value, code, pre { font-family: var(--font-mono); }
h1 { margin: 0; color: var(--text); font-size: 22px; font-weight: 700; overflow-wrap: anywhere; text-transform: uppercase; }
h2 { margin: 0; color: var(--text); font-size: 14px; font-weight: 650; overflow-wrap: anywhere; }
h3 { margin: 0; color: var(--text); font-size: 13px; font-weight: 650; }
.eyebrow { margin: 0; color: var(--amber); font-size: 11px; letter-spacing: .15em; text-transform: uppercase; }
.lead { margin: 10px 0 0; max-width: 680px; color: var(--muted); }
.source { margin-top: 5px; color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }`;
}

/**
 * Form controls.
 *
 * Every control is the same height and carries the same border, hover, and
 * focus treatment, so a toolbar reads as one row of controls rather than a
 * collection of separately styled ones.
 */
export function getControlCss(): string {
  return `
button, select, input[type="text"], input[type="search"] {
  min-height: var(--control-height);
  border: var(--edge) solid var(--line);
  background: var(--panel-deep);
  color: var(--text);
  padding: 5px 9px;
  font: inherit;
}
button { cursor: pointer; }
button:hover, button.active, select:hover, .tag-open:hover {
  border-color: var(--amber);
  background: var(--hover-bg);
  color: var(--hover-fg);
}
/* A field being typed in keeps its own ground and its text: inverting it the
   way a pressed control inverts would recolor the text under the caret. */
input[type="text"]:focus, input[type="search"]:focus {
  border-color: var(--amber);
  background: var(--panel-deep);
  color: var(--text);
}
/* Anything inside a control follows the control's own text color, so a hover
   that flips the background cannot leave a count or an icon on top of it in
   a color chosen for the background it used to have. */
button:hover *, button.active *, button:focus-visible *,
.tag-open:hover *, .tag-open:focus-visible * {
  color: inherit;
}
button:focus-visible, select:focus-visible, input:focus-visible {
  outline: var(--edge) solid var(--cyan);
  outline-offset: 2px;
}
button[disabled] { opacity: .5; cursor: default; }
input[type="search"]::-webkit-search-cancel-button { cursor: pointer; }
/* The status node every page announces through. Off-screen, never hidden
   with display:none, which would stop it being announced at all. */
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  border: 0;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}
.toolbar { display: flex; justify-content: flex-end; gap: 6px; flex-wrap: wrap; margin-left: auto; }
.toolbar label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 11px;
  text-transform: uppercase;
}
.control-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

/* A labelled control, such as a sort, drawn the same way on every page. */
.control-label { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; color: var(--muted); font: 11px var(--font-mono); text-transform: uppercase; }
.control-icon { position: relative; display: inline-block; }
.control-icon-svg { position: absolute; z-index: 1; top: 50%; left: 8px; width: 14px; height: 14px; pointer-events: none; color: var(--text); transform: translateY(-50%); }
.control-icon select:hover + .control-icon-svg { color: var(--hover-fg); }
.control-icon select { padding-left: 29px; }

/* Notes and Tasks tabs over a set of results, on a page that lists both. */
.overview-tabs-row { margin-top: 20px; padding-bottom: 8px; border-bottom: 2px solid var(--line); }
.overview-tabs button { border-bottom-color: var(--line); }
.overview-tab-panel { margin-top: 12px; }

/* A row of buttons that reads as one control. */
.segmented { display: inline-flex; }
.segmented > * + * { margin-left: calc(var(--edge) * -1); }
.segmented > :first-child { border-radius: var(--control-radius) 0 0 var(--control-radius); }
.segmented > :last-child { border-radius: 0 var(--control-radius) var(--control-radius) 0; }
.segmented > .active { position: relative; z-index: 1; }

/* An icon-only control, square and the same height as the rest. */
.icon-button {
  display: inline-grid;
  width: var(--control-height);
  min-height: var(--control-height);
  place-items: center;
  padding: 5px;
}
.toolbar-icon { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; }
.settings-icon, .help-icon { fill: currentColor; stroke: none; }
.filter-count { color: var(--muted); font-size: 10px; }

/* Walking a list a page at a time: a search page's results, a widget's entries. */
.pagination { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin: 16px 0 0; border-top: 1px solid var(--line); padding-top: 10px; font-size: 12px; }
.page-summary { display: flex; align-items: center; gap: 12px; }
.page-range { color: var(--muted); font-family: var(--font-mono); }
.page-controls { display: flex; align-items: center; gap: 4px; }
.pagination button { min-width: 28px; border: 1px solid var(--line); background: var(--panel); color: var(--text); padding: 3px 8px; font: inherit; cursor: pointer; }
.pagination button:hover:not([disabled]) { border-color: var(--amber); background: var(--hover-bg); color: var(--hover-fg); }
.pagination button[disabled] { color: var(--muted); cursor: default; opacity: 0.5; }
.pagination .page-number.is-current { border-color: var(--chosen-bg); background: var(--chosen-bg); color: var(--chosen-fg); }
.page-gap { color: var(--muted); padding: 0 2px; }

/* A chosen segment, in any group of them: the Dashboard's tabs mark their
   own, and this marks every other group the same way, rather than leaving
   them with the inverted treatment a pressed button takes. */
.segmented button.active, .segmented button[aria-pressed="true"], .segmented button[aria-selected="true"] {
  border-color: var(--chosen-bg);
  background: var(--chosen-bg);
  color: var(--chosen-fg);
}
.segmented button.active *, .segmented button[aria-pressed="true"] *, .segmented button[aria-selected="true"] * {
  color: inherit;
}

/* The gear that holds a page's view options, drawn the same on every page. */
.view-options { position: relative; flex: 0 0 auto; }
/* The gear is a summary rather than a button, so it is given a control's
   ground here and joins the button selectors every theme restyles. The Help
   button beside it is already a button, and is left to those same rules. */
.view-options summary { display: grid; width: var(--control-height); min-height: var(--control-height); place-items: center; border: var(--edge) solid var(--line); background: var(--panel-deep); color: var(--text); padding: 5px; cursor: pointer; list-style: none; }
.view-options summary::-webkit-details-marker { display: none; }
.view-options summary:hover { border-color: var(--amber); background: var(--hover-bg); color: var(--hover-fg); }
.view-options summary:focus-visible { outline: var(--edge) solid var(--cyan); outline-offset: 2px; }
.view-options .settings-icon { width: 16px; height: 16px; }
.view-options-menu { position: absolute; z-index: 3; top: calc(100% + 5px); right: 0; display: grid; gap: 10px; min-width: 210px; padding: 10px; border: 1px solid var(--slate-border); background: var(--panel-raised); }
.view-options-group { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--muted); font: 11px var(--font-mono); text-transform: uppercase; }
/* A group whose control is taller than a row, such as a list, sits under its label. */
.view-options-group.is-stacked { display: grid; justify-content: stretch; }
/* A row of small numbered or named choices inside the menu. */
.view-options-choices { display: inline-flex; }
.view-options-choices button { min-width: 28px; min-height: 28px; padding: 4px 8px; }
.view-options-choices button + button { margin-left: -1px; }
.view-options-choices button:first-child { border-radius: var(--control-radius) 0 0 var(--control-radius); }
.view-options-choices button:last-child { border-radius: 0 var(--control-radius) var(--control-radius) 0; }
.view-options-choices button.active { position: relative; z-index: 1; }`;
}

/**
 * Tags, in every place a tag is shown.
 *
 * A namespaced tag always dims its `#namespace/` prefix so the value it
 * carries stays the readable part.
 */
export function getTagCss(): string {
  return `
.tag-list { display: inline-flex; flex-wrap: wrap; gap: 6px; margin: 0 0 0 8px; vertical-align: middle; }
/* A tag reads as written wherever it sits: text-transform inherits, so a
   heading or a control a theme shouts would otherwise shout the tag too. */
.tag-open, .inline-tag { text-transform: none; }
.tag-open { min-height: 26px; padding: 3px 7px; color: var(--cyan); font-size: 11px; text-align: left; }
/* A tag in a title opens that tag rather than controlling the view, so it is
   drawn as a hairline with no fill and no control height: the boxes a reader
   sees elsewhere mean "this changes what is listed". */
.card-title .tag-open, .note .tag-list button { min-height: 0; padding: 3px 7px; border: 1px solid var(--line); background: transparent; line-height: 1.35; }
.inline-tag {
  min-height: 24px;
  margin-left: 3px;
  padding: 2px 4px;
  font-size: .78em;
  vertical-align: 1px;
}
.tag-namespace { opacity: .62; }
/* How much a tag weighs, as a rail of three steps: Related Notes' active
   tags, and related tags in Refine. Empty steps are faint so filled ones read. */
.tag-weight-rail { display: inline-flex; flex: 0 0 auto; width: 4px; height: 11px; flex-direction: column; justify-content: space-between; pointer-events: none; }
.tag-weight-rail-segment { display: block; width: 4px; height: 3px; border-radius: 1px; background: var(--muted); opacity: .3; }
.tag-weight-rail-segment.filled { background: var(--cyan); opacity: 1; }
.task-title .inline-tag { color: var(--text); font: inherit; text-transform: none; }

/* Right-click actions on any tag. */
.tag-context-menu {
  position: fixed;
  z-index: 20;
  min-width: 150px;
  padding: 4px;
  border: var(--edge) solid var(--amber);
  background: var(--panel-raised);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .45);
}
.tag-context-menu[hidden] { display: none; }
.tag-context-menu button {
  display: block;
  width: 100%;
  border: 0;
  padding: 8px 9px;
  text-align: left;
  text-transform: none;
}`;
}

/**
 * Content surfaces: the cards, tasks, metrics, and empty states that make up
 * the body of every page.
 */
export function getSurfaceCss(): string {
  return `
/*
 * Any content row a reader can open: a card, a task, a tag, an entity, a
 * saved view. One rule gives them all the same border, hover and focus, so a
 * new kind of row cannot quietly ship without the treatment the others have.
 */
.row, .card, .task {
  min-width: 0;
  border: var(--edge) solid var(--line);
  background: var(--panel);
  cursor: pointer;
}
.row:hover, .card:hover, .task:hover { border-color: var(--amber); }
.row:focus-visible, .card:focus-visible, .task:focus-visible {
  outline: var(--edge) solid var(--cyan);
  outline-offset: 1px;
}
.row[hidden] { display: none; }

.cards { display: grid; gap: 12px; margin-top: 20px; }
.card { padding: 14px; }
.card[hidden], .task[hidden] { display: none; }
.card-title { margin: 0; color: var(--cyan); font-size: 16px; overflow-wrap: anywhere; }

.task {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  padding: 10px;
}
.task input { width: 16px; height: 16px; margin: 2px 0 0; accent-color: var(--green); }
.task-title { color: var(--cyan); overflow-wrap: anywhere; }
.task-title a { color: var(--cyan); }
.task.completed .task-title { color: var(--muted); text-decoration: line-through; }
.task-summary { display: grid; gap: 7px; }


.metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(135px, 1fr));
  gap: 10px;
  margin-top: 20px;
}
.metric { min-width: 0; border: var(--edge) solid var(--line); background: var(--panel); padding: 12px; }
/* A metric that opens what it counts keeps the tile's look, and gains the
   hover and focus treatment every other control has. The tile rules paint it,
   not the control ones, so it carries the text that belongs on a panel: a
   theme whose controls have a ground of their own writes their text for that
   ground, and on LCARS that is near-black, which the tile never becomes. */
.metric-open { display: grid; gap: 4px; justify-items: start; color: var(--text); text-align: left; font: inherit; cursor: pointer; }
.metric-open:hover, .metric-open:focus-visible { border-color: var(--amber); background: var(--panel-raised); color: var(--text); }
.metric-label { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; }
.metric-value { display: block; margin-top: 5px; color: var(--green); font-size: 22px; }

.empty {
  margin-top: 20px;
  border: var(--edge) dashed var(--line);
  background: var(--panel-deep);
  padding: 20px;
  color: var(--muted);
}

.markdown {
  margin: 14px 0 0;
  padding: 12px;
  overflow-x: auto;
  border: var(--edge) solid var(--line);
  border-left: 4px solid var(--amber);
  background: var(--panel-deep);
  color: var(--text);
  white-space: pre-wrap;
  font: 12px/1.55 var(--font-mono);
}
.rendered { margin-top: 14px; line-height: 1.55; overflow-wrap: anywhere; }
.rendered :first-child { margin-top: 0; }
.rendered :last-child { margin-bottom: 0; }
.rendered code, .rendered pre { font-family: var(--font-mono); }
.rendered pre { overflow-x: auto; padding: 10px; border: var(--edge) solid var(--line); background: var(--panel-deep); }
.rendered a { color: var(--cyan); }`;
}

/**
 * The task board: columns of task cards that move between columns. The Task
 * Board page and the Dashboard's board layout both draw it.
 */
export function getTaskBoardCss(): string {
  return `
.board {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(250px, 1fr);
  align-items: start;
  gap: 12px;
  padding-bottom: 12px;
  overflow-x: auto;
}
.board-column {
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
  border: var(--edge) solid var(--line);
  background: var(--panel-deep);
  padding: 10px;
}
.board-column.drop-target { border-color: var(--amber); }
.board-column-title {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin: 0;
  color: var(--cyan);
  font: 12px var(--font-mono);
  letter-spacing: .06em;
  text-transform: uppercase;
}
.board-column.is-overdue .board-column-title { color: var(--favorite-red); }
.board-count { color: var(--muted); }
/* A column with hundreds of tasks scrolls in place: without this one long
   column made the whole page hundreds of cards tall, and dragging to a far
   column meant scrolling away from both.

   The cards take a row of their own that is allowed to shrink — minmax(0, 1fr)
   rather than the automatic minimum, which is the content's own height. An
   auto row sizes to its cards however tall they are, so the column clipped
   them at its max-height and the cards below could not be reached at all. */
.board-column { max-height: calc(100vh - 220px); overflow: hidden; grid-template-rows: auto minmax(0, 1fr); }
.board-column-title { padding-bottom: 6px; }
/* overflow-y alone would compute overflow-x to auto, and then anything that
   reaches past the right edge — a theme's hover nudge, a focus outline — puts
   a horizontal scrollbar under a column that has nothing to scroll sideways. */
.board-cards {
  display: grid;
  align-content: start;
  gap: 8px;
  min-height: 48px;
  overflow-x: hidden;
  overflow-y: auto;
}
.board-card { position: relative; }
/* Themes slide a row right on hover, which reads well across a wide list and
   badly in a column this narrow: the card had nowhere to go but out. It keeps
   the border and ground the same hover gives every other surface. Written to
   outweigh the theme sheet, which is laid down after this one. */
.board-cards .board-card:hover { transform: none; }
.board-card.dragging { opacity: .45; }
.board-card .task-title { padding-right: 26px; }
.board-details { margin: 0; }
/* Each detail stays whole and the line wraps between them — unless a detail
   is wider than the column on its own, as "overdue, due Mon 2026-09-01" is
   under a theme's letter-spacing, in which case it breaks rather than
   widening every card in the column. An inline-block is that exactly: one
   unit to the line, that wraps inside only when it has to. */
.board-details span { display: inline-block; white-space: normal; }
.board-details .overdue { color: var(--favorite-red); }
/* The move menu sits in the corner so it never adds a row to the card. */
.board-move {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  padding: 0;
  appearance: none;
  border-color: transparent;
  background: transparent;
  color: var(--muted);
  font-size: 14px;
  line-height: 1;
  text-align: center;
  text-align-last: center;
  cursor: pointer;
}
/* The menu sits on the control ground once it is hovered, so it takes the
   shared hover text rather than the amber it carries over the card. */
.board-move:hover, .board-move:focus-visible { border-color: var(--amber); color: var(--hover-fg); }
.board-empty { margin: 0; padding: 12px; border: 1px dashed var(--line); color: var(--muted); font-size: 12px; text-align: center; }
.board-more { margin: 0; color: var(--muted); font-size: 11px; }`;
}

/**
 * A list of task rows, with their due dates and details, and the drag that
 * ranks them. The Dashboard's search results and the Task Board's list both
 * draw it.
 */
export function getTaskListCss(): string {
  return `
.task-list { display: grid; grid-template-columns: repeat(var(--task-columns, 1), minmax(0, 1fr)); gap: 7px; }
.task-row { position: relative; display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 8px; align-items: start; border: 1px solid var(--slate-border); clip-path: polygon(0 8px, 8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%); background: var(--panel-bg); padding: 10px; cursor: pointer; }
.task-row:focus-visible { outline: 1px solid var(--cyan-bright); outline-offset: 2px; }
.task-row input { width: 16px; height: 16px; margin: 2px 0 0; accent-color: var(--toxic-green); }
.task-row.completed .task-title { color: var(--muted); text-decoration: line-through; }
.task-meta { display: flex; gap: 8px; flex-wrap: wrap; color: var(--muted); font: 11px var(--font-mono); margin-top: 5px; }
.due-date { color: var(--toxic-green); font-weight: 700; letter-spacing: .03em; }
.due-date.overdue { color: var(--favorite-red); }
.task-detail { letter-spacing: .03em; }
.task-detail.priority-highest, .task-detail.priority-high { color: var(--favorite-red); font-weight: 700; }
.is-draggable { cursor: grab; touch-action: none; }
.is-draggable:active { cursor: grabbing; }
.is-dragging { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
.drag-ghost { position: fixed; z-index: 10; top: -10000px; left: -10000px; pointer-events: none; opacity: .95; border: 1px solid var(--amber-bright); background: var(--panel-raised); }
.drag-placeholder { border: 1px dashed var(--toxic-green); background: transparent; opacity: .9; pointer-events: none; }
.rank-context-menu { position: fixed; z-index: 20; min-width: 170px; padding: 4px; border: 1px solid var(--amber-bright); background: var(--panel-raised); box-shadow: 0 8px 24px rgba(0, 0, 0, .45); }
.rank-context-menu[hidden] { display: none; }
.rank-context-menu button { display: block; width: 100%; border: 0; padding: 8px 9px; text-align: left; text-transform: none; }
.result-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.result-table th, .result-table td { padding: 7px 9px; border-bottom: var(--edge) solid var(--line); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.result-table th { padding: 0; color: var(--muted); font: 11px var(--font-mono); letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; }
/* A header is the button that sorts by it, filling the cell so the whole label is the target. */
.result-table th button { display: flex; width: 100%; gap: 5px; align-items: center; min-height: 0; border: 0; padding: 7px 9px; background: transparent; color: inherit; font: inherit; letter-spacing: inherit; text-transform: inherit; text-align: left; }
.result-table th button:hover, .result-table th button:focus-visible { color: var(--hover-fg); background: var(--hover-bg); }
/* The sorted column is told by weight and its arrow, not a colour: amber on a panel is too faint for a small label in some themes.
   Hovered, it takes the hover pair like any other header, or it would be its own text on the hover ground. */
.result-table th.is-sorted button { color: var(--text); font-weight: 700; }
.result-table th.is-sorted button:hover, .result-table th.is-sorted button:focus-visible { color: var(--hover-fg); }
.result-table .result-check { width: 24px; padding-right: 0; }
.result-table .result-row { cursor: pointer; }
/* A hovered row shows it by its rule, as .row does; a ground under every cell would fail the muted ones. */
.result-table .result-row:hover td { border-bottom-color: var(--amber); }
.result-table .result-row:focus-visible { outline: var(--edge) solid var(--cyan); outline-offset: -1px; }
.result-table .result-row.completed .result-title { color: var(--muted); text-decoration: line-through; }
.result-table .result-title { color: var(--cyan); }
.result-table td.is-overdue { color: var(--favorite-red); font-weight: 700; }
.result-table td.is-muted { color: var(--muted); }
.result-table input[type="checkbox"] { width: 16px; height: 16px; margin: 0; accent-color: var(--toxic-green); }
/* The gear's column picker: one line per column, the title fixed. */
.table-columns { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; text-transform: none; }
.table-columns label { display: flex; gap: 6px; align-items: center; font: 12px var(--font-mono); }
@media (max-width: 720px) { .task-list { grid-template-columns: 1fr; } }`;
}

/**
 * The complete base sheet, in cascade order.
 *
 * A page includes this first, then its own rules, then the theme sheet.
 */
export function getBaseCss(): string {
  return [
    getDesignTokens(),
    getShellCss(),
    getTypographyCss(),
    getControlCss(),
    getTagCss(),
    getSurfaceCss(),
    getTaskBoardCss(),
    getTaskListCss(),
  ].join('\n');
}

/**
 * Zen mode: Deckard's own chrome, turned down.
 *
 * Every rule is scoped under `body.zen`, and the sheet ships whether or not
 * zen is on — only the class is conditional. That is deliberate. The layout
 * contracts in `test/ui/verifyWebviews.js` match a rule by its exact selector
 * string, so `body.zen .metric` is not `.metric` and cannot flip a contract;
 * and `test/ui/checkContrast.js` reads every declared rule whether or not the
 * page renders a match, so these get contrast cover across all eight themes
 * without a second render pass.
 *
 * Position still matters and is not replaced by the specificity: LCARS'
 * `.metric:nth-child(3n + 2)::before` ties with `body.zen .metric::before`, so
 * this has to come after the theme sheet. `getPageTailCss()` is what puts it
 * there.
 *
 * **This sheet declares no color, background, or border-color.** Only what it
 * takes to hide, thin, and fold. Under that rule the contrast matrix cannot
 * move, which is why the contrast check stays a single pass — a new signature
 * there means a color slipped in here.
 */
export function getZenCss(): string {
  return `
body.zen { --edge: 1px; --control-height: 26px; --grid-line: transparent; }
/* The token clears the base sheet's grid. It is not enough on its own:
   Cooper, Synthwave, Oblivion and Tomcat paint their own backdrop straight
   onto body with their own colors, so zen has to say this outright. */
body.zen { background-image: none; }
/* Ornament nothing refers to. The query hint goes; the parse error that
   shares its slot does not, or a failed search reads as an empty one. */
body.zen .eyebrow,
body.zen .metric::before,
body.zen .query-hint,
body.zen .refine-hint,
body.zen .home-hint-bar { display: none; }
/* Shrunk, never hidden: on a search page the h1 is the subject being
   searched, not a restatement of the tab, and it is the page's one landmark. */
body.zen h1 { font-size: 14px; letter-spacing: normal; text-transform: none; }
body.zen h2, body.zen h3, body.zen .metric-label { letter-spacing: normal; text-transform: none; }
/* The frame, thinned. */
body.zen .metric, body.zen .card, body.zen .note, body.zen .task,
body.zen .tag-row, body.zen .task-row, body.zen .note-row, body.zen .entity-row,
body.zen .saved-filter-row, body.zen .stat-row, body.zen .empty,
body.zen .view-panel, body.zen .board-column { clip-path: none; box-shadow: none; }
/* Several themes slide a row 3px on hover, which fits today only because the
   sidebar's main has 12px of padding to absorb it. Zen spends that padding. */
body.zen .row:hover, body.zen .card:hover, body.zen .note:hover,
body.zen .task:hover, body.zen .task-row:hover, body.zen .note-row:hover,
body.zen .tag-row:hover, body.zen .entity-row:hover,
body.zen .saved-filter-row:hover, body.zen .stat-row:hover { transform: none; }
/* Spacing. These literals mirror getShellCss, getSurfaceCss, getTaskBoardCss
   and getTaskListCss; there are no spacing tokens to lean on, so a change
   there needs a change here. The layout suite measures both. */
body.zen main { padding: 14px; }
body.zen header { padding-bottom: 10px; }
body.zen .cards { gap: 8px; margin-top: 12px; }
body.zen .card { padding: 9px; }
body.zen .task { gap: 6px; padding: 7px; }
body.zen .task-row { gap: 6px; padding: 7px; }
body.zen .task-list { gap: 4px; }
body.zen .task-summary { gap: 4px; }
body.zen .metrics { gap: 6px; margin-top: 12px; }
body.zen .metric { padding: 8px; }
body.zen .board-column { padding: 7px; }
body.zen .board-cards { gap: 5px; }
/* Provenance folds to hover and focus. Off-screen rather than display:none,
   so it stays in the accessibility tree, in find-in-page, and announced —
   the same idiom .is-dragging uses. Board details are not provenance: they
   carry the due date and the word "overdue", so they never fold. */
body.zen .task-row .task-source,
body.zen .card .source,
body.zen .note .source {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
body.zen .task-row:hover .task-source, body.zen .task-row:focus-within .task-source,
body.zen .card:hover .source, body.zen .card:focus-within .source,
body.zen .note:hover .source, body.zen .note:focus-within .source {
  position: static;
  width: auto;
  height: auto;
  overflow: visible;
  clip-path: none;
}`;
}

/**
 * What every page puts after its own rules: the theme, then zen. Kept in one
 * place so "zen comes after the theme" is a fact in the code rather than a
 * convention nine files have to remember.
 */
export function getPageTailCss(): string {
  return `${getDeckardThemeCss(getDeckardTheme())}\n${getZenCss()}`;
}

/** The marker `getZenCss()` hangs on, or nothing. */
export function zenBodyAttribute(): string {
  return isZenModeEnabled() ? ' class="zen"' : '';
}

/** Whether a settings change alters how a page is drawn rather than what it says. */
export function affectsPageChrome(event: vscode.ConfigurationChangeEvent): boolean {
  return (
    event.affectsConfiguration('deckard.theme') ||
    event.affectsConfiguration('deckard.zenMode')
  );
}

/**
 * Helpers every page script needs.
 *
 * This is inserted inside each page's own `<script>`, so the functions are
 * ordinary declarations in that scope rather than module exports.
 *
 * Note for editors: this string is interpolated into a template literal, so a
 * backslash meant for the output has to be written doubled here.
 */
export function getComponentScript(): string {
  return `
  /**
   * Say one short thing to a screen reader.
   *
   * A page rebuilds itself wholesale on every snapshot, so the page body must
   * not be a live region: it would re-announce the whole page on each index
   * update and each keystroke. Pages announce what actually changed here
   * instead, into the small status node every page carries.
   */
  function announce(message) {
    const status = document.getElementById('live-status');
    if (!status) return;
    const text = String(message || '');
    // Repeating the same string is not announced again, so clear it first.
    if (status.textContent === text) status.textContent = '';
    status.textContent = text;
  }

  /** Escape snapshot data before it is inserted as HTML. */
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Render a tag so its namespace reads as a prefix of its value.
   *
   * Pass svg to emit tspans for a label inside an SVG node.
   */
  function renderTagLabel(label, svg) {
    const value = String(label);
    const match = value.match(/^([#@][^/]+\\/)(.*)$/);
    if (svg) {
      return match
        ? '<tspan class="tag-namespace">' + escapeHtml(match[1]) + '</tspan><tspan class="tag-value">' + escapeHtml(match[2]) + '</tspan>'
        : '<tspan class="tag-value">' + escapeHtml(value) + '</tspan>';
    }
    return match
      ? '<span class="tag-label"><span class="tag-namespace">' + escapeHtml(match[1]) + '</span><span class="tag-value">' + escapeHtml(match[2]) + '</span></span>'
      : '<span class="tag-label"><span class="tag-value">' + escapeHtml(value) + '</span></span>';
  }

  /** Render a tag as a control that opens its overview. */
  function renderTagButton(tag, className) {
    return '<button class="tag-open ' + (className || '') + '" data-action="open-tag" data-tag-key="'
      + escapeHtml(tag.key) + '" aria-label="Open ' + escapeHtml(tag.label) + ' overview">'
      + renderTagLabel(tag.label) + '</button>';
  }

  /** The rail step a weight fills to: three for 0.75 and up, two from 0.375. */
  function getWeightLevel(weight) {
    const value = Number(weight);
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (value >= 0.75) return 3;
    if (value >= 0.375) return 2;
    return 1;
  }

  /** How much a tag weighs, as a rail of three steps filled to level. */
  function renderWeightRail(level, title) {
    let html = '<span class="tag-weight-rail"' + (title ? ' title="' + escapeHtml(title) + '"' : '') + ' aria-hidden="true">';
    for (let index = 0; index < 3; index += 1) {
      html += '<span class="tag-weight-rail-segment' + (index < level ? ' filled' : '') + '"></span>';
    }
    return html + '</span>';
  }

  /** Give built-in and user-created namespaces the same readable title form. */
  function formatEntityTitle(kind, name) {
    function formatPart(value) {
      return String(value)
        .replace(/[-_]+/g, ' ')
        .replace(/\\b[a-z]/g, function (character) { return character.toUpperCase(); });
    }
    return formatPart(kind) + ': ' + formatPart(name);
  }

  /** Replace tag tokens inside a title with controls, keeping their position. */
  function renderInlineTitle(title, tags, appendMissing) {
    const references = tags || [];
    const labels = references
      .map(function (tag) { return tag.label; })
      .filter(Boolean)
      .sort(function (left, right) { return right.length - left.length; });
    if (!labels.length) return escapeHtml(title);
    const pattern = new RegExp(labels.map(function (label) {
      return String(label).split('').map(function (character) {
        return '[]{}()|^$+*?.-'.indexOf(character) >= 0 || character === String.fromCharCode(92)
          ? String.fromCharCode(92) + character
          : character;
      }).join('');
    }).join('|'), 'g');
    let rendered = '';
    let offset = 0;
    const matchedKeys = new Set();
    title.replace(pattern, function (match, matchOffset) {
      rendered += escapeHtml(title.slice(offset, matchOffset));
      const tag = references.find(function (candidate) { return candidate.label === match; });
      if (tag) matchedKeys.add(tag.key);
      rendered += tag ? renderTagButton(tag, 'inline-tag') : escapeHtml(match);
      offset = matchOffset + match.length;
      return match;
    });
    const trailing = appendMissing === false ? '' : references
      .filter(function (tag) { return !matchedKeys.has(tag.key); })
      .map(function (tag) { return renderTagButton(tag, 'inline-tag'); })
      .join('');
    return rendered + escapeHtml(title.slice(offset)) + trailing;
  }

  /** Decorate tag text inside already-rendered Markdown without re-escaping it. */
  function renderTaskTitle(renderedTitle, references) {
    references = references || [];
    if (!references.length) return renderedTitle;
    const template = document.createElement('template');
    template.innerHTML = renderedTitle;
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(function (node) {
      if (node.parentElement && node.parentElement.closest('a, button')) return;
      const source = node.nodeValue || '';
      const replacementHtml = renderInlineTitle(source, references, false);
      if (replacementHtml === escapeHtml(source)) return;
      const replacement = document.createElement('template');
      replacement.innerHTML = replacementHtml;
      node.parentNode.replaceChild(replacement.content, node);
    });
    return template.innerHTML;
  }


  /**
   * Right-click actions for any element carrying a tag key.
   *
   * Call installTagContextMenu(post) once; it wires the listeners and calls
   * back with the chosen action and tag.
   */
  let tagContextMenu;
  let tagContextKey;

  function closeTagContextMenu() {
    if (tagContextMenu) tagContextMenu.hidden = true;
    tagContextKey = undefined;
  }

  /**
   * A menu where the pointer is, of whatever a page offers there. Each item
   * is { action, label } and posts its action through the page's handler.
   */
  function openContextMenu(event, items) {
    if (!items.length) return;
    event.preventDefault();
    closeTagContextMenu();
    if (!tagContextMenu) {
      tagContextMenu = document.createElement('div');
      tagContextMenu.id = 'tag-context-menu';
      tagContextMenu.className = 'tag-context-menu';
      tagContextMenu.setAttribute('role', 'menu');
      document.body.appendChild(tagContextMenu);
    }
    tagContextMenu.innerHTML = items.map(function (item) {
      return '<button type="button" role="menuitem" data-context-action="' + escapeHtml(item.action) + '">' + escapeHtml(item.label) + '</button>';
    }).join('');
    tagContextMenu.hidden = false;
    const bounds = tagContextMenu.getBoundingClientRect();
    tagContextMenu.style.left = Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8)) + 'px';
    tagContextMenu.style.top = Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8)) + 'px';
    tagContextMenu.querySelector('button').focus();
  }

  function openTagContextMenu(event, target) {
    const tagKey = target.dataset.tagKey;
    if (!tagKey) return;
    // Opening closes whatever was open, which lets go of the tag it was
    // about, so this menu's tag is remembered after that and not before.
    openContextMenu(event, [{ action: 'rename-tag', label: 'Rename tag' }]);
    tagContextKey = tagKey;
  }

  function installTagContextMenu(onAction) {
    document.addEventListener('contextmenu', function (event) {
      const target = event.target.closest('[data-tag-key]');
      if (target) openTagContextMenu(event, target);
    });
    document.addEventListener('click', function (event) {
      const chosen = event.target.closest('#tag-context-menu [data-context-action]');
      if (chosen) {
        const tagKey = tagContextKey;
        closeTagContextMenu();
        if (tagKey) onAction(chosen.dataset.contextAction, tagKey);
        return;
      }
      if (tagContextMenu && !event.target.closest('#tag-context-menu')) closeTagContextMenu();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && tagContextMenu && !tagContextMenu.hidden) closeTagContextMenu();
    });
  }

  /** The Status, Priority, and Due date switch above a task board. */
  function renderTaskBoardGroupSwitch(groupBy) {
    return '<div class="segmented task-board-group" role="group" aria-label="Group tasks by">'
      + [['status', 'Status'], ['priority', 'Priority'], ['due', 'Due date'], ['assignee', 'Person']].map(function (option) {
        const active = option[0] === groupBy;
        return '<button type="button" class="' + (active ? 'active' : '') + '" data-action="set-board-group" data-group="' + option[0] + '" aria-pressed="' + active + '">' + option[1] + '</button>';
      }).join('') + '</div>';
  }

  /**
   * Every edit a card can make, whatever the board is grouped by.
   *
   * The menu used to offer the columns of the current grouping alone, so
   * changing a due date meant regrouping the whole board first, and the most
   * common edits ended in the Markdown file instead.
   */
  function renderTaskCardMoves(card, columnId, columns, settings) {
    const option = function (value, label) {
      return value === columnId
        ? ''
        : '<option value="' + escapeHtml(value) + '">' + escapeHtml(label) + '</option>';
    };
    const group = function (label, options) {
      const body = options.join('');
      return body ? '<optgroup label="' + escapeHtml(label) + '">' + body + '</optgroup>' : '';
    };
    const statuses = (settings && settings.statuses) || [];
    const statusOptions = [option('status:', 'No status')].concat(statuses.map(function (status) {
      return option('status:' + status, status.charAt(0).toUpperCase() + status.slice(1).replace(/[-_]+/g, ' '));
    }));
    const priorityOptions = [['highest', 'Highest'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low'], ['lowest', 'Lowest'], ['', 'No priority']].map(function (entry) {
      return option('priority:' + entry[0], entry[1]);
    });
    const dueOptions = [['today', 'Due today'], ['tomorrow', 'Due tomorrow'], ['', 'No due date']].map(function (entry) {
      return option('due:' + entry[0], entry[1]);
    });
    const done = card.completed ? '' : option('done', 'Complete it');
    // Any column of the current grouping that is not one of the above, such
    // as a due band the board made, still moves the card.
    const others = columns.filter(function (column) {
      return column.droppable && column.id !== columnId
        && column.id.indexOf('status:') !== 0
        && column.id.indexOf('priority:') !== 0
        && column.id.indexOf('due:') !== 0
        && column.id !== 'done';
    }).map(function (column) { return option(column.id, column.label); });
    return group('Status', statusOptions)
      + group('Priority', priorityOptions)
      + group('Due', dueOptions)
      + group('This board', others)
      + (done ? group('Done', [done]) : '');
  }

  /** One task card, with its checkbox and the menu that edits it. */
  function renderTaskBoardCard(card, columnId, columns, settings) {
    const details = card.details.map(function (detail) {
      const overdue = card.overdue && detail.indexOf('due ') === 0;
      // Colour alone carried this before, which says nothing to a reader who
      // cannot see it, or on a board grouped by anything but due date.
      return '<span' + (overdue ? ' class="overdue"' : '') + '>' + escapeHtml(overdue ? 'overdue, ' + detail : detail) + '</span>';
    }).join(' · ');
    const plainTitle = String(card.title || '');
    return '<article class="task board-card' + (card.completed ? ' completed' : '') + '" draggable="true" tabindex="0"'
      + ' data-task-id="' + escapeHtml(card.taskId) + '" data-file-path="' + escapeHtml(card.filePath) + '" data-line="' + card.line + '">'
      + '<input type="checkbox" data-action="board-toggle-task" aria-label="' + escapeHtml((card.completed ? 'Reopen ' : 'Complete ') + plainTitle) + '" title="' + (card.completed ? 'Reopen' : 'Complete') + ' this task"' + (card.completed ? ' checked' : '') + '>'
      + '<div class="task-summary"><div class="task-title">' + renderTaskTitle(card.renderedTitle, card.titleTags) + '</div>'
      + '<p class="source board-details">' + details + '</p>'
      + '<select class="board-move" data-action="board-move" title="Change this task" aria-label="' + escapeHtml('Change ' + plainTitle + ': status, priority, or due date') + '"><option value="" selected hidden>⋯</option>' + renderTaskCardMoves(card, columnId, columns, settings) + '</select>'
      + '</div></article>';
  }

  /**
   * Draw a task board from the host's columns. isVisible, when given, hides
   * cards a page filters locally, such as by a search.
   */
  function renderTaskBoard(board, isVisible) {
    return '<div class="board task-board" aria-label="Task board">' + board.columns.map(function (column) {
      const cards = isVisible ? column.cards.filter(isVisible) : column.cards;
      const count = cards.length + column.hiddenCount;
      const body = cards.length
        ? cards.map(function (card) { return renderTaskBoardCard(card, column.id, board.columns, board.settings); }).join('')
        : '<p class="board-empty">' + (column.droppable ? 'Drop a task here' : 'No tasks') + '</p>';
      return '<section class="board-column' + (column.id === 'due:overdue' ? ' is-overdue' : '') + '"'
        + ' data-column-id="' + escapeHtml(column.id) + '" data-droppable="' + column.droppable + '"'
        + ' aria-label="' + escapeHtml(column.label + ', ' + count + (count === 1 ? ' task' : ' tasks')) + '">'
        + '<h2 class="board-column-title"><span>' + escapeHtml(column.label) + '</span><span class="board-count">' + count + '</span></h2>'
        + '<div class="board-cards">' + body + '</div>'
        + (column.hiddenCount ? '<p class="board-more"><button data-action="show-column-rest" data-column-id="' + escapeHtml(column.id) + '">Show ' + column.hiddenCount + ' more</button></p>' : '')
        + '</section>';
    }).join('') + '</div>';
  }

  /**
   * Wire every task board on the page, once. Listeners sit on the document,
   * so a page may redraw its boards freely. post receives openSource,
   * toggleTask, moveTask, and setBoardGroup messages. A dropped card moves at
   * once; the host's next state confirms it or puts it back.
   */
  let taskBoardDragId;

  function installTaskBoard(post) {
    function boardCard(target) {
      return target && target.closest ? target.closest('.task-board .board-card') : undefined;
    }
    function dropColumn(event) {
      const column = event.target && event.target.closest ? event.target.closest('.task-board .board-column') : undefined;
      return column && taskBoardDragId && column.dataset.droppable === 'true' ? column : undefined;
    }
    function clearDropTargets() {
      document.querySelectorAll('.board-column.drop-target').forEach(function (column) { column.classList.remove('drop-target'); });
    }
    function openCard(card) {
      post({ type: 'openSource', filePath: card.dataset.filePath, line: Number(card.dataset.line) });
    }

    document.addEventListener('click', function (event) {
      const group = event.target.closest('[data-action="set-board-group"]');
      if (group) {
        post({ type: 'setBoardGroup', groupBy: group.dataset.group });
        return;
      }
      const rest = event.target.closest('[data-action="show-column-rest"]');
      if (rest) {
        post({ type: 'showColumnRest', columnId: rest.dataset.columnId });
        return;
      }
      if (event.target.closest('input, select, button, a')) return;
      const card = boardCard(event.target);
      if (card) openCard(card);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && event.target.matches && event.target.matches('.task-board .board-card')) openCard(event.target);
    });
    document.addEventListener('change', function (event) {
      const card = boardCard(event.target);
      if (!card) return;
      if (event.target.dataset.action === 'board-toggle-task') {
        post({ type: 'toggleTask', taskId: card.dataset.taskId, completed: event.target.checked });
      }
      if (event.target.dataset.action === 'board-move' && event.target.value) {
        post({ type: 'moveTask', taskId: card.dataset.taskId, column: event.target.value });
      }
    });
    document.addEventListener('dragstart', function (event) {
      const card = boardCard(event.target);
      if (!card) return;
      taskBoardDragId = card.dataset.taskId;
      card.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', taskBoardDragId);
    });
    document.addEventListener('dragend', function (event) {
      const card = boardCard(event.target);
      if (card) card.classList.remove('dragging');
      clearDropTargets();
      taskBoardDragId = undefined;
    });
    document.addEventListener('dragover', function (event) {
      const column = dropColumn(event);
      if (!column) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (!column.classList.contains('drop-target')) {
        clearDropTargets();
        column.classList.add('drop-target');
      }
    });
    document.addEventListener('dragleave', function (event) {
      const column = event.target && event.target.closest ? event.target.closest('.board-column') : undefined;
      if (column && !column.contains(event.relatedTarget)) column.classList.remove('drop-target');
    });
    document.addEventListener('drop', function (event) {
      const column = dropColumn(event);
      if (!column) return;
      event.preventDefault();
      const card = document.querySelector('.task-board .board-card[data-task-id="' + CSS.escape(taskBoardDragId) + '"]');
      if (card && card.closest('.board-column') !== column) {
        const cards = column.querySelector('.board-cards');
        const empty = cards.querySelector('.board-empty');
        if (empty) empty.remove();
        cards.prepend(card);
        post({ type: 'moveTask', taskId: taskBoardDragId, column: column.dataset.columnId });
      }
      clearDropTargets();
    });
  }

  /**
   * The gear that holds a page's view options. groups is a list of
   * { label, html, stacked }, one row of the menu each. A menu that was open
   * before a redraw is open after it.
   */
  /**
   * The way to Help from any page. Help was reachable only from one icon in
   * the Related Notes sidebar, or the command palette, so the pages a reader
   * gets stuck on offered no route to it.
   */
  function renderHelpButton(anchor) {
    return '<button type="button" class="icon-button help-button" data-action="open-help"'
      + (anchor ? ' data-help-anchor="' + escapeHtml(anchor) + '"' : '')
      + ' aria-label="Open Help" title="Open Help">'
      + '${helpIcon}'
      + '</button>';
  }

  function renderViewOptions(groups) {
    const wasOpen = Boolean(document.querySelector('.view-options[open]'));
    return '<details class="view-options"' + (wasOpen ? ' open' : '') + '><summary aria-label="View options" title="View options">' + '${settingsIcon}' + '</summary>'
      + '<div class="view-options-menu">' + groups.map(function (group) {
        return '<div class="view-options-group' + (group.stacked ? ' is-stacked' : '') + '"><span>' + escapeHtml(group.label) + '</span>' + group.html + '</div>';
      }).join('') + '</div></details>';
  }

  /**
   * A row of choices for the gear's menu, such as List and Board. choices
   * is a list of [value, text, ariaLabel]. Each button carries data-action,
   * data-value, and any attributes given.
   */
  function renderViewOptionChoices(action, choices, selected, label, attributes) {
    return '<div class="segmented view-options-choices" role="group" aria-label="' + escapeHtml(label) + '">' + choices.map(function (choice) {
      const value = String(choice[0]);
      const active = value === String(selected);
      return '<button type="button" class="' + (active ? 'active' : '') + '" data-action="' + escapeHtml(action) + '" data-value="' + escapeHtml(value) + '"' + (attributes ? ' ' + attributes : '') + ' aria-pressed="' + active + '"' + (choice[2] ? ' aria-label="' + escapeHtml(choice[2]) + '"' : '') + '>' + escapeHtml(choice[1]) + '</button>';
    }).join('') + '</div>';
  }

  /**
   * The gear's zen row, the same on every page that has a gear. The current
   * state is read from the body class rather than from the page's snapshot,
   * so no page has to carry zen through its state builder.
   */
  function renderZenOption() {
    const enabled = document.body.classList.contains('zen');
    return {
      label: 'Zen',
      html: renderViewOptionChoices('set-zen-mode', [['off', 'Off'], ['on', 'On']], enabled ? 'on' : 'off', 'Zen mode'),
    };
  }

  /**
   * Close the gear's menu on a click outside it, and on Escape, handing focus
   * back to the gear. Call once, before the page's own listeners, so a click
   * that redraws the page is seen while its target is still in the menu.
   *
   * The zen row is handled here rather than by each page: it posts through
   * the shared vscode handle, and the host's own configuration listener
   * redraws the page, so a page needs no handler of its own.
   */
  function installViewOptions() {
    document.addEventListener('click', function (event) {
      const zen = event.target && event.target.closest ? event.target.closest('[data-action="set-zen-mode"]') : undefined;
      if (zen) {
        vscode.postMessage({ type: 'setZenMode', enabled: zen.dataset.value === 'on' });
      }
      const inside = event.target && event.target.closest ? event.target.closest('.view-options') : undefined;
      document.querySelectorAll('.view-options[open]').forEach(function (options) {
        if (options !== inside) options.open = false;
      });
    });
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      const options = document.querySelector('.view-options[open]');
      if (!options) return;
      options.open = false;
      options.querySelector('summary').focus();
    });
  }

  /** Writes a task timestamp as the YYYY-MM-DD form the note uses. */
  function formatTaskDate(timestamp) {
    const date = new Date(timestamp);
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  /**
   * One task in a task list: its checkbox, title, and where it is written.
   * item is a DashboardTask. options.draggable marks a row that can be
   * ranked; options.titleDisplay is the tagTitleDisplayMode.
   */
  function renderTaskListRow(item, options) {
    const task = item.task;
    const settings = options || {};
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const dueDate = task.dueText
      ? '<span class="due-date ' + (task.dueAt !== undefined && task.dueAt < startOfToday.getTime() ? 'overdue' : '') + '">DUE ' + escapeHtml(task.dueText) + '</span>'
      : '';
    const scheduled = task.scheduledAt !== undefined
      ? '<span class="task-detail">SCHEDULED ' + escapeHtml(formatTaskDate(task.scheduledAt)) + '</span>'
      : '';
    const priority = task.priority
      ? '<span class="task-detail priority-' + escapeHtml(task.priority) + '">' + escapeHtml(task.priority.toUpperCase()) + ' PRIORITY</span>'
      : '';
    const recurrence = task.recurrence
      ? '<span class="task-detail">REPEATS ' + escapeHtml(task.recurrence.toUpperCase()) + '</span>'
      : '';
    const title = settings.titleDisplay === 'separate' ? item.renderedTitle : renderTaskTitle(item.renderedTitle, item.titleTags);
    return '<div class="row task-row' + (task.completed ? ' completed' : '') + (settings.draggable ? ' is-draggable' : '') + '" draggable="false" tabindex="0" data-task-id="' + escapeHtml(task.id) + '" data-file-path="' + escapeHtml(task.filePath) + '" data-line="' + task.lineNumber + '">'
      + '<input type="checkbox" data-action="toggle-task" data-task-id="' + escapeHtml(task.id) + '" ' + (task.completed ? 'checked' : '') + ' aria-label="Toggle ' + escapeHtml(task.title) + '">'
      + '<div><div class="task-title">' + title + '</div><div class="task-meta">' + dueDate + scheduled + priority + recurrence + '<span class="task-source">' + escapeHtml(item.fileName) + '</span>' + (item.sectionHeading ? '<span class="task-source">' + escapeHtml(item.sectionHeading) + '</span>' : '') + '<span class="task-source">line ' + task.lineNumber + '</span></div></div>'
      + '</div>';
  }

  /**
   * The Notes and Tasks tabs over a search's results. tabs is a list of
   * { id, label, count }; each button carries data-action="set-result-tab".
   */
  function renderResultTabs(tabs, active, label) {
    return '<div class="overview-tabs-row"><div class="segmented overview-tabs" role="tablist" aria-label="' + escapeHtml(label) + '">' + tabs.map(function (tab) {
      const selected = tab.id === active;
      return '<button class="' + (selected ? 'active' : '') + '" data-action="set-result-tab" data-tab="' + escapeHtml(tab.id) + '" role="tab" aria-selected="' + selected + '">' + escapeHtml(tab.label) + ' (<span data-search-count="' + escapeHtml(tab.id) + '">' + tab.count + '</span>)</button>';
    }).join('') + '</div></div>';
  }


  /**
   * Rows a reader ranks by dragging them, or by Move to top and Move to
   * bottom on their context menu. Call once; listeners sit on the document,
   * so a page may redraw its rows freely.
   *
   *   kinds       { name: { selector, key, edgeLabels } }: a row's
   *               selector, the dataset key that names it, such as taskId,
   *               and optionally the menu's two labels, first then last
   *   canRank(kind)          whether rows of this kind can be ranked now
   *   reorder(kind, key, targetKey, before, placeholder)
   *               ranks key next to targetKey; returns true when it did
   *   move(kind, key, toTop) ranks key first or last
   *   menuActions(kind, key) optional; more menu buttons, each with
   *               data-context-action
   *   onMenuAction(action, kind, key) optional; runs one of those
   */
  let rankMenu;
  let rankMenuKind;
  let rankMenuKey;

  function closeRankMenu() {
    if (rankMenu) rankMenu.hidden = true;
    rankMenuKind = undefined;
    rankMenuKey = undefined;
  }

  function installRankedRows(options) {
    const names = Object.keys(options.kinds);
    const rowSelector = names.map(function (name) { return options.kinds[name].selector; }).join(', ');
    const keyAttributes = names.map(function (name) {
      return 'data-' + options.kinds[name].key.replace(/[A-Z]/g, function (letter) { return '-' + letter.toLowerCase(); });
    }).concat(['data-file-path', 'data-line']);
    let drag;
    let ghost;
    let placeholder;
    let dropTarget;
    let dropBefore = true;
    let suppressClick = false;

    function kindOf(row) {
      return names.find(function (name) { return row.matches(options.kinds[name].selector); });
    }
    function keyOf(row, kind) {
      return row.dataset[options.kinds[kind].key];
    }
    function strip(element) {
      element.classList.remove('is-dragging');
      element.removeAttribute('draggable');
      keyAttributes.forEach(function (attribute) { element.removeAttribute(attribute); });
      element.setAttribute('aria-hidden', 'true');
    }
    function clearPreview() {
      if (ghost) ghost.remove();
      if (placeholder) placeholder.remove();
      ghost = undefined;
      placeholder = undefined;
      dropTarget = undefined;
      document.querySelectorAll('.is-dragging').forEach(function (row) { row.classList.remove('is-dragging'); });
    }
    function begin(event) {
      clearPreview();
      const row = drag.row;
      ghost = row.cloneNode(true);
      strip(ghost);
      ghost.classList.add('drag-ghost');
      const bounds = row.getBoundingClientRect();
      ghost.style.width = bounds.width + 'px';
      ghost.style.height = bounds.height + 'px';
      document.body.appendChild(ghost);
      placeholder = row.cloneNode(true);
      strip(placeholder);
      placeholder.removeAttribute('tabindex');
      placeholder.classList.add('drag-placeholder');
      placeholder.querySelectorAll('[data-action], button, input, [tabindex]').forEach(function (element) {
        element.removeAttribute('data-action');
        keyAttributes.forEach(function (attribute) { element.removeAttribute(attribute); });
        element.setAttribute('tabindex', '-1');
      });
      if (row.parentElement) row.parentElement.insertBefore(placeholder, row);
      row.classList.add('is-dragging');
      drag.active = true;
      follow(event.clientX, event.clientY);
    }
    function follow(clientX, clientY) {
      if (ghost) {
        ghost.style.left = clientX + 12 + 'px';
        ghost.style.top = clientY + 12 + 'px';
      }
      const element = document.elementFromPoint(clientX, clientY);
      const row = element ? element.closest(options.kinds[drag.kind].selector) : undefined;
      if (!row || row === drag.row || keyOf(row, drag.kind) === drag.key) return;
      const bounds = row.getBoundingClientRect();
      const before = clientY < bounds.top + bounds.height / 2;
      if (dropTarget === row && dropBefore === before) return;
      dropTarget = row;
      dropBefore = before;
      const insertionPoint = before ? row : row.nextSibling;
      if (placeholder && row.parentElement && insertionPoint !== placeholder) row.parentElement.insertBefore(placeholder, insertionPoint);
    }
    function finish(event, cancelled) {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const current = drag;
      if (current.row.hasPointerCapture && current.row.hasPointerCapture(event.pointerId)) current.row.releasePointerCapture(event.pointerId);
      if (!current.active) {
        drag = undefined;
        return;
      }
      let dropped = false;
      if (!cancelled) {
        follow(event.clientX, event.clientY);
        const targetKey = dropTarget ? keyOf(dropTarget, current.kind) : undefined;
        dropped = Boolean(targetKey) && targetKey !== current.key && options.canRank(current.kind)
          && options.reorder(current.kind, current.key, targetKey, dropBefore, placeholder) === true;
        suppressClick = true;
      }
      // A dropped row takes the placeholder's place until the host answers.
      if (dropped && placeholder && placeholder.parentElement) {
        placeholder.parentElement.insertBefore(current.row, placeholder);
        current.row.classList.remove('is-dragging');
      }
      clearPreview();
      drag = undefined;
    }
    function openMenu(event, row) {
      const kind = kindOf(row);
      const key = kind ? keyOf(row, kind) : undefined;
      if (!key) return;
      const actions = options.menuActions ? options.menuActions(kind, key) : [];
      if (options.canRank(kind)) {
        const labels = options.kinds[kind].edgeLabels || ['Move to top', 'Move to bottom'];
        actions.push('<button type="button" role="menuitem" data-context-action="top">' + escapeHtml(labels[0]) + '</button>');
        actions.push('<button type="button" role="menuitem" data-context-action="bottom">' + escapeHtml(labels[1]) + '</button>');
      }
      if (!actions.length) return;
      event.preventDefault();
      closeRankMenu();
      if (!rankMenu) {
        rankMenu = document.createElement('div');
        rankMenu.setAttribute('id', 'rank-context-menu');
        rankMenu.setAttribute('class', 'rank-context-menu');
        rankMenu.setAttribute('role', 'menu');
        document.body.appendChild(rankMenu);
      }
      rankMenuKind = kind;
      rankMenuKey = key;
      rankMenu.innerHTML = actions.join('');
      rankMenu.hidden = false;
      const bounds = rankMenu.getBoundingClientRect();
      rankMenu.style.left = Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8)) + 'px';
      rankMenu.style.top = Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8)) + 'px';
      rankMenu.querySelector('button').focus();
    }

    document.addEventListener('click', function (event) {
      const chosen = event.target.closest('#rank-context-menu [data-context-action]');
      if (chosen) {
        const kind = rankMenuKind;
        const key = rankMenuKey;
        const action = chosen.dataset.contextAction;
        closeRankMenu();
        if (!kind || !key) return;
        if (action === 'top' || action === 'bottom') {
          if (options.canRank(kind)) options.move(kind, key, action === 'top');
        } else if (options.onMenuAction) {
          options.onMenuAction(action, kind, key);
        }
        return;
      }
      if (rankMenu && !event.target.closest('#rank-context-menu')) closeRankMenu();
      // The click a drag ends with is not a click on the row.
      if (suppressClick) {
        suppressClick = false;
        if (event.target.closest(rowSelector)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }
    }, true);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && rankMenu && !rankMenu.hidden) {
        closeRankMenu();
        return;
      }
      // Reordering was a drag or a right-click, so a keyboard could reach
      // neither. The same menu opens on the focused row with the menu key,
      // Shift+F10, or Alt+Enter, at the row itself.
      const isMenuKey = event.key === 'ContextMenu'
        || (event.key === 'F10' && event.shiftKey)
        || (event.key === 'Enter' && event.altKey);
      if (!isMenuKey) return;
      const row = event.target.closest ? event.target.closest(rowSelector) : undefined;
      if (!row) return;
      const bounds = row.getBoundingClientRect();
      openMenu({
        preventDefault: function () { event.preventDefault(); },
        clientX: bounds.left + 12,
        clientY: bounds.top + bounds.height,
      }, row);
    });
    document.addEventListener('contextmenu', function (event) {
      const row = event.target.closest(rowSelector);
      if (row) openMenu(event, row);
    });
    document.addEventListener('pointerdown', function (event) {
      suppressClick = false;
      const row = event.target.closest(rowSelector);
      if (!row || event.button !== 0 || drag) return;
      // A control inside a row, such as a widget's gear, keeps its click: a
      // drag would capture the pointer and take the click away from it.
      if (event.target.closest('button, input, select, textarea, a, summary, label, [data-action]')) return;
      const kind = kindOf(row);
      if (!kind || !row.classList.contains('is-draggable') || !options.canRank(kind)) return;
      drag = { row: row, kind: kind, key: keyOf(row, kind), pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false };
      if (row.setPointerCapture) row.setPointerCapture(event.pointerId);
    });
    document.addEventListener('pointermove', function (event) {
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!drag.active) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
        begin(event);
      }
      event.preventDefault();
      follow(event.clientX, event.clientY);
    });
    document.addEventListener('pointerup', function (event) { finish(event, false); });
    document.addEventListener('pointercancel', function (event) { finish(event, true); });
  }

  /**
   * Moves key before or after targetKey in keys, for a drag that ranked it.
   * Returns the new order, or undefined when either is missing.
   */
  function rankKeys(keys, key, targetKey, before) {
    const from = keys.indexOf(key);
    const to = keys.indexOf(targetKey);
    if (from < 0 || to < 0) return undefined;
    const next = keys.slice();
    const insertion = to + (before ? 0 : 1);
    next.splice(from, 1);
    next.splice(insertion > from ? insertion - 1 : insertion, 0, key);
    return next;
  }

  /** Moves key to the start or end of keys. */
  function moveKeyToEdge(keys, key, toTop) {
    if (keys.indexOf(key) < 0) return undefined;
    const next = keys.filter(function (candidate) { return candidate !== key; });
    if (toTop) next.unshift(key);
    else next.push(key);
    return next;
  }

  /**
   * The page numbers to offer, with a gap where numbers are left out.
   *
   * The first and last pages are always there, because they are where a
   * reader goes back to, and the pages either side of the current one,
   * because they are the next step. A gap is a null.
   */
  function pageNumbers(current, pageCount) {
    if (pageCount <= 7) {
      return Array.from({ length: pageCount }, function (_, index) { return index + 1; });
    }
    const wanted = [1, pageCount, current, current - 1, current + 1];
    const pages = wanted
      .filter(function (page) { return page >= 1 && page <= pageCount; })
      .filter(function (page, index, all) { return all.indexOf(page) === index; })
      .sort(function (left, right) { return left - right; });
    const withGaps = [];
    pages.forEach(function (page, index) {
      if (index > 0 && page - pages[index - 1] > 1) withGaps.push(null);
      withGaps.push(page);
    });
    return withGaps;
  }

  /**
   * Previous, the page numbers, and Next: the control that walks a list.
   *
   * Every list that pages uses this one, so a search page and a widget on
   * Home are walked the same way. \`action\` and \`attributes\` say who is being
   * paged, and \`noun\` names the entries for a screen reader.
   */
  function renderPageSteps(paging, action, attributes, noun) {
    if (!paging || paging.pageCount <= 1) return '';
    const own = attributes ? ' ' + attributes : '';
    const step = function (page, label, enabled) {
      return '<button class="page-step" data-action="' + action + '" data-page="' + page + '"' + own
        + (enabled ? '' : ' disabled')
        + ' aria-label="' + label + ' page of ' + escapeHtml(noun) + '">' + label + '</button>';
    };
    const numbers = pageNumbers(paging.page, paging.pageCount).map(function (page) {
      if (page === null) return '<span class="page-gap" aria-hidden="true">…</span>';
      const current = page === paging.page;
      return '<button class="page-number' + (current ? ' is-current' : '') + '" data-action="' + action + '" data-page="' + page + '"' + own
        + (current ? ' aria-current="page"' : '')
        + ' aria-label="Page ' + page + ' of ' + escapeHtml(noun) + '">' + page + '</button>';
    }).join('');
    return step(paging.page - 1, 'Previous', paging.page > 1)
      + numbers
      + step(paging.page + 1, 'Next', paging.page < paging.pageCount);
  }

  /** "271–300 of 3760", the part of a list a page is showing. */
  function describePageRange(paging) {
    if (!paging || !paging.total) return '';
    const first = (paging.page - 1) * paging.size + 1;
    const last = Math.min(paging.page * paging.size, paging.total);
    return first + '\u2013' + last + ' of ' + paging.total;
  }
`;
}

/**
 * The search box every search page shares: the query bar and its
 * completions, the builder, the removable terms, and the facets.
 */
export function getQueryEditorCss(): string {
  return `
.query-workspace { margin-top: 16px; border: var(--edge) solid var(--line); background: var(--panel-deep); }
.query-bar-row { display: flex; align-items: stretch; gap: 6px; flex-wrap: wrap; padding: 10px; }
.query-input { flex: 1 1 auto; min-width: 0; min-height: 32px; border: var(--edge) solid var(--line-strong); background: var(--panel-deep); color: var(--text); padding: 5px 9px; font: 12px var(--font-mono); }
.query-input:focus { border-color: var(--amber); outline: none; }
.query-input:focus-visible { outline: var(--edge) solid var(--cyan); outline-offset: 2px; }
.query-input.invalid { border-color: #FF5555; }
.query-input-shell { position: relative; flex: 1 1 240px; min-width: 0; display: flex; }
/*
 * The search box is a field of chips, as a multi-select is: each term of the
 * search is a chip with a remove icon, joined by AND, and the text field after
 * them takes the next term. The field wraps onto more lines as terms are added.
 */
.query-bar-shell { flex-wrap: wrap; align-items: center; gap: 4px 5px; min-height: 32px; border: var(--edge) solid var(--line-strong); background: var(--panel-deep); padding: 3px 6px; cursor: text; }
.query-bar-shell:focus-within { border-color: var(--amber); }
.query-bar-shell.invalid { border-color: #FF5555; }
.query-bar-shell input.query-input[type="text"], .query-bar-shell input.query-input[type="text"]:focus { flex: 1 1 120px; min-width: 120px; min-height: 24px; border: 0; background: transparent; padding: 2px 3px; box-shadow: none; outline: none; }
/* Every chip looks the same, whatever its term; only a left-out tag is red. */
.query-bar-shell .query-chip { display: inline-flex; align-items: center; gap: 5px; min-height: 24px; max-width: 100%; margin: 0; border: 1px solid color-mix(in srgb, var(--cyan) 60%, transparent); border-radius: 3px; background: color-mix(in srgb, var(--cyan) 12%, transparent); color: var(--cyan); padding: 1px 4px 1px 8px; font: 11px var(--font-mono); text-align: left; text-transform: none; letter-spacing: normal; box-shadow: none; clip-path: none; transform: none; cursor: pointer; }
.query-chip-label { min-width: 0; overflow-wrap: anywhere; }
.query-bar-shell .query-chip.is-negated { border-color: color-mix(in srgb, var(--favorite-red) 60%, transparent); background: color-mix(in srgb, var(--favorite-red) 12%, transparent); color: var(--favorite-red); }
/* A group of the search: its own chips inside a frame, with the group's
   remove at the end, so what the builder nests the box shows nested. The
   frame removes the group, as a chip's whole face removes its term. */
.query-chip-group { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 5px; max-width: 100%; border: 1px dashed color-mix(in srgb, var(--cyan) 60%, transparent); border-radius: 3px; padding: 2px 3px 2px 5px; color: var(--cyan); cursor: pointer; }
.query-chip-group.is-negated { border-color: color-mix(in srgb, var(--favorite-red) 60%, transparent); color: var(--favorite-red); }
/* The group's own remove is the circle alone, ringed with the group's dash
   so it reads as the group's rather than one more chip. */
.query-bar-shell .query-chip-group-remove { border: 0; background: none; padding: 0 2px; min-height: 0; color: inherit; }
.query-bar-shell .query-chip-group-remove .query-chip-remove { border: 1px dashed currentColor; }
/* Pointing at the frame, or at its remove, lights the whole group, since
   that is what a press there removes; pointing at a chip inside, or at a
   group nested inside, lights that alone. */
.query-chip-group:hover:not(:has(.query-chip:hover, .query-chip-group:hover)), .query-chip-group:has(> .query-chip-group-remove:hover), .query-chip-group:has(> .query-chip-group-remove:focus-visible) { border-color: var(--amber); border-style: solid; color: var(--amber); }
.query-bar-shell .query-chip-group-remove:hover, .query-bar-shell .query-chip-group-remove:focus-visible { background: none; color: inherit; }
.query-bar-shell .query-chip-group-remove:hover .query-chip-remove, .query-bar-shell .query-chip-group-remove:focus-visible .query-chip-remove { background: var(--amber); color: var(--panel-deep); border-color: var(--amber); }
.query-chip-remove { display: inline-grid; flex: 0 0 auto; width: 16px; height: 16px; place-items: center; border-radius: 50%; background: color-mix(in srgb, currentColor 22%, transparent); color: inherit; font-size: 12px; line-height: 1; }
.query-bar-shell .query-chip:hover, .query-bar-shell .query-chip:focus-visible { border-color: var(--amber); background: color-mix(in srgb, var(--amber) 12%, transparent); color: var(--amber); transform: none; }
.query-bar-shell .query-chip:hover .query-chip-remove, .query-bar-shell .query-chip:focus-visible .query-chip-remove { background: var(--amber); color: var(--panel-deep); }
.query-chip-join, .query-op { color: var(--amber); font: 10px var(--font-mono); letter-spacing: .08em; }
.query-op { font-size: inherit; }
.query-paren { color: var(--muted); }
.query-suggestions { position: absolute; z-index: 12; top: calc(100% + 2px); left: 0; right: 0; max-height: 260px; overflow-y: auto; border: var(--edge) solid var(--amber); background: var(--panel-raised); }
.query-suggestions[hidden] { display: none; }
/* A completion reads as written, whatever a theme does to buttons, and each
   sits on its own ruled row; a long one wraps beside its note. */
.query-suggestions .query-suggestion { display: flex; width: 100%; min-height: 30px; align-items: center; justify-content: space-between; gap: 12px; margin: 0; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: transparent; color: var(--text); padding: 6px 10px; text-align: left; font: 12px var(--font-mono); letter-spacing: normal; text-transform: none; box-shadow: none; clip-path: none; transform: none; }
.query-suggestions .query-suggestion:last-child { border-bottom: 0; }
.query-suggestions .query-suggestion:hover, .query-suggestions .query-suggestion.active { background: var(--panel-deep); color: var(--amber); }
.query-suggestion-label { min-width: 0; overflow-wrap: anywhere; }
.query-suggestions .query-suggestion-detail { flex: 0 0 auto; color: var(--muted); font-size: 10px; white-space: nowrap; }
.query-status { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 0 10px 10px; color: var(--muted); font-size: 11px; }
.query-status > .query-hint, .query-status > .query-error { flex: 1 1 auto; }
/* Search is the bar's primary action in every theme; hover and focus keep
   the theme's own look. */
.query-bar-row .query-apply:not(:hover):not(:focus-visible) { border-color: var(--amber); color: var(--amber); }
.query-error { color: #FF8080; font: 11px var(--font-mono); }
.query-hint { color: var(--muted); font: 11px var(--font-mono); }
.query-builder { border-top: var(--edge) solid var(--line); padding: 10px; }
.query-builder-group { border: var(--edge) solid var(--line-strong); background: var(--panel-deep); padding: 10px; }
.query-builder-group.is-negated { border-style: dashed; }
/* The root group is the builder itself, so it draws no box of its own: a
   frame around everything would only look like one more level of nesting. */
.query-builder-group.is-root { border: 0; background: none; padding: 0; }
.query-builder-not[aria-pressed="true"] { border-color: var(--chosen-bg); background: var(--chosen-bg); color: var(--chosen-fg); }
.query-builder-group-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.query-builder-group-head select { min-height: 28px; font-size: 12px; }
.query-builder-head-text { color: var(--muted); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; }
.query-builder-not { min-height: 28px; padding: 4px 8px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
.query-builder-item { display: flex; align-items: flex-start; gap: 6px; margin-top: 6px; }
.query-builder-item > .query-builder-and { margin-top: 9px; }
.query-builder-item.has-group { margin-top: 10px; margin-bottom: 10px; }
.query-builder-item > .query-builder-group { flex: 1 1 auto; min-width: 0; }
.query-builder-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.query-builder-row + .query-builder-row { margin-top: 6px; }
.query-builder-row select, .query-builder-row input { min-height: 28px; font-size: 12px; }
.query-builder-row .query-builder-operator { font-family: var(--font-mono); }
.query-builder-row .query-builder-value-shell { flex: 1 1 160px; min-width: 0; }
.query-builder-row .query-builder-value { width: 100%; min-width: 0; border: var(--edge) solid var(--line); background: var(--panel-deep); color: var(--text); padding: 4px 8px; font: 12px var(--font-mono); }
.query-builder-row .query-builder-value:focus { border-color: var(--amber); outline: none; }
.query-builder-row .query-builder-pending { border-style: dashed; }
.query-builder-and { flex: none; width: 5em; color: var(--muted); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; }
.query-builder-remove { min-height: 28px; padding: 4px 8px; }
.query-builder-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.query-builder-actions button { font-size: 11px; }
.query-builder-readonly { flex: 1 1 auto; color: var(--muted); font: 12px var(--font-mono); overflow-wrap: anywhere; }
.query-builder-note { margin: 8px 0 0; color: var(--muted); font-size: 11px; }
/* The facets wrap on the left; the result count holds the top-right corner. */
.query-facets { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px 18px; margin: 12px 0; padding: 10px 12px; border: 1px dashed var(--line-strong); }
.query-facets-groups { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 18px; }
.query-facets-count { align-self: center; color: var(--muted); font-size: 11px; line-height: 26px; white-space: nowrap; }
.query-facets-empty { color: var(--muted); font-size: 11px; }
/* A value and its two other modes read as one control. The modes stay out of
   the way until the value is hovered or something in it has focus. */

/* The mode is held back by staying hidden until the value is hovered, not by
   a muted color, which would be muted against whatever ground a theme gives
   its controls rather than against the page. */
.query-recovery { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.query-recovery button { min-height: 26px; padding: 3px 8px; font-size: 11px; }
.query-facets-heading { color: var(--amber); font: 11px var(--font-mono); letter-spacing: .12em; text-transform: uppercase; }
.query-facet { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.query-facet-label { margin-right: 2px; color: var(--muted); font: 10px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
.query-facet-value { display: inline-flex; align-items: center; gap: 5px; min-height: 26px; padding: 3px 8px; font-size: 11px; text-transform: none; }
.query-facet-count { color: var(--muted); font-size: 10px; }
.query-facets.is-elsewhere { padding-block: 6px; }`;
}

/**
 * The search box's behaviour, inserted in a page script after
 * getComponentScript(), whose helpers it uses.
 *
 * Like getComponentScript(), this string is interpolated into a template
 * literal, so a backslash meant for the output is written doubled here.
 */
export function getQueryEditorScript(): string {
  return `
  /**
   * One search box: the query bar and its completions, the builder, the
   * search's removable terms, and the facets that narrow its results.
   *
   * The host owns the applied search. The editor keeps only what is being
   * typed and any builder rows not finished yet, and hands a finished search
   * back through options.apply.
   *
   *   getState()     the host's QueryViewState for this search, if any
   *   render()       redraws the page, which draws the editor's parts
   *   apply(text)    runs a search typed, built, or refined here
   *   clear()        empties the search
   *   onDraft(text)  optional; hears every keystroke, so a page can filter
   *                  what it already shows by the plain words being typed
   *   placeholder()  the empty box's hint
   *   label          what the box searches, for assistive technology
   *   clearedText()  optional; what Clear leaves in the box, such as the
   *                  page's own tag on a tag overview. Empty unless given;
   *                  Clear is disabled while the box holds only this.
   *   resultKinds    optional; what the search can find, notes and tasks
   *                  unless a page lists only one, such as ['tasks']
   *   refineElsewhere() optional; true while the sidebar shows this search's
   *                  Refine options, so the page shows a line in their place
   *   actions(hasText) optional; the page's own buttons for the bar, such as
   *                  Save. A button that needs text carries
   *                  data-query-needs-text, and is always drawn, disabled
   *                  until there is text, so the bar never shifts under the
   *                  pointer while a search is typed.
   */
  function createQueryEditor(options) {
    const DEFAULT_OPERATORS = {
      tag: ['eq', 'neq'], text: ['contains', 'notContains', 'eq', 'neq'], is: ['eq', 'neq'],
      task: ['eq', 'neq'], due: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'], scheduled: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
      start: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'], done: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
      priority: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'], has: ['eq', 'neq'], kind: ['eq', 'neq'],
      file: ['eq', 'neq', 'contains', 'notContains'], path: ['eq', 'neq', 'contains', 'notContains'], in: ['eq', 'neq'],
      created: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'], updated: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
    };
    const SYMBOL_OPERATORS = { '=': 'eq', '!=': 'neq', '~': 'contains', '!~': 'notContains', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' };
    const OPERATOR_LABELS = { eq: '=', neq: '!=', contains: '~', notContains: '!~', gt: '>', gte: '>=', lt: '<', lte: '<=' };
    /** Hover text, since a symbol alone does not say what it compares. */
    const OPERATOR_DESCRIPTIONS = { eq: 'is', neq: 'is not', contains: 'contains', notContains: 'does not contain', gt: 'after', gte: 'on or after', lt: 'before', lte: 'on or before' };
    /** The text field matches whole words with = and any substring with ~. */
    const TEXT_OPERATOR_DESCRIPTIONS = { eq: 'is the whole word', neq: 'does not have the whole word' };
    /** Priority compares rank, not time. */
    const PRIORITY_OPERATOR_DESCRIPTIONS = { gt: 'above', gte: 'at or above', lt: 'below', lte: 'at or below' };
    const FIELD_PLACEHOLDERS = {
      tag: '#project/atlas', text: 'vendor review', is: 'open', task: 'open', due: 'today', scheduled: 'today',
      start: 'today', done: '7d', priority: 'high', has: 'due', kind: 'project', file: '2026-09-*.md',
      path: 'notes/*', in: 'notes/projects', created: '2026-09-13', updated: '30d',
    };
    /** Fields written as one field:value token. */
    const SHORTHAND_FIELDS = ['is', 'has', 'in'];

    /**
     * A whole search waiting to be run, such as one the builder wrote or Clear
     * left; undefined means the box shows the applied search and the entry.
     */
    let draft;
    /** The next term, being typed in the field after the chips. */
    let entry = '';
    /** The entry the last search that ran was written with. */
    let lastEntry = '';
    /** The entry to keep once the host answers the search that ran. */
    let entryAfterRun = '';
    /** The applied search the editor last saw. */
    let appliedSeen;
    /** Set between applying a search and seeing the host's answer. */
    let awaitingApply = false;
    let builderOpen = false;
    /**
     * Local builder rows. A row not finished yet contributes nothing to the
     * search text, so the rows cannot come straight from the host's parse;
     * the draft owns them until they turn into text the host can parse.
     */
    let builderDraft;
    /** The applied search the rows were last reconciled with. */
    let builderSourceText;
    /** A builder value input to focus once the next render settles. */
    let pendingBuilderFocus;
    let restoreFocus = false;
    /**
     * Set while the page redraws around the box. A redraw takes the field out
     * of the document, which the browser reports as the reader leaving it,
     * and what was typed would be let go as if they had clicked away. The
     * draft's own results arriving is the commonest redraw of all.
     */
    let redrawing = false;
    /** Where the caret sat when the redraw began, to put it back. */
    let caretAtRedraw;
    /** Set while the caret is being put back, so the list stays closed. */
    let suppressFocusSuggestions = false;
    /** Set when the reader asked for the box itself, such as by pressing /. */
    let openSuggestionsOnRestore = false;
    let suggestionItems = [];
    let suggestionIndex = -1;
    /** Which input the completion list belongs to, if any. */
    let suggestionHostKey;
    /** The partial text the completion list is filtering on. */
    let suggestionToken = '';

    function query() { return options.getState() || {}; }
    function suggestions() { return query().suggestions || {}; }
    function appliedText() { return query().text || ''; }
    function currentText() { return draft === undefined ? combineQuery(appliedText(), entry) : draft; }
    function operatorsFor(field) {
      const table = suggestions().operators || DEFAULT_OPERATORS;
      return table[field] || DEFAULT_OPERATORS[field] || ['eq'];
    }
    function fieldNames() {
      const listed = (suggestions().fields || []).map(function (field) { return field.value; });
      return listed.length ? listed : Object.keys(DEFAULT_OPERATORS);
    }
    function clearedText() {
      return options.clearedText ? String(options.clearedText() || '') : '';
    }
    /** Whether Clear would change the search. */
    function canClear(text) {
      return String(text || '').trim() !== clearedText().trim();
    }
    function placeholder() {
      return typeof options.placeholder === 'function' ? options.placeholder() : (options.placeholder || '');
    }

    /** The bar, its status line, the search's terms, and the builder. */
    /**
     * statusControls is the page's own HTML for the line under the box, such
     * as a sort control, kept there so it takes no row of its own.
     */
    function renderBar(statusControls) {
      const value = currentText();
      const hasText = Boolean(String(value).trim());
      const errors = (query().diagnostics || []).filter(function (diagnostic) { return diagnostic.severity === 'error'; });
      const terms = renderChips();
      const status = errors.length
        ? '<span class="query-error" role="alert">' + escapeHtml(errors[0].message) + '</span>'
        : '<span class="query-hint">Enter searches. Words, #tags, is:open, has:due, in:folder; AND, OR, NOT. Press / to search.</span>';
      const label = options.label || 'Search';
      return '<section class="query-workspace" aria-label="' + escapeHtml(label) + '">'
        + '<div class="query-bar-row">'
        + '<span class="query-input-shell query-bar-shell' + (errors.length ? ' invalid' : '') + '" data-query-text="' + escapeHtml(value) + '">' + terms + '<input class="query-input' + (errors.length ? ' invalid' : '') + '" type="text" data-action="query-input" data-suggest-key="query" spellcheck="false" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-label="' + escapeHtml(terms ? label + ': add a term' : label) + '" placeholder="' + escapeHtml(terms ? '' : placeholder()) + '" value="' + escapeHtml(entry) + '"><div class="query-suggestions" data-suggestions="query" hidden role="listbox"></div></span>'
        + '<button class="query-apply" data-action="apply-query" title="Run this search">Search</button>'
        + '<button data-action="clear-query" data-query-clears title="Clear the search"' + (canClear(value) ? '' : ' disabled') + '>Clear</button>'
        + (options.actions ? options.actions(hasText) : '')
        + '</div>'
        + '<div class="query-status"><button class="query-builder-toggle" data-action="toggle-builder" aria-expanded="' + builderOpen + '" title="Build the search one condition at a time">' + (builderOpen ? 'Hide builder' : 'Builder') + '</button>' + status + (statusControls || '') + '</div>'
        + renderBuilder()
        + '</section>';
    }

    /**
     * The search's words, with where each starts and ends: a tag, written as
     * #tag, -#tag, tag:#tag, or tag = #tag; an operator; a parenthesis; or
     * anything else. Quoted text is one word.
     */
    function scanQuery(text) {
      const tokens = [];
      const pattern = /"(?:[^"\\\\]|\\\\.)*"?|'[^']*'?|[()]|[^\\s()]+/g;
      let match;
      while ((match = pattern.exec(text))) {
        tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
      }
      const pieces = [];
      const unquote = function (value) { return value.replace(/^["']|["']$/g, ''); };
      for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        const word = token.text;
        let tag = /^(-|!)?([#@][^\\s()"']+)$/.exec(unquote(word));
        if (tag) {
          pieces.push({ kind: 'tag', start: token.start, end: token.end, negated: Boolean(tag[1]) });
          continue;
        }
        tag = /^(-)?tags?(:|!?=)(.+)$/i.exec(word);
        if (tag && /^[#@]/.test(unquote(tag[3]))) {
          pieces.push({ kind: 'tag', start: token.start, end: token.end, negated: Boolean(tag[1]) || tag[2] === '!=' });
          continue;
        }
        const operator = tokens[index + 1];
        const value = tokens[index + 2];
        if (/^tags?$/i.test(word) && operator && value && /^!?=$/.test(operator.text) && /^[#@]/.test(unquote(value.text))) {
          pieces.push({ kind: 'tag', start: token.start, end: value.end, negated: operator.text === '!=' });
          index += 2;
          continue;
        }
        if (/^(and|or|not|&&|\\|\\|)$/i.test(word)) {
          pieces.push({ kind: 'op', start: token.start, end: token.end });
          continue;
        }
        pieces.push({ kind: word === '(' || word === ')' ? 'paren' : 'word', start: token.start, end: token.end });
      }
      return pieces;
    }

    /** A term's text, with its AND, OR, and NOT in their own color. */
    function renderTermText(text) {
      let html = '';
      let offset = 0;
      scanQuery(text).forEach(function (piece) {
        if (piece.kind !== 'op' && piece.kind !== 'paren') return;
        html += escapeHtml(text.slice(offset, piece.start))
          + '<span class="' + (piece.kind === 'op' ? 'query-op' : 'query-paren') + '">' + escapeHtml(text.slice(piece.start, piece.end).toUpperCase()) + '</span>';
        offset = piece.end;
      });
      return html + escapeHtml(text.slice(offset));
    }

    /**
     * The applied search as chips, each removing its own term, joined by
     * the word between them. A group is a bordered run of its own chips
     * with a remove of its own at the end, nested as the builder has it,
     * so a condition inside a group goes alone and the group goes whole.
     */
    function renderChips() {
      const text = appliedText().trim();
      if (!text) return '';
      const terms = (query().terms || []).length ? query().terms : [{ text: text, without: '' }];
      return renderTermChips(terms, query().termsJoin || 'and');
    }

    function renderTermChips(terms, join) {
      const word = join === 'or' ? 'OR' : 'AND';
      return terms.map(function (term, index) {
        return (index > 0 ? '<span class="query-chip-join" aria-hidden="true">' + word + '</span>' : '') + renderTermChip(term);
      }).join('');
    }

    function renderTermChip(term) {
      // Words show as the text condition they run.
      const label = term.label || term.text;
      if (term.items && term.items.length) {
        // The frame removes the group, as a chip's whole face removes its
        // term; a chip inside is found first by the click, so it goes alone.
        return '<span class="query-chip-group' + (term.negated ? ' is-negated' : '') + '" role="group" aria-label="' + escapeHtml(label) + '" data-action="remove-term" data-without="' + escapeHtml(term.without) + '">'
          + (term.negated ? '<span class="query-chip-join" aria-hidden="true">NOT</span>' : '')
          + renderTermChips(term.items, term.join)
          + '<button type="button" class="query-chip query-chip-group-remove" data-action="remove-term" data-without="' + escapeHtml(term.without) + '" aria-label="Remove the group ' + escapeHtml(label) + '" title="Remove the group ' + escapeHtml(label) + '"><span class="query-chip-remove" aria-hidden="true">&#215;</span></button>'
          + '</span>';
      }
      const pieces = scanQuery(term.text);
      const tag = pieces.length === 1 && pieces[0].kind === 'tag' ? pieces[0] : undefined;
      const className = 'query-chip' + (tag ? ' is-tag' : '') + (term.negated || (tag && tag.negated) ? ' is-negated' : '');
      return '<button type="button" class="' + className + '" data-action="remove-term" data-without="' + escapeHtml(term.without) + '" aria-label="Remove ' + escapeHtml(label) + '" title="Remove ' + escapeHtml(label) + '"><span class="query-chip-label">' + renderTermText(label) + '</span><span class="query-chip-remove" aria-hidden="true">&#215;</span></button>';
    }

    /**
     * The applied search with a new term added by AND. A term whose top level
     * is an OR is wrapped, so it adds one condition.
     */
    function combineQuery(applied, extra) {
      const text = String(applied || '').trim();
      const addition = joinTags(String(extra || '').trim());
      if (!addition) return text;
      if (!text) return addition;
      const wrapped = /(^|\\s)(or|\\|\\|)(\\s|$)/i.test(addition) && !/^\\(.*\\)$/.test(addition) ? '(' + addition + ')' : addition;
      return (query().canAppend === false ? '(' + text + ')' : text) + ' AND ' + wrapped;
    }

    /**
     * Writes AND between two tags that stand side by side, so a search of
     * several tags reads as what it does.
     */
    function joinTags(text) {
      const value = String(text);
      const pieces = scanQuery(value);
      let result = '';
      let offset = 0;
      pieces.forEach(function (piece, index) {
        const previous = pieces[index - 1];
        if (piece.kind === 'tag' && previous && previous.kind === 'tag' && !value.slice(previous.end, piece.start).trim()) {
          result += value.slice(offset, previous.end) + ' AND ';
          offset = piece.start;
        }
      });
      return result + value.slice(offset);
    }

    /** Set the entry, in the field and in the state, without a redraw. */
    function setEntry(input, text) {
      entry = String(text || '');
      draft = undefined;
      if (input && input.value !== entry) input.value = entry;
      syncTextButtons(currentText());
      if (options.onDraft) options.onDraft(currentText());
    }

    // Text typed and not added as a term is let go when the search box loses
    // focus, as a multi-select does; moving to the box's own buttons keeps it.
    let pointerInWorkspace = false;
    document.addEventListener('mousedown', function (event) {
      pointerInWorkspace = Boolean(event.target && event.target.closest && event.target.closest('.query-workspace'));
    }, true);
    document.addEventListener('mouseup', function () {
      setTimeout(function () { pointerInWorkspace = false; }, 0);
    }, true);
    document.addEventListener('focusout', function (event) {
      const target = event.target;
      if (redrawing) return;
      if (!target || !target.dataset || target.dataset.action !== 'query-input' || !entry) return;
      const next = event.relatedTarget;
      if (pointerInWorkspace || (next && next.closest && next.closest('.query-workspace'))) return;
      closeSuggestions();
      setEntry(target, '');
    }, true);

    /**
     * Enable the bar's buttons that need text as soon as there is some, in
     * place, rather than redrawing the bar while a search is typed.
     */
    function syncTextButtons(text) {
      const hasText = Boolean(String(text || '').trim());
      const enable = function (button, enabled) {
        button.disabled = !enabled;
        if (enabled) button.removeAttribute('disabled');
        else button.setAttribute('disabled', '');
      };
      document.querySelectorAll('[data-query-needs-text]').forEach(function (button) { enable(button, hasText); });
      document.querySelectorAll('[data-query-clears]').forEach(function (button) { enable(button, canClear(text)); });
      document.querySelectorAll('.query-bar-shell').forEach(function (shell) { shell.setAttribute('data-query-text', String(text || '')); });
    }

    /** Whether the applied search ran and matched nothing of any kind. */
    function matchedNothing() {
      if (!appliedText().trim()) return false;
      const counts = query().matchCounts;
      if (!counts) return false;
      return (options.resultKinds || ['notes', 'tasks']).every(function (kind) { return !counts[kind]; });
    }

    /**
     * Ways out of a search that found nothing. Narrowing is useless here, so
     * the Refine row offers the two ways to widen instead: drop the term that
     * was added last, or go back to what the page opened with.
     */
    function renderRecovery() {
      const terms = query().terms || [];
      const last = terms.length > 1 ? terms[terms.length - 1] : undefined;
      const label = last ? String(last.label || last.text) : '';
      const drop = last
        ? '<button data-action="remove-term" data-without="' + escapeHtml(last.without) + '" title="Run this search without its last term">Drop ' + escapeHtml(label) + '</button>'
        : '';
      const clear = canClear(currentText())
        ? '<button data-action="clear-query" data-query-clears title="Clear the search">Clear the search</button>'
        : '';
      if (!drop && !clear) return '';
      return '<span class="query-facets-empty">Nothing matched.</span><span class="query-recovery">' + drop + clear + '</span>';
    }

    /** What the results could still be narrowed by, with counts. */
    function renderFacets() {
      const facets = query().facets || [];
      const count = renderMatchCount();
      const recovery = matchedNothing() ? renderRecovery() : '';
      if (!facets.length && !count) return '';
      if (options.refineElsewhere && options.refineElsewhere()) {
        // The sidebar still says where Refine went; a search that matched
        // nothing has nothing to narrow, so it offers the way back instead.
        const note = facets.length
          ? '<span class="query-facets-empty">In the Related Notes sidebar.</span>'
          : (recovery || '<span class="query-facets-empty">Nothing left to narrow by.</span>');
        return '<section class="query-facets is-elsewhere" aria-label="Refine these results"><div class="query-facets-groups"><span class="query-facets-heading">Refine</span>' + note + '</div>' + count + '</section>';
      }
      const empty = facets.length ? '' : (recovery || '<span class="query-facets-empty">Nothing left to narrow by.</span>');
      return '<section class="query-facets" aria-label="Refine these results"><div class="query-facets-groups"><span class="query-facets-heading">Refine</span>' + empty + facets.map(function (facet) {
        return '<div class="query-facet" role="group" aria-label="' + escapeHtml(facet.label) + '"><span class="query-facet-label">' + escapeHtml(facet.label) + '</span>' + facet.values.map(function (value) {
          return renderFacetValue(facet, value);
        }).join('') + '</div>';
      }).join('') + '</div>' + count + '</section>';
    }

    /**
     * What clicking a Refine value does to the search, in the words of the
     * query it writes. A reader is choosing between AND, OR and NOT, so the
     * tooltip names them rather than describing them.
     */
    function describeFacetValue(value) {
      const clause = value.clause || '';
      return [
        value.detail ? value.detail : '',
        'Click — AND ' + clause + ': keep only results that match it',
        'Alt-click — AND NOT ' + clause + ': leave those results out',
        'Shift-click — OR ' + clause + ': widen the last value chosen here, so either matches',
      ].filter(Boolean).join('\\n');
    }

    /**
     * One value of a facet, with how strongly it is related when it is a tag.
     *
     * A value is one button. It used to sit between a hidden − and +, which
     * held their width open whether or not anyone hovered; the same three
     * things are said by the click, Alt-click and Shift-click the tooltip
     * spells out, and a keyboard does them with Enter, Alt-Enter and
     * Shift-Enter on the focused value.
     */
    function renderFacetValue(facet, value) {
      const isTag = facet.id === 'tags' || facet.id === 'related';
      const hasStrength = typeof value.strength === 'number';
      const name = value.label;
      const title = describeFacetValue(value);
      const strength = hasStrength ? ', related ' + getWeightLevel(value.strength) + ' of 3' : '';
      const shared = ' data-facet-id="' + escapeHtml(facet.id) + '" data-clause="' + escapeHtml(value.clause) + '"';
      return '<button class="query-facet-value" data-action="facet"' + shared + ' title="' + escapeHtml(title) + '" aria-label="' + escapeHtml(facet.label + ': ' + name + strength + ', ' + value.count + '. Enter adds AND ' + value.clause + ', Alt-Enter adds AND NOT, Shift-Enter adds OR.') + '">' + (hasStrength ? renderWeightRail(getWeightLevel(value.strength)) : '') + (isTag ? renderTagLabel(name) : escapeHtml(name)) + '<span class="query-facet-count">' + value.count + '</span></button>';
    }

    /** How many of each kind of result the applied search matches. */
    function renderMatchCount() {
      if (!appliedText().trim()) return '';
      const counts = query().matchCounts || { notes: 0, tasks: 0 };
      const nouns = { notes: ['note', 'notes'], tasks: ['task', 'tasks'] };
      return '<span class="query-facets-count" role="status">' + (options.resultKinds || ['notes', 'tasks']).map(function (kind) {
        const count = counts[kind] || 0;
        return count + ' ' + nouns[kind][count === 1 ? 0 : 1];
      }).join(' &middot; ') + '</span>';
    }

    function renderBuilder() {
      if (!builderOpen) return '';
      return '<div class="query-builder">' + renderGroup(builderTree(), [], 0)
        + '<p class="query-builder-note">In a new row, type a tag, a word, or a value such as open. Enter adds another row, Backspace in an empty row removes it, and Ctrl or Cmd+Enter adds a group beside the row. A group matches all of its rows or any of them, and not turns it around.</p>'
        + '</div>';
    }

    /** A group, nested to any depth: its head, its rows and groups, and what adds to it. */
    function renderGroup(group, path, depth) {
      const at = pathText(path);
      const items = group.items.length
        ? group.items.map(function (item, index) {
          const itemPath = path.concat(index);
          const joiner = '<span class="query-builder-and">' + (index === 0 ? 'where' : (group.join === 'or' ? 'or' : 'and')) + '</span>';
          return item.items
            ? '<div class="query-builder-item has-group">' + joiner + renderGroup(item, itemPath, depth + 1) + '</div>'
            : renderBuilderRow(item, itemPath, joiner);
        }).join('')
        : '<p class="query-builder-note">This group is empty. Add a condition to start it.</p>';
      const head = '<div class="query-builder-group-head">'
        + '<button type="button" class="query-builder-not' + (group.negated ? ' active' : '') + '" data-action="builder-toggle-not" data-path="' + at + '" aria-pressed="' + (group.negated ? 'true' : 'false') + '" title="Turn this group around: match what it does not">not</button>'
        + '<span class="query-builder-head-text">match</span>'
        + '<select data-action="builder-set-join" data-path="' + at + '" aria-label="How this group combines its rows">'
        + '<option value="and"' + (group.join !== 'or' ? ' selected' : '') + '>all of</option>'
        + '<option value="or"' + (group.join === 'or' ? ' selected' : '') + '>any of</option>'
        + '</select>'
        + (depth > 0 ? '<button class="query-builder-remove" data-action="builder-remove-group" data-path="' + at + '">Remove group</button>' : '')
        + '</div>';
      const actions = '<div class="query-builder-actions">'
        + '<button data-action="builder-add-row" data-path="' + at + '">Add condition</button>'
        + '<button data-action="builder-add-group" data-path="' + at + '">Add group</button>'
        + '</div>';
      return '<div class="query-builder-group' + (depth === 0 ? ' is-root' : '') + (group.negated ? ' is-negated' : '') + '" data-group-path="' + at + '">' + head + items + actions + '</div>';
    }

    function renderBuilderRow(row, path, joiner) {
      const at = pathText(path);
      const position = ' data-path="' + at + '"';
      const suggestKey = 'p' + (at ? at.replace(/\\./g, '_') : '');
      const remove = '<button class="query-builder-remove" data-action="builder-remove-row"' + position + ' aria-label="Remove this condition">Remove</button>';
      if (row.pending) {
        return '<div class="query-builder-row">' + joiner
          + '<span class="query-input-shell query-builder-value-shell"><input class="query-builder-value query-builder-pending" data-action="builder-set-value" data-pending="true" data-suggest-key="' + suggestKey + '"' + position + ' value="' + escapeHtml(row.value || '') + '" placeholder="Type a tag, a word, or a value such as open" aria-label="New condition" role="combobox" aria-expanded="false" aria-autocomplete="list" autocomplete="off" spellcheck="false"><div class="query-suggestions" data-suggestions="' + suggestKey + '" hidden role="listbox"></div></span>'
          + remove + '</div>';
      }
      if (!row.supported) {
        return '<div class="query-builder-row">' + joiner
          + '<code class="query-builder-readonly">' + escapeHtml(row.text) + '</code>' + remove + '</div>';
      }
      const fields = fieldNames().map(function (field) {
        return '<option value="' + escapeHtml(field) + '"' + (field === row.field ? ' selected' : '') + '>' + escapeHtml(field) + '</option>';
      }).join('');
      const descriptions = row.field === 'text'
        ? Object.assign({}, OPERATOR_DESCRIPTIONS, TEXT_OPERATOR_DESCRIPTIONS)
        : row.field === 'priority'
          ? Object.assign({}, OPERATOR_DESCRIPTIONS, PRIORITY_OPERATOR_DESCRIPTIONS)
          : OPERATOR_DESCRIPTIONS;
      const operators = operatorsFor(row.field).map(function (operator) {
        return '<option value="' + operator + '" title="' + escapeHtml(descriptions[operator] || '') + '"' + (operator === row.operator ? ' selected' : '') + '>' + escapeHtml(OPERATOR_LABELS[operator] || operator) + '</option>';
      }).join('');
      const operatorTitle = descriptions[row.operator] || 'Operator';
      return '<div class="query-builder-row">' + joiner
        + '<select data-action="builder-set-field"' + position + ' aria-label="Field">' + fields + '</select>'
        + '<select class="query-builder-operator" data-action="builder-set-operator"' + position + ' aria-label="Operator: ' + escapeHtml(operatorTitle) + '" title="' + escapeHtml(operatorTitle) + '">' + operators + '</select>'
        + '<span class="query-input-shell query-builder-value-shell"><input class="query-builder-value" data-action="builder-set-value" data-suggest-key="' + suggestKey + '" data-field="' + escapeHtml(row.field) + '"' + position + ' value="' + escapeHtml(row.value) + '" placeholder="' + escapeHtml(FIELD_PLACEHOLDERS[row.field] || '') + '" aria-label="Value" role="combobox" aria-expanded="false" aria-autocomplete="list" autocomplete="off" spellcheck="false"><div class="query-suggestions" data-suggestions="' + suggestKey + '" hidden role="listbox"></div></span>'
        + remove + '</div>';
    }

    /** A row waiting for a value, which then decides its field. */
    function pendingRow() {
      return { pending: true, field: 'text', operator: 'contains', value: '', supported: true, text: '' };
    }

    /** The path attribute of a row or group, as a list of indices into items. */
    function pathOf(element) {
      const text = String((element && element.dataset && element.dataset.path) || '');
      return text ? text.split('.').map(Number) : [];
    }

    function pathText(path) {
      return path.join('.');
    }

    /** The group at a path, walking down from the root; undefined if a row is met. */
    function groupAt(tree, path) {
      let group = tree;
      for (let i = 0; i < path.length; i += 1) {
        const item = group.items[path[i]];
        if (!item || !item.items) return undefined;
        group = item;
      }
      return group;
    }

    function itemAt(tree, path) {
      if (!path.length) return undefined;
      const parent = groupAt(tree, path.slice(0, -1));
      return parent ? parent.items[path[path.length - 1]] : undefined;
    }

    function cloneTree(tree) {
      return JSON.parse(JSON.stringify(tree));
    }

    /**
     * Read the builder's tree, seeding it from the host's parse on first
     * use. Returns a copy a caller can change and hand to applyBuilderTree.
     */
    function builderTree() {
      if (!builderDraft) {
        builderDraft = cloneTree(query().builder || { join: 'and', items: [] });
        builderSourceText = appliedText();
      }
      return cloneTree(builderDraft);
    }

    /**
     * Adopt the edited tree, then run the search it describes. A row still
     * empty changes the tree without changing the search, so that case
     * redraws locally instead of making a round trip that would drop it.
     */
    function applyBuilderTree(tree) {
      builderDraft = tree;
      const text = buildQueryFromTree(tree, 0);
      if (text === appliedText()) {
        options.render();
        return;
      }
      builderSourceText = text;
      draft = text;
      run(text, true, false, false);
    }

    /**
     * Write the tree as search text, skipping rows with no value yet. This
     * mirrors fromBuilderTree on the host: a nested group with more than one
     * term is parenthesized, and a negated one is NOT (...).
     */
    function buildQueryFromTree(group, depth) {
      const terms = group.items.map(function (item) {
        if (item.items) return buildQueryFromTree(item, depth + 1);
        if (item.pending) return '';
        if (!item.supported) return item.text.trim();
        if (!String(item.value).trim()) return '';
        return formatBuilderCondition(item);
      }).filter(Boolean);
      if (!terms.length) return '';
      const body = terms.join(group.join === 'or' ? ' OR ' : ' AND ');
      if (group.negated) return 'NOT ' + (terms.length > 1 ? '(' + body + ')' : body);
      return depth > 0 && terms.length > 1 ? '(' + body + ')' : body;
    }

    /** One row as text, with shorthands written the way they are typed. */
    function formatBuilderCondition(row) {
      const value = quoteQueryValue(String(row.value).trim());
      if (row.field === 'has') return (row.operator === 'neq' ? 'no' : 'has') + ':' + value;
      if (SHORTHAND_FIELDS.indexOf(row.field) >= 0) return (row.operator === 'neq' ? '-' : '') + row.field + ':' + value;
      return row.field + ' ' + (OPERATOR_LABELS[row.operator] || '=') + ' ' + value;
    }

    function quoteQueryValue(value) {
      return /[\\s:=<>~!()"']/.test(value) || !value
        ? '"' + value.replace(/(["\\\\])/g, '\\\\$1') + '"'
        : value;
    }

    /** The field a word names, from the host's spellings or the built-in names. */
    function fieldFor(word) {
      const aliases = suggestions().aliases || {};
      const name = String(word).toLowerCase();
      if (aliases[name]) return aliases[name];
      if (name === 'no') return 'has';
      return DEFAULT_OPERATORS[name] ? name : undefined;
    }

    function unquote(value) {
      const text = String(value).trim();
      return /^(["']).*\\1$/.test(text) ? text.slice(1, -1) : text;
    }

    /**
     * Read one condition as it would be typed, such as is:open,
     * priority >= high, #project/atlas, or a plain word, into a builder row.
     */
    function parseConditionText(text) {
      const value = String(text).trim();
      const row = function (field, operator, rowValue) {
        return { field: field, operator: operator, value: rowValue, supported: true, text: '' };
      };
      let match = /^(-?)([A-Za-z]+):(.+)$/.exec(value);
      if (match && fieldFor(match[2])) {
        const word = match[2].toLowerCase();
        const field = fieldFor(word);
        const negated = (match[1] === '-') !== (word === 'no');
        const rest = unquote(match[3]);
        const comparison = /^(>=|<=|!=|!~|>|<|~)/.exec(rest);
        if (comparison && SHORTHAND_FIELDS.indexOf(field) < 0) {
          return row(field, SYMBOL_OPERATORS[comparison[1]], unquote(rest.slice(comparison[1].length)));
        }
        return row(field, negated ? 'neq' : (field === 'text' ? 'contains' : 'eq'), rest);
      }
      match = /^([A-Za-z]+)\\s*(!=|!~|>=|<=|=|~|>|<)\\s*(.+)$/.exec(value);
      if (match && fieldFor(match[1])) {
        return row(fieldFor(match[1]), SYMBOL_OPERATORS[match[2]], unquote(match[3]));
      }
      if (/^-?[#@]/.test(value)) return row('tag', value.charAt(0) === '-' ? 'neq' : 'eq', value.replace(/^-/, ''));
      return row('text', 'contains', unquote(value));
    }

    /**
     * Run a search. A search that takes in what was typed empties the field;
     * one that only removes or adds a chip, or comes from the builder, keeps
     * it, as keepEntry says.
     */
    function run(text, keepEntry, incidental, focusBar) {
      awaitingApply = true;
      lastEntry = entry;
      entryAfterRun = keepEntry ? entry : '';
      // The host answers with a fresh snapshot, and the page rebuilds itself
      // from it. Without this the caret would be thrown away on every search,
      // so the next keystroke would go nowhere. A search built in the builder
      // keeps its own field instead.
      restoreFocus = focusBar !== false;
      // A facet click or a dropped chip is a step along the way, not a search
      // worth keeping: recording those evicts what the reader actually typed
      // from the short list of recent searches.
      options.apply(joinTags(String(text).trim()), !incidental);
    }

    /**
     * Narrow by a facet value: add it, leave it out with Alt, or with Shift
     * allow it as well as the value of the same facet already chosen.
     */
    function refine(clause, facetId, mode) {
      const text = appliedText().trim();
      if (mode === 'or') {
        const facet = (query().facets || []).find(function (candidate) { return candidate.id === facetId; });
        const existing = facet && facet.applied && facet.applied[0];
        const merged = existing ? mergeAlternative(text, existing, clause) : undefined;
        if (merged !== undefined) {
          run(merged, true, true);
          return;
        }
      }
      const term = mode === 'exclude' ? '-' + clause : clause;
      if (!text) run(term, true, true);
      else if (query().canAppend === false) run('(' + text + ') AND ' + term, true, true);
      else run(text + ' AND ' + term, true, true);
    }

    /** Put a clause beside an existing one as an alternative. */
    function mergeAlternative(text, existing, clause) {
      const escaped = existing.replace(/[.*+?^$(){}|[\\]\\\\]/g, '\\\\$&');
      const match = new RegExp('(^|[\\\\s(])' + escaped + '(?=$|[\\\\s)])', 'i').exec(text);
      if (!match) return undefined;
      const start = match.index + match[1].length;
      const end = start + existing.length;
      let depth = 0;
      for (let position = 0; position < start; position += 1) {
        if (text.charAt(position) === '(') depth += 1;
        if (text.charAt(position) === ')') depth -= 1;
      }
      return depth > 0
        ? text.slice(0, end) + ' OR ' + clause + text.slice(end)
        : text.slice(0, start) + '(' + existing + ' OR ' + clause + ')' + text.slice(end);
    }

    /**
     * Completions for the word under the caret in the bar. After a field
     * and its operator they are that field's values; otherwise conditions,
     * field names, and tags, each of which stands on its own. An empty bar
     * offers recent searches.
     */
    function queryBarSuggestions(input) {
      const all = suggestions();
      if (!input.value.trim()) {
        return {
          token: '',
          showAll: true,
          items: (all.recent || []).slice(0, 8).map(function (item) {
            // A recent search is a whole search, so choosing one runs it.
            return { value: item.value, label: item.label, detail: item.detail, insert: item.value, replaceAll: true, apply: true };
          }),
        };
      }
      const caret = caretPosition(input);
      const prefix = input.value.slice(0, caret);
      const context = valueContext(prefix, all.aliases || {});
      if (context) {
        const values = (all.values || {})[context.field] || [];
        return {
          token: context.token,
          items: values.map(function (item) {
            return { value: item.value, label: item.label, detail: item.detail, insert: quoteQueryValue(item.value) + ' ', term: true };
          }),
        };
      }
      const token = (prefix.match(/[^\\s()]*$/) || [''])[0];
      const conditions = (all.conditions || []).map(function (item) {
        return { value: item.value, label: item.label, detail: item.detail, insert: item.value + ' ', term: true };
      });
      const fields = (all.fields || []).map(function (item) {
        const shorthand = SHORTHAND_FIELDS.indexOf(item.value) >= 0;
        return { value: item.value, label: item.label + (shorthand ? ':' : ' ='), detail: item.detail, insert: item.value + (shorthand ? ':' : ' = ') };
      });
      const tags = ((all.values || {}).tag || []).map(function (item) {
        return { value: item.value, label: item.label, detail: item.detail, insert: item.value + ' ', term: true };
      });
      return { token: token, items: conditions.concat(fields, tags) };
    }

    /** Where the caret sits, defaulting to the end of the value. */
    function caretPosition(input) {
      return typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
    }

    /** Detect a caret in the value of a field condition, such as is:ov. */
    function valueContext(prefix, aliases) {
      const match = prefix.match(/([A-Za-z]+)\\s*(!=|!~|>=|<=|[:=~<>])\\s*([^\\s()]*)$/);
      if (!match) return undefined;
      const field = aliases[match[1].toLowerCase()];
      return field ? { field: field, token: match[3] } : undefined;
    }

    /** Completions for one builder row's value. */
    function builderValueSuggestions(field, token) {
      const values = (suggestions().values || {})[field] || [];
      return {
        token: token,
        items: values.map(function (item) {
          return { value: item.value, label: item.label, detail: item.detail, insert: item.value };
        }),
      };
    }

    /**
     * Completions for a new row, which starts from a value: a condition, a
     * tag, a field to fill in, or failing those the words themselves.
     */
    function pendingRowSuggestions(token) {
      const all = suggestions();
      const conditions = (all.conditions || []).map(function (item) {
        return { value: item.value, label: item.label, detail: item.detail, condition: item.value };
      });
      const tags = ((all.values || {}).tag || []).map(function (item) {
        return { value: item.value, label: item.label, detail: item.detail, condition: item.value };
      });
      const fields = (all.fields || []).map(function (item) {
        return { value: item.value, label: item.label + (SHORTHAND_FIELDS.indexOf(item.value) >= 0 ? ':' : ' =') + ' …', detail: item.detail, field: item.value };
      });
      const words = token && !/^-?[#@]/.test(token)
        ? [{ value: token, label: 'text ~ ' + quoteQueryValue(token), detail: 'Entries containing these words', condition: 'text ~ ' + quoteQueryValue(token), always: true }]
        : [];
      return { token: token, items: conditions.concat(tags, fields, words) };
    }

    /** Populate and show the list attached to an input. */
    function openSuggestions(input) {
      const key = input.dataset.suggestKey;
      if (!key) return;
      const source = key === 'query'
        ? queryBarSuggestions(input)
        : input.dataset.pending
          ? pendingRowSuggestions(input.value.trim())
          : builderValueSuggestions(input.dataset.field, input.value);
      const token = String(source.token || '').toLowerCase();
      suggestionItems = source.showAll
        ? source.items
        : !token
          ? []
          : source.items.filter(function (item) {
            return item.always
              || String(item.value).toLowerCase().indexOf(token) >= 0
              || String(item.label).toLowerCase().indexOf(token) >= 0;
          }).slice(0, 12);
      suggestionToken = String(source.token || '');
      suggestionHostKey = key;
      // Nothing is highlighted until the author arrows into the list, so
      // Enter runs what they typed instead of silently taking a completion.
      suggestionIndex = -1;
      renderSuggestions(input);
    }

    function suggestionContainer(key) {
      return document.querySelector('[data-suggestions="' + key + '"]');
    }

    function renderSuggestions(input) {
      const container = suggestionContainer(suggestionHostKey);
      if (!container) return;
      if (!suggestionItems.length) {
        container.hidden = true;
        container.innerHTML = '';
        if (input) input.setAttribute('aria-expanded', 'false');
        return;
      }
      container.innerHTML = suggestionItems.map(function (item, index) {
        return '<button type="button" role="option" aria-selected="' + (index === suggestionIndex) + '" class="query-suggestion' + (index === suggestionIndex ? ' active' : '') + '" data-action="query-suggestion" data-suggestion-index="' + index + '"><span class="query-suggestion-label">' + renderTermText(item.label) + '</span>' + (item.detail ? '<span class="query-suggestion-detail">' + escapeHtml(item.detail) + '</span>' : '') + '</button>';
      }).join('');
      container.hidden = false;
      if (input) input.setAttribute('aria-expanded', 'true');
    }

    function closeSuggestions() {
      suggestionItems = [];
      suggestionIndex = -1;
      const container = suggestionContainer(suggestionHostKey);
      if (container) {
        container.hidden = true;
        container.innerHTML = '';
      }
      suggestionHostKey = undefined;
    }

    function rowAt(tree, input) {
      const item = itemAt(tree, pathOf(input));
      return item && !item.items ? item : undefined;
    }

    /**
     * Turn a new row into the condition it was given, and open another new
     * row after it so the next condition can be typed straight away.
     */
    function commitPendingRow(input, conditionText) {
      const text = String(conditionText).trim();
      if (!text) return;
      const tree = builderTree();
      const path = pathOf(input);
      const parent = groupAt(tree, path.slice(0, -1));
      const index = path[path.length - 1];
      if (!parent || !parent.items[index]) return;
      parent.items[index] = parseConditionText(text);
      parent.items.push(pendingRow());
      pendingBuilderFocus = { path: pathText(path.slice(0, -1).concat(parent.items.length - 1)) };
      applyBuilderTree(tree);
    }

    /** Replace the word being completed with the chosen suggestion. */
    function acceptSuggestion(index) {
      const item = suggestionItems[index];
      if (!item) return;
      const key = suggestionHostKey;
      const input = document.querySelector('[data-suggest-key="' + key + '"]');
      if (!input) return;

      if (key === 'query') {
        closeSuggestions();
        // A recent search is a whole search, and replaces this one.
        if (item.apply) {
          setEntry(input, '');
          run(item.insert);
          return;
        }
        const caret = caretPosition(input);
        const start = caret - suggestionToken.length;
        const text = input.value.slice(0, start) + item.insert + input.value.slice(caret);
        // A tag or condition, or a field's value, is a whole term: it becomes
        // a chip at once. A field name waits for its value.
        if (item.term) {
          setEntry(input, '');
          run(combineQuery(appliedText(), text));
          return;
        }
        setEntry(input, text);
        const nextCaret = start + item.insert.length;
        input.setSelectionRange(nextCaret, nextCaret);
        input.focus();
        return;
      }

      closeSuggestions();
      if (input.dataset.pending) {
        if (item.field) {
          // A field chosen without a value becomes an ordinary row to fill in.
          const tree = builderTree();
          const path = pathOf(input);
          const parent = groupAt(tree, path.slice(0, -1));
          if (!parent) return;
          parent.items[path[path.length - 1]] = { field: item.field, operator: operatorsFor(item.field)[0], value: '', supported: true, text: '' };
          pendingBuilderFocus = { path: pathText(path) };
          builderDraft = tree;
          options.render();
          return;
        }
        commitPendingRow(input, item.condition);
        return;
      }
      // A builder value is committed as soon as it is chosen, so the results
      // update without waiting for the field to lose focus.
      input.value = item.insert;
      commitBuilderValue(input);
    }

    function commitBuilderValue(input) {
      const tree = builderTree();
      const row = rowAt(tree, input);
      if (!row) return;
      row.value = input.value;
      pendingBuilderFocus = { path: String(input.dataset.path || '') };
      applyBuilderTree(tree);
    }

    function removeRow(input) {
      const tree = builderTree();
      const removed = removeItem(tree, pathOf(input));
      if (!removed) return;
      const index = removed.path[removed.path.length - 1];
      if (index > 0) pendingBuilderFocus = { path: pathText(removed.path.slice(0, -1).concat(index - 1)) };
      applyBuilderTree(tree);
    }

    /** Takes the row or group at path out of the tree. A group left with
        nothing in it goes too, and so on upward, so an emptied group never
        lingers as a box with only a head; the root is the one group that
        stays. Returns the path that was finally removed, or null. */
    function removeItem(tree, path) {
      if (!path.length) return null;
      let at = path.slice();
      for (;;) {
        const parent = groupAt(tree, at.slice(0, -1));
        if (!parent) return null;
        parent.items.splice(at[at.length - 1], 1);
        if (parent.items.length || at.length === 1) return { path: at };
        at = at.slice(0, -1);
      }
    }

    /** A group inside the group at path, joined the other way, with a row to type in. */
    function addGroup(path) {
      const tree = builderTree();
      const parent = groupAt(tree, path);
      if (!parent) return;
      parent.items.push({ join: parent.join === 'or' ? 'and' : 'or', items: [pendingRow()] });
      pendingBuilderFocus = { path: pathText(path.concat(parent.items.length - 1, 0)) };
      applyBuilderTree(tree);
    }

    function isEditable(target) {
      return Boolean(target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]'));
    }

    return {
      renderBar: renderBar,
      renderFacets: renderFacets,
      currentText: currentText,

      /**
       * The plain words of a search, which a page can match at once because
       * every one of them must appear. A field, its operator, and its value
       * are a condition rather than words, and a search with OR, NOT, or
       * parentheses is not only words, so it waits for the host.
       */
      previewWords: function (text) {
        const value = String(text || '');
        if (/(^|\\s)(or|not)(\\s|$)|\\|\\||[()]/i.test(value)) return [];
        const tokens = value.split(/\\s+/).filter(Boolean);
        const words = [];
        let lastWordIndex = -2;
        for (let index = 0; index < tokens.length; index += 1) {
          const token = tokens[index];
          const operator = /^(!=|!~|>=|<=|=|~|>|<)/.exec(token);
          if (operator) {
            if (lastWordIndex === index - 1) words.pop();
            if (token === operator[1]) index += 1;
            continue;
          }
          if (!/^[-!#@"']/.test(token) && !/[:=<>~]/.test(token) && !/^(and|&&)$/i.test(token)) {
            words.push(token.toLowerCase());
            lastWordIndex = index;
          }
        }
        return words;
      },

      /** Reconcile with a fresh host state, before the page redraws. */
      receive: function () {
        const text = appliedText();
        // The answer to a search this editor ran replaces what was typed even
        // when the text comes back the same, as when a typed tag moves into
        // the page's title and leaves nothing behind.
        if (text !== appliedSeen || awaitingApply) {
          const input = document.activeElement;
          const typing = Boolean(input && input.dataset && input.dataset.action === 'query-input');
          // A search this editor ran turns what was typed into chips; one that
          // did not parse keeps it in the field with its error. Any other
          // change, such as a save elsewhere, leaves a term being typed.
          if (awaitingApply) {
            entry = query().pending ? lastEntry : entryAfterRun;
            draft = undefined;
          } else if (!typing) {
            entry = '';
            draft = undefined;
          }
          appliedSeen = text;
          awaitingApply = false;
        }
        if (text !== builderSourceText) {
          builderDraft = undefined;
          builderSourceText = text;
        }
      },

      /**
       * Told before the page redraws, so that taking the field out of the
       * document is not mistaken for the reader leaving it, and the caret can
       * be put back where they were typing.
       */
      beforeRender: function () {
        const active = document.activeElement;
        if (active && active.dataset && active.dataset.action === 'query-input') {
          redrawing = true;
          caretAtRedraw = active.selectionStart;
          restoreFocus = true;
        }
      },

      /** Restore focus and any open completion list after a redraw. */
      afterRender: function () {
        const caretWanted = caretAtRedraw;
        redrawing = false;
        caretAtRedraw = undefined;
        if (restoreFocus) {
          restoreFocus = false;
          const bar = document.querySelector('[data-suggest-key="query"]');
          if (bar && bar.focus) {
            // Putting the caret back is not the reader asking for the recent
            // searches: only focusing the empty box by hand opens those.
            if (!openSuggestionsOnRestore) suppressFocusSuggestions = true;
            openSuggestionsOnRestore = false;
            bar.focus();
            suppressFocusSuggestions = false;
            const typed = bar.value ? bar.value.length : 0;
            // Back where they were typing, not at the end: a redraw in the
            // middle of a word would otherwise move the caret under them.
            const caret =
              caretWanted === undefined || caretWanted === null
                ? typed
                : Math.min(caretWanted, typed);
            if (bar.setSelectionRange) bar.setSelectionRange(caret, caret);
          }
        }
        if (pendingBuilderFocus) {
          const target = document.querySelector('[data-action="builder-set-value"][data-path="' + pendingBuilderFocus.path + '"]');
          pendingBuilderFocus = undefined;
          if (target && target.focus) target.focus();
        }
        if (suggestionHostKey && suggestionItems.length) {
          renderSuggestions(document.querySelector('[data-suggest-key="' + suggestionHostKey + '"]'));
        }
      },

      /** Put the caret in the search box, with its recent searches. */
      focus: function () {
        restoreFocus = true;
        openSuggestionsOnRestore = true;
        options.render();
      },

      handleMousedown: function (event) {
        // Pressing on a completion must not move focus out of its field: a
        // builder value commits on blur, which would redraw the row and
        // destroy the completion before its click could land.
        if (event.target.closest && event.target.closest('[data-action="query-suggestion"]')) {
          event.preventDefault();
          return true;
        }
        // Pressing the field around the chips puts the caret in it.
        const shell = event.target.classList && event.target.classList.contains('query-bar-shell') ? event.target : undefined;
        const input = shell ? shell.querySelector('[data-action="query-input"]') : undefined;
        if (input && input.focus) {
          event.preventDefault();
          input.focus();
          return true;
        }
        return false;
      },

      handleFocusIn: function (event) {
        const target = event.target;
        if (suppressFocusSuggestions) return;
        if (target && target.dataset && target.dataset.action === 'query-input' && !target.value) {
          openSuggestions(target);
        }
      },

      /** Returns true when the click belonged to the editor. */
      handleClick: function (event) {
        if (suggestionItems.length && !(event.target.closest && event.target.closest('.query-input-shell'))) {
          closeSuggestions();
        }
        const target = event.target.closest ? event.target.closest('[data-action]') : undefined;
        if (!target) return false;
        // A disabled button in the bar is there to hold its place, not to act.
        if (target.disabled === true || (target.getAttribute && target.getAttribute('disabled') !== null)) return true;
        const action = target.dataset.action;
        if (action === 'toggle-builder') {
          builderOpen = !builderOpen;
          if (builderOpen) {
            // The builder always opens with an empty row to type in, even when
            // the search already has conditions, such as a page's own tags.
            const tree = builderTree();
            if (!tree.items.some(function (item) { return !item.items && item.pending; })) {
              tree.items.push(pendingRow());
            }
            builderDraft = tree;
            pendingBuilderFocus = { path: pathText([tree.items.length - 1]) };
          }
          options.render();
          return true;
        }
        if (action === 'apply-query') {
          closeSuggestions();
          run(currentText());
          return true;
        }
        if (action === 'clear-query') {
          entry = '';
          entryAfterRun = '';
          document.querySelectorAll('[data-suggest-key="query"]').forEach(function (bar) { bar.value = ''; });
          draft = clearedText();
          closeSuggestions();
          awaitingApply = true;
          syncTextButtons(draft);
          if (options.onDraft) options.onDraft(draft);
          options.clear();
          return true;
        }
        if (action === 'query-suggestion') {
          acceptSuggestion(Number(target.dataset.suggestionIndex));
          return true;
        }
        if (action === 'remove-term') {
          closeSuggestions();
          run(target.dataset.without || '', true, true);
          const bar = document.querySelector('[data-suggest-key="query"]');
          if (bar && bar.focus) bar.focus();
          return true;
        }
        if (action === 'facet') {
          refine(target.dataset.clause, target.dataset.facetId, event.altKey ? 'exclude' : event.shiftKey ? 'or' : 'and');
          return true;
        }
        if (action === 'builder-add-group') {
          addGroup(pathOf(target));
          return true;
        }
        if (action === 'builder-add-row') {
          const tree = builderTree();
          const path = pathOf(target);
          const group = groupAt(tree, path);
          if (group) {
            group.items.push(pendingRow());
            pendingBuilderFocus = { path: pathText(path.concat(group.items.length - 1)) };
            applyBuilderTree(tree);
          }
          return true;
        }
        if (action === 'builder-remove-group' || action === 'builder-remove-row') {
          const tree = builderTree();
          if (removeItem(tree, pathOf(target))) applyBuilderTree(tree);
          return true;
        }
        if (action === 'builder-toggle-not') {
          const tree = builderTree();
          const group = groupAt(tree, pathOf(target));
          if (group) {
            group.negated = !group.negated;
            applyBuilderTree(tree);
          }
          return true;
        }
        return false;
      },

      /** Returns true when the key belonged to the editor. */
      handleKeydown: function (event) {
        const input = event.target.closest ? event.target.closest('[data-suggest-key]') : undefined;
        if (!input) {
          if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !isEditable(event.target)) {
            event.preventDefault();
            restoreFocus = true;
            options.render();
            return true;
          }
          return false;
        }
        const isBar = input.dataset.suggestKey === 'query';
        if (event.key === 'ArrowDown' && suggestionItems.length) {
          event.preventDefault();
          suggestionIndex = (suggestionIndex + 1) % suggestionItems.length;
          renderSuggestions(input);
          return true;
        }
        if (event.key === 'ArrowUp' && suggestionItems.length) {
          event.preventDefault();
          suggestionIndex = (suggestionIndex - 1 + suggestionItems.length) % suggestionItems.length;
          renderSuggestions(input);
          return true;
        }
        if (event.key === 'Tab' && suggestionItems.length) {
          // Tab means "complete this", so it takes the first entry when the
          // author has not picked one.
          event.preventDefault();
          acceptSuggestion(suggestionIndex >= 0 ? suggestionIndex : 0);
          return true;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          if (!isBar && (event.metaKey || event.ctrlKey)) {
            closeSuggestions();
            addGroup(pathOf(input).slice(0, -1));
            return true;
          }
          if (suggestionItems.length && suggestionIndex >= 0) {
            acceptSuggestion(suggestionIndex);
            return true;
          }
          closeSuggestions();
          if (isBar) run(currentText());
          else if (input.dataset.pending) commitPendingRow(input, input.value);
          else commitBuilderValue(input);
          return true;
        }
        // Backspace in an empty field removes the last chip.
        if (isBar && event.key === 'Backspace' && !input.value && draft === undefined) {
          const terms = query().terms || [];
          if (appliedText().trim()) {
            event.preventDefault();
            closeSuggestions();
            run(terms.length ? terms[terms.length - 1].without : '', false, true);
          }
          return true;
        }
        if (event.key === 'Backspace' && !isBar && !input.value) {
          event.preventDefault();
          closeSuggestions();
          removeRow(input);
          return true;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          if (suggestionItems.length) {
            closeSuggestions();
            return true;
          }
          if (isBar) {
            // Escape with no completions open abandons the term being typed.
            setEntry(input, '');
          }
          return true;
        }
        return true;
      },

      handleInput: function (event) {
        const target = event.target;
        if (target.dataset.action === 'query-input') {
          setEntry(target, target.value);
          openSuggestions(target);
          return true;
        }
        if (target.dataset.action === 'builder-set-value') {
          if (target.dataset.pending) {
            const tree = builderTree();
            const row = rowAt(tree, target);
            if (row) {
              row.value = target.value;
              builderDraft = tree;
            }
          }
          openSuggestions(target);
          return true;
        }
        return false;
      },

      handleChange: function (event) {
        const target = event.target;
        const action = target.dataset.action;
        if (action === 'builder-set-join') {
          const tree = builderTree();
          const group = groupAt(tree, pathOf(target));
          if (group) {
            group.join = target.value === 'or' ? 'or' : 'and';
            applyBuilderTree(tree);
          }
          return true;
        }
        if (action !== 'builder-set-field' && action !== 'builder-set-operator' && action !== 'builder-set-value') return false;
        // A new row waits for Enter or a completion; leaving it is not a choice.
        if (target.dataset.pending) return true;
        const tree = builderTree();
        const row = rowAt(tree, target);
        if (!row) return true;
        if (action === 'builder-set-field') {
          row.field = target.value;
          // Keep the operator valid for the new field.
          const allowed = operatorsFor(row.field);
          if (allowed.indexOf(row.operator) < 0) row.operator = allowed[0];
        }
        if (action === 'builder-set-operator') row.operator = target.value;
        if (action === 'builder-set-value') row.value = target.value;
        applyBuilderTree(tree);
        return true;
      },
    };
  }
`;
}

/**
 * A per-webview nonce for the inline style and script.
 */
export function createNonce(): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}

/**
 * The content security policy every webview uses.
 *
 * Scripts and styles are allowed only with the page's own nonce, so a policy
 * cannot drift looser on one page than another.
 */
export function getContentSecurityPolicy(
  cspSource: string,
  nonce: string,
  options: { images?: boolean; fonts?: boolean } = {},
): string {
  const directives = [
    `default-src 'none'`,
    `style-src ${cspSource} 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
  ];
  if (options.images) {
    directives.push(`img-src ${cspSource} data:`);
  }
  if (options.fonts) {
    directives.push(`font-src ${cspSource}`);
  }
  return `${directives.join('; ')};`;
}
