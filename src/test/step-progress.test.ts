import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { findStepProgress, formatProgressBar } from '../ui/state/editorLensState';

suite('Step progress lens', () => {
  test('finds each task with steps, how many are done, and the next one', () => {
    const file = parseMarkdown(
      'notes/watch.md',
      [
        '# Dawn watch #team/wardens',
        '- [ ] Pack the field kit 📅 2026-10-03',
        '  - [x] Charge the lens battery',
        '  - [ ] Pack the rain shells #context/home',
        '  - [ ] Sign out the radio',
        '- [ ] A task with no steps',
        '- [ ] Close the gate',
        '  - [x] Lock it',
      ].join('\n'),
    );
    assert.deepStrictEqual(findStepProgress(file), [
      { line: 1, total: 3, done: 1, nextLine: 3, next: 'Pack the rain shells' },
      { line: 6, total: 1, done: 1 },
    ]);
  });

  test('draws a bar in text, a start as one cell and only all of it full', () => {
    assert.strictEqual(formatProgressBar(1, 3), '███░░░░░░░');
    assert.strictEqual(formatProgressBar(0, 3), '░░░░░░░░░░');
    assert.strictEqual(formatProgressBar(1, 50), '█░░░░░░░░░', 'a start shows');
    assert.strictEqual(formatProgressBar(49, 50), '█████████░', 'nearly all is not all');
    assert.strictEqual(formatProgressBar(3, 3), '██████████');
    assert.strictEqual(formatProgressBar(2, 4, 4), '██░░');
    assert.strictEqual(formatProgressBar(0, 0), '');
  });
});
