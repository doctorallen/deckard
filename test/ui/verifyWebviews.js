// Renders every webview and checks the document it produces.
//
// Each page is a shell its host writes, which links its bundle and its style
// sheets from dist/webview. The compiler checks the bundle's source, but not
// what the shell links, in what order, or under what policy. This renders
// each page for real, with everything it links inlined by the page loader,
// and asserts what every page must have: its script parses, the design
// tokens are present, the page's layout survives the cascade, zen is the
// last layer, and the page's nonce gates every style and script.
//
// Every row a reader can open carries a shared surface. That rule reads the
// page text, which holds the body of a page whose host builds it (Help and
// the debug page), and the DOM each surface draws (the test:dom goldens),
// which is all a compiled page leaves to read. A page's state in an
// application/json block is data, not script, so it is neither parsed nor
// held to the nonce.
//
//   npm run test:ui
const { pages } = require('./pages.js');
const { readPageNonce } = require('../harness/loadPage.js');
const { readGoldens } = require('../harness/domGoldens.js');
const path = require('node:path');
const { readFileSync } = require('node:fs');
const esbuild = require('esbuild');

/**
 * CSS with its whitespace and comments set aside, so a sheet as written and
 * the same sheet as esbuild built it read alike.
 */
function normalizeCss(css) {
  return esbuild.transformSync(css, { loader: 'css', minifyWhitespace: true }).code.trim();
}
/** The zen sheet as written, which every page's tail ends with. */
const displaySheet = normalizeCss(readFileSync(path.join(__dirname, '..', '..', 'src', 'webview', 'shared', 'display.css'), 'utf8'));
/**
 * Layout each page must still have after the cascade.
 *
 * The shared sheet and a page's own rules use the same selector names, so a
 * base rule can silently replace page layout. These assert the properties
 * that decide how a page is actually laid out.
 */
const LAYOUT_CONTRACTS = {
  dashboard: [
    ['main', 'max-width', '1400px'],
    ['.metrics', 'grid-template-columns', 'repeat(3'],
    ['.metrics', 'min-width', 'min(380px'],
    ['.metric', 'clip-path', 'polygon'],
    ['.home-grid', 'grid-template-columns', 'repeat(2'],
  ],
  searchPage: [
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
    // A column that cannot shrink its cards row clips the tasks below the
    // fold with no way to reach them.
    ['.board-column', 'grid-template-rows', 'minmax(0, 1fr)'],
    // overflow-y on its own computes overflow-x to auto, and then a hover
    // nudge or a focus ring puts a horizontal scrollbar under the column.
    ['.board-cards', 'overflow-x', 'hidden'],
    ['.board-cards .board-card:hover', 'transform', 'none'],
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
    if (!selectors.includes(selector)) {
      continue;
    }
    for (const declaration of body.split(';')) {
      const [name, ...rest] = declaration.split(':');
      if (name && name.trim() === property) {
        value = rest.join(':').trim();
      }
    }
  }
  return value;
}

/** Classes that render a row a reader can open. */
const CONTENT_ROWS = [
  'tag-row', 'entity-row', 'note-row', 'task-row', 'saved-filter-row',
  'board-card', 'stat-row',
];
/** Whether a row's classes include the shared surface every content row needs. */
function hasSharedSurface(classes) {
  return classes.includes('row') || classes.includes('card') || classes.includes('task');
}

/**
 * The content rows in a drawn body that carry no shared surface.
 *
 * @param {object} body A golden's body element.
 * @returns {string[]} Each such row's class attribute.
 */
function bareDrawnRows(body) {
  return [...body.querySelectorAll('[class]')]
    .map((element) => element.getAttribute('class'))
    .filter((written) => {
      const classes = written.split(/\s+/);
      return CONTENT_ROWS.some((rowClass) => classes.includes(rowClass)) && !hasSharedSurface(classes);
    });
}

/**
 * The inline scripts of a page that run, leaving out its state in an
 * application/json block, which is data.
 */
function runnableScripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)]
    .map(([, attributes, text]) => ({ attributes, text }))
    .filter((block) => !/\btype="application\/json"/i.test(block.attributes))
    .map((block) => block.text);
}

/** A problem for each script that does not parse. */
function scriptProblems(scripts) {
  const problems = [];
  for (const script of scripts) {
    try { new Function(script); }
    catch (error) { problems.push('script does not parse: ' + error.message); }
  }
  return problems;
}

/**
 * Every row a reader can open must carry a shared surface component, so it
 * gets the same border, hover and focus as every other one. Layout rows such
 * as .control-row are not content and are not listed in CONTENT_ROWS.
 */
function bareTextRowProblems(html) {
  const problems = [];
  for (const rowClass of CONTENT_ROWS) {
    const bare = [...html.matchAll(new RegExp(`class="([^"]*\\b${rowClass}\\b[^"]*)"`, 'g'))]
      .filter((match) => !hasSharedSurface(match[1].split(/\s+/)));
    for (const match of bare) {
      problems.push(`.${rowClass} is missing a shared surface (.row/.card): "${match[1]}"`);
    }
  }
  return problems;
}

/**
 * How far the braces of a page's styles are off balance: below zero at the
 * first stray closing brace, which makes the browser drop the rule after it,
 * and above zero when a block is left open.
 */
function braceDepth(styles) {
  let depth = 0;
  for (const character of styles.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"/g, '""')) {
    if (character === '{') {
      depth += 1;
    }
    if (character === '}') {
      depth -= 1;
    }
    if (depth < 0) {
      break;
    }
  }
  return depth;
}

/** The problems with a page's styles: their braces, its layout, and zen's place. */
function styleProblems(name, styles) {
  const problems = [];
  const depth = braceDepth(styles);
  if (depth !== 0) {
    problems.push(`style braces do not balance (${depth < 0 ? 'a stray }' : 'an unclosed {'})`);
  }
  for (const [selector, property, expected] of LAYOUT_CONTRACTS[name] ?? []) {
    const actual = effectiveValue(styles, selector, property);
    if (!actual || !actual.includes(expected)) {
      problems.push(
        `${selector} { ${property} } should include "${expected}", got "${actual ?? 'nothing'}"`,
      );
    }
  }

  // Display is the last layer. Its rules only beat a theme's because they
  // come after them — LCARS' .metric:nth-child(3n + 2)::before ties with
  // body[data-styling="plain"] .metric::before on specificity, so position
  // is what decides it.
  const cascade = normalizeCss(styles);
  if (!cascade.includes(displaySheet)) {
    problems.push('the Display sheet is missing or altered from src/webview/shared/display.css');
  } else if (!cascade.endsWith(displaySheet)) {
    problems.push('the Display sheet is not the last layer of the page\'s sheets');
  }
  return problems;
}

/** The problems with a page's tokens and its Content-Security-Policy. */
function tokenAndPolicyProblems(html) {
  const problems = [];
  // Tokens must be declared once, by the shared sheet.
  const roots = (html.match(/:root\s*\{/g) || []).length;
  if (roots > 2) {
    problems.push(`${roots} :root blocks; tokens should come from the base sheet`);
  }
  if (!/:root/.test(html)) {
    problems.push('missing :root');
  }
  if (!/Content-Security-Policy/.test(html)) {
    problems.push('missing CSP');
  }
  // Every inline style and script carries the nonce the page's policy
  // names. The page comes through the page loader, so a bundle it loads by
  // URI is counted here as the inline script it becomes.
  const nonce = readPageNonce(html);
  if (!nonce) {
    problems.push('the CSP names no nonce');
  }
  const ungated = [...html.matchAll(/<(script|style)\b([^>]*)>/gi)]
    .filter(([, , attributes]) => !/\btype="application\/json"/i.test(attributes))
    .filter(([, , attributes]) => !attributes.includes(`nonce="${nonce}"`));
  if (ungated.length) {
    problems.push(`${ungated.length} inline style or script without the page's nonce`);
  }
  return problems;
}

let fail = 0;
for (const [name, render] of pages) {
  let html;
  try { html = render(); }
  catch (error) { console.log(`  FAIL ${name}: render threw: ${error.message}`); fail++; continue; }
  const scripts = runnableScripts(html);
  const problems = scriptProblems(scripts);
  if (!/--amber\s*:/.test(html)) {
    problems.push('missing design tokens');
  }
  if (!/--panel-raised\s*:/.test(html)) {
    problems.push('missing the full token set');
  }
  problems.push(...bareTextRowProblems(html));
  // Page layout must survive the shared sheet.
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1])
    .join('\n');
  problems.push(...styleProblems(name, styles), ...tokenAndPolicyProblems(html));
  if (problems.length) { fail++; console.log(`  FAIL ${name}\n       ` + problems.join('\n       ')); }
  else {
    console.log(`  ok   ${name}  (${(html.length/1024).toFixed(0)}kb, ${scripts.length} script)`);
  }
}
// The same rule over what each surface draws, so it still holds once a
// page's markup is no longer text.
let bareSurfaces = 0;
const goldens = readGoldens((surface, body) => {
  const bare = bareDrawnRows(body);
  if (!bare.length) {
    return;
  }
  bareSurfaces++;
  console.log(`  FAIL ${surface} (as drawn)\n       ` + bare.map((written) => `a content row is missing a shared surface (.row/.card): "${written}"`).join('\n       '));
});
fail += bareSurfaces;
if (!bareSurfaces) {
  console.log(`  ok   the content rows of ${goldens} drawn surfaces carry a shared surface`);
}
console.log(fail ? `\n${fail} failed` : '\nall webviews render');
process.exit(fail ? 1 : 0);
