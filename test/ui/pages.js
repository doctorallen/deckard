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
vscodeStub.workspace.getConfiguration = (section) => {
  const configuration = getConfiguration(section);
  return {
    ...configuration,
    get: (key, fallback) =>
      section === 'deckard' && key === 'theme' ? 'replicant' : configuration.get(key, fallback),
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

module.exports = { pages };
