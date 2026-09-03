import * as assert from 'assert';

import * as vscode from 'vscode';

import { isMarkdownDocument } from '../ui/commands/tagDecorations';

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
});
