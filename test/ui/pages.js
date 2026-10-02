// The rendered HTML of every Deckard webview, built from the compiled sources
// with VS Code replaced by the e2e stub. The pages are the ones the mocha
// suites walk, from src/test/pages.ts, and each comes through the shared page
// loader, so the webview checks see one self-contained page, with the bundle
// and the sheets its shell links inlined. A new page is added once, in the
// catalog, and every check covers it.
const path = require('node:path');
const { existsSync } = require('node:fs');

const compiled = path.join(__dirname, '..', '..', 'out');
if (!existsSync(compiled)) {
  console.error('Run "npm run compile-tests" first: out/ is missing.');
  process.exit(1);
}
const vscodeStub = require('../e2e/vscodeStub.js');
vscodeStub.install();
/**
 * The page builders read the theme and zen mode from the settings when they
 * run, so the pages are given them through the stub's settings, as a
 * reader's settings would give them. The contrast check walks every theme,
 * and the layout check walks zen on and off.
 */
const { settings } = vscodeStub._test;
/** Where the theme and zen mode are set, by their full names. */
const THEME = 'deckard.theme';
const ZEN = 'deckard.zenMode';
// The layout checks describe the pages under Replicant, which declares no
// tokens of its own. Every other theme, the default Corpo included, re-declares
// the tokens and restyles surfaces on purpose, so the pages render as Replicant.
settings.set(THEME, 'replicant');
settings.set(ZEN, false);
const modules = require('../harness/modules.js');
const { loadPage } = require('../harness/loadPage.js');

/**
 * What Help renders with: the shipped manifest, and the shipped changelog's
 * releases, so What's new is measured too. Every page renders against the
 * one stand-in webview of src/test/pageWebview.ts, as the mocha suites do.
 */
const pageOptions = {
  help: {
    manifest: require('../../package.json').contributes,
    options: {
      releases: modules.changelog.parseChangelog(
        require('node:fs').readFileSync(path.join(__dirname, '..', '..', 'CHANGELOG.md'), 'utf8'),
      ),
      newSince: '1.20.0',
    },
  },
};
const pages = modules.pageCatalog.PAGES.map((page) => [page.id, () => loadPage(modules.pageCatalog.renderPage(page.id, pageOptions))]);

/** Every theme Deckard ships, read from the manifest the themes declare. */
const { deckardThemes } = modules.themeNames;

/**
 * Renders every page with one theme applied, as [name, html] pairs. The page
 * functions read the theme when they run, so the pages are built again for
 * each one rather than restyled after the fact.
 */
function renderPagesForTheme(theme, options) {
  return withLook(theme, Boolean(options && options.zen), () => pages.map(([name, render]) => [name, render()]));
}

/** Runs `render` with the theme and zen mode set, and sets them back after. */
function withLook(theme, zen, render) {
  const previousTheme = settings.get(THEME);
  const previousZen = settings.get(ZEN);
  settings.set(THEME, theme);
  settings.set(ZEN, zen);
  try {
    return render();
  } finally {
    settings.set(THEME, previousTheme);
    settings.set(ZEN, previousZen);
  }
}

/**
 * Renders one page by name, in a theme, with zen on or off, and with page
 * options of its own, such as the entry the debug page diagnoses, over the
 * ones every page renders with.
 */
function renderPage(name, options = {}) {
  if (!pages.some(([pageName]) => pageName === name)) {
    throw new Error(`No such page: ${name}`);
  }
  return withLook(options.theme || settings.get(THEME), Boolean(options.zen), () =>
    loadPage(modules.pageCatalog.renderPage(name, { ...pageOptions, ...options.pageOptions })));
}

/**
 * What VS Code's own tokens stand for: Dark Modern and Light Modern, the
 * defaults. Corpo reads these for everything it draws, and every theme reads
 * them for its fonts, so a page checked without them is not the page a
 * reader sees: Corpo's buttons had no chrome and its columns no ground in
 * the layout and visual checks, since the tokens fell back to nothing. The
 * contrast check walks both; the pages are laid out with the dark one.
 */
const vscodePalettes = {
  dark: {
    '--vscode-editor-background': '#1f1f1f',
    '--vscode-editorWidget-background': '#202020',
    '--vscode-input-background': '#313131',
    '--vscode-list-hoverBackground': '#2a2d2e',
    '--vscode-foreground': '#cccccc',
    '--vscode-descriptionForeground': '#9d9d9d',
    '--vscode-textLink-foreground': '#4daafc',
    '--vscode-focusBorder': '#0078d4',
    '--vscode-charts-green': '#89d185',
    '--vscode-charts-red': '#f14c4c',
    '--vscode-charts-orange': '#d18616',
    '--vscode-charts-yellow': '#cca700',
    '--vscode-charts-blue': '#3794ff',
    '--vscode-panel-border': '#2b2b2b',
    '--vscode-widget-border': '#313131',
    '--vscode-button-background': '#0078d4',
    '--vscode-button-foreground': '#ffffff',
    '--vscode-button-hoverBackground': '#026ec1',
    '--vscode-button-border': '#ffffff12',
    '--vscode-button-secondaryBackground': '#313131',
    '--vscode-button-secondaryForeground': '#cccccc',
    '--vscode-button-secondaryHoverBackground': '#3c3c3c',
    '--vscode-input-foreground': '#cccccc',
    '--vscode-input-border': '#3c3c3c',
    '--vscode-input-placeholderForeground': '#989898',
    '--vscode-dropdown-background': '#313131',
    '--vscode-dropdown-border': '#3c3c3c',
    '--vscode-sideBar-background': '#181818',
    '--vscode-editorWidget-foreground': '#cccccc',
    '--vscode-editorWarning-foreground': '#cca700',
    '--vscode-widget-shadow': '#0000005c',
    '--vscode-editor-font-family': 'monospace',
    '--vscode-font-family': 'sans-serif',
  },
  light: {
    '--vscode-editor-background': '#ffffff',
    '--vscode-editorWidget-background': '#f8f8f8',
    '--vscode-input-background': '#ffffff',
    '--vscode-list-hoverBackground': '#e8e8e8',
    '--vscode-foreground': '#3b3b3b',
    // Light Modern, the default light theme since 1.83; Light+ had #717171.
    '--vscode-descriptionForeground': '#3b3b3b',
    '--vscode-textLink-foreground': '#005fb8',
    '--vscode-focusBorder': '#005fb8',
    '--vscode-charts-green': '#388a34',
    '--vscode-charts-red': '#a1260d',
    '--vscode-charts-orange': '#d18616',
    '--vscode-charts-yellow': '#b89500',
    '--vscode-charts-blue': '#0f4a85',
    '--vscode-panel-border': '#e5e5e5',
    '--vscode-widget-border': '#d4d4d4',
    '--vscode-button-background': '#005fb8',
    '--vscode-button-foreground': '#ffffff',
    '--vscode-button-hoverBackground': '#0258a8',
    '--vscode-button-border': '#0000001a',
    '--vscode-button-secondaryBackground': '#e5e5e5',
    '--vscode-button-secondaryForeground': '#3b3b3b',
    '--vscode-button-secondaryHoverBackground': '#cccccc',
    '--vscode-input-foreground': '#3b3b3b',
    '--vscode-input-border': '#cecece',
    '--vscode-input-placeholderForeground': '#767676',
    '--vscode-dropdown-background': '#ffffff',
    '--vscode-dropdown-border': '#cecece',
    '--vscode-sideBar-background': '#f8f8f8',
    '--vscode-editorWidget-foreground': '#3b3b3b',
    '--vscode-editorWarning-foreground': '#bf8803',
    '--vscode-widget-shadow': '#00000029',
    '--vscode-editor-font-family': 'monospace',
    '--vscode-font-family': 'sans-serif',
  },
};

/** The tokens as a style block, for a page drawn outside VS Code. */
function vscodePaletteCss(name) {
  const palette = vscodePalettes[name];
  return ':root {' + Object.entries(palette).map(([token, value]) => `${token}: ${value};`).join(' ') + '}';
}

module.exports = { pages, renderPage, renderPagesForTheme, themes: deckardThemes, vscodePalettes, vscodePaletteCss };
