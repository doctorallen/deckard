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
const { pages, renderPagesForTheme, themes, vscodePaletteCss } = require('./pages.js');
const modules = require('../harness/modules.js');
const { readPageNonce } = require('../harness/loadPage.js');
const { createTaskBoard } = modules.taskBoardState;
const { createSidebarSnapshot } = modules.relatedNotesRanking;
const { createSearchPageSnapshot, createDeckardStatsSnapshot } = modules.dashboardState;
const { createCalendar } = modules.calendarState;
const { parseMarkdown } = modules.parser;
const { buildWorkspaceIndex } = modules.indexer;
const { PreferencesStore } = modules.preferences;

const chrome = findChrome();
if (!chrome) {
  console.log('layout check skipped: no Chrome found (set CHROME_PATH)');
  process.exit(0);
}

/** Enough tasks that the busiest column must scroll, and titles that wrap. */
function createIndex(withSteps = false) {
  const long = 'Chase the replicant through the neon market and file the report before the rain';
  const lines = ['# Tasks #project/atlas', ''];
  for (let i = 1; i <= 40; i += 1) {
    lines.push(`- [ ] ${i === 1 ? long : `Overdue task ${i}`} 📅 2026-09-01 #status/doing`);
    // The board's cards: the long first task has steps, the next of them
    // too long for a column, so its line must ellipsize, not widen the card.
    if (i === 1 && withSteps) {
      lines.push('  - [x] Find the market stall', '  - [ ] Draft the report for the precinct before the rain comes back');
    }
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

/**
 * The calendar's own small month, so no other surface's pixels move with it:
 * a crowded day, a day far past due, and a chosen day with more tasks and
 * new notes than the panel lists at once, their titles long.
 */
function createCalendarIndex() {
  const long = 'Chase the replicant through the neon market and file the report';
  const created = new Date(2026, 8, 21, 9).getTime();
  const tasks = [
    ...Array.from({ length: 7 }, (_, i) => `- [ ] ${long} ${i + 1} 📅 2026-09-21`),
    '- [ ] Draft the brief for the whole of the Atlas programme ⏳ 2026-09-21',
    ...Array.from({ length: 12 }, (_, i) => `- [ ] Busy ${i} 📅 2026-09-24`),
    ...Array.from({ length: 11 }, (_, i) => `- [ ] Planned ${i} ⏳ 2026-09-24`),
    '- [ ] Renew the lease 📅 2026-08-03',
    '- [x] Filed the report ✅ 2026-09-21',
  ];
  const files = new Map([
    ['notes/2026-09-21.md', parseMarkdown('notes/2026-09-21.md', `# 2026-09-21\n${tasks.join('\n')}\n`, { createdAt: created, updatedAt: created })],
    ...Array.from({ length: 6 }, (_, i) => {
      const filePath = `projects/a-folder-with-a-long-name/note-${i}.md`;
      return [filePath, parseMarkdown(filePath, `# A new note with a title too long for the sidebar ${i}\n`, { createdAt: created + i, updatedAt: created })];
    }),
  ]);
  return buildWorkspaceIndex(files);
}

/**
 * The calendar page's month: the sidebar's, with a task due every week that
 * repeats, a task due every day, and a crowded day for +N more.
 */
function createCalendarPageIndex() {
  const base = createCalendarIndex();
  const files = new Map(base.files);
  const created = new Date(2026, 8, 1, 9).getTime();
  files.set('notes/routines.md', parseMarkdown('notes/routines.md', [
    '# Routines',
    '- [ ] Water the plants on the balcony and the ones by the window 📅 2026-09-22 🔁 every week',
    '- [ ] Stand-up 📅 2026-09-21 🔁 every weekday',
    '- [ ] Pay rent 📅 2026-09-28 🔁 every month when done',
  ].join('\n') + '\n', { createdAt: created, updatedAt: created }));
  return buildWorkspaceIndex(files);
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
  // Only the board's surfaces carry steps, so no other page's pixels move.
  const boardIndex = createIndex(true).index;
  const preferences = new PreferencesStore(createGlobalState());
  return [
    {
      page: 'taskBoard',
      viewport: [1400, 900],
      snapshot: () => createTaskBoard(
        boardIndex,
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
      // Grouped by a tag namespace, the switch has five segments: it must
      // wrap rather than push the page sideways at a narrower width.
      name: 'taskBoardByTag',
      page: 'taskBoard',
      viewport: [900, 700],
      snapshot: () => createTaskBoard(
        boardIndex,
        { ...preferences.value, taskBoardGroup: 'tag', taskBoardGroupNamespace: 'project' },
        { query: '' },
        { now: NOW, statuses: ['todo', 'doing', 'done'], statusNamespace: 'status', format: 'emoji' },
        'inline',
      ),
      scrollers: ['html', '.board-cards'],
      clippers: ['.board-column'],
      hovered: ['.board-card'],
    },
    {
      // The calendar in a narrow sidebar with its day panel on: counts that
      // run to two digits, and rows whose words are longer than the panel.
      page: 'calendar',
      viewport: [240, 700],
      snapshot: () => createCalendar(createCalendarIndex(), '2026-09', new Date(NOW), 0, {
        dayPanel: true,
      }),
      scrollers: ['html'],
      clippers: ['.day', '.day-panel .task-row'],
      hovered: ['.day-panel .task-row'],
    },
    {
      // The sidebar calendar as its five working days.
      name: 'calendarNoWeekends',
      page: 'calendar',
      viewport: [240, 700],
      snapshot: () => createCalendar(createCalendarIndex(), '2026-09', new Date(NOW), 0, {
        dayPanel: true,
        showWeekends: false,
        selectedDate: '2026-09-24',
      }),
      scrollers: ['html'],
      clippers: ['.day', '.day-panel .task-row'],
      hovered: ['.day-panel .task-row'],
    },
    {
      // Related Notes showing the calendar page's chosen day.
      name: 'sidebarNotesCalendarDay',
      page: 'sidebarNotes',
      viewport: [240, 700],
      snapshot: () => ({
        activeTags: [],
        notes: [],
        tagTitleDisplayMode: 'inline',
        calendarDay: createCalendar(createCalendarPageIndex(), '2026-09', new Date(NOW), 0, {
          dayPanel: true,
          showRepeats: true,
          selectedDate: '2026-09-24',
        }).selected,
        state: 'calendarDay',
      }),
      scrollers: ['html'],
      clippers: ['.day-panel .task-row'],
      hovered: ['.day-panel .task-row'],
    },
    {
      // The calendar page, wide: the month beside the chosen day, with
      // chips cut short, +N more, and repeats every weekday.
      page: 'calendarPage',
      viewport: [1400, 900],
      snapshot: () => createCalendar(createCalendarPageIndex(), '2026-09', new Date(NOW), 0, {
        dayPanel: true,
        layout: 'page',
        showRepeats: true,
        selectedDate: '2026-09-24',
      }),
      scrollers: ['html'],
      clippers: ['.cal-chip', '.day-panel .task-row'],
      hovered: ['.cal-chip'],
    },
    {
      // The page under 900px: the day panel moves under the month.
      name: 'calendarPageNarrow',
      page: 'calendarPage',
      viewport: [800, 900],
      snapshot: () => createCalendar(createCalendarPageIndex(), '2026-09', new Date(NOW), 0, {
        dayPanel: true,
        layout: 'page',
        showRepeats: true,
      }),
      scrollers: ['html'],
      clippers: ['.cal-chip', '.day-panel .task-row'],
      hovered: ['.cal-chip'],
    },
    {
      // As narrow as a reader is likely to drag the sidebar: the page's own
      // floor is 220px.
      page: 'sidebarNotes',
      viewport: [240, 700],
      snapshot: () => createSidebarSnapshot(index, 'notes/atlas.md', files.get('notes/atlas.md'), {
        now: NOW,
        enableKeywordLinks: true,
        relatedNotesSortMode: 'tags',
        sectionAccessCounts: {},
        tagTitleDisplayMode: 'inline',
      }),
      scrollers: ['html'],
      clippers: [],
      hovered: ['.note'],
    },
    {
      // A note with no tags: the tags similar notes use, each a full-width
      // row, then the entries worded like it, at the same narrow width.
      name: 'sidebarNotesUntagged',
      page: 'sidebarNotes',
      viewport: [240, 700],
      snapshot: () => {
        const untaggedFiles = new Map(files);
        const untagged = parseMarkdown('notes/untagged.md', [
          '# Thursday',
          'Walked the neon market with Dana about the Atlas project and the replicants report.',
          'The related note on the Atlas project needs an entry before the rain.',
        ].join('\n'));
        untaggedFiles.set('notes/untagged.md', untagged);
        return {
          ...createSidebarSnapshot(buildWorkspaceIndex(untaggedFiles), 'notes/untagged.md', untagged, {
            now: NOW,
            enableKeywordLinks: true,
            relatedNotesSortMode: 'tags',
            sectionAccessCounts: {},
            tagTitleDisplayMode: 'inline',
          }),
          previewLines: 1,
        };
      },
      scrollers: ['html'],
      clippers: [],
      hovered: ['.note'],
    },
    // Zen folds each card's file and line away and reveals it on hover, so a
    // hovered result is the one row that grows. The search page is where that
    // reveal sits inside a .card-header rather than at the end of the row.
    // Without zen it is drawn too, so its cards' tags, their three lines, and
    // the hub line are measured in every theme.
    {
      // Stats: what needs attention first, then the totals, then what is
      // viewed most, with every panel's rows at full width.
      page: 'stats',
      viewport: [1100, 900],
      snapshot: () => ({
        ...createDeckardStatsSnapshot(index, {
          ...preferences.value,
          tagAccessCounts: { '#project/atlas': 4, '#topic/replicants': 2 },
        }, [{ filePath: 'notes/unreadable-note-with-a-long-name.md', reason: 'EACCES: permission denied' }], NOW),
        // "5 minutes ago" would change with the clock, and so the pixels.
        updatedAt: 0,
      }),
      scrollers: ['html'],
      clippers: [],
      hovered: ['.metric-open'],
    },
    {
      page: 'searchPage',
      viewport: [900, 900],
      snapshot: () => createSearchPageSnapshot(index, preferences.value, '#project/atlas'),
      scrollers: ['html'],
      clippers: [],
      hovered: ['.card'],
    },
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
  // A control that cannot act must not light up under the pointer: its
  // colors at rest, to compare once every :hover rule is forced onto it.
  function look(el) {
    const style = getComputedStyle(el);
    return [style.backgroundColor, style.borderTopColor, style.color].join(' ');
  }
  const disabled = [...document.querySelectorAll('button:disabled, [aria-disabled="true"]')];
  disabled.forEach((el) => { el.style.transition = 'none'; });
  const disabledAtRest = disabled.map(look);
  runs[0].disabledCount = disabled.length;
  // A tag on a card is written text: no edge and no ground at rest.
  runs[0].cardTagsBoxed = [...document.querySelectorAll(':is(.card, .task-row, .board-card, .note) :is(button.tag-open, button.inline-tag)')]
    .filter((el) => {
      const style = getComputedStyle(el);
      return style.borderTopStyle !== 'none' || (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent');
    })
    .slice(0, 4)
    .map((el) => name(el) + ' ' + getComputedStyle(el).borderTopStyle + ' ' + getComputedStyle(el).backgroundColor);
  // A result cut to three lines is no taller than three of its lines.
  runs[0].clampOver = [...document.querySelectorAll('.card-body.is-clamped > .rendered, .card-body.is-clamped > .markdown')]
    .filter((el) => {
      const style = getComputedStyle(el);
      const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.55;
      const content = el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      return content > 3 * line + 2;
    })
    .slice(0, 4)
    .map((el) => name(el) + ' ' + el.clientHeight + 'px');
  // A tag keeps to one line and stays inside the entry it is written in.
  runs[0].tagsBroken = [...document.querySelectorAll('.tag-open .tag-label, .inline-tag .tag-label')]
    .filter((label) => {
      const entry = label.closest('.note, .card, .board-card, .task-row');
      const lines = label.getClientRects().length;
      const past = entry ? label.getBoundingClientRect().right - entry.getBoundingClientRect().right : 0;
      return lines > 1 || past > 0.5;
    })
    .slice(0, 4)
    .map((label) => label.textContent + ' (' + label.getClientRects().length + ' lines)');
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
    disabled.forEach((el) => el.classList.add('layout-probe-hover'));
    runs[1].disabledLit = disabled
      .map((el, i) => { const now = look(el); return now === disabledAtRest[i] ? '' : name(el) + ' ' + disabledAtRest[i] + ' -> ' + now; })
      .filter(Boolean);
  }
  const pre = document.createElement('pre');
  pre.id = 'layout-probe';
  pre.textContent = JSON.stringify(runs);
  document.body.appendChild(pre);
})();`;
}

/**
 * The page as the webview shows it, with the VS Code bridge replaced. probe
 * is the script that measures it, the layout probe unless another is given.
 */
/**
 * Every transition and animation at its end, and no caret. A page is
 * measured and photographed once, at a moment Chrome picks, so anything
 * still moving then is caught at a different point on each run: CI drew 17
 * surfaces differently from one run to the next, the first card's focus
 * ring half faded in or not yet there. What is checked is where a page
 * settles, which is what a reader sees once it stops moving.
 */
const SETTLED = '*, *::before, *::after { transition-duration: 0s !important; transition-delay: 0s !important; animation-duration: 0s !important; animation-delay: 0s !important; caret-color: transparent !important; }';

function buildPage(html, surface, probe = probeScript(surface)) {
  const snapshot = surface.snapshot();
  // The page keeps its Content-Security-Policy, which Chrome enforces as VS
  // Code does, so a page that needs something its policy blocks fails here
  // too. What the harness adds carries the page's nonce to be let through,
  // and the parent page carries the same policy, since a srcdoc frame
  // inherits its parent's as well as reading its own.
  const policy = (html.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/) || [''])[0];
  const nonce = readPageNonce(html);
  const nonced = nonce ? ` nonce="${nonce}"` : '';
  const bridge = `<script${nonced}>
window.acquireVsCodeApi = function () {
  return { postMessage: function () {}, getState: function () {}, setState: function () {} };
};
</script>`;
  const drive = `<script${nonced}>
window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', data: ${JSON.stringify(snapshot)} } }));
setTimeout(function () { ${probe} }, 50);
</script>`;
  const inner = html
    // VS Code sets its tokens on the document; here a style block does.
    .replace('<head>', `<head><style${nonced}>${vscodePaletteCss('dark')}${SETTLED}</style>`)
    .replace(/<script/, `${bridge}<script`)
    .replace(/<\/body>/, `${drive}</body>`);
  const [width, height] = surface.viewport;
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${policy}<style${nonced}>
html, body { margin: 0; padding: 0; background: #888; }
iframe { display: block; border: 0; width: ${width}px; height: ${height}px; }
</style></head><body>
<iframe id="page" srcdoc="${inner.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>
<pre id="layout-probe"></pre>
<script${nonced}>
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

// The surfaces, the page builder and the browser are shared with the visual
// check, which draws the same pages and compares the pixels instead.
module.exports = { chrome, createSurfaces, buildPage, findChrome, measure };

if (require.main === module) {
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
      const surfaceName = surface.name || surface.page;
      if (only && only !== `${label}:${surfaceName}` && only !== surfaceName && only !== label) continue;
      const html = rendered.get(surface.page);
      const file = path.join(dir, `${label}-${surfaceName}.html`);
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
        for (const boxed of run.cardTagsBoxed || []) {
          problems.push(`a tag on a card is drawn as a control: ${boxed}`);
        }
        for (const over of run.clampOver || []) {
          problems.push(`a result cut to three lines is taller than three: ${over}`);
        }
        for (const broken of run.tagsBroken || []) {
          problems.push(`a tag breaks over lines or out of its entry: ${broken}`);
        }
        for (const lit of run.disabledLit || []) {
          problems.push(`a control that cannot act lights up under the pointer: ${lit}`);
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
        console.log(`  ok   ${label.padEnd(14)} ${surfaceName.padEnd(15)} ${scrolls} scroller(s) scrolling, nothing clipped, nothing sideways`);
      } else {
        failed += 1;
        console.log(`  FAIL ${label.padEnd(14)} ${surfaceName}`);
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
}
