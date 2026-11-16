import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { findCarriedHeading, mergeCarriedOver } from '../domain/notes/carriedHeadings';
import { planCarriedTasks } from '../domain/notes/carryForward';
import { isOpenTask } from '../domain/tasks/taskStatuses';

const friday = [
  '# 2026-11-13',
  '',
  '- [ ] Book travel',
  '',
  '## Vendor sync #project/borealis @dana',
  'The gateway is included.',
  '- [ ] Send the quote',
  '',
  '### Pricing #vendor',
  '- [ ] Ask for the gateway price',
  '',
  '## Notes',
  '### Follow-ups',
  '- [ ] File the survey',
  '',
].join('\n');
const FRIDAY = 'journal/2026-11-13.md';
const options = { filePath: FRIDAY, todayPath: 'journal/2026-11-16.md', style: 'wiki' as const };

/** What carrying every open task of `text` into today's note plans. */
function plan(text: string, mode: 'move' | 'migrate', filePath = FRIDAY, today = '# 2026-11-16\n') {
  const tasks = parseMarkdown(filePath, text).tasks.filter(isOpenTask);
  return planCarriedTasks(tasks, new Map([[filePath, text.split('\n')]]), today, {
    mode,
    target: '2026-11-16',
    todayPath: 'journal/2026-11-16.md',
  });
}

/** A note's lines with a plan's source edits made, last first. */
function afterEdits(text: string, planned: ReturnType<typeof plan>): string {
  const lines = text.split('\n');
  const offset = (position: { line: number; character: number }): number =>
    lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character;
  let result = text;
  for (const edit of [...planned.sourceEdits].reverse()) {
    result = `${result.slice(0, offset(edit.range.start))}${edit.text}${result.slice(offset(edit.range.end))}`;
  }
  return result;
}

suite('Carried tasks keep their meeting', () => {
  test('a task is carried under the nearest heading with tags, or the outermost below the top level', () => {
    const lines = friday.split('\n');
    assert.strictEqual(findCarriedHeading(lines, 2, options), undefined, 'under the note\'s own heading alone');
    assert.deepStrictEqual(findCarriedHeading(lines, 6, options), {
      heading: 'Vendor sync #project/borealis @dana',
      link: '([[2026-11-13#Vendor sync]])',
    });
    assert.deepStrictEqual(findCarriedHeading(lines, 9, options), {
      heading: 'Pricing #vendor #project/borealis @dana',
      link: '([[2026-11-13#Pricing]])',
    });
    assert.deepStrictEqual(findCarriedHeading(lines, 13, options), { heading: 'Notes', link: '([[2026-11-13#Notes]])' });
    assert.strictEqual(
      findCarriedHeading(lines, 6, { ...options, todayPath: '2026-11-16.md', style: 'markdown' })?.link,
      '([2026-11-13#Vendor sync](journal/2026-11-13.md#vendor-sync))',
    );
  });

  test('plans the tasks under no heading first, then each heading\'s, with its link', () => {
    const planned = plan(friday, 'migrate');
    assert.deepStrictEqual(planned.groups, [
      { lines: ['- [ ] Book travel'] },
      { under: { heading: 'Vendor sync #project/borealis @dana', link: '([[2026-11-13#Vendor sync]])' }, lines: ['- [ ] Send the quote'] },
      { under: { heading: 'Pricing #vendor #project/borealis @dana', link: '([[2026-11-13#Pricing]])' }, lines: ['- [ ] Ask for the gateway price'] },
      { under: { heading: 'Notes', link: '([[2026-11-13#Notes]])' }, lines: ['- [ ] File the survey'] },
    ]);
    assert.strictEqual(planned.carried.length, 4);
  });

  test('carried again, a task keeps its heading and the link to where it was first written', () => {
    const monday = [
      '# 2026-11-16',
      '',
      '## Carried over',
      '',
      '- [ ] Book travel',
      '',
      '### Vendor sync #project/borealis @dana',
      '([[2026-11-13#Vendor sync]])',
      '- [ ] Send the quote',
      '- [x] Confirm the dates',
      '',
      '### Notes',
      '([[2026-11-13#Notes]])',
      '- [ ] File the survey',
      '',
      '## Evening',
      '',
    ].join('\n');
    const planned = plan(monday, 'move', 'journal/2026-11-16.md', '# 2026-11-17\n');
    assert.deepStrictEqual(planned.groups, [
      { lines: ['- [ ] Book travel'] },
      { under: { heading: 'Vendor sync #project/borealis @dana', link: '([[2026-11-13#Vendor sync]])' }, lines: ['- [ ] Send the quote'] },
      { under: { heading: 'Notes', link: '([[2026-11-13#Notes]])' }, lines: ['- [ ] File the survey'] },
    ]);
    // A heading the move leaves with only its link goes; one that still holds a line stays.
    assert.strictEqual(
      afterEdits(monday, planned),
      [
        '# 2026-11-16',
        '',
        '## Carried over',
        '',
        '',
        '### Vendor sync #project/borealis @dana',
        '([[2026-11-13#Vendor sync]])',
        '- [x] Confirm the dates',
        '',
        '## Evening',
        '',
      ].join('\n'),
    );
  });

  test('a Markdown link carried again is written from today\'s note, and a heading without its link links to itself', () => {
    const lines = [
      '# 2026-11-16',
      '## Carried over',
      '### Vendor sync',
      '([2026-11-13#Vendor sync](2026-11-13.md#vendor-sync))',
      '- [ ] Send the quote',
      '### Notes',
      '- [ ] File the survey',
    ];
    const from = { filePath: 'journal/2026/11/2026-11-16.md', todayPath: 'journal/2026/12/2026-12-01.md', style: 'markdown' as const };
    assert.strictEqual(
      findCarriedHeading(lines, 4, from)?.link,
      '([2026-11-13#Vendor sync](../11/2026-11-13.md#vendor-sync))',
    );
    assert.strictEqual(
      findCarriedHeading(lines, 6, { ...from, style: 'wiki' })?.link,
      '([[2026-11-16#Notes]])',
    );
  });

  test('lays Carried over out: its own lines, then the headings under it', () => {
    assert.deepStrictEqual(mergeCarriedOver([], 2, [{ lines: ['- [ ] One'] }]), ['', '- [ ] One']);
    assert.deepStrictEqual(
      mergeCarriedOver([], 2, [{ under: { heading: 'Notes', link: '([[2026-11-13#Notes]])' }, lines: ['- [ ] One'] }]),
      ['', '### Notes', '([[2026-11-13#Notes]])', '- [ ] One'],
    );
    assert.deepStrictEqual(
      mergeCarriedOver(['', '### Notes', '([[2026-11-13#Notes]])', '- [ ] One', ''], 2, [{ lines: ['- [ ] Two'] }]),
      ['', '- [ ] Two', '', '### Notes', '([[2026-11-13#Notes]])', '- [ ] One', ''],
      'above the headings, not under the last of them',
    );
    assert.deepStrictEqual(
      mergeCarriedOver(['', '###### Notes', '([[2026-11-12#Notes]])', '- [ ] One'], 6, [
        { under: { heading: 'notes', link: '([[2026-11-13#Notes]])' }, lines: ['- [ ] Two'] },
      ]),
      ['', '###### Notes', '([[2026-11-12#Notes]])', '- [ ] One', '', '###### notes', '([[2026-11-13#Notes]])', '- [ ] Two'],
      'another day\'s Notes is another heading, and none is deeper than six',
    );
  });
});
