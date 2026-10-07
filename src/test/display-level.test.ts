import * as assert from 'assert';

import {
  DISPLAY_LEVELS,
  STEP_VALUES,
  changedScaleSettings,
  resolveDisplayLevel,
  resolveScaleValues,
  zenToggleTarget,
} from '../ui/state/displayLevel';

suite('Display: the scale', () => {
  test('the step is the one set, else Full', () => {
    assert.strictEqual(resolveDisplayLevel('quiet'), 'quiet');
    assert.strictEqual(resolveDisplayLevel('zen'), 'zen');
    assert.strictEqual(resolveDisplayLevel(undefined), 'full');
    assert.strictEqual(resolveDisplayLevel('loud'), 'full', 'an unknown step');
  });

  test('each step turns its settings down further than the one before', () => {
    const turnedDown = (level: (typeof DISPLAY_LEVELS)[number]): (keyof typeof STEP_VALUES.full)[] =>
      (Object.keys(STEP_VALUES.full) as (keyof typeof STEP_VALUES.full)[]).filter((key) => STEP_VALUES[level][key] !== STEP_VALUES.full[key]);
    assert.deepStrictEqual(turnedDown('full'), []);
    assert.deepStrictEqual(turnedDown('quiet'), ['themeStyling', 'helpText', 'tags']);
    assert.deepStrictEqual(turnedDown('zen'), ['themeStyling', 'helpText', 'density', 'cardFrames', 'tags', 'counts', 'fileAndLine', 'dates']);
    for (const key of turnedDown('quiet')) {
      assert.strictEqual(STEP_VALUES.zen[key], STEP_VALUES.quiet[key], `Zen keeps what Quiet turned down: ${key}`);
    }
  });

  test('a setting left at auto follows the step; one set wins at every step', () => {
    for (const level of DISPLAY_LEVELS) {
      assert.deepStrictEqual(resolveScaleValues(level, {}), STEP_VALUES[level]);
      assert.deepStrictEqual(
        resolveScaleValues(level, { themeStyling: 'auto', helpText: 'auto', density: 'auto' }),
        STEP_VALUES[level],
      );
      assert.strictEqual(resolveScaleValues(level, { density: 'compact' }).density, 'compact');
      assert.strictEqual(resolveScaleValues(level, { helpText: 'shown' }).helpText, 'shown');
    }
    assert.deepStrictEqual(resolveScaleValues('zen', { themeStyling: 'styled', counts: 'shown' }), {
      ...STEP_VALUES.zen,
      themeStyling: 'styled',
      counts: 'shown',
    });
  });

  test('a value a setting doesn\'t have follows the step', () => {
    assert.strictEqual(resolveScaleValues('full', { density: 'plain' }).density, 'comfortable');
    assert.strictEqual(resolveScaleValues('zen', { helpText: 3 }).helpText, 'hidden');
  });

  test('counts as changed only what is set to something other than auto', () => {
    assert.deepStrictEqual(changedScaleSettings({}), []);
    assert.deepStrictEqual(changedScaleSettings({ themeStyling: 'auto', density: 'compact', helpText: 'nope' }), ['density']);
  });

  test('the Zen button goes to Zen, and back to the step the reader came from, or to Full', () => {
    assert.strictEqual(zenToggleTarget('full', undefined), 'zen');
    assert.strictEqual(zenToggleTarget('quiet', 'full'), 'zen');
    assert.strictEqual(zenToggleTarget('zen', 'quiet'), 'quiet');
    assert.strictEqual(zenToggleTarget('zen', undefined), 'full', 'nothing to go back to');
    assert.strictEqual(zenToggleTarget('zen', 'zen'), 'full');
    assert.strictEqual(zenToggleTarget('zen', 'loud'), 'full');
  });
});
