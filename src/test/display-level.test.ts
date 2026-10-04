import * as assert from 'assert';

import {
  DISPLAY_LEVELS,
  STEP_VALUES,
  changedScaleSettings,
  resolveDisplayLevel,
  resolveScaleValues,
} from '../ui/state/displayLevel';

suite('Display: the scale', () => {
  test('the step is the one set, else Zen for a reader who had Zen mode on, else Full', () => {
    assert.strictEqual(resolveDisplayLevel('quiet', true), 'quiet', 'a step set wins over zenMode');
    assert.strictEqual(resolveDisplayLevel('full', true), 'full');
    assert.strictEqual(resolveDisplayLevel(undefined, true), 'zen');
    assert.strictEqual(resolveDisplayLevel(undefined, false), 'full');
    assert.strictEqual(resolveDisplayLevel('loud', false), 'full', 'an unknown step');
  });

  test('each step turns its settings down further than the one before', () => {
    const plainCount = (level: (typeof DISPLAY_LEVELS)[number]): number => {
      const values = STEP_VALUES[level];
      return [values.themeStyling === 'plain', values.helpText === 'hidden', values.density === 'compact'].filter(Boolean).length;
    };
    assert.deepStrictEqual(DISPLAY_LEVELS.map(plainCount), [0, 2, 3]);
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
    assert.deepStrictEqual(resolveScaleValues('zen', { themeStyling: 'styled' }), {
      themeStyling: 'styled',
      helpText: 'hidden',
      density: 'compact',
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
});
