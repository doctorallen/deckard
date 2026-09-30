// Copies docs/architecture into the docs site's staging folder, with each
// link pointed at where its target lives once the site is built.
//
//   node scripts/stage-architecture.js <site folder> <repository blob URL>
//
// The pages are plain Markdown written to read on GitHub, so they link the
// code and the plans by relative path, such as `../../src/extension.ts`. On
// the site only the guide and the architecture pages exist, so a link into
// either stays relative, and a link to anything else in the repository is
// rewritten to that file on GitHub. .github/workflows/docs.yml runs this
// after it stages the guide.
const path = require('node:path');
const { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } = require('node:fs');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'docs', 'architecture');
/** Where the guide's pages and screenshots sit in the staged site. */
const STAGED_ELSEWHERE = [
  { from: 'docs/guide/', to: '' },
  { from: 'docs/images/', to: 'images/' },
];

/** Every Markdown file under a folder, as paths relative to it. */
function listPages(folder, prefix = '') {
  return readdirSync(folder).flatMap((name) => {
    const full = path.join(folder, name);
    if (statSync(full).isDirectory()) return listPages(full, `${prefix}${name}/`);
    return name.endsWith('.md') ? [`${prefix}${name}`] : [];
  });
}

/**
 * Where one link from a page should point on the site.
 *
 * @param {string} page The page's path under docs/architecture, such as
 *   `decisions/0001-load-page-bundles-through-aswebviewuri.md`.
 * @param {string} href The link as written.
 * @param {string} blob The repository's blob URL for the branch being built.
 * @returns {string} The link unchanged when it is absolute, an anchor, or
 *   stays within the section; otherwise its place on the site or on GitHub.
 */
function relink(page, href, blob) {
  if (/^([a-z]+:|#|\/)/i.test(href)) return href;
  const [target, anchor] = href.split('#');
  const inRepository = path.posix.normalize(path.posix.join('docs/architecture', path.posix.dirname(page), target));
  const suffix = anchor === undefined ? '' : `#${anchor}`;
  if (inRepository.startsWith('docs/architecture/')) return href;
  const staged = STAGED_ELSEWHERE.find(({ from }) => inRepository.startsWith(from));
  if (staged) {
    const onSite = staged.to + inRepository.slice(staged.from.length);
    const fromPage = path.posix.join('architecture', path.posix.dirname(page));
    return path.posix.relative(fromPage, onSite) + suffix;
  }
  return `${blob}/${inRepository}${suffix}`;
}

/**
 * Copies every page, with its links rewritten, into `<site>/architecture`.
 * A page may mark where the generated layer graph goes with the comment
 * `<!-- layer-graph -->`; on the site it becomes the graph's image.
 */
function stage(site, blob) {
  for (const page of listPages(SOURCE)) {
    const text = readFileSync(path.join(SOURCE, page), 'utf8')
      .replace(/(\]\()([^)\s]+)(\))/g, (_all, open, href, close) => open + relink(page, href, blob) + close)
      .replace('<!-- layer-graph -->', '![The layers of src and the imports between them, drawn by dependency-cruiser](layers.svg)');
    const out = path.join(site, 'architecture', page);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, text);
  }
}

if (require.main === module) {
  const [site, blob] = process.argv.slice(2);
  if (!site || !blob) {
    console.error('Usage: node scripts/stage-architecture.js <site folder> <repository blob URL>');
    process.exit(1);
  }
  stage(site, blob);
}

module.exports = { relink };
