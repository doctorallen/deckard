// The passes the checks that draw in Chrome make, and which of them this run
// takes.
//
// Every surface is drawn in every theme Deckard ships, with zen off and then
// on: sixteen passes. The layout, rendered contrast, and visual checks walk
// the same list. Sampling it is not safe (162a7c7c failed only in
// corpo+zen), so CI splits it instead, between jobs that run at once:
//
//   UI_SHARD=<k>/<n>   take every n-th pass, starting with the k-th (1-based)
//
// UI_SHARD=1/2 takes the first, third, fifth... passes and UI_SHARD=2/2 the
// others, so the shards of one n together make every pass exactly once.
// Unset, a run takes every pass. Lives apart from checkLayout.js, which needs
// Chrome to load, so the passes can be named without one.
const { themes } = require('./pages.js');

/**
 * Every pass, whatever the shard, as [theme, zen] pairs: each theme, without
 * zen and then with it.
 *
 * @returns {Array<[string, boolean]>} The sixteen passes, in order.
 */
function allPasses() {
  return themes.map((entry) => entry.id ?? entry).flatMap((theme) => [[theme, false], [theme, true]]);
}

/**
 * Which shard of how many this run is, from UI_SHARD.
 *
 * @param {string | undefined} value UI_SHARD, as `<k>/<n>`.
 * @returns {{ index: number, count: number }} The shard, 1-based, and how many there are; 1 of 1 when unset.
 */
function readShard(value = process.env.UI_SHARD) {
  if (value === undefined || value === '') {
    return { index: 1, count: 1 };
  }
  const match = /^(\d+)\/(\d+)$/.exec(value.trim());
  const index = match ? Number(match[1]) : NaN;
  const count = match ? Number(match[2]) : NaN;
  if (!match || count < 1 || index < 1 || index > count) {
    throw new Error(`UI_SHARD must be <k>/<n> with 1 <= k <= n, not "${value}"`);
  }
  return { index, count };
}

/**
 * The passes this run makes: every n-th of allPasses, starting with the k-th,
 * as UI_SHARD says, or all of them.
 *
 * @param {string | undefined} shard UI_SHARD, as `<k>/<n>`.
 * @returns {Array<[string, boolean]>} The passes, in order.
 */
function passes(shard = process.env.UI_SHARD) {
  const { index, count } = readShard(shard);
  return allPasses().filter((_, position) => position % count === index - 1);
}

/**
 * A pass as the checks name it: the theme, with `+zen` for the zen pass.
 *
 * @param {string} theme The theme's id, such as `corpo`.
 * @param {boolean} zen Whether zen mode is on.
 * @returns {string} The label, such as `corpo+zen`.
 */
function passLabel(theme, zen) {
  return zen ? `${theme}+zen` : theme;
}

/**
 * Whether a check's `*_ONLY` variable picks a surface in a pass, or names
 * nothing. LAYOUT_ONLY=oblivion:sidebarNotes runs one surface while looking
 * at it, LAYOUT_ONLY=oblivion+zen:sidebarNotes picks the zen pass of it, and
 * LAYOUT_ONLY=oblivion every surface in a pass.
 *
 * @param {string | undefined} only The variable's value.
 * @param {string} label The pass, as `<theme>` or `<theme>+zen`.
 * @param {string} name The surface's name, or its page's.
 * @returns {boolean} Whether to draw the surface.
 */
function isPicked(only, label, name) {
  return !only || only === `${label}:${name}` || only === name || only === label;
}

/**
 * Says which shard this run is, when it is one of several, so a log shows
 * which passes it drew.
 *
 * @param {string} check The check's name, for the line.
 */
function announceShard(check) {
  const { index, count } = readShard();
  if (count > 1) {
    console.log(`${check}: shard ${index} of ${count}: ${passes().map(([theme, zen]) => passLabel(theme, zen)).join(', ')}\n`);
  }
}

module.exports = { allPasses, announceShard, isPicked, passes, passLabel, readShard };
