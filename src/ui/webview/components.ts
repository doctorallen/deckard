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
.query-suggestions { position: absolute; z-index: 12; top: calc(100% + 2px); left: 0; right: 0; max-height: 260px; overflow-y: auto; border: var(--edge) solid var(--amber); background: var(--panel-raised); }
.query-suggestions[hidden] { display: none; }
.query-suggestion { display: flex; width: 100%; align-items: baseline; justify-content: space-between; gap: 10px; border: 0; background: transparent; padding: 6px 9px; text-align: left; font: 12px var(--font-mono); }
.query-suggestion:hover, .query-suggestion.active { background: var(--panel-deep); color: var(--amber); }
.query-suggestion-detail { color: var(--muted); font-size: 10px; }
.query-status { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 0 10px 10px; color: var(--muted); font-size: 11px; }
.query-error { color: #FF8080; font: 11px var(--font-mono); }
.query-hint { color: var(--muted); font: 11px var(--font-mono); }
.query-terms { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 10px 10px; }
.query-term { display: inline-flex; align-items: center; gap: 2px; border: 1px solid var(--line-strong); background: var(--panel); padding: 1px 2px 1px 8px; }
.query-term code { color: var(--cyan); font-size: 11px; }
.query-term-remove { min-height: 22px; border: 0; background: transparent; color: var(--muted); padding: 0 6px; font-size: 13px; line-height: 1; }
.query-term-remove:hover, .query-term-remove:focus-visible { border: 0; background: transparent; color: var(--amber); }
.query-builder { border-top: var(--edge) solid var(--line); padding: 10px; }
.query-builder-group { border: var(--edge) solid var(--line); background: var(--panel); padding: 10px; }
.query-builder-group + .query-builder-or { display: block; margin: 8px 0; color: var(--amber); font: 11px var(--font-mono); letter-spacing: .12em; text-align: center; text-transform: uppercase; }
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
.query-facets { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 18px; margin-top: 12px; padding: 10px; border: 1px dashed var(--line-strong); }
.query-facets-heading { color: var(--amber); font: 11px var(--font-mono); letter-spacing: .12em; text-transform: uppercase; }
.query-facet { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.query-facet-label { margin-right: 2px; color: var(--muted); font: 10px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
.query-facet-value { display: inline-flex; align-items: baseline; gap: 5px; min-height: 26px; padding: 3px 8px; font-size: 11px; text-transform: none; }
.query-facet-count { color: var(--muted); font-size: 10px; }`;
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

    /** Text being typed; undefined means the box shows the applied search. */
    let draft;
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
    let suggestionItems = [];
    let suggestionIndex = -1;
    /** Which input the completion list belongs to, if any. */
    let suggestionHostKey;
    /** The partial text the completion list is filtering on. */
    let suggestionToken = '';

    function query() { return options.getState() || {}; }
    function suggestions() { return query().suggestions || {}; }
    function appliedText() { return query().text || ''; }
    function currentText() { return draft === undefined ? appliedText() : draft; }
    function operatorsFor(field) {
      const table = suggestions().operators || DEFAULT_OPERATORS;
      return table[field] || DEFAULT_OPERATORS[field] || ['eq'];
    }
    function fieldNames() {
      const listed = (suggestions().fields || []).map(function (field) { return field.value; });
      return listed.length ? listed : Object.keys(DEFAULT_OPERATORS);
    }
    function placeholder() {
      return typeof options.placeholder === 'function' ? options.placeholder() : (options.placeholder || '');
    }

    /** The bar, its status line, the search's terms, and the builder. */
    function renderBar() {
      const value = currentText();
      const errors = (query().diagnostics || []).filter(function (diagnostic) { return diagnostic.severity === 'error'; });
      const counts = query().matchCounts || { notes: 0, tasks: 0 };
      const status = errors.length
        ? '<span class="query-error" role="alert">' + escapeHtml(errors[0].message) + '</span>'
        : '<span class="query-hint">Enter searches. Words, #tags, is:open, has:due, in:folder; AND, OR, NOT. Press / to search.</span>';
      const summary = appliedText().trim()
        ? '<span>' + counts.notes + ' ' + (counts.notes === 1 ? 'note' : 'notes') + ' &middot; ' + counts.tasks + ' ' + (counts.tasks === 1 ? 'task' : 'tasks') + '</span>'
        : '';
      const label = options.label || 'Search';
      return '<section class="query-workspace" aria-label="' + escapeHtml(label) + '">'
        + '<div class="query-bar-row">'
        + '<span class="query-input-shell"><input class="query-input' + (errors.length ? ' invalid' : '') + '" type="text" data-action="query-input" data-suggest-key="query" spellcheck="false" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-label="' + escapeHtml(label) + '" placeholder="' + escapeHtml(placeholder()) + '" value="' + escapeHtml(value) + '"><div class="query-suggestions" data-suggestions="query" hidden role="listbox"></div></span>'
        + '<button data-action="apply-query" title="Run this search">Search</button>'
        + '<button data-action="toggle-builder" aria-expanded="' + builderOpen + '" title="Build the search one condition at a time">' + (builderOpen ? 'Hide builder' : 'Builder') + '</button>'
        + (value ? '<button data-action="clear-query" title="Clear the search">Clear</button>' : '')
        + '</div>'
        + '<div class="query-status">' + status + summary + '</div>'
        + renderTerms()
        + renderBuilder()
        + '</section>';
    }

    /** Each term of a search of several, removable on its own. */
    function renderTerms() {
      const terms = query().terms || [];
      if (terms.length < 2) return '';
      return '<div class="query-terms" aria-label="Search terms">' + terms.map(function (term) {
        return '<span class="query-term"><code>' + escapeHtml(term.text) + '</code><button class="query-term-remove" data-action="remove-term" data-without="' + escapeHtml(term.without) + '" aria-label="Remove ' + escapeHtml(term.text) + '" title="Remove ' + escapeHtml(term.text) + '">&#215;</button></span>';
      }).join('') + '</div>';
    }

    /** What the results could still be narrowed by, with counts. */
    function renderFacets() {
      const facets = query().facets || [];
      if (!facets.length) return '';
      return '<section class="query-facets" aria-label="Refine these results"><span class="query-facets-heading">Refine</span>' + facets.map(function (facet) {
        return '<div class="query-facet" role="group" aria-label="' + escapeHtml(facet.label) + '"><span class="query-facet-label">' + escapeHtml(facet.label) + '</span>' + facet.values.map(function (value) {
          return '<button class="query-facet-value" data-action="facet" data-facet-id="' + escapeHtml(facet.id) + '" data-clause="' + escapeHtml(value.clause) + '" title="Show only these. Alt-click to leave them out; Shift-click to allow them as well." aria-label="' + escapeHtml(facet.label + ': ' + value.label + ', ' + value.count) + '">' + (facet.id === 'tags' ? renderTagLabel(value.label) : escapeHtml(value.label)) + '<span class="query-facet-count">' + value.count + '</span></button>';
        }).join('') + '</div>';
      }).join('') + '</section>';
    }

    /** OR groups of AND rows over the host's parse of the search. */
    function renderBuilder() {
      if (!builderOpen) return '';
      const draftGroups = builderGroups();
      const groups = draftGroups.length ? draftGroups : [{ rows: [] }];
      const groupsHtml = groups.map(function (group, groupIndex) {
        const rows = group.rows.length
          ? group.rows.map(function (row, rowIndex) { return renderBuilderRow(row, groupIndex, rowIndex); }).join('')
          : '<p class="query-builder-note">This group is empty. Add a condition to start it.</p>';
        return (groupIndex > 0 ? '<span class="query-builder-or">or</span>' : '')
          + '<div class="query-builder-group" data-group-index="' + groupIndex + '">' + rows
          + '<div class="query-builder-actions"><button data-action="builder-add-row" data-group-index="' + groupIndex + '">Add condition</button>'
          + (groups.length > 1 ? '<button data-action="builder-remove-group" data-group-index="' + groupIndex + '">Remove group</button>' : '')
          + '</div></div>';
      }).join('');
      const note = query().isBuildable === false
        ? '<p class="query-builder-note">Some conditions were written by hand and are shown as text. Editing them in the search box keeps them exactly as written.</p>'
        : '';
      return '<div class="query-builder">' + groupsHtml
        + '<div class="query-builder-actions"><button data-action="builder-add-group">Add OR group</button></div>'
        + note
        + '<p class="query-builder-note">In a new row, type a tag, a word, or a value such as open. Enter adds another row, Backspace in an empty row removes it, and Ctrl or Cmd+Enter starts an OR group.</p>'
        + '</div>';
    }

    function renderBuilderRow(row, groupIndex, rowIndex) {
      const position = ' data-group-index="' + groupIndex + '" data-row-index="' + rowIndex + '"';
      const suggestKey = 'g' + groupIndex + 'r' + rowIndex;
      const joiner = '<span class="query-builder-and">' + (rowIndex === 0 ? 'where' : 'and') + '</span>';
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

    /**
     * Read the builder's rows, seeding them from the host's parse on first
     * use. Returns a copy a caller can change and hand to applyBuilderGroups.
     */
    function builderGroups() {
      if (!builderDraft) {
        builderDraft = (query().groups || []).map(function (group) {
          return { rows: group.rows.map(function (row) { return Object.assign({}, row); }) };
        });
        builderSourceText = appliedText();
      }
      return builderDraft.map(function (group) {
        return { rows: group.rows.map(function (row) { return Object.assign({}, row); }) };
      });
    }

    /**
     * Adopt edited rows, then run the search they describe. A row still
     * empty changes the rows without changing the search, so that case
     * redraws locally instead of making a round trip that would drop it.
     */
    function applyBuilderGroups(groups) {
      builderDraft = groups;
      const text = buildQueryFromGroups(groups);
      if (text === appliedText()) {
        options.render();
        return;
      }
      builderSourceText = text;
      draft = text;
      run(text);
    }

    /** Write rows as search text, skipping rows with no value yet. */
    function buildQueryFromGroups(groups) {
      const branches = groups.map(function (group) {
        return group.rows.map(function (row) {
          if (row.pending) return '';
          if (!row.supported) return row.text.trim();
          if (!String(row.value).trim()) return '';
          return formatBuilderCondition(row);
        }).filter(Boolean).join(' AND ');
      }).filter(Boolean);
      return branches.length <= 1
        ? (branches[0] || '')
        : branches.map(function (branch) {
          return branch.indexOf(' AND ') >= 0 ? '(' + branch + ')' : branch;
        }).join(' OR ');
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

    function run(text) {
      awaitingApply = true;
      options.apply(String(text).trim());
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
          run(merged);
          return;
        }
      }
      const term = mode === 'exclude' ? '-' + clause : clause;
      if (!text) run(term);
      else if (query().canAppend === false) run('(' + text + ') ' + term);
      else run(text + ' ' + term);
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
            return { value: item.value, label: item.label, detail: item.detail, insert: item.value, replaceAll: true };
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
            return { value: item.value, label: item.label, detail: item.detail, insert: quoteQueryValue(item.value) + ' ' };
          }),
        };
      }
      const token = (prefix.match(/[^\\s()]*$/) || [''])[0];
      const conditions = (all.conditions || []).map(function (item) {
        return { value: item.value, label: item.label, detail: item.detail, insert: item.value + ' ' };
      });
      const fields = (all.fields || []).map(function (item) {
        const shorthand = SHORTHAND_FIELDS.indexOf(item.value) >= 0;
        return { value: item.value, label: item.label + (shorthand ? ':' : ' ='), detail: item.detail, insert: item.value + (shorthand ? ':' : ' = ') };
      });
      const tags = ((all.values || {}).tag || []).map(function (item) {
        return { value: item.value, label: item.label, detail: item.detail, insert: item.value + ' ' };
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
        return '<button type="button" role="option" aria-selected="' + (index === suggestionIndex) + '" class="query-suggestion' + (index === suggestionIndex ? ' active' : '') + '" data-action="query-suggestion" data-suggestion-index="' + index + '"><span>' + escapeHtml(item.label) + '</span>' + (item.detail ? '<span class="query-suggestion-detail">' + escapeHtml(item.detail) + '</span>' : '') + '</button>';
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

    function rowAt(groups, input) {
      const group = groups[Number(input.dataset.groupIndex)];
      return group ? group.rows[Number(input.dataset.rowIndex)] : undefined;
    }

    /**
     * Turn a new row into the condition it was given, and open another new
     * row after it so the next condition can be typed straight away.
     */
    function commitPendingRow(input, conditionText) {
      const text = String(conditionText).trim();
      if (!text) return;
      const groups = builderGroups();
      const groupIndex = Number(input.dataset.groupIndex);
      const rowIndex = Number(input.dataset.rowIndex);
      const group = groups[groupIndex];
      if (!group || !group.rows[rowIndex]) return;
      group.rows[rowIndex] = parseConditionText(text);
      group.rows.push(pendingRow());
      pendingBuilderFocus = { groupIndex: groupIndex, rowIndex: group.rows.length - 1 };
      applyBuilderGroups(groups);
    }

    /** Replace the word being completed with the chosen suggestion. */
    function acceptSuggestion(index) {
      const item = suggestionItems[index];
      if (!item) return;
      const key = suggestionHostKey;
      const input = document.querySelector('[data-suggest-key="' + key + '"]');
      if (!input) return;

      if (key === 'query') {
        const caret = caretPosition(input);
        const start = item.replaceAll ? 0 : caret - suggestionToken.length;
        const end = item.replaceAll ? input.value.length : caret;
        input.value = input.value.slice(0, start) + item.insert + input.value.slice(end);
        const nextCaret = start + item.insert.length;
        closeSuggestions();
        input.setSelectionRange(nextCaret, nextCaret);
        draft = input.value;
        if (options.onDraft) options.onDraft(draft);
        input.focus();
        return;
      }

      closeSuggestions();
      if (input.dataset.pending) {
        if (item.field) {
          // A field chosen without a value becomes an ordinary row to fill in.
          const groups = builderGroups();
          const groupIndex = Number(input.dataset.groupIndex);
          const rowIndex = Number(input.dataset.rowIndex);
          groups[groupIndex].rows[rowIndex] = { field: item.field, operator: operatorsFor(item.field)[0], value: '', supported: true, text: '' };
          pendingBuilderFocus = { groupIndex: groupIndex, rowIndex: rowIndex };
          builderDraft = groups;
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
      const groups = builderGroups();
      const row = rowAt(groups, input);
      if (!row) return;
      row.value = input.value;
      pendingBuilderFocus = { groupIndex: Number(input.dataset.groupIndex), rowIndex: Number(input.dataset.rowIndex) };
      applyBuilderGroups(groups);
    }

    function removeRow(input) {
      const groups = builderGroups();
      const groupIndex = Number(input.dataset.groupIndex);
      const rowIndex = Number(input.dataset.rowIndex);
      const group = groups[groupIndex];
      if (!group) return;
      group.rows.splice(rowIndex, 1);
      if (rowIndex > 0) pendingBuilderFocus = { groupIndex: groupIndex, rowIndex: rowIndex - 1 };
      applyBuilderGroups(groups);
    }

    function addGroup() {
      const groups = builderGroups();
      groups.push({ rows: [pendingRow()] });
      pendingBuilderFocus = { groupIndex: groups.length - 1, rowIndex: 0 };
      applyBuilderGroups(groups);
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
          // A search this editor ran replaces what was typed. Any other
          // change, such as a save elsewhere, leaves a search being typed.
          if (awaitingApply || !typing || draft === undefined) draft = undefined;
          appliedSeen = text;
          awaitingApply = false;
        }
        if (text !== builderSourceText) {
          builderDraft = undefined;
          builderSourceText = text;
        }
      },

      /** Restore focus and any open completion list after a redraw. */
      afterRender: function () {
        if (restoreFocus) {
          restoreFocus = false;
          const bar = document.querySelector('[data-suggest-key="query"]');
          if (bar && bar.focus) {
            bar.focus();
            const caret = bar.value ? bar.value.length : 0;
            if (bar.setSelectionRange) bar.setSelectionRange(caret, caret);
          }
        }
        if (pendingBuilderFocus) {
          const target = document.querySelector('[data-action="builder-set-value"][data-group-index="' + pendingBuilderFocus.groupIndex + '"][data-row-index="' + pendingBuilderFocus.rowIndex + '"]');
          pendingBuilderFocus = undefined;
          if (target && target.focus) target.focus();
        }
        if (suggestionHostKey && suggestionItems.length) {
          renderSuggestions(document.querySelector('[data-suggest-key="' + suggestionHostKey + '"]'));
        }
      },

      /** Put the caret in the search box. */
      focus: function () {
        restoreFocus = true;
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
        return false;
      },

      handleFocusIn: function (event) {
        const target = event.target;
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
        const action = target.dataset.action;
        if (action === 'toggle-builder') {
          builderOpen = !builderOpen;
          const groups = builderGroups();
          if (builderOpen && groups.every(function (group) { return !group.rows.length; })) {
            builderDraft = [{ rows: [pendingRow()] }];
            pendingBuilderFocus = { groupIndex: 0, rowIndex: 0 };
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
          draft = '';
          closeSuggestions();
          awaitingApply = true;
          if (options.onDraft) options.onDraft('');
          options.clear();
          return true;
        }
        if (action === 'query-suggestion') {
          acceptSuggestion(Number(target.dataset.suggestionIndex));
          return true;
        }
        if (action === 'remove-term') {
          run(target.dataset.without || '');
          return true;
        }
        if (action === 'facet') {
          refine(target.dataset.clause, target.dataset.facetId, event.altKey ? 'exclude' : event.shiftKey ? 'or' : 'and');
          return true;
        }
        if (action === 'builder-add-group') {
          addGroup();
          return true;
        }
        if (action === 'builder-add-row') {
          const groups = builderGroups();
          const groupIndex = Number(target.dataset.groupIndex);
          const group = groups[groupIndex];
          if (group) {
            group.rows.push(pendingRow());
            pendingBuilderFocus = { groupIndex: groupIndex, rowIndex: group.rows.length - 1 };
            applyBuilderGroups(groups);
          }
          return true;
        }
        if (action === 'builder-remove-group') {
          const groups = builderGroups();
          groups.splice(Number(target.dataset.groupIndex), 1);
          applyBuilderGroups(groups);
          return true;
        }
        if (action === 'builder-remove-row') {
          const groups = builderGroups();
          const group = groups[Number(target.dataset.groupIndex)];
          if (group) {
            group.rows.splice(Number(target.dataset.rowIndex), 1);
            applyBuilderGroups(groups);
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
            addGroup();
            return true;
          }
          if (suggestionItems.length && suggestionIndex >= 0) {
            acceptSuggestion(suggestionIndex);
            return true;
          }
          closeSuggestions();
          if (isBar) run(input.value);
          else if (input.dataset.pending) commitPendingRow(input, input.value);
          else commitBuilderValue(input);
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
            // Escape with no completions open abandons the edit.
            draft = undefined;
            input.value = appliedText();
            if (options.onDraft) options.onDraft(input.value);
          }
          return true;
        }
        return true;
      },

      handleInput: function (event) {
        const target = event.target;
        if (target.dataset.action === 'query-input') {
          draft = target.value;
          openSuggestions(target);
          if (options.onDraft) options.onDraft(draft);
          return true;
        }
        if (target.dataset.action === 'builder-set-value') {
          if (target.dataset.pending) {
            const groups = builderGroups();
            const row = rowAt(groups, target);
            if (row) {
              row.value = target.value;
              builderDraft = groups;
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
        if (action !== 'builder-set-field' && action !== 'builder-set-operator' && action !== 'builder-set-value') return false;
        // A new row waits for Enter or a completion; leaving it is not a choice.
        if (target.dataset.pending) return true;
        const groups = builderGroups();
        const row = rowAt(groups, target);
        if (!row) return true;
        if (action === 'builder-set-field') {
          row.field = target.value;
          // Keep the operator valid for the new field.
          const allowed = operatorsFor(row.field);
          if (allowed.indexOf(row.operator) < 0) row.operator = allowed[0];
        }
        if (action === 'builder-set-operator') row.operator = target.value;
        if (action === 'builder-set-value') row.value = target.value;
        applyBuilderGroups(groups);
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
