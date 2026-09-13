import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import { findMatchingEntryLine } from '../ui/webview/sidebarNotes';

const savedLines = [
  '# Plan #project/atlas',
  'Body.',
  '',
  '## Next #risk/vendor',
  '- [ ] Ship it #status/doing',
  '',
  '## Next #risk/vendor',
  'Again.',
];

const saved = parseMarkdown('notes/plan.md', savedLines.join('\n'));
// The same note with three unsaved lines added at the top.
const live = parseMarkdown(
  'notes/plan.md',
  ['Draft one.', 'Draft two.', 'Draft three.', ...savedLines].join('\n'),
);

suite('Matching an unsaved entry to the saved note', () => {
  test('finds a heading again after lines above it moved', () => {
    assert.strictEqual(findMatchingEntryLine(live, 7, saved), 4);
  });

  test('tells apart headings that share a title by their order', () => {
    assert.strictEqual(findMatchingEntryLine(live, 10, saved), 7);
  });

  test('finds a tagged task again', () => {
    assert.strictEqual(findMatchingEntryLine(live, 8, saved), 5);
  });

  test('finds the entry a body line belongs to', () => {
    assert.strictEqual(findMatchingEntryLine(live, 5, saved), 1);
  });

  test('finds nothing for a heading renamed since the save', () => {
    const renamed = parseMarkdown(
      'notes/plan.md',
      savedLines.join('\n').replace('## Next #risk/vendor', '## Later #risk/vendor'),
    );
    assert.strictEqual(findMatchingEntryLine(renamed, 4, saved), undefined);
  });
});
