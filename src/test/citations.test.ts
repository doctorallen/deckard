import * as assert from 'assert';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown, stripTags } from '../domain/markdown/parser';

suite('Pandoc citations', () => {
  test('a bracketed citation names no one, while a Dataview field and link text still do', () => {
    const file = parseMarkdown('lit.md', [
      '# Literature #topic/networks',
      'As shown in [@smith2020; @lee2019, p. 33], and [see @kim2021].',
      '- [ ] Ask @dana about the method',
      '- [ ] Send the draft [assignee:: @ren]',
      '- [ ] Call [@sam](https://example.com) back',
    ].join('\n'));
    const index = buildWorkspaceIndex(new Map([['lit.md', file]]));
    const people = [...index.tags.keys()].filter((key) => key.startsWith('@')).sort();
    assert.deepStrictEqual(people, ['@dana', '@ren', '@sam']);
    assert.strictEqual(file.tasks[1].assignee, '@ren');
    assert.strictEqual(stripTags('Read [@smith2020] with @dana'), 'Read [@smith2020] with');
  });
});
