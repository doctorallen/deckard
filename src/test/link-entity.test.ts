import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { findHeadingTagColumn } from '../ui/commands/linkEntity';

/** The heading line with `tag` written where Link Current Heading writes it. */
function tagged(line: string, tag: string): string {
  const at = findHeadingTagColumn(line);
  return `${line.slice(0, at)} ${tag}${line.slice(at)}`;
}

suite('Link Current Heading', () => {
  test('writes the tag after the heading\'s words, before its ^marker', () => {
    assert.strictEqual(tagged('## Plan ^p1', '@dana'), '## Plan @dana ^p1');
    assert.deepStrictEqual(
      parseMarkdown('n.md', `# Top\n${tagged('## Plan ^p1', '@dana')}\ntext\n`).blockIds,
      { p1: 2 },
      '[[n#^p1]] still opens the heading',
    );
  });

  test('writes the tag before closing hashes, and at the end of any other heading', () => {
    assert.strictEqual(tagged('## Plan ##', '@dana'), '## Plan @dana ##');
    assert.strictEqual(tagged('## Plan', '@dana'), '## Plan @dana');
    assert.strictEqual(tagged('## Learn C#', '@dana'), '## Learn C# @dana');
    assert.strictEqual(tagged('## Plan #atlas', '@dana'), '## Plan #atlas @dana');
  });
});
