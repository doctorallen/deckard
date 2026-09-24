import * as assert from 'assert';

import {
  getShellCss,
  getSurfaceCss,
  getTaskBoardCss,
  getTaskListCss,
  getZenCss,
} from '../ui/webview/components';

/**
 * The shared sheet spaces everything from one six-step scale, and zen
 * re-declares the steps rather than restating rules. A literal outside the
 * scale in a padding, gap, or margin is a step that will sit beside a
 * neighbor and read as untidiness.
 */
const SCALE = new Set(['0', '1px', '2px', '4px', '8px', '12px', '16px', '24px', '32px', 'auto']);

function offScale(css: string): string[] {
  const found: string[] = [];
  for (const match of css.matchAll(/(?:padding|margin|gap)(?:-[a-z]+)?:\s*([^;]+);/g)) {
    for (const part of match[1].trim().split(/\s+/)) {
      if (part.startsWith('var(') || part.startsWith('calc(')) continue;
      if (!SCALE.has(part)) found.push(match[0].trim());
    }
  }
  return found;
}

suite('Spacing scale', () => {
  test('the shared sheet spaces from the scale', () => {
    for (const [name, sheet] of [
      ['shell', getShellCss()],
      ['surfaces', getSurfaceCss()],
      ['task board', getTaskBoardCss()],
      ['task list', getTaskListCss()],
    ] as const) {
      assert.deepStrictEqual(offScale(sheet), [], `${name}: every padding, gap, and margin is a step of the scale`);
    }
  });

  test('zen re-declares the steps and restates no spacing rule', () => {
    const zen = getZenCss();
    assert.match(zen, /body\.zen \{ --space-1: 3px; --space-2: 6px; --space-3: 8px;/);
    assert.ok(
      !/body\.zen \.(card|task|task-row|metric|board-column) \{[^}]*padding:/.test(zen),
      'zen tightens the steps, not the cards',
    );
  });
});
