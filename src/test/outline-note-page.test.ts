import * as assert from 'assert';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import { OutlineTreeProvider } from '../ui/views/outlineTree';
import { ActiveNotePage } from '../ui/webview/activeNotePage';

/**
 * The Outline while the note page is in front: it lists the page's note,
 * read from the index, as the Context view follows it, and goes back to the
 * editor's note when the page leaves.
 */
suite('Outline: the note page', () => {
  const disposables: vscode.Disposable[] = [];

  teardown(() => {
    disposables.splice(0).forEach((disposable) => disposable.dispose());
  });

  test('lists the headings of the note the page shows, and none once it closes', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const filePath = 'notes/atlas.md';
    const index = buildWorkspaceIndex(new Map([[filePath, parseMarkdown(filePath, '# Atlas #project/atlas\nIntro.\n## Plan\nSteps.\n## Risks\nThe lift.')]]));
    const indexer = {
      getSnapshot: () => index,
      getUri: () => undefined,
      onDidUpdate: () => ({ dispose: () => undefined }),
    };
    const outline = new OutlineTreeProvider(indexer as never);
    const page = new ActiveNotePage();
    disposables.push(outline, page);
    outline.followNotePage(page);
    const labels = (): string[] => outline.getChildren().flatMap((root) => [root, ...outline.getChildren(root)]).map((node) => String(outline.getTreeItem(node).label));

    assert.deepStrictEqual(labels(), [], 'no note in front');
    page.setActive({ location: { filePath, line: 3 } });
    assert.deepStrictEqual(labels().map((label) => label.replace(/\s+#\S+/g, '')), ['Atlas', 'Plan', 'Risks']);
    page.setActive(undefined);
    assert.deepStrictEqual(labels(), []);
  });
});
