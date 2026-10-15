import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { collectTaggedEntries, findBandEntry, planEntryHovers, splitEntryLines } from '../domain/markdown/taggedEntries';

suite('Tagged entries', () => {
  test('bands the innermost tagged entry the cursor is in, and nothing outside one', () => {
    const entries = collectTaggedEntries(
      parseMarkdown(
        'notes/atlas.md',
        [
          '# Atlas #project/atlas', // 1
          'Why it matters.', // 2
          '- [ ] Call Ren #risk/vendor', // 3
          '- [ ] Book the room', // 4
          '', // 5
          '# Untagged', // 6
          'Nothing here.', // 7
        ].join('\n'),
      ),
    );
    assert.deepStrictEqual(
      entries.map((entry) => [entry.startLine, entry.endLine]),
      [[1, 5], [3, 3], [4, 4]],
      'the tagged section and its tasks, which carry its tag, not the untagged section',
    );
    assert.strictEqual(findBandEntry(entries, 3)?.title.trim(), 'Call Ren #risk/vendor');
    assert.strictEqual(findBandEntry(entries, 2)?.startLine, 1, 'the section around the line');
    assert.strictEqual(findBandEntry(entries, 7), undefined);
  });

  test('of two entries alike in span, the band takes the later one', () => {
    const entries = [
      { startLine: 1, endLine: 4, title: 'first' },
      { startLine: 2, endLine: 5, title: 'second' },
    ];
    assert.strictEqual(findBandEntry(entries, 3)?.title, 'second');
    assert.strictEqual(findBandEntry(entries, 1)?.title, 'first');
    assert.strictEqual(findBandEntry([], 1), undefined);
  });

  test('splits a note into the lines each entry owns, so a task hover is not its heading hover too', () => {
    const entries = collectTaggedEntries(
      parseMarkdown(
        'notes/atlas.md',
        [
          '# Atlas #project/atlas', // 1
          'Why it matters.', // 2
          '- [ ] Call Ren #risk/vendor', // 3
          '- [ ] Book the room', // 4
          'After the tasks.', // 5
        ].join('\n'),
      ),
    );
    assert.deepStrictEqual(
      splitEntryLines(entries).map((run) => [run.entry.startLine, run.startLine, run.endLine]),
      [[1, 1, 2], [3, 3, 3], [4, 4, 4], [1, 5, 5]],
      'the section keeps its lines either side of its tasks, and each task keeps its own',
    );
    assert.deepStrictEqual(splitEntryLines([]), []);
  });

  test('offers Edit task on every task line, and Pin to Home on each entry\'s own lines', () => {
    const parsed = parseMarkdown(
      'notes/atlas.md',
      [
        '# Atlas #project/atlas', // 1
        'Why it matters.', // 2
        '- [ ] Call Ren #risk/vendor', // 3
        '- [ ] Book the room', // 4
        'After the tasks.', // 5
      ].join('\n'),
    );
    const entries = collectTaggedEntries(parsed);
    const taskLines = parsed.tasks.map((task) => task.lineNumber);
    assert.deepStrictEqual(planEntryHovers(entries, taskLines), [
      { startLine: 1, endLine: 2, pinLine: 1 },
      { startLine: 3, endLine: 3, pinLine: 3, taskLine: 3 },
      { startLine: 4, endLine: 4, pinLine: 4, taskLine: 4 },
      { startLine: 5, endLine: 5, pinLine: 1 },
    ]);
    assert.deepStrictEqual(
      planEntryHovers([], taskLines),
      [{ startLine: 3, endLine: 3, taskLine: 3 }, { startLine: 4, endLine: 4, taskLine: 4 }],
      'with highlighting off, or outside every entry, a task offers only Edit task',
    );
  });

  test('a task with no tag of its own, under a tagged heading, offers Edit task alone', () => {
    const entries = [{ startLine: 1, endLine: 4, title: 'Atlas' }];
    assert.deepStrictEqual(planEntryHovers(entries, [3]), [
      { startLine: 1, endLine: 2, pinLine: 1 },
      { startLine: 3, endLine: 3, taskLine: 3 },
      { startLine: 4, endLine: 4, pinLine: 1 },
    ]);
  });
});
