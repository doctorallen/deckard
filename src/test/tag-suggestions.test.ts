import * as assert from 'assert';

import * as vscode from 'vscode';

import { TagInfo, WorkspaceIndex } from '../core/types';
import {
  getTagCompletionContext,
  TagCompletionProvider,
} from '../ui/commands/tagSuggestions';

suite('Tag suggestions', () => {
  test('finds the tag token at the cursor and its replacement range', () => {
    assert.deepStrictEqual(getTagCompletionContext('Review @pro', 11), {
      marker: '@',
      query: 'pro',
      startColumn: 7,
      endColumn: 11,
    });
    assert.deepStrictEqual(getTagCompletionContext('Review @project', 10), {
      marker: '@',
      query: 'pr',
      startColumn: 7,
      endColumn: 15,
    });
    assert.deepStrictEqual(getTagCompletionContext('# Heading', 1), {
      marker: '#',
      query: '',
      startColumn: 0,
      endColumn: 1,
    });
    assert.deepStrictEqual(getTagCompletionContext('Review ~mar', 11, '~'), {
      marker: '~',
      query: 'mar',
      startColumn: 7,
      endColumn: 11,
    });
  });

  test('filters existing tags and includes entry counts', async () => {
    const provider = new TagCompletionProvider({
      ready: Promise.resolve(),
      getSnapshot: () =>
        createIndex([
          createTag('@process', 1),
          createTag('@project', 4),
          createTag('#other', 9),
        ]),
    });
    const document = createDocument(
      '/tmp/deckard/notes/case.md',
      'Review @project',
    );

    const items = await provider.provideCompletionItems(
      document,
      new vscode.Position(0, 10),
    );

    assert.deepStrictEqual(
      items.map((item) => item.label),
      ['@process', '@project'],
    );
    assert.deepStrictEqual(
      items.map((item) => item.detail),
      ['1 entry', '4 entries'],
    );
    const range = items[0].range;
    assert.ok(range && 'inserting' in range && 'replacing' in range);
    if (range && 'inserting' in range && 'replacing' in range) {
      assert.strictEqual(range.inserting.start.character, 7);
      assert.strictEqual(range.inserting.end.character, 10);
      assert.strictEqual(range.replacing.start.character, 7);
      assert.strictEqual(range.replacing.end.character, 15);
    }
    provider.dispose();
  });

  test('does not suggest numeric-only hash tags or non-Markdown documents', async () => {
    const provider = new TagCompletionProvider({
      ready: Promise.resolve(),
      getSnapshot: () =>
        createIndex([createTag('#3', 2), createTag('#project', 4)]),
    });

    const hashDocument = createDocument(
      '/tmp/deckard/notes/case.md',
      'Review #',
    );
    const lineStartHashDocument = createDocument(
      '/tmp/deckard/notes/case.md',
      '#',
    );
    const fencedDocument = createDocument(
      '/tmp/deckard/notes/case.md',
      '```markdown\n@pro\n```',
    );
    const headingDocument = createDocument(
      '/tmp/deckard/notes/case.md',
      '# Heading #',
    );
    const headingTagDocument = createDocument(
      '/tmp/deckard/notes/case.md',
      '# Heading #project',
    );
    const repeatedHeadingMarkerDocument = createDocument(
      '/tmp/deckard/notes/case.md',
      '## something',
    );
    const textDocument = createDocument('/tmp/deckard/notes/case.txt', '@pro');
    const hashItems = await provider.provideCompletionItems(
      hashDocument,
      new vscode.Position(0, 8),
    );
    const fencedItems = await provider.provideCompletionItems(
      fencedDocument,
      new vscode.Position(1, 4),
    );
    const lineStartHashItems = await provider.provideCompletionItems(
      lineStartHashDocument,
      new vscode.Position(0, 1),
    );
    const headingItems = await provider.provideCompletionItems(
      headingDocument,
      new vscode.Position(0, 11),
    );
    const headingTagItems = await provider.provideCompletionItems(
      headingTagDocument,
      new vscode.Position(0, 11),
    );
    const repeatedHeadingMarkerItems = await provider.provideCompletionItems(
      repeatedHeadingMarkerDocument,
      new vscode.Position(0, 2),
    );
    const textItems = await provider.provideCompletionItems(
      textDocument,
      new vscode.Position(0, 4),
    );

    assert.deepStrictEqual(
      hashItems.map((item) => item.label),
      ['#project'],
    );
    assert.deepStrictEqual(
      lineStartHashItems.map((item) => item.label),
      ['#project'],
    );
    assert.deepStrictEqual(fencedItems, []);
    assert.deepStrictEqual(headingItems, []);
    assert.deepStrictEqual(
      headingTagItems.map((item) => item.label),
      ['#project'],
    );
    assert.deepStrictEqual(repeatedHeadingMarkerItems, []);
    assert.deepStrictEqual(textItems, []);
    provider.dispose();
  });

  test('finds namespaced hash entities by their short name', async () => {
    const provider = new TagCompletionProvider({
      ready: Promise.resolve(),
      getSnapshot: () =>
        createIndex([
          createTag('#project/atlas', 3),
          createTag('#topic/atlas', 2),
          createTag('@atlas-owner', 1),
        ]),
    });
    const document = createDocument(
      '/tmp/deckard/notes/case.md',
      'Review #atl',
    );

    const items = await provider.provideCompletionItems(
      document,
      new vscode.Position(0, 11),
    );

    assert.deepStrictEqual(
      items.map((item) => item.label),
      ['#project/atlas', '#topic/atlas'],
    );
    provider.dispose();
  });

  test('does not suggest tags when autocomplete is disabled', async () => {
    const provider = new TagCompletionProvider(
      {
        ready: Promise.resolve(),
        getSnapshot: () => createIndex([createTag('@project', 4)]),
      },
      () => false,
    );
    const document = createDocument(
      '/tmp/deckard/notes/case.md',
      'Review @project',
    );

    const items = await provider.provideCompletionItems(
      document,
      new vscode.Position(0, 10),
    );

    assert.deepStrictEqual(items, []);
    provider.dispose();
  });
});

function createTag(key: string, count: number): TagInfo {
  return {
    key,
    label: key,
    sectionIds: [],
    taskIds: [],
    filePaths: [],
    count,
    isFavorite: false,
  };
}

function createIndex(tags: TagInfo[]): WorkspaceIndex {
  return {
    files: new Map(),
    sections: new Map(),
    tasks: new Map(),
    tags: new Map(tags.map((tag) => [tag.key, tag])),
    entities: new Map(),
    updatedAt: Date.now(),
  };
}

function createDocument(uriPath: string, text: string): vscode.TextDocument {
  const lines = text.split(/\r?\n/);

  return {
    uri: vscode.Uri.file(uriPath),
    getText: () => text,
    lineAt: (line: number) => ({ text: lines[line] }),
  } as unknown as vscode.TextDocument;
}
