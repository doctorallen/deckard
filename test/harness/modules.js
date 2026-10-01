// Every compiled module the Node harnesses load, named once.
//
// test/ui, test/e2e, and test/perf run the compiled sources from out/ without
// VS Code, so they cannot import relatively the way the mocha suites do; each
// used to name its modules by path, 35 paths in 12 files. The refactor moves
// most of those files, and a move that the mocha suites follow would break the
// harnesses silently. Here each module has one entry: a move is one edit.
//
// Each module is a lazy getter, so a harness that installs its `vscode`
// stand-in before touching a module still does so first:
//
//   const { parser } = require('../harness/modules.js');
//   parser.parseMarkdown(...);
const path = require('node:path');

const OUT = path.join(__dirname, '..', '..', 'out');

/** Each module's name, and its path under out/. */
const MODULES = {
  // core
  changelog: 'core/changelog.js',
  parser: 'domain/markdown/parser.js',
  queryContext: 'domain/query/queryContext.js',
  preferences: 'core/storage/preferences.js',
  searchStore: 'core/storage/searchStore.js',
  parsedFileCodec: 'core/storage/parsedFileCodec.js',
  timing: 'shared/timing.js',
  indexer: 'core/workspace/indexer.js',
  scanner: 'core/workspace/scanner.js',
  // ui/state
  calendarState: 'ui/state/calendarState.js',
  dashboardState: 'ui/state/dashboardState.js',
  dashboardWidgets: 'ui/state/dashboardWidgets.js',
  notesGraphState: 'ui/state/notesGraphState.js',
  relatedNotesRanking: 'ui/state/relatedNotesRanking.js',
  taskBoardState: 'ui/state/taskBoardState.js',
  // ui/commands
  dailyNote: 'ui/commands/dailyNote.js',
  tagDecorations: 'ui/providers/tagDecorations.js',
  workspaceWrites: 'ui/commands/workspaceWrites.js',
  // The task writes a harness hands to a page host, as the extension builds them.
  taskWrites: 'test/taskWrites.js',
  // The preference services a harness hands to a page host, as the extension builds them.
  preferenceServices: 'test/preferenceServices.js',
  // ui/webview: page hosts
  activeCalendar: 'ui/webview/activeCalendar.js',
  activeSearch: 'ui/webview/activeSearch.js',
  calendar: 'ui/webview/calendar.js',
  calendarPage: 'ui/webview/calendarPage.js',
  dashboard: 'ui/webview/dashboard.js',
  searchPage: 'ui/webview/searchPage.js',
  sidebarNotes: 'ui/webview/sidebarNotes.js',
  stats: 'ui/webview/stats.js',
  taskBoard: 'ui/webview/taskBoard.js',
  // ui/webview: page builders and their parts
  calendarHtml: 'ui/webview/calendarHtml.js',
  components: 'ui/webview/components.js',
  dashboardHtml: 'ui/webview/dashboardHtml.js',
  guide: 'ui/webview/guide.js',
  helpHtml: 'ui/webview/helpHtml.js',
  notesGraphHtml: 'ui/webview/notesGraphHtml.js',
  relatedNotesDebugHtml: 'ui/webview/relatedNotesDebugHtml.js',
  searchPageHtml: 'ui/webview/searchPageHtml.js',
  sidebarNotesHtml: 'ui/webview/sidebarNotesHtml.js',
  statsHtml: 'ui/webview/statsHtml.js',
  taskBoardHtml: 'ui/webview/taskBoardHtml.js',
  themes: 'ui/webview/themes.js',
  themePreview: 'ui/webview/themePreview.js',
  // src/test: the page catalog the mocha suites share
  pageCatalog: 'test/pages.js',
};

/**
 * The absolute path of a compiled module.
 *
 * @param {keyof typeof MODULES} name A name from the catalog.
 * @returns {string} Its file under out/.
 */
function pathOf(name) {
  if (!Object.prototype.hasOwnProperty.call(MODULES, name)) {
    throw new Error(`test/harness/modules.js has no module named ${name}.`);
  }
  return path.join(OUT, MODULES[name]);
}

const modules = { pathOf, OUT };
for (const name of Object.keys(MODULES)) {
  Object.defineProperty(modules, name, { enumerable: true, get: () => require(pathOf(name)) });
}
module.exports = modules;
