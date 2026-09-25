import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { collectNoteLinks } from '../ui/state/noteLinks';

suite('What links to a note', () => {
  test('lists each linking line under its headings, and each mention without a link', () => {
    const files = new Map(
      Object.entries({
        'notes/Atlas.md': '# Atlas\nThe plan.\n',
        'notes/Standup.md': '# Standup\n## Decisions\nWe moved [[Atlas]] to Q4.\n',
        'notes/Budget.md': '# Budget\nAtlas needs more time.\n',
      }).map(([path, content]) => [path, parseMarkdown(path, content)]),
    );
    const index = buildWorkspaceIndex(files);
    const links = collectNoteLinks(index, index.files.get('notes/Atlas.md')!);

    assert.strictEqual(links.linkedFromCount, 1);
    assert.deepStrictEqual(links.linkedFrom[0], {
      filePath: 'notes/Standup.md',
      title: 'Standup',
      line: 3,
      text: 'We moved [[Atlas]] to Q4.',
      headingPath: ['Decisions'],
    });
    assert.strictEqual(links.mentionCount, 1);
    assert.deepStrictEqual(
      [links.mentions[0].filePath, links.mentions[0].line, links.mentions[0].name, links.mentions[0].startColumn],
      ['notes/Budget.md', 2, 'Atlas', 0],
    );
  });
});
