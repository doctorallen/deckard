// Measures open question 3 of docs/implementation/20-webviews.md: whether
// the Preact pages each carry Preact and the shared core in their own bundle
// (A), or load one shared bundle beside a smaller page bundle (B).
//
//   A  dist/webview/<page>.js holds Preact, what it uses of
//      src/webview/shared, and the page.
//   B  dist/webview/shared.js holds Preact and all of src/webview/shared as
//      one iife global, deckardShared; an esbuild plugin maps the page's
//      imports of them to that global, so the page's bundle holds only the
//      page. The shell loads shared.js before the page.
//
// For each variant it prints each bundle's raw (unminified), minified, and
// gzip bytes, with Preact's, the core's, and the page's shares of the
// minified bundle from esbuild's metafile; the VSIX's size; the median of
// 20 loads to first render in jsdom (openWebviewPage); and the median of 10
// first renders in Chrome, from the layout harness's LAYOUT_TIMING=1 mode,
// which needs Chrome. The rule, set before the numbers: B only if it saves
// more than 100 KB in the VSIX, or more than 10 ms of Chrome first render on
// a page; otherwise A.
//
//   npm run compile-tests && npm run build:webview
//   npx vsce package --no-dependencies --out /tmp/deckard.vsix
//   node scripts/measure-page-bundles.js stats --vsix /tmp/deckard.vsix
//
// The pages measured are named; each must be a Preact page with a surface in
// test/ui/surfaces.js. --vsix names a VSIX built from this checkout, whose
// bundles are swapped for each variant's and zipped again the same way, so
// the two sizes compare. Nothing it builds is left in dist/.
//
// Each page's own VSIX row swaps that page's bundles alone. With
// --together <page,page,…>, it also swaps every page listed at once, B
// with one shared.js for all of them, which is what B would ship once more
// than one page is built with it:
//
//   node scripts/measure-page-bundles.js searchPage taskBoard --vsix /tmp/deckard.vsix \
//     --together stats,taskBoard,calendar,calendarPage,searchPage
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { performance } = require('node:perf_hooks');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const SHARED = 'src/webview/shared';
/** The global B's shared bundle sets, and the page bundles read. */
const GLOBAL = 'deckardShared';

/**
 * The options esbuild.js builds every page bundle with, kept in memory.
 *
 * @param {boolean} minify Whether to minify, as --production does.
 * @returns {import('esbuild').BuildOptions} Esbuild's options.
 */
function pageOptions(minify) {
  return {
    absWorkingDir: ROOT,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome148',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    minify,
    write: false,
    metafile: true,
    logLevel: 'silent',
  };
}

/**
 * The shared core's modules, each by the name B's global keeps it under.
 *
 * @returns {string[]} Their file names, without extension.
 */
function sharedModules() {
  return readdirSync(path.join(ROOT, SHARED))
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => file.replace(/\.tsx?$/, ''))
    .sort();
}

/**
 * B's esbuild plugin: a page's imports of Preact and of the shared core
 * resolve to B's global rather than to the files.
 *
 * @returns {import('esbuild').Plugin} A plugin for the page's build.
 */
function mapToShared() {
  return {
    name: 'map-to-shared',
    setup(build) {
      build.onResolve({ filter: /^preact(\/jsx-runtime)?$/ }, (args) => ({ path: args.path === 'preact' ? 'preact' : 'jsxRuntime', namespace: GLOBAL }));
      build.onResolve({ filter: /^\.\.\/shared\// }, (args) => ({ path: path.basename(args.path), namespace: GLOBAL }));
      build.onLoad({ filter: /.*/, namespace: GLOBAL }, (args) => ({ contents: `module.exports = ${GLOBAL}[${JSON.stringify(args.path)}];`, loader: 'js' }));
    },
  };
}

/**
 * One bundle, raw and minified, with the minified build's metafile.
 *
 * @param {string} name The bundle's file name under dist/webview.
 * @param {import('esbuild').BuildOptions} options What to build.
 * @returns {Promise<{ name: string, raw: string, minified: string, metafile: object }>} Its text both ways, and what went into it.
 */
async function buildBundle(name, options) {
  const raw = await esbuild.build({ ...pageOptions(false), ...options, outfile: name });
  const minified = await esbuild.build({ ...pageOptions(true), ...options, outfile: name });
  return { name, raw: raw.outputFiles[0].text, minified: minified.outputFiles[0].text, metafile: minified.metafile };
}

/**
 * The bundles of one variant of one page.
 *
 * @param {'A' | 'B'} variant Which variant.
 * @param {string} page The page's folder under src/webview.
 * @returns {Promise<Array<{ name: string, raw: string, minified: string, metafile: object }>>} Each bundle, the page's last.
 */
async function buildVariant(variant, page) {
  const entry = `src/webview/${page}/main.tsx`;
  if (variant === 'A') {
    return [await buildBundle(`${page}.js`, { entryPoints: [entry] })];
  }
  const contents = [
    "export * as preact from 'preact';",
    "export * as jsxRuntime from 'preact/jsx-runtime';",
    ...sharedModules().map((name) => `export * as ${name} from './${SHARED}/${name}';`),
  ].join('\n');
  return [
    await buildBundle('shared.js', { stdin: { contents, resolveDir: ROOT, loader: 'ts', sourcefile: 'shared.ts' }, globalName: GLOBAL }),
    await buildBundle(`${page}.js`, { entryPoints: [entry], plugins: [mapToShared()] }),
  ];
}

/**
 * A bundle's minified bytes by where they came from: Preact, the shared
 * core, the page, and esbuild's own wrapping, which no input claims.
 *
 * @param {{ minified: string, metafile: object }} bundle A bundle as buildBundle made it.
 * @returns {{ preact: number, core: number, page: number, other: number }} Bytes from each.
 */
function shares(bundle) {
  const output = Object.values(bundle.metafile.outputs)[0];
  const share = { preact: 0, core: 0, page: 0, other: 0 };
  for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
    if (input.includes('node_modules/preact/')) {
      share.preact += bytesInOutput;
    } else if (input.startsWith(`${SHARED}/`) || input === 'shared.ts') {
      share.core += bytesInOutput;
    } else if (input.startsWith('src/webview/')) {
      share.page += bytesInOutput;
    }
  }
  share.other = Buffer.byteLength(bundle.minified) - share.preact - share.core - share.page;
  return share;
}

/** Bytes as kilobytes, to one place. */
function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** The middle value of a list of numbers. */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * A folder laid out like the extension, holding the built sheets and one
 * variant's page bundles under dist/webview, for the page loader to read.
 *
 * @param {string} dir Where to make it.
 * @param {Array<{ name: string, minified: string }>} bundles What the variant builds, minified.
 * @returns {string} The folder, as `dir` named it.
 */
function variantRoot(dir, bundles) {
  const webview = path.join(dir, 'dist', 'webview');
  mkdirSync(webview, { recursive: true });
  cpSync(path.join(ROOT, 'dist', 'webview'), webview, { recursive: true, filter: (source) => !/\.(js|map)$/.test(source) });
  bundles.forEach((bundle) => writeFileSync(path.join(webview, bundle.name), bundle.minified));
  return dir;
}

/**
 * The page's shell as its host renders it, loading B's shared bundle first
 * when the variant has one, made self-contained against `root`.
 *
 * @param {string} page The page's folder under src/webview.
 * @param {string} root The variant's folder.
 * @param {boolean} shared Whether the variant loads shared.js.
 * @returns {string} A page every harness can load.
 */
function variantPage(page, root, shared) {
  const { loadPage } = require('../test/harness/loadPage.js');
  const modules = require('../test/harness/modules.js');
  let html = modules.pageCatalog.renderPage(page);
  if (shared) {
    html = html.replace(/<script nonce="([^"]+)" src="([^"]*)\/[^/"]+\.js"><\/script>/, (whole, nonce, base) => `<script nonce="${nonce}" src="${base}/shared.js"></script>${whole}`);
  }
  return loadPage(html, { root });
}

/**
 * The median of 20 loads of a page to its first render in jsdom: the page
 * built, its scripts run, and its state posted and drawn.
 *
 * @param {string} html The self-contained page.
 * @param {unknown} snapshot The state it draws.
 * @returns {number} Milliseconds, the middle of the 20.
 */
function jsdomFirstRender(html, snapshot) {
  const { openWebviewPage } = require('../out/test/webviewPage.js');
  const times = [];
  for (let run = 0; run < 20; run += 1) {
    const started = performance.now();
    const page = openWebviewPage(html, snapshot);
    times.push(performance.now() - started);
    page.dispose();
  }
  return median(times);
}

/**
 * The VSIX's size with a variant's bundles in place of its own, zipped by
 * `zip -9` from the VSIX unpacked in `unpacked`.
 *
 * @param {string} unpacked The VSIX's files.
 * @param {Array<{ name: string, minified: string }>} bundles What the variant builds, minified.
 * @param {string} file Where to write the VSIX.
 * @returns {number} Its size in bytes.
 */
function variantVsix(unpacked, bundles, file) {
  const webview = path.join(unpacked, 'extension', 'dist', 'webview');
  rmSync(path.join(webview, 'shared.js'), { force: true });
  bundles.forEach((bundle) => writeFileSync(path.join(webview, bundle.name), bundle.minified));
  const zipped = spawnSync('zip', ['-q', '-r', '-X', '-9', file, '.'], { cwd: unpacked });
  if (zipped.status !== 0) {
    throw new Error(`zip failed: ${zipped.stderr}`);
  }
  return statSync(file).size;
}

/**
 * Every page listed built both ways at once, as the VSIX would ship it: A
 * with each page's own bundle, B with one shared.js and each page's own,
 * with the minified bytes and the VSIX each makes.
 *
 * @param {string[]} pages The pages' folders under src/webview.
 * @param {{ dir: string, vsix?: string }} options Where to work, and the VSIX to zip again.
 */
async function measureTogether(pages, options) {
  console.log(`\ntogether: ${pages.join(', ')}`);
  let unpacked;
  if (options.vsix) {
    unpacked = path.join(options.dir, 'vsix-together');
    mkdirSync(unpacked);
    spawnSync('unzip', ['-q', options.vsix, '-d', unpacked]);
  }
  for (const variant of ['A', 'B']) {
    const built = new Map();
    for (const page of pages) {
      (await buildVariant(variant, page)).forEach((bundle) => built.set(bundle.name, bundle));
    }
    const bundles = [...built.values()];
    const total = bundles.reduce((sum, bundle) => sum + Buffer.byteLength(bundle.minified), 0);
    const gzip = bundles.reduce((sum, bundle) => sum + zlib.gzipSync(bundle.minified, { level: 9 }).length, 0);
    const vsixSize = unpacked ? kb(variantVsix(unpacked, bundles, path.join(options.dir, `together-${variant}.vsix`))) : '(no --vsix)';
    console.log(`  ${variant} ${bundles.length} bundles, minified in all ${kb(total)}, gzip ${kb(gzip)}; VSIX ${vsixSize}`);
  }
}

/**
 * Prints one variant's bundles: raw, minified, and gzip bytes, and the
 * minified bytes' shares.
 *
 * @param {'A' | 'B'} variant Which variant.
 * @param {Array<{ name: string, raw: string, minified: string, metafile: object }>} bundles Its bundles.
 */
function printBundles(variant, bundles) {
  for (const bundle of bundles) {
    const share = shares(bundle);
    const gzip = zlib.gzipSync(bundle.minified, { level: 9 }).length;
    console.log(`  ${variant} ${bundle.name.padEnd(10)} raw ${kb(Buffer.byteLength(bundle.raw))}, minified ${kb(Buffer.byteLength(bundle.minified))}, gzip ${kb(gzip)}; `
      + `Preact ${kb(share.preact)}, core ${kb(share.core)}, page ${kb(share.page)}, esbuild ${kb(share.other)}`);
  }
}

/**
 * Both variants of one page, measured and printed.
 *
 * @param {string} page The page's folder under src/webview.
 * @param {{ dir: string, vsix?: string }} options Where to work, and the VSIX to zip again.
 */
async function measurePage(page, options) {
  // The page catalog's modules load with VS Code replaced by the e2e stub.
  require('../test/ui/pages.js');
  const { createSurfaces } = require('../test/ui/surfaces.js');
  // The layout harness, whose LAYOUT_TIMING=1 mode times a first render;
  // it ends the run, saying so, where no Chrome is found.
  const chrome = require('../test/ui/checkLayout.js');
  const surface = createSurfaces(false).find((entry) => entry.page === page && !entry.drive);
  let unpacked;
  console.log(`\n${page}`);
  if (options.vsix) {
    unpacked = path.join(options.dir, `vsix-${page}`);
    mkdirSync(unpacked);
    spawnSync('unzip', ['-q', options.vsix, '-d', unpacked]);
    console.log(`  the VSIX as vsce packed it: ${kb(statSync(options.vsix).size)}`);
  }
  for (const variant of ['A', 'B']) {
    const bundles = await buildVariant(variant, page);
    printBundles(variant, bundles);
    const html = variantPage(page, variantRoot(path.join(options.dir, `${page}-${variant}`), bundles), variant === 'B');
    const total = bundles.reduce((sum, bundle) => sum + Buffer.byteLength(bundle.minified), 0);
    const vsixSize = unpacked ? kb(variantVsix(unpacked, bundles, path.join(options.dir, `${page}-${variant}.vsix`))) : '(no --vsix)';
    const jsdom = jsdomFirstRender(html, surface.snapshot()).toFixed(1);
    const inChrome = chrome.medianFirstRender(html, surface, { file: path.join(options.dir, `${page}-${variant}.html`) }).toFixed(1);
    console.log(`  ${variant} minified in all ${kb(total)}; VSIX ${vsixSize}; first render: jsdom ${jsdom} ms (median of 20), Chrome ${inChrome} ms (median of 10)`);
  }
}

/** Measures both variants of each page named, or of Stats. */
async function main() {
  const args = process.argv.slice(2);
  const vsixAt = args.indexOf('--vsix');
  const vsix = vsixAt >= 0 ? path.resolve(args[vsixAt + 1]) : undefined;
  const togetherAt = args.indexOf('--together');
  const together = togetherAt >= 0 ? args[togetherAt + 1].split(',').filter(Boolean) : [];
  const pages = args.filter((arg, index) => !arg.startsWith('--') && index !== vsixAt + 1 && index !== togetherAt + 1);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'deckard-bundles-'));
  try {
    for (const page of pages.length ? pages : ['stats']) {
      await measurePage(page, { dir, vsix });
    }
    if (together.length) {
      await measureTogether(together, { dir, vsix });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
