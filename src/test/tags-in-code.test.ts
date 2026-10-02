import * as assert from 'assert';

import { findCodeAndLinkRanges } from '../domain/markdown/inlineRanges';
import {
  extractTagSpans,
  extractTags,
  parseMarkdown,
  stripTags,
} from '../domain/markdown/parser';
import { appendTagToLine } from '../ui/commands/bulkEdit';
import { moveInlineTagsToFrontmatterContent } from '../ui/commands/moveTagsToFrontmatter';
import { replaceIndexedTag } from '../domain/markdown/tagRename';
import { getTagCompletionContext } from '../domain/markdown/completionContext';
import { setTaskNamespaceTags, setTaskStatusTag } from '../domain/tasks/boardMoves';

const keys = (text: string): string[] => extractTags(text).map((tag) => tag.key);

suite('Tags in inline code', () => {
  test('finds single, double, and unclosed backtick spans as CommonMark does', () => {
    assert.deepStrictEqual(findCodeAndLinkRanges('a `b` c'), [{ start: 2, end: 5 }]);
    assert.deepStrictEqual(findCodeAndLinkRanges('``a ` b`` c'), [{ start: 0, end: 9 }]);
    assert.deepStrictEqual(findCodeAndLinkRanges('an ` unclosed tick'), []);
    assert.deepStrictEqual(findCodeAndLinkRanges('``two`'), [], 'runs of different lengths do not close');
    assert.deepStrictEqual(findCodeAndLinkRanges('\\`not code`'), [], 'an escaped tick opens nothing');
  });

  test('a tag in a single-backtick span is text', () => {
    assert.deepStrictEqual(keys('Write `#project/x` or `@dana` to tag'), []);
  });

  test('a tag in a double-backtick span is text, even with a backtick inside', () => {
    assert.deepStrictEqual(keys('Try ``#a `b` #c`` here'), []);
  });

  test('a real tag beside a code span on the same line is still a tag', () => {
    assert.deepStrictEqual(keys('Type `#example` like this #real and @dana'), ['#real', '@dana']);
  });

  test('an unclosed backtick is not code, so the tag after it counts', () => {
    assert.deepStrictEqual(keys('An odd ` tick then #real'), ['#real']);
  });

  test('the index holds no tag from inline code in headings, tasks, or prose', () => {
    const parsed = parseMarkdown(
      'notes/a.md',
      ['# Using `#draft` #guide', '', '- [ ] Explain `@dana` #docs', '', 'Write `#idea` in prose.'].join('\n'),
    );
    const tags = new Set([...parsed.sections, ...parsed.tasks].flatMap((item) => item.tags));
    assert.deepStrictEqual([...tags].sort(), ['#docs', '#guide']);
    assert.ok(!parsed.sections.some((section) => section.startLine === 5), 'the prose line is no tagged entry');
  });

  test('decorations and hovers get no span inside inline code', () => {
    const spans = extractTagSpans('Type `#example` then #real');
    assert.deepStrictEqual(
      spans.map((span) => [span.label, span.startColumn]),
      [['#real', 21]],
    );
  });

  test('titles keep a tag written as code', () => {
    assert.strictEqual(stripTags('Write `#draft` tags #guide'), 'Write `#draft` tags');
  });

  test('completion is not offered inside inline code, and is outside it', () => {
    const line = 'Write `#pro` then #pro';
    assert.strictEqual(getTagCompletionContext(line, 11), undefined);
    assert.strictEqual(getTagCompletionContext(line, line.length)?.query, 'pro');
    assert.strictEqual(getTagCompletionContext('An open `#pro', 13)?.query, 'pro', 'an unclosed tick is no code yet');
  });

  test('rename and merge leave a tag written as code alone', () => {
    const result = replaceIndexedTag('Use `#old` for #old, and ``#old``.', '#old', { key: '#new', label: '#new' });
    assert.strictEqual(result.content, 'Use `#old` for #new, and ``#old``.');
    assert.strictEqual(result.occurrenceCount, 1);
    const merged = replaceIndexedTag('`#old` #old #new', '#old', { key: '#new', label: '#new' });
    assert.strictEqual(merged.content, '`#old` #new');
  });

  test('bulk edit adds a tag that the line only shows as code', () => {
    assert.strictEqual(appendTagToLine('- [ ] Explain `#docs`', '#docs'), '- [ ] Explain `#docs` #docs');
  });

  test('Move Tags to Front Matter leaves code alone', () => {
    assert.strictEqual(moveInlineTagsToFrontmatterContent('Write `#draft` here.'), undefined);
  });

  test('board moves change the real status tag, not one in code', () => {
    assert.strictEqual(
      setTaskStatusTag('- [ ] Show ` #status/todo` #status/todo', 3, 'status', 'doing'),
      '- [ ] Show ` #status/todo` #status/doing',
    );
    assert.strictEqual(
      setTaskNamespaceTags('- [ ] Show ` #stage/a` #stage/a', 3, { remove: ['#stage/a'], add: '#stage/b' }),
      '- [ ] Show ` #stage/a` #stage/b',
    );
  });
});
