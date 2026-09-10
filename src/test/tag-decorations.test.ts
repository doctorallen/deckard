import * as assert from 'assert';

import * as vscode from 'vscode';

import {
  createEntryRelatedNotesHoverMessage,
  EditorTagDecorations,
  createTagRenameHoverMessage,
  isMarkdownDocument,
} from '../ui/commands/tagDecorations';

suite('Tag decorations', () => {
  test('recognizes .md files regardless of language mode', () => {
    assert.strictEqual(
      isMarkdownDocument({
        languageId: 'markdown',
        uri: vscode.Uri.file('/tmp/deckard/notes/readme.md'),
      }),
      true,
    );
    assert.strictEqual(
      isMarkdownDocument({
        languageId: 'plaintext',
        uri: vscode.Uri.file('/tmp/deckard/notes/readme.md'),
      }),
      true,
    );
    assert.strictEqual(
      isMarkdownDocument({
        languageId: 'markdown',
        uri: vscode.Uri.file('/tmp/deckard/notes/readme.txt'),
      }),
      false,
    );
  });

  test('creates overview links for front matter on associated Markdown files', () => {
    const decorations = new EditorTagDecorations();
    try {
      const content = [
        '---',
        'projects: [neon-relay]',
        'people: [mara-vale, ivo-chen]',
        'topics: [operations, risk-management]',
        '---',
        '# Relay protocol',
      ].join('\n');
      const document = {
        languageId: 'plaintext',
        uri: vscode.Uri.file('/tmp/deckard/front-matter.md'),
        getText: () => content,
      } as unknown as vscode.TextDocument;
      const provider = decorations as unknown as {
        provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[];
      };

      const links = provider.provideDocumentLinks(document);
      const projectLink = links.find((link) =>
        decodeURIComponent(link.target?.query ?? '').includes(
          '#project/neon-relay',
        ),
      );
      const operationsLink = links.find((link) =>
        decodeURIComponent(link.target?.query ?? '').includes(
          '#topic/operations',
        ),
      );

      assert.ok(projectLink);
      assert.ok(
        operationsLink,
        links.map((link) => link.target?.toString()).join('\n'),
      );
      assert.deepStrictEqual(
        JSON.parse(decodeURIComponent(projectLink.target?.query ?? '')),
        ['#project/neon-relay'],
      );
      assert.strictEqual(operationsLink.range.start.line, 3);
      assert.strictEqual(operationsLink.range.start.character, 9);
      assert.deepStrictEqual(
        JSON.parse(decodeURIComponent(operationsLink.target?.query ?? '')),
        ['#topic/operations'],
      );
    } finally {
      decorations.dispose();
    }
  });

  test('creates a trusted rename action for tag hovers', () => {
    const hover = createTagRenameHoverMessage(
      '#project/neon-relay',
      '#project/neon-relay',
    );

    assert.strictEqual(
      hover.value.includes('command:deckard.renameTag'),
      true,
    );
    assert.strictEqual(hover.value.includes('command:deckard.showTagOverview'), false);
    assert.deepStrictEqual(hover.isTrusted, {
      enabledCommands: ['deckard.renameTag'],
    });
  });

  test('creates a trusted entry-level related-notes hover action', () => {
    const hover = createEntryRelatedNotesHoverMessage(
      'Relay checks',
      'file:///tmp/deckard/relay.md',
      12,
    );

    assert.strictEqual(
      hover.value.includes('command:deckard.showEntryRelatedNotes'),
      true,
    );
    assert.strictEqual(hover.value.includes('Show related notes for Relay checks'), true);
    assert.deepStrictEqual(hover.isTrusted, {
      enabledCommands: ['deckard.showEntryRelatedNotes'],
    });
  });

});
