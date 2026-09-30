import * as assert from 'assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import * as vscode from 'vscode';

import { parseMarkdown } from '../domain/markdown/parser';
import { appendCapture } from '../ui/commands/capture';
import { buildDestinationItems } from '../ui/commands/destinationPicker';
import { buildWorkspaceIndex } from '../domain/index/indexState';

suite('Quick capture', () => {
  test('offers the headings used last first, the last one leading, and skips one that is gone', () => {
    const files = new Map(
      Object.entries({
        'a.md': '# A\n## Next\nText.\n',
        'b.md': '# B\n## Calls\n',
      }).map(([path, content]) => [path, parseMarkdown(path, content)]),
    );
    const index = buildWorkspaceIndex(files);
    const items = buildDestinationItems(index, {
      recentHeadings: [
        { filePath: 'b.md', heading: 'Calls', headingLevel: 2, occurrence: 0 },
        { filePath: 'a.md', heading: 'Gone', headingLevel: 2, occurrence: 0 },
        { filePath: 'a.md', heading: 'Next', headingLevel: 2, occurrence: 0 },
      ],
    });
    const labels = items.map((item) => item.label);
    assert.deepStrictEqual(labels.slice(0, 3), ['Recent', 'Calls', 'Next']);
    assert.strictEqual(labels[3], 'All headings');
    assert.ok(!labels.slice(4).includes('Calls'), 'a recent heading is listed once');
    const withMore = buildDestinationItems(index, {}, { newNote: true, today: { fileName: '2026-09-26.md' } });
    assert.deepStrictEqual(withMore.slice(0, 3).map((item) => item.label), ['$(new-file) New note…', '$(calendar) Today’s note', 'Headings']);
  });

  test('adds the task through the editor copy, keeping unsaved changes, and saves', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'deckard-capture-'));
    const file = join(directory, '2026-09-13.md');
    writeFileSync(file, '# 2026-09-13\n\n- [ ] One\n');
    const uri = vscode.Uri.file(file);
    try {
      await vscode.workspace.openTextDocument(uri);
      const draft = new vscode.WorkspaceEdit();
      draft.insert(uri, new vscode.Position(0, 0), '<!-- draft -->\n');
      assert.ok(await vscode.workspace.applyEdit(draft));

      const taskLine = await appendCapture(uri, '- [ ] Two');

      assert.strictEqual(taskLine, 4);
      assert.strictEqual(
        readFileSync(file, 'utf8'),
        '<!-- draft -->\n# 2026-09-13\n\n- [ ] One\n- [ ] Two\n',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

});
