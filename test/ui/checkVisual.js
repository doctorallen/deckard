// Draws the webviews in a real browser and compares the pixels to the last
// time they were drawn.
//
// The layout check measures geometry and the contrast check reads color
// pairs. Neither can see a backdrop a theme paints, a glow that came back, or
// a control that moved: zen mode shipped with Cooper's dotted grid still
// showing, and it took a screenshot to notice. This takes that screenshot for
// every surface, theme and zen state, and fails when it differs from the
// recorded one by more than a sliver.
//
// Baselines are kept per platform. Fonts are rasterized by the operating
// system, so a page drawn on macOS and the same page drawn on Linux differ in
// every glyph's edge; comparing across them would fail on nothing. The first
// run on a platform records its own set and says so; CI keeps Linux's.
//
//   npm run test:visual               compare
//   npm run test:visual -- --update   record what is drawn now as the baseline
//   VISUAL_ONLY=cooper+zen:taskBoard  one surface
//   VISUAL_KEEP=<dir>                 leave the screenshots and diffs there
const path = require('node:path');
const os = require('node:os');
const { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { PNG } = require('pngjs');
const pixelmatchModule = require('pixelmatch');
const pixelmatch = pixelmatchModule.default ?? pixelmatchModule;

const { renderPagesForTheme, themes } = require('./pages.js');
const { chrome, createSurfaces, buildPage } = require('./checkLayout.js');

/** How different one pixel may be before it counts, 0 to 1. */
const PIXEL_THRESHOLD = 0.1;
/** How many pixels may differ, as a share of the page, before it fails. */
const FAIL_ABOVE = 0.005;

const BASELINES = path.join(__dirname, 'visual-baseline', process.platform);
const updating = process.argv.includes('--update');
const keep = process.env.VISUAL_KEEP;
const dir = keep || mkdtempSync(path.join(os.tmpdir(), 'deckard-visual-'));
if (keep) mkdirSync(keep, { recursive: true });
mkdirSync(BASELINES, { recursive: true });

function screenshot(file, viewport, out) {
  const result = spawnSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${viewport[0]},${viewport[1]}`,
    '--virtual-time-budget=3000', `--screenshot=${out}`, `file://${file}`,
  ], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL' });
  if (result.signal === 'SIGKILL') throw new Error('chrome wedged after 60s');
  if (!existsSync(out)) throw new Error(`no screenshot (chrome exit ${result.status}): ${(result.stderr ?? '').slice(0, 300)}`);
  return PNG.sync.read(readFileSync(out));
}

let failed = 0;
let recorded = 0;
let compared = 0;
const seen = new Set();
try {
  for (const theme of themes.map((entry) => entry.id ?? entry)) {
    for (const zen of [false, true]) {
      const label = zen ? `${theme}+zen` : theme;
      const rendered = new Map(renderPagesForTheme(theme, { zen }));
      for (const surface of createSurfaces(zen)) {
        const only = process.env.VISUAL_ONLY;
        if (only && only !== `${label}:${surface.page}` && only !== surface.page && only !== label) continue;
        const name = `${label}-${surface.page}`;
        seen.add(`${name}.png`);
        const file = path.join(dir, `${name}.html`);
        writeFileSync(file, buildPage(rendered.get(surface.page), surface));
        const shot = path.join(dir, `${name}.png`);
        const baseline = path.join(BASELINES, `${name}.png`);
        let drawn;
        try {
          drawn = screenshot(file, surface.viewport, shot);
        } catch (error) {
          failed += 1;
          console.log(`  FAIL ${label.padEnd(14)} ${surface.page.padEnd(13)} ${error.message}`);
          continue;
        }
        if (updating || !existsSync(baseline)) {
          writeFileSync(baseline, readFileSync(shot));
          recorded += 1;
          console.log(`  ${updating ? 'updated' : 'recorded'} ${label.padEnd(12)} ${surface.page}`);
          continue;
        }
        const expected = PNG.sync.read(readFileSync(baseline));
        if (expected.width !== drawn.width || expected.height !== drawn.height) {
          failed += 1;
          console.log(`  FAIL ${label.padEnd(14)} ${surface.page.padEnd(13)} size changed: ${expected.width}x${expected.height} -> ${drawn.width}x${drawn.height}`);
          continue;
        }
        const diff = new PNG({ width: drawn.width, height: drawn.height });
        const differing = pixelmatch(expected.data, drawn.data, diff.data, drawn.width, drawn.height, { threshold: PIXEL_THRESHOLD });
        const share = differing / (drawn.width * drawn.height);
        compared += 1;
        if (share > FAIL_ABOVE) {
          failed += 1;
          const diffFile = path.join(dir, `${name}.diff.png`);
          writeFileSync(diffFile, PNG.sync.write(diff));
          console.log(`  FAIL ${label.padEnd(14)} ${surface.page.padEnd(13)} ${(share * 100).toFixed(2)}% of pixels differ (${differing}); diff at ${diffFile}`);
        } else {
          console.log(`  ok   ${label.padEnd(14)} ${surface.page.padEnd(13)} ${differing === 0 ? 'identical' : `${(share * 100).toFixed(3)}% differ, within the sliver`}`);
        }
      }
    }
  }
  // A baseline nothing draws any more is a surface that was removed or
  // renamed; say so, rather than keep a picture of something that is gone.
  if (!process.env.VISUAL_ONLY) {
    for (const stale of readdirSync(BASELINES).filter((name) => name.endsWith('.png') && !seen.has(name))) {
      if (updating) {
        rmSync(path.join(BASELINES, stale));
        console.log(`  removed ${stale}: nothing draws it now`);
      } else {
        failed += 1;
        console.log(`  FAIL ${stale}: a baseline nothing draws now; run with --update to drop it`);
      }
    }
  }
} finally {
  if (!keep && failed === 0) rmSync(dir, { recursive: true, force: true });
}
if (recorded) {
  console.log(`\n${recorded} baseline(s) ${updating ? 'updated' : 'recorded'} under test/ui/visual-baseline/${process.platform}; commit them.`);
}
if (failed) {
  console.log(`\n${failed} surface(s) look different${keep ? '' : `; screenshots and diffs are in ${dir}`}`);
  console.log('If the change is meant, record it with "npm run test:visual -- --update".');
  process.exit(1);
}
console.log(compared ? `\nevery surface looks as it did` : '\nnothing to compare yet');
