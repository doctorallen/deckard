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
button:hover, button.active, select:hover, input[type="text"]:focus, input[type="search"]:focus {
  border-color: var(--amber);
  background: var(--panel-raised);
  color: var(--amber);
}
button:focus-visible, select:focus-visible, input:focus-visible {
  outline: var(--edge) solid var(--cyan);
  outline-offset: 2px;
}
button[disabled] { opacity: .5; cursor: default; }
input[type="search"]::-webkit-search-cancel-button { cursor: pointer; }
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

/* A row of buttons that reads as one control. */
.segmented { display: inline-flex; }
.segmented > * + * { margin-left: calc(var(--edge) * -1); }
.segmented > :first-child { border-radius: 2px 0 0 2px; }
.segmented > :last-child { border-radius: 0 2px 2px 0; }
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
.settings-icon { fill: currentColor; stroke: none; }
.filter-count { color: var(--muted); font-size: 10px; }

/* The gear disclosure used for per-page view options. */
.view-options { position: relative; }
.view-options summary {
  display: grid;
  width: var(--control-height);
  min-height: var(--control-height);
  place-items: center;
  border: var(--edge) solid var(--line);
  background: var(--panel-deep);
  color: var(--text);
  padding: 5px;
  cursor: pointer;
  list-style: none;
}
.view-options summary::-webkit-details-marker { display: none; }
.view-options summary:hover { border-color: var(--amber); background: var(--panel-raised); color: var(--amber); }
.view-options summary:focus-visible { outline: var(--edge) solid var(--cyan); outline-offset: 2px; }
.view-options-menu {
  position: absolute;
  z-index: 3;
  top: calc(100% + 5px);
  right: 0;
  display: grid;
  gap: 10px;
  min-width: 230px;
  padding: 10px;
  border: var(--edge) solid var(--line);
  background: var(--panel-raised);
}
.view-options-group {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 11px;
  text-transform: uppercase;
}`;
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
.tag-open { min-height: 26px; padding: 3px 7px; color: var(--cyan); font-size: 11px; text-align: left; }
.inline-tag {
  min-height: 24px;
  margin-left: 3px;
  padding: 2px 4px;
  font-size: .78em;
  vertical-align: 1px;
}
.tag-namespace { opacity: .62; }
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
.task-filter-icon { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; }
.task-filter-toggle button {
  display: inline-flex;
  min-width: var(--control-height);
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(135px, 1fr));
  gap: 10px;
  margin-top: 20px;
}
.metric { min-width: 0; border: var(--edge) solid var(--line); background: var(--panel); padding: 12px; }
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
.board-cards { display: grid; gap: 8px; min-height: 48px; }
.board-card { position: relative; }
.board-card.dragging { opacity: .45; }
.board-card .task-title { padding-right: 26px; }
.board-details { margin: 0; }
/* Each detail stays whole; the line wraps between them. */
.board-details span { white-space: nowrap; }
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
.board-move:hover, .board-move:focus-visible { border-color: var(--amber); color: var(--amber); }
.board-empty { margin: 0; padding: 12px; border: 1px dashed var(--line); color: var(--muted); font-size: 12px; text-align: center; }
.board-more { margin: 0; color: var(--muted); font-size: 11px; }`;
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
  ].join('\n');
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

  /** The list, open-box, and checked-box icons used by task filters. */
  function taskFilterIcon(filter) {
    if (filter === 'all') return '<svg class="task-filter-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5 4h8M5 8h8M5 12h8"/><circle cx="2.5" cy="4" r=".5"/><circle cx="2.5" cy="8" r=".5"/><circle cx="2.5" cy="12" r=".5"/></svg>';
    if (filter === 'active') return '<svg class="task-filter-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>';
    return '<svg class="task-filter-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="3" y="3" width="10" height="10" rx="1"/><path d="m5.5 8 1.7 1.7 3.3-3.3"/></svg>';
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

  function openTagContextMenu(event, target) {
    const tagKey = target.dataset.tagKey;
    if (!tagKey) return;
    event.preventDefault();
    closeTagContextMenu();
    if (!tagContextMenu) {
      tagContextMenu = document.createElement('div');
      tagContextMenu.id = 'tag-context-menu';
      tagContextMenu.className = 'tag-context-menu';
      tagContextMenu.setAttribute('role', 'menu');
      document.body.appendChild(tagContextMenu);
    }
    tagContextKey = tagKey;
    tagContextMenu.innerHTML = '<button type="button" role="menuitem" data-context-action="rename-tag">Rename tag</button>';
    tagContextMenu.hidden = false;
    const bounds = tagContextMenu.getBoundingClientRect();
    tagContextMenu.style.left = Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8)) + 'px';
    tagContextMenu.style.top = Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8)) + 'px';
    tagContextMenu.querySelector('button').focus();
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
      + [['status', 'Status'], ['priority', 'Priority'], ['due', 'Due date']].map(function (option) {
        const active = option[0] === groupBy;
        return '<button type="button" class="' + (active ? 'active' : '') + '" data-action="set-board-group" data-group="' + option[0] + '" aria-pressed="' + active + '">' + option[1] + '</button>';
      }).join('') + '</div>';
  }

  /** One task card, with its checkbox and the menu that moves it to another column. */
  function renderTaskBoardCard(card, columnId, columns) {
    const moves = columns.filter(function (column) {
      return column.droppable && column.id !== columnId;
    }).map(function (column) {
      return '<option value="' + escapeHtml(column.id) + '">' + escapeHtml(column.label) + '</option>';
    }).join('');
    const details = card.details.map(function (detail) {
      const overdue = card.overdue && detail.indexOf('due ') === 0;
      return '<span' + (overdue ? ' class="overdue"' : '') + '>' + escapeHtml(detail) + '</span>';
    }).join(' · ');
    return '<article class="task board-card' + (card.completed ? ' completed' : '') + '" draggable="true" tabindex="0"'
      + ' data-task-id="' + escapeHtml(card.taskId) + '" data-file-path="' + escapeHtml(card.filePath) + '" data-line="' + card.line + '">'
      + '<input type="checkbox" data-action="board-toggle-task" title="' + (card.completed ? 'Reopen' : 'Complete') + ' this task"' + (card.completed ? ' checked' : '') + '>'
      + '<div class="task-summary"><div class="task-title">' + renderInlineTitle(card.title, card.titleTags, false) + '</div>'
      + '<p class="source board-details">' + details + '</p>'
      + '<select class="board-move" data-action="board-move" title="Move to another column" aria-label="Move this task to another column"><option value="" selected hidden>⋯</option>' + moves + '</select>'
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
        ? cards.map(function (card) { return renderTaskBoardCard(card, column.id, board.columns); }).join('')
        : '<p class="board-empty">' + (column.droppable ? 'Drop a task here' : 'No tasks') + '</p>';
      return '<section class="board-column' + (column.id === 'due:overdue' ? ' is-overdue' : '') + '"'
        + ' data-column-id="' + escapeHtml(column.id) + '" data-droppable="' + column.droppable + '"'
        + ' aria-label="' + escapeHtml(column.label + ', ' + count + (count === 1 ? ' task' : ' tasks')) + '">'
        + '<h2 class="board-column-title"><span>' + escapeHtml(column.label) + '</span><span class="board-count">' + count + '</span></h2>'
        + '<div class="board-cards">' + body + '</div>'
        + (column.hiddenCount ? '<p class="board-more">and ' + column.hiddenCount + ' more</p>' : '')
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
