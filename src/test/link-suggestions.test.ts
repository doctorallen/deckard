import * as assert from 'assert';

import * as vscode from 'vscode';

import {
  findWikiLinkTargets,
  getWikiLinkCompletionContext,
  WikiLinkCompletionProvider,
} from '../ui/commands/linkSuggestions';
import { parseMarkdown } from '../core/markdown/parser';
import { WorkspaceIndex } from '../core/types';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { createWikiLink } from '../ui/commands/insertLink';

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

  test('resolves and completes a note by its aliases', async () => {
    const index = indexOf({
      'notes/Atlas.md': '---\naliases: [Atlas Program, atlas]\n---\n# Atlas',
      'notes/Harbor.md': '---\naliases: [HQ]\n---\n',
      'notes/Vendor.md': '---\naliases: [HQ]\n---\n',
    });
    assert.deepStrictEqual(
      findWikiLinkTargets('[[atlas program]] [[HQ]] [[Atlas]]', index).map(
        (link) => link.filePath,
      ),
      ['notes/Atlas.md', 'notes/Atlas.md'],
      'an alias two notes share opens neither, and a title repeated as an alias is one note',
    );

    const provider = new WikiLinkCompletionProvider({
      ready: Promise.resolve(),
      getSnapshot: () => index,
    });
    const items = await provider.provideCompletionItems(
      createDocument('/tmp/deckard/notes/case.md', 'See [[prog'),
      new vscode.Position(0, 10),
    );
    assert.deepStrictEqual(
      items.map((item) => [item.label, item.detail, item.insertText]),
      [['Atlas Program', 'Alias of notes/Atlas.md', 'Atlas Program]]']],
    );
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

suite('Linking to a related note', () => {
  const index = buildWorkspaceIndex(
    new Map(
      Object.entries({
        'notes/Atlas.md': [
          '# Atlas',
          'The program.',
          '## Check-in #project/atlas',
          'Notes from the call.',
          'The lift is still stuck #risk/vendor.',
        ].join('\n'),
        'notes/Harbor.md': '# Harbor\n## Check-in\nAnother one.',
        'archive/Harbor.md': '# Harbor\nThe old one.',
      }).map(([path, content]) => [path, parseMarkdown(path, content)]),
    ),
  );
  const sectionAt = (filePath: string, heading: string): string | undefined =>
    [...index.sections.values()].find(
      (section) => section.filePath === filePath && section.heading.startsWith(heading),
    )?.id;

  test('names the heading the entry was written under, without its tags', () => {
    assert.deepStrictEqual(
      createWikiLink(index, 'notes/Atlas.md', sectionAt('notes/Atlas.md', 'Check-in')),
      { text: '[[Atlas#Check-in]]' },
    );
  });

  test('leaves out a heading that only repeats the note title', () => {
    assert.deepStrictEqual(
      createWikiLink(index, 'notes/Atlas.md', sectionAt('notes/Atlas.md', 'Atlas')),
      { text: '[[Atlas]]' },
    );
    assert.deepStrictEqual(createWikiLink(index, 'notes/Atlas.md', undefined), {
      text: '[[Atlas]]',
    });
  });

  test('climbs from a tagged line to the heading above it', () => {
    const line = [...index.sections.values()].find(
      (section) => section.isInline && section.filePath === 'notes/Atlas.md',
    );
    assert.ok(line, 'the note has a tagged line of its own beneath the heading');
    assert.strictEqual(
      createWikiLink(index, 'notes/Atlas.md', line.id).text,
      '[[Atlas#Check-in]]',
    );
  });

  test('says when the name it has to write means more than one note', () => {
    const link = createWikiLink(
      index,
      'notes/Harbor.md',
      sectionAt('notes/Harbor.md', 'Check-in'),
    );
    assert.strictEqual(link.text, '[[Harbor#Check-in]]');
    assert.match(link.warning ?? '', /2 notes are called/);
  });
});

function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return {
    files: new Map(
      Object.entries(notes).map(([path, content]) => [path, parseMarkdown(path, content)]),
    ),
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
