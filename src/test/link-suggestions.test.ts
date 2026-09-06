import * as assert from 'assert';

import * as vscode from 'vscode';

import {
  findWikiLinkTargets,
  getWikiLinkCompletionContext,
  WikiLinkCompletionProvider,
} from '../ui/commands/linkSuggestions';
import { parseMarkdown } from '../core/markdown/parser';
import { WorkspaceIndex } from '../core/types';

suite('Wiki link suggestions', () => {
  test('completes workspace note titles inside Wiki links', async () => {
    const provider = new WikiLinkCompletionProvider({
      ready: Promise.resolve(),
      getSnapshot: () => createIndex(['notes/Atlas Planning.md', 'notes/People.md']),
    });
    const document = createDocument('/tmp/deckard/notes/case.md', 'See [[atl');

    const items = await provider.provideCompletionItems(
      document,
      new vscode.Position(0, 9),
    );

    assert.deepStrictEqual(items.map((item) => item.label), ['Atlas Planning']);
    assert.strictEqual(items[0].insertText, 'Atlas Planning]]');
    provider.dispose();
  });

  test('finds only an unfinished Wiki link target', () => {
    assert.deepStrictEqual(getWikiLinkCompletionContext('See [[Atlas', 11), {
      query: 'Atlas',
      startColumn: 6,
    });
    assert.strictEqual(getWikiLinkCompletionContext('See [Atlas]', 11), undefined);
  });

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

function createDocument(uriPath: string, text: string): vscode.TextDocument {
  return {
    uri: vscode.Uri.file(uriPath),
    lineAt: () => ({ text }),
  } as unknown as vscode.TextDocument;
}
