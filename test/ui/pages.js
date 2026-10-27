// The rendered HTML of every Deckard webview, built from the compiled sources,
// which write a page without VS Code. The pages are the ones the mocha
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
/**
 * The theme a page is drawn in when a check names none. The page builders
 * are given the theme and zen mode, as a host gives them what it read from
 * the settings; the contrast check walks every theme, and the layout check
 * walks zen on and off. The layout checks describe the pages under
 * Replicant, which declares no tokens of its own. Every other theme, the
 * default Mimic included, re-declares the tokens and restyles surfaces on
 * purpose, so the pages render as Replicant.
 */
const DEFAULT_THEME = 'replicant';
const modules = require('../harness/modules.js');
const { loadPage } = require('../harness/loadPage.js');

/**
 * What Help renders with: the releases of a frozen copy of the changelog,
 * test/ui/fixtures/changelog.md, so What's new is measured too. The copy is
 * frozen because a release cuts the changelog, and the release job runs
 * every check on what it releases: drawn from the live
 * changelog, Help's goldens and screenshots would change with each release
 * and fail its own check. Every page renders against the one stand-in
 * webview of src/test/pageWebview.ts, as the mocha suites do.
 */
const pageOptions = {
  help: {
    options: {
      releases: modules.changelog.parseChangelog(
        require('node:fs').readFileSync(path.join(__dirname, 'fixtures', 'changelog.md'), 'utf8'),
      ),
      newSince: '1.20.0',
    },
  },
};
const pages = modules.pageCatalog.PAGES.map((page) => [
  page.id,
  (chrome = { theme: DEFAULT_THEME, zen: false }) => loadPage(modules.pageCatalog.renderPage(page.id, { ...pageOptions, chrome })),
]);

/** Every theme Deckard ships, read from the manifest the themes declare. */
const { deckardThemes } = modules.themeNames;

/**
 * Renders every page with one theme applied, as [name, html] pairs. A page
 * is written in the theme it is given, so the pages are built again for
 * each one rather than restyled after the fact.
 */
function renderPagesForTheme(theme, options) {
  const chrome = { theme, zen: Boolean(options && options.zen), ...(options && options.display ? { display: options.display } : {}) };
  return pages.map(([name, render]) => [name, render(chrome)]);
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
  const chrome = { theme: options.theme || DEFAULT_THEME, zen: Boolean(options.zen), ...(options.display ? { display: options.display } : {}) };
  return loadPage(modules.pageCatalog.renderPage(name, { ...pageOptions, ...options.pageOptions, chrome }));
}

/**
 * What VS Code's own tokens stand for: Dark 2026 and Light 2026, the
 * defaults, read from the palettes Corpo pins them to
 * (src/webview/shared/themes/corpo.css), with a font for each. Mimic reads
 * these for everything it draws, and every theme reads them for its fonts,
 * so a page checked without them is not the page a reader sees: Mimic's
 * buttons had no chrome and its columns no ground in the layout and visual
 * checks, since the tokens fell back to nothing. The contrast check walks
 * both; the pages are laid out with the dark one, Mimic's with the light
 * (paletteFor).
 */
const vscodePalettes = readCorpoPalettes();

/**
 * Corpo's two palettes, by the VS Code color theme kind each is drawn
 * under, as token-to-color maps. A token Corpo unsets is left out, as VS
 * Code leaves it out of its defaults.
 */
function readCorpoPalettes() {
  const sheet = path.join(__dirname, '..', '..', 'src', 'webview', 'shared', 'themes', 'corpo.css');
  const css = require('node:fs').readFileSync(sheet, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const fonts = { '--vscode-editor-font-family': 'monospace', '--vscode-font-family': 'sans-serif' };
  const palettes = {};
  for (const [, kind, body] of css.matchAll(/:root:has\(> body\.vscode-(dark|light)\)\s*\{([^}]*)\}/g)) {
    const palette = {};
    for (const [, token, value] of body.matchAll(/(--vscode-[\w-]+)\s*:\s*([^;!]+?)\s*!important\s*;/g)) {
      if (value !== 'initial') {
        palette[token] = value;
      }
    }
    palettes[kind] = { ...palette, ...fonts };
  }
  if (!palettes.dark || !palettes.light) {
    throw new Error(`Could not read Corpo's dark and light palettes from ${sheet}.`);
  }
  return palettes;
}

/**
 * The palette the checks that draw in Chrome give a theme: the light one for
 * Mimic, so a VS Code light theme is laid out and drawn too, and the dark
 * one for every other theme. Corpo under the dark palette is Mimic under it.
 */
function paletteFor(theme) {
  return theme === 'mimic' ? 'light' : 'dark';
}

/** The tokens as a style block, for a page drawn outside VS Code. */
function vscodePaletteCss(name) {
  const palette = vscodePalettes[name];
  return ':root {' + Object.entries(palette).map(([token, value]) => `${token}: ${value};`).join(' ') + '}';
}

module.exports = { pages, renderPage, renderPagesForTheme, themes: deckardThemes, vscodePalettes, vscodePaletteCss, paletteFor };
