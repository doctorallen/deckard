// The rendered HTML of every Deckard webview, built from the compiled sources
// with VS Code replaced by the e2e stub. The webview checks share it, so a new
// page is added once and every check covers it.
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
// The layout checks describe the pages under Replicant, which declares no
// tokens of its own. Every other theme, the default Corpo included, re-declares
// the tokens and restyles surfaces on purpose, so the pages render as Replicant.
const vscodeStub = require(path.join(__dirname, '..', 'e2e', 'vscodeStub.js'));
const getConfiguration = vscodeStub.workspace.getConfiguration;
/** The theme the pages render with; the contrast check walks every one. */
let renderTheme = 'replicant';
/** Whether the pages render with zen mode on; the layout check walks both. */
let renderZen = false;
vscodeStub.workspace.getConfiguration = (section) => {
  const configuration = getConfiguration(section);
  return {
    ...configuration,
    get: (key, fallback) => {
      if (section !== 'deckard') return configuration.get(key, fallback);
      if (key === 'theme') return renderTheme;
      if (key === 'zenMode') return renderZen;
      return configuration.get(key, fallback);
    },
  };
};
const webview = {
  cspSource: 'vscode-webview://deckard',
  asWebviewUri: (uri) => ({ toString: () => 'vscode-webview://deckard/asset' }),
};
const pages = [
  ['dashboard', () => require('../../out/ui/webview/dashboardHtml.js').getDashboardHtml(webview, { fsPath: '/ext' })],
  ['searchPage', () => require('../../out/ui/webview/searchPageHtml.js').getSearchPageHtml(webview)],
  ['sidebarNotes', () => require('../../out/ui/webview/sidebarNotesHtml.js').getSidebarNotesHtml(webview, '1.0.0')],
  ['notesGraph', () => require('../../out/ui/webview/notesGraphHtml.js').getNotesGraphHtml(webview)],
  ['help', () => require('../../out/ui/webview/helpHtml.js').getHelpHtml(webview, { fsPath: '/ext' })],
  ['stats', () => require('../../out/ui/webview/statsHtml.js').getStatsHtml(webview)],
  ['taskBoard', () => require('../../out/ui/webview/taskBoardHtml.js').getTaskBoardHtml(webview)],
  ['calendar', () => require('../../out/ui/webview/calendarHtml.js').getCalendarHtml(webview)],
  ['relatedNotesDebug', () => require('../../out/ui/webview/relatedNotesDebugHtml.js')
      .getRelatedNotesDebugHtml(webview, {
        filePath: 'notes/a.md', sourceLine: 1, title: 'Entry', tags: [],
        snapshot: {
          activeTags: [], notes: [],
          tagTitleDisplayMode: 'inline', state: 'ready',
        },
      })],
];

/** Every theme Deckard ships, read from the manifest the themes declare. */
const { deckardThemes } = require('../../out/ui/webview/themes.js');

/**
 * Renders every page with one theme applied, as [name, html] pairs. The page
 * functions read the theme when they run, so the pages are built again for
 * each one rather than restyled after the fact.
 */
function renderPagesForTheme(theme, options) {
  const previousTheme = renderTheme;
  const previousZen = renderZen;
  renderTheme = theme;
  renderZen = Boolean(options && options.zen);
  try {
    return pages.map(([name, render]) => [name, render()]);
  } finally {
    renderTheme = previousTheme;
    renderZen = previousZen;
  }
}

/** Renders one page by name, with zen on or off. */
function renderPage(name, options) {
  const entry = pages.find(([pageName]) => pageName === name);
  if (!entry) throw new Error(`No such page: ${name}`);
  return renderPagesForTheme(
    (options && options.theme) || renderTheme,
    options,
  ).find(([pageName]) => pageName === name)[1];
}

module.exports = { pages, renderPage, renderPagesForTheme, themes: deckardThemes };
