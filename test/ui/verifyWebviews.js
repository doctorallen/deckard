// Renders every webview and checks the document it produces.
//
// The webviews are HTML built from template literals, so a typo in a style
// sheet or an inline script is invisible to the compiler. This renders each
// page for real and asserts the things the shared component layer guarantees:
// the script parses, the design tokens are present, one nonce gates the
// inline style and script, and no page redeclares a shared helper.
//
//   npm run test:ui
const path = require('node:path');
const { existsSync } = require('node:fs');

const compiled = path.join(__dirname, '..', '..', 'out');
if (!existsSync(compiled)) {
  console.error('Run "npm run compile-tests" first: out/ is missing.');
  process.exit(1);
}
const Module = require('node:module');
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function patched(request, ...rest) {
  if (request === 'vscode') {
    return path.join(__dirname, '..', 'e2e', 'vscodeStub.js');
  }
  return resolveFilename.call(this, request, ...rest);
};
const webview = {
  cspSource: 'vscode-webview://deckard',
  asWebviewUri: (uri) => ({ toString: () => 'vscode-webview://deckard/asset' }),
};
const pages = [
  ['dashboard', () => require('../../out/ui/webview/dashboardHtml.js').getDashboardHtml(webview, { fsPath: '/ext' })],
  ['tagOverview', () => require('../../out/ui/webview/tagOverviewHtml.js').getTagOverviewHtml(webview)],
  ['sidebarNotes', () => require('../../out/ui/webview/sidebarNotesHtml.js').getSidebarNotesHtml(webview, '1.0.0')],
  ['notesGraph', () => require('../../out/ui/webview/notesGraphHtml.js').getNotesGraphHtml(webview)],
  ['help', () => require('../../out/ui/webview/helpHtml.js').getHelpHtml(webview, { fsPath: '/ext' })],
  ['stats', () => require('../../out/ui/webview/statsHtml.js').getStatsHtml(webview)],
  ['taskBoard', () => require('../../out/ui/webview/taskBoardHtml.js').getTaskBoardHtml(webview)],
  ['relatedNotesDebug', () => require('../../out/ui/webview/relatedNotesDebugHtml.js')
      .getRelatedNotesDebugHtml(webview, {
        filePath: 'notes/a.md', sourceLine: 1, title: 'Entry', tags: [],
        snapshot: {
          activeTags: [], notes: [], tagOverviewFilters: [],
          tagTitleDisplayMode: 'inline', state: 'ready',
        },
      })],
];
/**
 * Layout each page must still have after the cascade.
 *
 * The shared sheet and a page's own rules use the same selector names, so a
 * base rule can silently replace page layout. These assert the properties
 * that decide how a page is actually laid out.
 */
const LAYOUT_CONTRACTS = {
  dashboard: [
    ['main', 'max-width', '1180px'],
    ['.metrics', 'grid-template-columns', 'repeat(3'],
    ['.metrics', 'min-width', 'min(380px'],
    ['.metric', 'clip-path', 'polygon'],
  ],
  tagOverview: [
    ['main', 'border-top', 'var(--amber)'],
    ['header', 'position', 'relative'],
  ],
  sidebarNotes: [
    ['body', 'min-width', '220px'],
    ['main', 'padding', '12px'],
    ['main', 'border-top', 'var(--amber)'],
  ],
  help: [
    ['main', 'display', 'grid'],
    ['main', 'grid-template-columns', 'minmax(180px'],
    ['.cards', 'grid-template-columns', 'repeat(2'],
  ],
  stats: [
    ['main', 'max-width', '1100px'],
    ['main', 'border-top', 'var(--green)'],
  ],
  taskBoard: [
    ['main', 'max-width', 'none'],
    ['main', 'border-top', 'var(--cyan)'],
    ['.board', 'grid-auto-flow', 'column'],
  ],
};

/**
 * The value a property ends up with for a selector, taking the last rule that
 * sets it outside a media query — which is what the cascade does here.
 */
function effectiveValue(css, selector, property) {
  // Comments would otherwise be read as part of the selector that follows.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const withoutMedia = bare.replace(
    /@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g,
    '',
  );
  const rules = [...withoutMedia.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  let value;
  for (const [, head, body] of rules) {
    const selectors = head.split(',').map((part) => part.trim());
    if (!selectors.includes(selector)) continue;
    for (const declaration of body.split(';')) {
      const [name, ...rest] = declaration.split(':');
      if (name && name.trim() === property) value = rest.join(':').trim();
    }
  }
  return value;
}

// Classes that render a row a reader can open.
const CONTENT_ROWS = [
  'tag-row', 'entity-row', 'note-row', 'task-row', 'saved-filter-row',
  'board-card', 'stat-row',
];
const SHARED_HELPERS = [
  'escapeHtml', 'renderTagLabel', 'renderTagButton', 'renderInlineTitle',
  'renderTaskTitle', 'taskFilterIcon', 'formatEntityTitle',
  'closeTagContextMenu', 'openTagContextMenu', 'installTagContextMenu',
  'renderTaskBoard', 'renderTaskBoardCard', 'renderTaskBoardGroupSwitch',
  'installTaskBoard',
];
let fail = 0;
for (const [name, render] of pages) {
  let html;
  try { html = render(); }
  catch (error) { console.log(`  FAIL ${name}: render threw: ${error.message}`); fail++; continue; }
  const problems = [];
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  for (const script of scripts) {
    try { new Function(script); }
    catch (error) { problems.push('script does not parse: ' + error.message); }
  }
  if (!/--amber\s*:/.test(html)) problems.push('missing design tokens');
  if (!/--panel-raised\s*:/.test(html)) problems.push('missing the full token set');
  // A helper the shared script owns must not be redeclared by a page.
  for (const script of scripts) {
    for (const helper of SHARED_HELPERS) {
      const count = (script.match(new RegExp('function ' + helper + '\\s*\\(', 'g')) || []).length;
      if (count > 1) problems.push(`${helper} is declared ${count} times`);
    }
  }
  // Every row a reader can open must carry a shared surface component, so it
  // gets the same border, hover and focus as every other one. Layout rows
  // such as .control-row are not content and are not listed here.
  for (const rowClass of CONTENT_ROWS) {
    for (const match of html.matchAll(new RegExp(`class="([^"]*\\b${rowClass}\\b[^"]*)"`, 'g'))) {
      const classes = match[1].split(/\s+/);
      if (!classes.includes('row') && !classes.includes('card') && !classes.includes('task')) {
        problems.push(`.${rowClass} is missing a shared surface (.row/.card): "${match[1]}"`);
      }
    }
  }

  // Page layout must survive the shared sheet.
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1])
    .join('\n');
  for (const [selector, property, expected] of LAYOUT_CONTRACTS[name] ?? []) {
    const actual = effectiveValue(styles, selector, property);
    if (!actual || !actual.includes(expected)) {
      problems.push(
        `${selector} { ${property} } should include "${expected}", got "${actual ?? 'nothing'}"`,
      );
    }
  }

  // Tokens must be declared once, by the shared sheet.
  const roots = (html.match(/:root\s*\{/g) || []).length;
  if (roots > 2) problems.push(`${roots} :root blocks; tokens should come from the base sheet`);
  if (!/:root/.test(html)) problems.push('missing :root');
  if (!/Content-Security-Policy/.test(html)) problems.push('missing CSP');
  // A nonce must gate every inline style and script.
  const nonces = [...html.matchAll(/nonce="([^"]+)"/g)].map((m) => m[1]);
  if (new Set(nonces).size !== 1) problems.push(`expected one nonce, saw ${new Set(nonces).size}`);
  if (problems.length) { fail++; console.log(`  FAIL ${name}\n       ` + problems.join('\n       ')); }
  else console.log(`  ok   ${name}  (${(html.length/1024).toFixed(0)}kb, ${scripts.length} script)`);
}
console.log(fail ? `\n${fail} failed` : '\nall webviews render');
process.exit(fail ? 1 : 0);
