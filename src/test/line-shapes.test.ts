import * as assert from 'assert';

import {
  findFencedLines,
  isHeadingLine,
  isTaskLineOf,
  matchHeading,
  matchTaskLine,
  TaskLineShape,
} from '../domain/markdown/lineShapes';

/** Which of `lines` a shape accepts. */
function accepted(shape: TaskLineShape, lines: readonly string[]): string[] {
  return lines.filter((line) => isTaskLineOf(line, shape));
}

suite('Line shapes: task lines', () => {
  const lines = [
    '- [ ] open',
    '- [x] done',
    '- [X] done',
    '- [>] migrated',
    '- [ ]',
    '- [ ]word',
    '  * [ ] indented',
    '\t+ [ ] tabbed',
    '\u00a0- [ ] no-break space',
    '-  [ ] two spaces',
    '-\t[ ] tab gap',
    '- [-] cancelled',
    '-[ ] no gap',
    '1. [ ] numbered',
    '- [ ] \r',
  ];

  test('any mark but [>], any whitespace indent, nothing required after', () => {
    // Word count, Toggle Done, the selection seed.
    const shape: TaskLineShape = { indent: 'whitespace', marks: ' xX' };
    assert.deepStrictEqual(accepted(shape, lines), [
      '- [ ] open',
      '- [x] done',
      '- [X] done',
      '- [ ]',
      '- [ ]word',
      '  * [ ] indented',
      '\t+ [ ] tabbed',
      '\u00a0- [ ] no-break space',
      '-  [ ] two spaces',
      '-\t[ ] tab gap',
      '- [ ] \r',
    ]);
  });

  test('[>] counts only for the shapes that list it', () => {
    const any: TaskLineShape = { indent: 'whitespace', marks: ' xX>' };
    const migrated: TaskLineShape = { indent: 'whitespace', marks: '>' };
    const open: TaskLineShape = { indent: 'whitespace', marks: ' ' };
    assert.strictEqual(isTaskLineOf('- [>] moved', any), true);
    assert.strictEqual(isTaskLineOf('- [>] moved', migrated), true);
    assert.strictEqual(isTaskLineOf('- [ ] open', migrated), false);
    assert.strictEqual(isTaskLineOf('- [>] moved', open), false);
    assert.strictEqual(isTaskLineOf('- [x] done', open), false);
  });

  test('a spaces-and-tabs indent refuses a no-break space', () => {
    const shape: TaskLineShape = { indent: 'spaces-and-tabs', marks: ' xX', after: 'gap' };
    assert.strictEqual(isTaskLineOf('\u00a0- [ ] step', shape), false);
    assert.strictEqual(isTaskLineOf(' \t- [ ] step', shape), true);
    assert.strictEqual(isTaskLineOf('- [ ]', shape), false);
    assert.strictEqual(isTaskLineOf('- [ ]step', shape), false);
  });

  test('gap-then-words needs something after the gap', () => {
    const shape: TaskLineShape = { indent: 'spaces-and-tabs', marks: ' xX', after: 'gap-then-words' };
    assert.strictEqual(isTaskLineOf('- [ ] Call Ren', shape), true);
    assert.strictEqual(isTaskLineOf('- [ ]   ', shape), false);
    assert.strictEqual(isTaskLineOf('- [ ]', shape), false);
  });

  test('the parser shape keeps the rest of the line on one line', () => {
    const shape: TaskLineShape = { indent: 'whitespace', marks: ' xX', after: 'gap', oneLine: true };
    assert.deepStrictEqual(matchTaskLine('  * [x]  Ship it', shape), {
      indent: '  ',
      bullet: '*',
      opening: '  * [',
      mark: 'x',
      head: '  * [x]',
      gap: '  ',
      body: 'Ship it',
    });
    assert.strictEqual(isTaskLineOf('- [ ] Ship\r', shape), false);
    assert.strictEqual(isTaskLineOf('- [ ] Ship\u2028it', shape), false);
    assert.strictEqual(isTaskLineOf('- [ ] Ship\r', { indent: 'whitespace', marks: ' xX', after: 'gap' }), true);
  });

  test('optional-blank reads at most one blank as part of the box', () => {
    const shape: TaskLineShape = { indent: 'whitespace', marks: ' xX', after: 'optional-blank' };
    assert.deepStrictEqual(
      [matchTaskLine('- [ ]  two', shape)?.body, matchTaskLine('- [ ]\tone', shape)?.body, matchTaskLine('- [ ]none', shape)?.body],
      [' two', 'one', 'none'],
    );
  });

  test('one-space accepts only the line Deckard writes', () => {
    const shape: TaskLineShape = { indent: 'none', bulletGap: 'one-space', marks: ' xX', after: 'one-space' };
    assert.deepStrictEqual(accepted(shape, ['- [ ] a', '- [x] a', ' - [ ] a', '-  [ ] a', '- [ ]a', '- [ ]\ta', '-\t[ ] a']), [
      '- [ ] a',
      '- [x] a',
    ]);
  });

  test('an unread box needs only its opening bracket', () => {
    const shape: TaskLineShape = { indent: 'spaces-and-tabs', marks: 'unread' };
    assert.strictEqual(matchTaskLine('  - [', shape)?.opening.length, 5);
    assert.strictEqual(matchTaskLine('- [?] odd', shape)?.opening.length, 3);
    assert.strictEqual(matchTaskLine('- [x]', shape)?.mark, '');
    assert.strictEqual(matchTaskLine('- no box', shape), undefined);
  });
});

suite('Line shapes: headings', () => {
  test('a bare # is a heading only where bare hashes are allowed', () => {
    for (const line of ['#', '##', '   ###', '# ']) {
      assert.strictEqual(isHeadingLine(line, { allowBare: true }), true, line);
    }
    assert.strictEqual(isHeadingLine('#', { allowBare: false }), false);
    assert.strictEqual(isHeadingLine('##', { allowBare: false }), false);
    assert.strictEqual(isHeadingLine('# ', { allowBare: false }), true);
  });

  test('neither shape takes a tag, seven hashes, or a four-space indent', () => {
    for (const line of ['#tag', '####### seven', '    # code', '\t# tabbed']) {
      assert.strictEqual(isHeadingLine(line, { allowBare: true }), false, line);
      assert.strictEqual(isHeadingLine(line, { allowBare: false }), false, line);
    }
  });

  test('kept reads the words with their closing hashes and needs one character', () => {
    assert.deepStrictEqual(matchHeading('## Plan ##  ', 'kept'), { level: 2, text: 'Plan ##' });
    assert.deepStrictEqual(matchHeading('# Title\r', 'kept'), { level: 1, text: 'Title' });
    assert.deepStrictEqual(matchHeading('#  ', 'kept'), { level: 1, text: ' ' });
    assert.strictEqual(matchHeading('# ', 'kept'), undefined);
    assert.strictEqual(matchHeading('#', 'kept'), undefined);
  });

  test('dropped takes the closing hashes off and allows no words', () => {
    assert.deepStrictEqual(matchHeading('## Plan ##  ', 'dropped'), { level: 2, text: 'Plan' });
    assert.deepStrictEqual(matchHeading('# #', 'dropped'), { level: 1, text: '' });
    assert.deepStrictEqual(matchHeading('# ', 'dropped'), { level: 1, text: '' });
    assert.strictEqual(matchHeading('# Title\r', 'dropped'), undefined);
  });
});

suite('Line shapes: fences', () => {
  test('marks the fences and what they hold', () => {
    const lines = ['text', '```ts', 'code', '```', 'after', '   ~~~', 'more', '~~~~'];
    assert.deepStrictEqual([...findFencedLines(lines)], [1, 2, 3, 5, 6, 7]);
  });

  test('a fence closes only on the character that opened it', () => {
    const lines = ['```', '~~~', 'still code', '```', 'prose'];
    assert.deepStrictEqual([...findFencedLines(lines)], [0, 1, 2, 3]);
  });

  test('a four-space indent is not a fence, and an unclosed one runs to the end', () => {
    assert.deepStrictEqual([...findFencedLines(['    ```', 'prose'])], []);
    assert.deepStrictEqual([...findFencedLines(['prose', '``` open', 'a', 'b'])], [1, 2, 3]);
  });
});
