// Draws the webviews in a real browser and compares the pixels to the last
// time they were drawn.
//
// The layout check measures geometry and the contrast check reads color
// pairs. Neither can see a backdrop a theme paints, a glow that came back, or
// a control that moved: zen mode shipped with Cooper's dotted grid still
// showing, and it took a screenshot to notice. This takes that screenshot for
// a short, chosen list of surfaces (VISUAL_SET, below) and fails when one
// differs from the recorded one by more than a sliver.
//
// The baselines are Linux's alone, in test/ui/visual-baseline/linux. Fonts
// are rasterized by the operating system, so a page drawn on macOS and the
// same page drawn on Linux differ in every glyph's edge; comparing across
// them would fail on nothing. So on any other system the check says so and
// skips, unless VISUAL_FORCE=1 or VISUAL_BASELINES is set. The Nightly
// workflow runs it, and run by hand it uploads what it drew with no baseline
// or differing from one, which is how a baseline is recorded.
//
//   npm run test:visual               compare
//   npm run test:visual -- --update   record what is drawn now as the baseline
//   npm run test:visual -- --ci       compare, and fail for a surface with no
//                                     baseline rather than record one
//   VISUAL_FORCE=1                    compare with the Linux baselines on
//                                     another system, where every glyph differs
//   VISUAL_BASELINES=<dir>            compare with (or --update into) that
//                                     folder instead, on any system: record
//                                     the set on one commit and compare on
//                                     another, on a Mac, say
//   VISUAL_ONLY=cooper+zen:dashboardHome  one surface
//   VISUAL_KEEP=<dir>                 leave the screenshots and diffs there
//   VISUAL_CHANGED=<dir>              copy there only what a failure needs:
//                                     each surface drawn with no baseline or
//                                     differing from it, under its baseline's
//                                     name (baseline/), and each diff (diff/)
//   UI_CONCURRENCY=<n>                how many Chromes draw at once
//   UI_SHARD=<k>/<n>                  every n-th pass, from the k-th (passes.js)
//
// Before any Chrome starts, the baselines' names are checked against the
// set, whatever the shard: a baseline the set does not name fails at once,
// and a surface with none is named at once. The shard that draws it still
// records it, so a run's artifact holds the image to commit.
//
// The screenshots are taken by several Chromes at once, half the logical cores'
// worth and at most four unless UI_CONCURRENCY says otherwise
// (test/ui/chromePool.js), each with a profile of its own. Each surface is
// still reported in the same order, with the same lines, as when they were
// drawn one at a time, which UI_CONCURRENCY=1 still does. Drawing at once
// changes no pixel: time in each Chrome is virtual, and the screenshots
// compare with the same baselines.
const path = require('node:path');
const os = require('node:os');
const { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { PNG } = require('pngjs');
const pixelmatchModule = require('pixelmatch');
const pixelmatch = pixelmatchModule.default ?? pixelmatchModule;

const { renderPagesForTheme, paletteFor } = require('./pages.js');
const { createSurfaces, surfaceHtml } = require('./surfaces.js');
const { allPasses, announceShard, isPicked, passes, passLabel } = require('./passes.js');
const { runChromeAsync, runInOrder } = require('./chromePool.js');

/** Where the baselines this run compares with are kept. */
const BASELINES = process.env.VISUAL_BASELINES
  ? path.resolve(process.env.VISUAL_BASELINES)
  : path.join(__dirname, 'visual-baseline', 'linux');

// Linux's baselines are only worth comparing with on Linux.
if (process.platform !== 'linux' && !process.env.VISUAL_BASELINES && process.env.VISUAL_FORCE !== '1') {
  console.log(`visual check skipped: the baselines are Linux's, and ${process.platform} draws every glyph's edge differently.`);
  console.log('The Nightly workflow compares them, and run by hand it uploads what it drew to take baselines from.');
  console.log('VISUAL_FORCE=1 compares here anyway; VISUAL_BASELINES=<dir> compares with a set of your own.');
  process.exit(0);
}

const { chrome, buildPage } = require('./checkLayout.js');

/**
 * The surfaces compared, as `<pass>-<surface>`, the name of each one's
 * baseline. It is short on purpose. Screenshotting every surface in every
 * theme with zen off and on made over a thousand baselines a platform,
 * re-recorded on every change to how anything looks, and nobody read them.
 * The layout and rendered contrast checks hold every surface in every pass
 * to what can be measured; this keeps the pixels of a few: each page's main
 * surface in Mimic, the default theme, and a few more of its views; Home in
 * every theme, since a theme is mostly its backdrop and its chrome; and
 * three with zen on, Cooper's among them, the one that shipped with its
 * grid showing.
 */
const VISUAL_SET = [
  // Each page's main surface, in the default theme.
  'mimic-dashboardHome',
  'mimic-taskBoard',
  'mimic-calendar',
  'mimic-calendarPage',
  'mimic-sidebarNotes',
  'mimic-stats',
  'mimic-searchPage',
  'mimic-notePage',
  'mimic-taskStatuses',
  'mimic-help',
  'mimic-notesGraph',
  'mimic-relatedNotesDebug',
  // Views of a page that lay it out otherwise, and a floating layer.
  'mimic-taskBoardLanes',
  'mimic-taskBoardTable',
  'mimic-taskBoardCardMenu',
  'mimic-searchPageTypeBoard',
  'mimic-dashboardTags',
  'mimic-helpGuide',
  // Home in every other theme.
  'corpo-dashboardHome',
  'replicant-dashboardHome',
  'oblivion-dashboardHome',
  'lcars-dashboardHome',
  'synthwave-dashboardHome',
  'tomcat-dashboardHome',
  'fellowship-dashboardHome',
  'cooper-dashboardHome',
  'razorback-dashboardHome',
  // Zen.
  'mimic+zen-dashboardHome',
  'mimic+zen-taskBoard',
  'cooper+zen-dashboardHome',
];

/** How different one pixel may be before it counts, 0 to 1. */
const PIXEL_THRESHOLD = 0.1;
/**
 * How many pixels may differ, as a share of the page, before it fails.
 *
 * On one platform an unchanged page draws identically, pixel for pixel: the
 * first forty comparisons found thirty-one identical and the rest were real
 * changes. The smallest real change seen - two small buttons moving along a
 * row - was 0.03% of the page. Half a percent let that through; a hundredth
 * of a percent, some eighty pixels on the largest surface, does not, and
 * still forgives a stray edge.
 */
const FAIL_ABOVE = 0.0001;

/**
 * Surfaces macOS draws differently from one run to the next, and the share
 * of the page each may differ by there. Related Notes' native select draws
 * its chevron flipped on some runs on macOS, so a set recorded there with
 * VISUAL_BASELINES cannot settle it. The list is read only on macOS: Linux
 * holds these surfaces to the sliver every surface is held to.
 */
const DARWIN_UNSETTLED = new Map([
  ['sidebarNotes', 0.001],
  ['sidebarNotesUntagged', 0.001],
]);

/**
 * How much of a surface may differ before it fails.
 *
 * @param {string} surfaceName The surface's own name.
 * @returns {number} The share of the page.
 */
function allowedShare(surfaceName) {
  if (process.platform === 'darwin' && DARWIN_UNSETTLED.has(surfaceName)) {
    return DARWIN_UNSETTLED.get(surfaceName);
  }
  return FAIL_ABOVE;
}

const updating = process.argv.includes('--update');
// On CI a missing baseline is a failure: recording one and passing is how
// the guard went quiet on Linux, where no baseline had ever been kept. The
// surface is still recorded, so the run's artifact holds the image to commit.
const ci = process.argv.includes('--ci');
const keep = process.env.VISUAL_KEEP;
const dir = keep || mkdtempSync(path.join(os.tmpdir(), 'deckard-visual-'));
if (keep) {
  mkdirSync(keep, { recursive: true });
}
const changed = process.env.VISUAL_CHANGED;
mkdirSync(BASELINES, { recursive: true });

/**
 * Copies what a failed comparison or a recording needs looked at into
 * VISUAL_CHANGED, when it is set: the image drawn, under its baseline's name,
 * and the diff when there is one.
 *
 * @param {string} name The baseline's name, without `.png`.
 * @param {string} shot The image drawn.
 * @param {string} [diffFile] The diff written for it.
 */
function keepChanged(name, shot, diffFile) {
  if (!changed) {
    return;
  }
  mkdirSync(path.join(changed, 'baseline'), { recursive: true });
  writeFileSync(path.join(changed, 'baseline', `${name}.png`), readFileSync(shot));
  if (!diffFile) {
    return;
  }
  mkdirSync(path.join(changed, 'diff'), { recursive: true });
  writeFileSync(path.join(changed, 'diff', `${name}.diff.png`), readFileSync(diffFile));
}

/**
 * Takes a screenshot of a page at a surface's size and resolves with it as
 * a PNG, retrying once if Chrome wedges. `log` takes the retry's line.
 */
async function screenshot(file, viewport, out, log) {
  const take = () => runChromeAsync(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${viewport[0]},${viewport[1]}`,
    '--virtual-time-budget=3000', `--screenshot=${out}`, `file://${file}`,
  ], { timeout: 60000 });
  let result = await take();
  // Headless Chrome occasionally wedges at 0% CPU and never returns. Once is
  // a flake and is retried, as the layout check does; twice is a fault.
  if (result.signal === 'SIGKILL') {
    log('       chrome wedged after 60s, retrying once');
    result = await take();
  }
  if (result.signal === 'SIGKILL') {
    throw new Error('chrome wedged twice, 60s each');
  }
  if (!existsSync(out)) {
    throw new Error(`no screenshot (chrome exit ${result.status}): ${(result.stderr ?? '').slice(0, 300)}`);
  }
  return PNG.sync.read(readFileSync(out));
}

/**
 * Compares a surface's screenshot with its baseline, counting it as
 * compared, and as failed when more of it differs than its share allows,
 * and says which to `log`.
 */
function compareShot({ label, surfaceName, name, shot }, drawn, baseline, { tally, log }) {
  const expected = PNG.sync.read(readFileSync(baseline));
  if (expected.width !== drawn.width || expected.height !== drawn.height) {
    tally.failed += 1;
    keepChanged(name, shot);
    log(`  FAIL ${label.padEnd(14)} ${surfaceName.padEnd(15)} size changed: ${expected.width}x${expected.height} -> ${drawn.width}x${drawn.height}`);
    return;
  }
  const diff = new PNG({ width: drawn.width, height: drawn.height });
  const differing = pixelmatch(expected.data, drawn.data, diff.data, drawn.width, drawn.height, { threshold: PIXEL_THRESHOLD });
  const share = differing / (drawn.width * drawn.height);
  tally.compared += 1;
  if (share > allowedShare(surfaceName)) {
    tally.failed += 1;
    const diffFile = path.join(dir, `${name}.diff.png`);
    writeFileSync(diffFile, PNG.sync.write(diff));
    keepChanged(name, shot, diffFile);
    log(`  FAIL ${label.padEnd(14)} ${surfaceName.padEnd(15)} ${(share * 100).toFixed(2)}% of pixels differ (${differing}); diff at ${diffFile}`);
  } else {
    log(`  ok   ${label.padEnd(14)} ${surfaceName.padEnd(15)} ${differing === 0 ? 'identical' : `${(share * 100).toFixed(3)}% differ, within the sliver`}`);
  }
}

// The layout probe still runs, so the page is driven and hovered as the
// layout check drives it, but the report it writes into the page is not part
// of what the reader sees, and a short page would show it under its content.
const HIDE_PROBE = '#layout-probe { display: none !important; }';

/**
 * Draws one surface and compares it with its baseline, or records the
 * baseline when updating or when there is none, saying which to `log`.
 */
async function drawSurface(surface, { label, theme, zen, rendered }, tally, log) {
  const surfaceName = surface.name || surface.page;
  const name = `${label}-${surfaceName}`;
  const file = path.join(dir, `${name}.html`);
  writeFileSync(file, buildPage(surfaceHtml(surface, rendered, { theme, zen }), surface, undefined, { css: HIDE_PROBE, palette: paletteFor(theme) }));
  const shot = path.join(dir, `${name}.png`);
  const baseline = path.join(BASELINES, `${name}.png`);
  let drawn;
  try {
    drawn = await screenshot(file, surface.viewport, shot, log);
  } catch (error) {
    tally.failed += 1;
    log(`  FAIL ${label.padEnd(14)} ${surfaceName.padEnd(15)} ${error.message}`);
    return;
  }
  if (updating || !existsSync(baseline)) {
    writeFileSync(baseline, readFileSync(shot));
    if (!updating) {
      keepChanged(name, shot);
    }
    tally.recorded += 1;
    log(`  ${updating ? 'updated' : 'recorded'} ${label.padEnd(12)} ${surfaceName}`);
    return;
  }
  compareShot({ label, surfaceName, name, shot }, drawn, baseline, { tally, log });
}

/**
 * Whether the set names a surface in a pass.
 *
 * @param {string} label The pass, as `<theme>` or `<theme>+zen`.
 * @param {string} surfaceName The surface's own name.
 * @returns {boolean} Whether its screenshot is compared.
 */
function inSet(label, surfaceName) {
  return VISUAL_SET.includes(`${label}-${surfaceName}`);
}

/**
 * The name of every baseline the set draws, whatever the shard. An entry
 * that names no surface in any pass is an error, thrown before anything is
 * drawn: a surface renamed must not drop out of the set unseen.
 *
 * @returns {Set<string>} The file names, as `<pass>-<surface>.png`.
 */
function expectedBaselines() {
  const drawable = new Set();
  for (const [theme, zen] of allPasses()) {
    for (const surface of createSurfaces()) {
      drawable.add(`${passLabel(theme, zen)}-${surface.name || surface.page}`);
    }
  }
  const unknown = VISUAL_SET.filter((name) => !drawable.has(name));
  if (unknown.length) {
    throw new Error(`VISUAL_SET names what no pass draws: ${unknown.join(', ')}`);
  }
  return new Set(VISUAL_SET.map((name) => `${name}.png`));
}

/**
 * Says, before anything is drawn, which baselines the set lacks and which
 * it no longer names. A stale baseline is a surface removed, renamed, or
 * taken out of the set: updating removes it, and otherwise it fails. A
 * missing one is named here and recorded when its surface is drawn, which
 * fails a --ci run in the shard that draws it.
 *
 * @param {{ failed: number }} tally The run's count, which a stale baseline adds to.
 */
function checkBaselineNames(tally) {
  const expected = expectedBaselines();
  const present = new Set(readdirSync(BASELINES).filter((name) => name.endsWith('.png')));
  const stale = [...present].filter((name) => !expected.has(name));
  const missing = [...expected].filter((name) => !present.has(name));
  for (const name of stale) {
    if (updating) {
      rmSync(path.join(BASELINES, name));
      console.log(`  removed ${name}: nothing draws it now`);
    } else {
      tally.failed += 1;
      console.log(`  FAIL ${name}: a baseline the set does not name; run with --update to drop it`);
    }
  }
  if (missing.length && !updating) {
    console.log(`  ${missing.length} surface(s) have no baseline under ${path.relative(process.cwd(), BASELINES) || BASELINES}; each is recorded when drawn${ci ? ', and fails this --ci run' : ''}:`);
    missing.forEach((name) => console.log(`         ${name}`));
  }
  if (stale.length || missing.length) {
    console.log('');
  }
}

/**
 * Every surface of the set VISUAL_ONLY picks in every pass this shard makes,
 * in the order they are reported. A pass's pages are rendered only when its
 * first surface is taken.
 */
function* visualJobs() {
  for (const [theme, zen] of passes()) {
    const label = passLabel(theme, zen);
    const picked = createSurfaces().filter((entry) =>
      inSet(label, entry.name || entry.page) && isPicked(process.env.VISUAL_ONLY, label, entry.name || entry.page));
    if (picked.length === 0) {
      continue;
    }
    const rendered = new Map(renderPagesForTheme(theme, { zen }));
    for (const surface of picked) {
      yield { surface, label, theme, zen, rendered };
    }
  }
}

/** The check: every surface drawn and compared, exiting 1 when any differs. */
async function run() {
  /** What the run has counted so far, kept as it goes so a crash leaves the screenshots of a failure. */
  const tally = { failed: 0, recorded: 0, compared: 0 };
  announceShard('visual check');
  try {
    if (!process.env.VISUAL_ONLY) {
      checkBaselineNames(tally);
    }
    await runInOrder(visualJobs(), ({ surface, ...pass }, log) => drawSurface(surface, pass, tally, log));
  } finally {
    if (!keep && tally.failed === 0) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  let { failed } = tally;
  const { recorded, compared } = tally;
  if (recorded) {
    console.log(`\n${recorded} baseline(s) ${updating ? 'updated' : 'recorded'} under ${path.relative(process.cwd(), BASELINES) || BASELINES}${process.env.VISUAL_BASELINES ? '' : '; commit them'}.`);
    if (ci && !updating) {
      failed += recorded;
      console.log('--ci: a surface without a baseline was recorded rather than compared, so this run fails.');
    }
  }
  if (failed) {
    console.log(`\n${failed} surface(s) look different${keep ? '' : `; screenshots and diffs are in ${dir}`}`);
    console.log('If the change is meant, record it with "npm run test:visual -- --update".');
    process.exit(1);
  }
  console.log(compared ? `\nevery surface looks as it did` : '\nnothing to compare yet');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
