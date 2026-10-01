// Checks which third-party packages each bundle inlines.
//
//   node scripts/check-bundle-inputs.js
//
// Whatever src imports from node_modules, esbuild copies into a bundle that
// ships in the VSIX, so the packages a bundle takes in are what Deckard runs
// on a reader's machine (docs/architecture/decisions/0011). This reads the
// metafiles the last build wrote (node esbuild.js writes
// out/extension-meta.json and out/webview-meta.json) and fails on any package
// a bundle takes in that is not listed for it here:
//
// - The host bundles may take in only the packages they took in when this
//   check arrived, in Phase 6 step 3. The list only shrinks: step 6 removes
//   markdown-it and sanitize-html and the packages they bring, which leaves
//   picomatch.
// - A page's script may take in only Preact, and a page's style sheet nothing.
const path = require('node:path');
const { existsSync, readFileSync } = require('node:fs');

const ROOT = path.join(__dirname, '..');

/**
 * The packages the host bundles took in when this check arrived, as
 * out/extension-meta.json listed them: the three dependencies and the
 * packages they bring (markdown-it's argparse serves only its command line).
 */
const HOST_PACKAGES = [
  // markdown-it and its dependencies
  'entities', 'linkify-it', 'markdown-it', 'mdurl', 'punycode.js', 'uc.micro',
  // sanitize-html and its dependencies, dayjs by way of launder
  'deepmerge', 'dom-serializer', 'domelementtype', 'domhandler', 'domutils',
  'escape-string-regexp', 'htmlparser2', 'is-plain-object', 'launder', 'nanoid',
  'parse-srcset', 'picocolors', 'postcss', 'sanitize-html', 'source-map-js', 'dayjs',
  // the exclude globs
  'picomatch',
];

/** What each build's bundles may take in, by the file extension of the bundle. */
const ALLOWED = {
  'extension-meta.json': { '.js': HOST_PACKAGES },
  'webview-meta.json': { '.js': ['preact'], '.css': [] },
};

/**
 * The package a bundle input belongs to, or undefined for Deckard's own
 * source. The last `node_modules/` in the path decides, since an input's
 * path may run through a linked folder.
 *
 * @param {string} input An input's path, as the metafile writes it.
 */
function packageOf(input) {
  const at = input.lastIndexOf('node_modules/');
  if (at < 0) {
    return undefined;
  }
  const [scope, name] = input.slice(at + 'node_modules/'.length).split('/');
  return scope.startsWith('@') ? `${scope}/${name}` : scope;
}

/**
 * The problems with one build's bundles: each package a bundle takes in
 * that is not allowed for it.
 *
 * @param {string} file The metafile's name under out/.
 * @returns {string[]} One line for each package that is not allowed.
 */
function checkBuild(file) {
  const metafile = path.join(ROOT, 'out', file);
  if (!existsSync(metafile)) {
    return [`out/${file} is missing: run node esbuild.js first`];
  }
  const { outputs } = JSON.parse(readFileSync(metafile, 'utf8'));
  const problems = [];
  for (const [bundle, output] of Object.entries(outputs)) {
    const allowed = ALLOWED[file][path.extname(bundle)];
    if (!allowed) {
      continue;
    }
    const packages = new Set(Object.keys(output.inputs).map(packageOf).filter(Boolean));
    const extra = [...packages].filter((name) => !allowed.includes(name)).sort();
    if (extra.length) {
      problems.push(`${bundle} takes in ${extra.join(', ')}, which it may not`);
    }
    console.log(`  ${extra.length ? 'FAIL' : 'ok  '} ${bundle}: ${packages.size ? [...packages].sort().join(', ') : 'no third-party code'}`);
  }
  return problems;
}

const problems = Object.keys(ALLOWED).flatMap(checkBuild);
if (problems.length) {
  console.log(`\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('\nevery bundle takes in only the packages listed for it');
