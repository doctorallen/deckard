import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { captureSeed, shortSelection, withSourceLink } from '../ui/commands/selectionSeed';

function editorOn(lines: string[], start: [number, number], end: [number, number], path = '/ws/notes/2026-09-22.md') {
  const selection = {
    start: { line: start[0], character: start[1] },
    end: { line: end[0], character: end[1] },
    isEmpty: start[0] === end[0] && start[1] === end[1],
  };
  return {
    document: {
      uri: vscode.Uri.file(path),
      getText: () => lines[start[0]].slice(start[1], end[1]),
    },
    selection,
  } as unknown as vscode.TextEditor;
}

suite('Find and Capture start from the selection', () => {
  test('takes a few words on one line, and nothing longer', () => {
    assert.strictEqual(shortSelection(editorOn(['Call Ren friday'], [0, 0], [0, 15])), 'Call Ren friday');
    assert.strictEqual(shortSelection(editorOn(['   '], [0, 0], [0, 3])), undefined);
    assert.strictEqual(shortSelection(editorOn(['a', 'b'], [0, 0], [1, 1])), undefined);
    assert.strictEqual(shortSelection(editorOn(['x'.repeat(130)], [0, 0], [0, 130])), undefined);
    assert.strictEqual(shortSelection(editorOn(['word'], [0, 1], [0, 1])), undefined);
  });

  test('links a capture back to the heading the words were selected under', () => {
    const content = '# Monday\n## Weekly review\nCall Ren friday\n';
    const index = buildWorkspaceIndex(new Map([['notes/2026-09-22.md', parseMarkdown('notes/2026-09-22.md', content)]]));
    const seed = captureSeed(
      editorOn(content.split('\n'), [2, 0], [2, 15]),
      index,
      () => 'notes/2026-09-22.md',
    );
    assert.deepStrictEqual(seed, { text: 'Call Ren friday', link: '[[2026-09-22#Weekly review]]' });
    assert.deepStrictEqual(captureSeed(editorOn(content.split('\n'), [2, 0], [2, 15]), index, () => undefined), {
      text: 'Call Ren friday',
    });
  });

  test('writes the link after the words and before the metadata, or at the end of a note line', () => {
    assert.strictEqual(
      withSourceLink('- [ ] Call Ren 📅 2026-10-02', '[[2026-09-22#Weekly review]]'),
      '- [ ] Call Ren [[2026-09-22#Weekly review]] 📅 2026-10-02',
    );
    assert.strictEqual(
      withSourceLink('- [ ] Call Ren ⏫ 📅 2026-10-02', '[[A]]'),
      '- [ ] Call Ren [[A]] ⏫ 📅 2026-10-02',
    );
    assert.strictEqual(withSourceLink('- An idea', '[[A]]'), '- An idea [[A]]');
    assert.strictEqual(withSourceLink('- [ ] Call Ren', undefined), '- [ ] Call Ren');
  });
});
