// Lays out the webviews in a real browser and measures them.
//
// The other checks never lay anything out: the layout contracts read the
// stylesheet as text, and the end-to-end suites run against a DOM with no
// geometry. So a column that clipped its own cards, or a hover that grew a
// card past its scroller, passed every one of them. This renders each page
// as the webview does — the host's HTML, the page's own script, a snapshot
// the real state builder made — in headless Chrome, then asks the DOM what
// it measured.
//
// Chrome writes the page back with --dump-dom once scripts have run, and the
// page's own probe writes its measurements into a <pre> for that dump to
// carry, so no debugger protocol is needed. CHROME_PATH names the browser;
// otherwise the usual names are tried, and the check is skipped with a
// message when none is found rather than failing a machine without one.
//
//   npm run test:layout
//   LAYOUT_ONLY=oblivion:taskBoard npm run test:layout   one surface, or a theme, or a page
//   LAYOUT_DEBUG=1                                       the measurements themselves
//   LAYOUT_KEEP=/tmp/pages LAYOUT_DRY=1                  write the pages to open by hand
const path = require('node:path');
const os = require('node:os');
const { existsSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

const compiled = path.join(__dirname, '..', '..', 'out');
if (!existsSync(compiled)) {
  console.error('Run "npm run compile-tests" first: out/ is missing.');
  process.exit(1);
}
const { pages, renderPagesForTheme, themes } = require('./pages.js');
const { createTaskBoard } = require('../../out/ui/state/taskBoardState.js');
const { createSidebarSnapshot } = require('../../out/ui/state/relatedNotesRanking.js');
const { createSearchPageSnapshot } = require('../../out/ui/state/dashboardState.js');
const { parseMarkdown } = require('../../out/core/markdown/parser.js');
const { buildWorkspaceIndex } = require('../../out/core/workspace/indexer.js');
const { PreferencesStore } = require('../../out/core/storage/preferences.js');

const chrome = findChrome();
if (!chrome) {
  console.log('layout check skipped: no Chrome found (set CHROME_PATH)');
  process.exit(0);
}

/** Enough tasks that the busiest column must scroll, and titles that wrap. */
function createIndex() {
  const long = 'Chase the replicant through the neon market and file the report before the rain';
  const lines = ['# Tasks #project/atlas', ''];
  for (let i = 1; i <= 40; i += 1) {
    lines.push(`- [ ] ${i === 1 ? long : `Overdue task ${i}`} 📅 2026-09-01 #status/doing`);
  }
  for (let i = 1; i <= 12; i += 1) {
    lines.push(`- [ ] Later task ${i} 📅 2026-12-01`);
  }
  lines.push('- [ ] Undated task @dana', '- [x] Finished task ✅ 2026-09-10');
  const files = new Map([
    ['notes/tasks.md', parseMarkdown('notes/tasks.md', lines.join('\n'))],
    ['notes/atlas.md', parseMarkdown('notes/atlas.md', [
      '# Atlas #project/atlas @dana',
      'A note with a title long enough to wrap in a narrow sidebar, about #topic/replicants and @ren-kade.',
      '## Meeting #meeting/standup',
      'Notes from the standup with @dana.',
    ].join('\n'))],
    ...Array.from({ length: 12 }, (_, i) => [`notes/note-${i}.md`, parseMarkdown(`notes/note-${i}.md`,
      `# Related note ${i} #project/atlas #topic/replicants\nMentions @dana and the Atlas project, entry ${i}.`)]),
  ]);
  return { index: buildWorkspaceIndex(files), files };
}

function createGlobalState() {
  const store = new Map();
  return {
    get: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
    keys: () => [...store.keys()],
    update: (key, value) => { store.set(key, value); return Promise.resolve(); },
  };
}

const NOW = new Date(2026, 8, 21, 12).getTime();

/**
 * The surfaces measured, each with the snapshot its page renders from and
 * the geometry it must keep. A probe runs in the page and reports; the
 * expectations here read the report.
 */
function createSurfaces(zen) {
  const { index, files } = createIndex();
  const preferences = new PreferencesStore(createGlobalState());
  return [
    {
      page: 'taskBoard',
      viewport: [1400, 900],
      snapshot: () => createTaskBoard(
        index,
        preferences.value,
        { query: '' },
        { now: NOW, statuses: ['todo', 'doing', 'done'], statusNamespace: 'status', format: 'emoji' },
        'inline',
      ),
      scrollers: ['.board-cards'],
      clippers: ['.board-column'],
      hovered: ['.board-card'],
    },
    {
      // As narrow as a reader is likely to drag the sidebar: the page's own
      // floor is 220px.
      page: 'sidebarNotes',
      viewport: [240, 700],
      snapshot: () => createSidebarSnapshot(
        index,
        'notes/atlas.md',
        files.get('notes/atlas.md'),
        true,
        'tags',
        {},
        'inline',
      ),
      scrollers: ['html'],
      clippers: [],
      hovered: ['.note'],
    },
    // Zen folds each card's file and line away and reveals it on hover, so a
    // hovered result is the one row that grows. The search page is where that
    // reveal sits inside a .card-header rather than at the end of the row.
    ...(zen ? [{
      page: 'searchPage',
      viewport: [900, 900],
      snapshot: () => createSearchPageSnapshot(index, preferences.value, '#project/atlas'),
      scrollers: ['html'],
      clippers: [],
      hovered: ['.card'],
    }] : []),
  ];
}

/**
 * What the page measures about itself once its script has drawn the
 * snapshot, written into #layout-probe for the DOM dump to carry out.
 */
function probeScript(surface) {
  return `
(function () {
  function box(el) {
    return {
      clientW: el.clientWidth, scrollW: el.scrollWidth,
      clientH: el.clientHeight, scrollH: el.scrollHeight,
      overflowX: getComputedStyle(el).overflowX, overflowY: getComputedStyle(el).overflowY
    };
  }
  function report(label) {
    const out = { label, scrollers: [], clippers: [] };
    for (const sel of ${JSON.stringify(surface.scrollers)}) {
      document.querySelectorAll(sel).forEach((el, i) => {
        const b = box(el);
        out.scrollers.push({ sel: sel + '#' + i, ...b, wide: b.scrollW > b.clientW ? wide(el) : [] });
      });
    }
    for (const sel of ${JSON.stringify(surface.clippers)}) {
      document.querySelectorAll(sel).forEach((el, i) => out.clippers.push({ sel: sel + '#' + i, ...box(el) }));
    }
    return out;
  }
  // The elements reaching past a scroller's right edge, widest first, so a
  // failure names what grew rather than only that something did.
  function name(el) {
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].join('.') : '');
  }
  function wide(scroller) {
    const edge = scroller.getBoundingClientRect().left + scroller.clientWidth;
    const past = [...scroller.querySelectorAll('*')]
      .map((el) => ({ el, right: el.getBoundingClientRect().right }))
      .filter((entry) => entry.right > edge + 0.5)
      .sort((a, b) => b.right - a.right)
      .slice(0, 4)
      .map((entry) => name(entry.el) + ' +' + Math.round(entry.right - edge) + 'px');
    if (past.length) return past;
    // Nothing's own box reaches past the edge, so a ::before or ::after does.
    // Hiding elements one at a time until the overflow goes finds whose.
    const found = [];
    for (const el of [...scroller.querySelectorAll('*')].slice(0, 400)) {
      const was = el.style.display;
      el.style.display = 'none';
      const gone = scroller.scrollWidth <= scroller.clientWidth;
      el.style.display = was;
      if (gone) { found.push(name(el) + ' (a pseudo-element of it, or inside it)'); if (found.length > 3) break; }
    }
    return found;
  }
  const runs = [{ ...report('resting'), viewport: [innerWidth, innerHeight] }];
  let target = null;
  let hoverTarget = '';
  for (const sel of ${JSON.stringify(surface.hovered)}) {
    target = document.querySelector(sel);
    if (target) { hoverTarget = sel; break; }
  }
  runs[0].hoverTarget = hoverTarget;
  runs[0].classes = [...new Set([...document.querySelectorAll('[class]')].flatMap((el) => [...el.classList]))].filter((c) => /row|card|item|note|task|entry/.test(c)).slice(0, 30);
  if (target) {
    // :hover cannot be forced from a script, so every :hover rule on the page
    // is rewritten to match a class instead, and the class is put on one row.
    for (const sheet of document.styleSheets) {
      for (const rule of sheet.cssRules) {
        if (rule.selectorText && rule.selectorText.includes(':hover')) {
          rule.selectorText = rule.selectorText.split(':hover').join('.layout-probe-hover');
        }
      }
    }
    target.classList.add('layout-probe-hover');
    // Force layout so the rewritten rules apply before measuring.
    void target.offsetWidth;
    runs.push({ ...report('hovered'), transform: getComputedStyle(target).transform });
  }
  const pre = document.createElement('pre');
  pre.id = 'layout-probe';
  pre.textContent = JSON.stringify(runs);
  document.body.appendChild(pre);
})();`;
}

/** The page as the webview shows it, with the VS Code bridge replaced. */
function buildPage(html, surface) {
  const snapshot = surface.snapshot();
  const bridge = `<script>
window.acquireVsCodeApi = function () {
  return { postMessage: function () {}, getState: function () {}, setState: function () {} };
};
</script>`;
  const drive = `<script>
window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', data: ${JSON.stringify(snapshot)} } }));
setTimeout(function () { ${probeScript(surface)} }, 50);
</script>`;
  const inner = html
    // The page's CSP names a nonce these scripts do not have.
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
    .replace(/<script/, `${bridge}<script`)
    .replace(/<\/body>/, `${drive}</body>`);
  const [width, height] = surface.viewport;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; background: #888; }
iframe { display: block; border: 0; width: ${width}px; height: ${height}px; }
</style></head><body>
<iframe id="page" srcdoc="${inner.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>
<pre id="layout-probe"></pre>
<script>
setTimeout(function () {
  var doc = document.getElementById('page').contentDocument;
  var probe = doc && doc.getElementById('layout-probe');
  document.getElementById('layout-probe').textContent = probe ? probe.textContent : '';
}, 400);
</script></body></html>`;
}

// A --virtual-time-budget of 3s should dump the DOM and exit in about that.
// Headless Chrome occasionally wedges instead, at 0% CPU, and never returns:
// without a timeout that hangs the whole suite silently, which it did for
// twenty minutes before anyone asked. One wedge is a flake and is retried;
// twice on the same surface is a fault and is reported as one.
const MEASURE_TIMEOUT_MS = 60000;

function runChrome(file, viewport) {
  return spawnSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--window-size=${Math.max(viewport[0], 800)},${Math.max(viewport[1], 800)}`,
    '--virtual-time-budget=3000', '--dump-dom', `file://${file}`,
  ], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: MEASURE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
}

function measure(file, viewport) {
  let result = runChrome(file, viewport);
  if (result.signal === 'SIGKILL') {
    console.log(`       chrome wedged after ${MEASURE_TIMEOUT_MS / 1000}s, retrying once`);
    result = runChrome(file, viewport);
  }
  if (result.signal === 'SIGKILL') {
    throw new Error(
      `chrome wedged twice, ${MEASURE_TIMEOUT_MS / 1000}s each, on ${path.basename(file)}`,
    );
  }
  const match = /<pre id="layout-probe">([\s\S]*?)<\/pre>/.exec(result.stdout ?? '');
  if (!match) {
    throw new Error(`no probe output (chrome exit ${result.status}): ${(result.stderr ?? '').slice(0, 400)}`);
  }
  return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes('/')) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    const found = spawnSync('which', [candidate], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  return undefined;
}

// LAYOUT_KEEP=<dir> writes the pages there and leaves them, to open by hand.
const keep = process.env.LAYOUT_KEEP;
const dir = keep || mkdtempSync(path.join(os.tmpdir(), 'deckard-layout-'));
if (keep && !existsSync(keep)) require('node:fs').mkdirSync(keep, { recursive: true });
let failed = 0;
try {
  for (const theme of themes.map((entry) => entry.id ?? entry)) {
   for (const zen of [false, true]) {
    const label = zen ? `${theme}+zen` : theme;
    const rendered = new Map(renderPagesForTheme(theme, { zen }));
    for (const surface of createSurfaces(zen)) {
      // LAYOUT_ONLY=oblivion:sidebarNotes runs one surface while looking at it.
      // LAYOUT_ONLY=oblivion+zen:sidebarNotes picks the zen pass of it.
      const only = process.env.LAYOUT_ONLY;
      if (only && only !== `${label}:${surface.page}` && only !== surface.page && only !== label) continue;
      const html = rendered.get(surface.page);
      const file = path.join(dir, `${label}-${surface.page}.html`);
      writeFileSync(file, buildPage(html, surface));
      const problems = [];
      let runs;
      try {
        runs = process.env.LAYOUT_DRY ? [] : measure(file, surface.viewport);
      } catch (error) {
        problems.push(error.message);
        runs = [];
      }
      if (process.env.LAYOUT_DEBUG) {
        console.log(JSON.stringify({ theme: label, page: surface.page, runs }, null, 1));
      }
      if (runs[0] && (runs[0].viewport[0] !== surface.viewport[0] || runs[0].viewport[1] !== surface.viewport[1])) {
        problems.push(`viewport is ${runs[0].viewport.join('x')}, not ${surface.viewport.join('x')}`);
      }
      if (runs[0] && !runs[0].hoverTarget) {
        problems.push(`no row to hover: none of ${surface.hovered.join(', ')} is on the page (saw ${runs[0].classes.join(', ') || 'no row-like classes'})`);
      }
      for (const run of runs) {
        for (const box of run.scrollers) {
          if (box.scrollW > box.clientW) {
            problems.push(`${run.label}: ${box.sel} overflows sideways (${box.scrollW} > ${box.clientW})${run.transform && run.transform !== 'none' ? `, the hovered row moved (${run.transform})` : ''}${box.wide.length ? ' — ' + box.wide.join('; ') : ''}`);
          }
        }
        for (const box of run.clippers) {
          if (box.scrollH > box.clientH && box.overflowY === 'hidden') {
            problems.push(`${run.label}: ${box.sel} clips ${box.scrollH - box.clientH}px it cannot scroll to`);
          }
        }

      }
      if (process.env.LAYOUT_DRY) {
        console.log(`  wrote ${file}`);
      } else if (problems.length === 0) {
        const scrolls = runs[0]?.scrollers.filter((box) => box.scrollH > box.clientH).length ?? 0;
        console.log(`  ok   ${label.padEnd(14)} ${surface.page.padEnd(13)} ${scrolls} scroller(s) scrolling, nothing clipped, nothing sideways`);
      } else {
        failed += 1;
        console.log(`  FAIL ${label.padEnd(14)} ${surface.page}`);
        problems.forEach((problem) => console.log(`         ${problem}`));
      }
    }
   }
  }
} finally {
  if (!keep) rmSync(dir, { recursive: true, force: true });
}
if (failed) {
  console.log(`\n${failed} surface(s) mis-laid`);
  process.exit(1);
}
console.log('\nevery surface lays out as drawn');
