import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import * as vscode from 'vscode';

import { parseMarkdown } from '../domain/markdown/parser';
import {
  collectTaggedEntries,
  createEntryRelatedNotesHoverMessage,
  EditorTagDecorations,
  findBandEntry,
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

  test('bands the innermost tagged entry the cursor is in, and nothing outside one', () => {
    const entries = collectTaggedEntries(
      parseMarkdown(
        'notes/atlas.md',
        [
          '# Atlas #project/atlas', // 1
          'Why it matters.', // 2
          '- [ ] Call Ren #risk/vendor', // 3
          '- [ ] Book the room', // 4
          '', // 5
          '# Untagged', // 6
          'Nothing here.', // 7
        ].join('\n'),
      ),
    );
    assert.deepStrictEqual(
      entries.map((entry) => [entry.startLine, entry.endLine]),
      [[1, 5], [3, 3], [4, 4]],
      'the tagged section and its tasks, which carry its tag, not the untagged section',
    );
    assert.strictEqual(findBandEntry(entries, 3)?.title.trim(), 'Call Ren #risk/vendor');
    assert.strictEqual(findBandEntry(entries, 2)?.startLine, 1, 'the section around the line');
    assert.strictEqual(findBandEntry(entries, 7), undefined);
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

  test('creates a trusted entry-level related-notes hover action', () => {
    const hover = createEntryRelatedNotesHoverMessage(
      'Relay checks',
      'file:///tmp/deckard/relay.md',
      12,
      false,
    );

    assert.strictEqual(
      hover.value.includes('command:deckard.showEntryRelatedNotes'),
      true,
    );
    assert.strictEqual(hover.value.includes('Show related notes for Relay checks'), true);
    // The ranking breakdown is a developer tool, so an ordinary hover leaves
    // it out; deckard.developerMode puts it back.
    assert.strictEqual(hover.value.includes('Debug related notes for Relay checks'), false);
    // The entry is in front of the reader here, so pinning it is offered
    // beside its related notes.
    assert.strictEqual(hover.value.includes('Pin Relay checks to Home'), true);
    assert.strictEqual(hover.value.includes('command:deckard.pinNote'), true);
    assert.deepStrictEqual(hover.isTrusted, {
      enabledCommands: [
        'deckard.showEntryRelatedNotes',
        'deckard.pinNote',
        'deckard.unpinNote',
      ],
    });
  });

  test('offers to unpin an entry that is already pinned', () => {
    const hover = createEntryRelatedNotesHoverMessage(
      'Relay checks',
      'file:///tmp/deckard/relay.md',
      12,
      false,
      true,
    );

    assert.strictEqual(hover.value.includes('Unpin Relay checks from Home'), true);
    assert.strictEqual(hover.value.includes('command:deckard.unpinNote'), true);
  });

  test('offers the ranking breakdown in developer mode', () => {
    const hover = createEntryRelatedNotesHoverMessage(
      'Relay checks',
      'file:///tmp/deckard/relay.md',
      12,
      true,
    );

    assert.strictEqual(hover.value.includes('Debug related notes for Relay checks'), true);
    assert.deepStrictEqual(hover.isTrusted, {
      enabledCommands: [
        'deckard.showEntryRelatedNotes',
        'deckard.pinNote',
        'deckard.unpinNote',
        'deckard.showEntryRelatedNotesDebug',
      ],
    });
  });

});
