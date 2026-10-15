import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import * as vscode from 'vscode';

import {
  createEntryHoverMessage,
  EditorTagDecorations,
  createTagRenameHoverMessage,
  isMarkdownDocument,
} from '../ui/providers/tagDecorations';

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

  test('contributes the band colors for every kind of theme', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'),
    ) as { contributes: { colors: { id: string; defaults: Record<string, string> }[] } };
    for (const id of ['deckard.sectionHighlightBackground', 'deckard.sectionHighlightBorder']) {
      const color = manifest.contributes.colors.find((candidate) => candidate.id === id);
      assert.ok(color, id);
      for (const kind of ['dark', 'light', 'highContrast', 'highContrastLight']) {
        assert.ok(color.defaults[kind], `${id} ${kind}`);
      }
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

  test('offers a tagged entry one short link, to pin it to Home', () => {
    const hover = createEntryHoverMessage({
      documentUri: 'file:///tmp/deckard/relay.md',
      pinLine: 12,
    });

    // Context follows the entry the cursor is in, so the hover offers no
    // related notes, and the link names no entry: the hover sits on it.
    assert.strictEqual(hover.value.includes('showEntryRelatedNotes'), false);
    assert.strictEqual(hover.value.includes('Related'), false);
    assert.strictEqual(hover.value.startsWith('[Pin to Home]('), true);
    assert.strictEqual(hover.value.includes('command:deckard.pinNote'), true);
    assert.deepStrictEqual(hover.isTrusted, {
      enabledCommands: ['deckard.editTask', 'deckard.pinNote', 'deckard.unpinNote'],
    });
  });

  test('offers a task Edit task, at its own line, before Pin to Home', () => {
    const tagged = createEntryHoverMessage({
      documentUri: 'file:///tmp/deckard/relay.md',
      pinLine: 14,
      taskLine: 14,
    });
    assert.strictEqual(tagged.value.startsWith('[Edit task](command:deckard.editTask?'), true);
    assert.strictEqual(tagged.value.includes(encodeURIComponent(JSON.stringify(['file:///tmp/deckard/relay.md', 14]))), true);
    assert.strictEqual(tagged.value.includes(' · [Pin to Home]('), true);

    const untagged = createEntryHoverMessage({
      documentUri: 'file:///tmp/deckard/relay.md',
      taskLine: 15,
    });
    assert.strictEqual(untagged.value.includes('Pin'), false, 'a task with no tag of its own offers no pin');
  });

  test('offers to unpin an entry that is already pinned', () => {
    const hover = createEntryHoverMessage({
      documentUri: 'file:///tmp/deckard/relay.md',
      pinLine: 12,
      pinned: true,
    });

    assert.strictEqual(hover.value.startsWith('[Unpin from Home]('), true);
    assert.strictEqual(hover.value.includes('command:deckard.unpinNote'), true);
  });
});
