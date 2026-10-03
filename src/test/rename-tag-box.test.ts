import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { describeRenameTarget, nameSelection } from '../ui/commands/renameTag';

function createIndex() {
  const files = new Map(
    Object.entries({
      'notes/a.md': '# A #proj/atlas\n',
      'notes/b.md': '# B #project/atlas\n# C #project/atlas\n',
    }).map(([path, content]) => [path, parseMarkdown(path, content)]),
  );
  return buildWorkspaceIndex(files);
}

suite('The Rename Tag box', () => {
  test('says, as a name is typed, what the rename will do', () => {
    const index = createIndex();
    const source = index.tags.get('#proj/atlas')!;
    const say = (value: string) => describeRenameTarget(index, source, value);
    assert.deepStrictEqual(say('#proj/atlas'), {
      message: 'This is #proj/atlas already; nothing will change.',
      severity: 'info',
    });
    assert.deepStrictEqual(say('#project/atlas'), {
      message: 'Merges into #project/atlas (2 entries).',
      severity: 'info',
    });
    assert.deepStrictEqual(say('project/atlas'), {
      message: 'Becomes a new tag #proj/project/atlas. Start with # to leave out proj/.',
      severity: 'warning',
    });
    assert.deepStrictEqual(say('atlas-2026'), {
      message: 'Becomes a new tag #proj/atlas-2026.',
      severity: 'info',
    });
    assert.strictEqual(say('two #tags here').severity, 'error');
    assert.strictEqual(say('').severity, 'error');
  });

  test('starts with the name after the namespace selected', () => {
    assert.deepStrictEqual(nameSelection('#proj/atlas'), [6, 11]);
    assert.deepStrictEqual(nameSelection('#atlas'), [1, 6]);
    assert.deepStrictEqual(nameSelection('@dana'), [1, 5]);
  });
});
