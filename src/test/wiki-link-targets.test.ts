import * as assert from 'assert';

import { findWikiLinkTargets } from '../domain/index/wikiLinkTargets';
import { parseMarkdown } from '../domain/markdown/parser';
import { WorkspaceIndex } from '../domain/model';

suite('Wiki link targets', () => {
  test('resolves complete Wiki links only when their target title is unique', () => {
    const index = createIndex([
      'notes/Atlas Planning.md',
      'notes/People.md',
      'archive/People.md',
    ]);

    assert.deepStrictEqual(
      findWikiLinkTargets(
        'See [[atlas planning]] and [[People]] or [[Missing]].',
        index,
      ),
      [
        {
          title: 'atlas planning',
          filePath: 'notes/Atlas Planning.md',
          startOffset: 4,
          endOffset: 22,
        },
      ],
    );
  });
});

suite('Wiki links to headings', () => {
  test('land on the heading, including [[#Heading]] in the same note', () => {
    const atlas = parseMarkdown('notes/Atlas.md', '# Atlas\n## Decision #project/atlas');
    const index: WorkspaceIndex = {
      files: new Map([[atlas.filePath, atlas]]),
      sections: new Map(),
      tasks: new Map(),
      tags: new Map(),
      entities: new Map(),
      updatedAt: Date.now(),
    };

    assert.deepStrictEqual(
      findWikiLinkTargets(
        '[[atlas#decision]] [[#Decision]] [[Atlas#Nowhere]]',
        index,
        'notes/Atlas.md',
      ).map((link) => [link.filePath, link.line]),
      [
        ['notes/Atlas.md', 2],
        ['notes/Atlas.md', 2],
        // A heading the note lacks still opens the note.
        ['notes/Atlas.md', undefined],
      ],
    );
  });
});

/** An index of empty notes at `paths`. */
function createIndex(paths: string[]): WorkspaceIndex {
  return {
    files: new Map(paths.map((path) => [path, parseMarkdown(path, '')])),
    sections: new Map(),
    tasks: new Map(),
    tags: new Map(),
    entities: new Map(),
    updatedAt: Date.now(),
  };
}
