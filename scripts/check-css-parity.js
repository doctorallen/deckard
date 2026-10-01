// Checks that every page draws with the CSS it drew with before its sheets
// became files (docs/implementation/20-webviews.md, Phase 6 step 3.2).
//
//   npm run compile-tests && npm run build:webview
//   node scripts/check-css-parity.js [base]
//
//   npm run compile-tests && node esbuild.js --webview --production
//   node scripts/check-css-parity.js --minify [base]
//
// `base` is the commit whose pages still wrote their CSS into a <style>
// block, 7b3088d by default. The script extracts it to a folder of its own,
// compiles it, and renders every page there in every theme with zen off and
// on, taking the text of its one <style> block. It renders the same pages
// from this tree, through the page loader, which inlines the sheets each page
// links in the order it links them, and joins their text. The two must be
// equal once whitespace and comments are set aside, which esbuild's
// whitespace minifier does to both sides alike. With --minify, both sides go
// through esbuild's whole minifier instead, for the minified sheets the VSIX
// ships: they must be what minifying the old text gives.
//
// This is a one-off gate for step 3.2, deleted once the step has landed.
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const { existsSync, mkdtempSync, rmSync, symlinkSync } = require('node:fs');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const minify = process.argv.includes('--minify');
const base = process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? '7b3088d';

/**
 * Renders every page of the tree at `root` in every theme, with zen off and
 * on, and returns the text of each page's style sheets, joined in order.
 * The tree's own catalog and loader do the rendering, in a process of its
 * own, so each tree's modules and VS Code stand-in stay apart.
 *
 * @param {string} root A tree with compiled sources in out/.
 * @returns {Record<string, string>} The sheets, by `page theme zen`.
 */
function renderSheets(root) {
  const program = `
    const ui = require(${JSON.stringify(path.join(root, 'test', 'ui', 'pages.js'))});
    const sheets = {};
    for (const theme of ui.themes) {
      for (const zen of [false, true]) {
        for (const [name, html] of ui.renderPagesForTheme(theme, { zen })) {
          sheets[name + ' ' + theme + ' ' + (zen ? 'zen' : 'plain')] =
            [...html.matchAll(/<style[^>]*>([\\s\\S]*?)<\\/style>/g)].map((match) => match[1]).join('\\n');
        }
      }
    }
    process.stdout.write(JSON.stringify(sheets));
  `;
  const result = spawnSync(process.execPath, ['-e', program], { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`rendering the pages of ${root} failed:\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

/** Extracts `ref` to a temporary folder and compiles it, returning the folder. */
function checkOutBase(ref) {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'deckard-css-parity-'));
  execFileSync('sh', ['-c', `git archive ${JSON.stringify(ref)} | tar -x -C ${JSON.stringify(folder)}`], { cwd: ROOT });
  symlinkSync(path.join(ROOT, 'node_modules'), path.join(folder, 'node_modules'));
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', folder, '--outDir', path.join(folder, 'out')], { stdio: 'inherit' });
  return folder;
}

/** CSS with its whitespace and comments set aside. */
function normalize(css) {
  const options = minify ? { minify: true } : { minifyWhitespace: true };
  return esbuild.transformSync(css, { loader: 'css', target: 'chrome148', ...options }).code.trim();
}

/** Where two strings first differ, with some of each around it. */
function firstDifference(left, right) {
  let at = 0;
  while (at < left.length && left[at] === right[at]) {
    at += 1;
  }
  return `at ${at}:\n       before: ${left.slice(Math.max(0, at - 80), at + 80)}\n       after:  ${right.slice(Math.max(0, at - 80), at + 80)}`;
}

function main() {
  if (!existsSync(path.join(ROOT, 'out')) || !existsSync(path.join(ROOT, 'dist', 'webview'))) {
    console.error('Run "npm run compile-tests && npm run build:webview" first.');
    process.exit(1);
  }
  const folder = checkOutBase(base);
  let before;
  try {
    before = renderSheets(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  const after = renderSheets(ROOT);
  const pages = new Map();
  let failed = 0;
  for (const key of Object.keys(before)) {
    const page = key.split(' ')[0];
    const result = pages.get(page) ?? { equal: 0, total: 0 };
    result.total += 1;
    if (after[key] === undefined) {
      failed += 1;
      console.log(`  FAIL ${key}: the page is not rendered now`);
    } else {
      const was = normalize(before[key]);
      const is = normalize(after[key]);
      if (was === is) {
        result.equal += 1;
      } else {
        failed += 1;
        console.log(`  FAIL ${key}: the sheets differ ${firstDifference(was, is)}`);
      }
    }
    pages.set(page, result);
  }
  for (const [page, { equal, total }] of pages) {
    console.log(`  ${equal === total ? 'ok  ' : 'FAIL'} ${page}: ${equal} of ${total} themes and zen states draw with the same CSS`);
  }
  if (failed) {
    console.log(`\n${failed} differ from ${base}`);
    process.exit(1);
  }
  console.log(`\nevery page, theme, and zen state draws with the CSS it drew with at ${base}`);
}

main();
