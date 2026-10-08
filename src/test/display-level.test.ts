import * as assert from 'assert';

import { ZEN_CHOICES } from '../ui/state/displayLevel';

suite('Display: Zen', () => {
  test('Zen turns on plain styling, no help text, compact spacing, flat cards, tags as text, and quiet controls', () => {
    assert.deepStrictEqual(ZEN_CHOICES, { styling: 'plain', help: 'hidden', density: 'compact', cards: 'flat', tags: 'text', controls: 'quiet' });
  });

  test('Zen hides no data: it has no say over counts or dates', () => {
    const keys: readonly string[] = Object.keys(ZEN_CHOICES);
    assert.ok(!keys.includes('counts'), 'counts always show');
    assert.ok(!keys.includes('dates'), 'dates always show in full');
  });
});
