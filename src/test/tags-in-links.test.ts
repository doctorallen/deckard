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
import { setTaskNamespaceTags } from '../domain/tasks/boardMoves';
import { removeStatusTags } from '../domain/tasks/legacyStatusTags';

const keys = (text: string): string[] => extractTags(text).map((tag) => tag.key);

suite('Tags in links', () => {
  test('finds wiki links, embeds, and Markdown link targets', () => {
    assert.deepStrictEqual(findCodeAndLinkRanges('a [[b]] c'), [{ start: 2, end: 7 }]);
    assert.deepStrictEqual(findCodeAndLinkRanges('![[b#c]]'), [{ start: 0, end: 8 }]);
    assert.deepStrictEqual(findCodeAndLinkRanges('[see](#here) x'), [{ start: 5, end: 12 }]);
    assert.deepStrictEqual(findCodeAndLinkRanges('an open [[link'), []);
    assert.deepStrictEqual(findCodeAndLinkRanges('[[a\nb]]'), [], 'a link does not cross lines');
  });

  test('a link to a heading in the same note is no tag', () => {
    assert.deepStrictEqual(keys('See [[#Heading]] above'), []);
    assert.deepStrictEqual(keys('See [[#Heading|the heading]] above'), []);
    assert.deepStrictEqual(keys('![[#Heading]]'), []);
    assert.deepStrictEqual(keys('[see](#heading)'), []);
  });

  test('a link to another note\'s heading or block is no tag', () => {
    assert.deepStrictEqual(keys('[[Note#Heading]] and [[Note#^block]] and [[Note|#alias]]'), []);
  });

  test('a real tag right after a link on the same line is still a tag', () => {
    assert.deepStrictEqual(keys('See [[#Decision]] #real'), ['#real']);
    assert.deepStrictEqual(keys('See [[Note#Heading]]#glued'), ['#glued']);
  });

  test('the index holds no tag from a link, and the line is no tagged entry', () => {
    const parsed = parseMarkdown(
      'notes/a.md',
      ['# Plan', '', 'See [[#Decision]] and ![[Other#Part]].', '', '## Decision #project/x'].join('\n'),
    );
    const tags = new Set([...parsed.sections, ...parsed.tasks].flatMap((item) => item.tags));
    assert.deepStrictEqual([...tags], ['#project/x']);
    assert.ok(!parsed.sections.some((section) => section.startLine === 3));
  });

  test('decorations and hovers get no span inside a link', () => {
    assert.deepStrictEqual(
      extractTagSpans('[[#Top]] #real').map((span) => [span.label, span.startColumn]),
      [['#real', 9]],
    );
  });

  test('titles keep a heading link whole', () => {
    assert.strictEqual(stripTags('About [[#Decision]] #x'), 'About [[#Decision]]');
  });

  test('completion is not offered inside a link, even one not closed yet', () => {
    assert.strictEqual(getTagCompletionContext('See [[#Dec]]', 10), undefined);
    assert.strictEqual(getTagCompletionContext('See [[#Dec', 10), undefined);
    assert.strictEqual(getTagCompletionContext('See [[Note#Hea', 14), undefined);
    assert.strictEqual(getTagCompletionContext('See [[Note]] #pro', 17)?.query, 'pro');
  });

  test('rename and merge leave a link alone', () => {
    const result = replaceIndexedTag('[[#old]] [[Note#old|x]] #old', '#old', { key: '#new', label: '#new' });
    assert.strictEqual(result.content, '[[#old]] [[Note#old|x]] #new');
    assert.strictEqual(result.occurrenceCount, 1);
  });

  test('bulk edit, Move Tags to Front Matter, and board moves leave links alone', () => {
    assert.strictEqual(appendTagToLine('See [[#docs]]', '#docs'), 'See [[#docs]] #docs');
    assert.strictEqual(moveInlineTagsToFrontmatterContent('See [[#Decision]].'), undefined);
    assert.strictEqual(
      removeStatusTags('- [ ] Read [[Note| #status/todo]] #status/todo', 3, 'status'),
      '- [ ] Read [[Note| #status/todo]]',
    );
    assert.strictEqual(
      setTaskNamespaceTags('- [ ] Read [[Note| #stage/a]]', 3, { remove: ['#stage/a'] }),
      '- [ ] Read [[Note| #stage/a]]',
    );
  });
});
