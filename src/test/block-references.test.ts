import * as assert from 'assert';

import * as vscode from 'vscode';

import { findBlockIds, findFencedLines, parseMarkdown } from '../core/markdown/parser';
import { WorkspaceIndex } from '../core/types';
import {
  buildBacklinkIndex,
  parseWikiTarget,
} from '../core/workspace/backlinks';
import {
  findWikiLinkTargets,
  getBlockCompletionContext,
  WikiLinkCompletionProvider,
} from '../ui/commands/linkSuggestions';
import { createLinkPreview } from '../ui/state/referenceState';

/**
 * Links that name one line of a note rather than the whole note or one of its
 * headings: `[[Note#^lift-slip]]`, written the way Obsidian writes them.
 *
 * Deckard reads the markers and follows the links. It does not write markers
 * into anyone's prose, so a note is only as marked up as its author made it.
 */
suite('Block references', () => {
  const NOTE = [
    '# Check-in #project/atlas',
    '',
    '## Vendor review',
    'The lift survey slipped because the contractor never confirmed. ^lift-slip',
    'Nothing to point at here.',
    '',
    '```',
    'Fenced text. ^fenced',
    '```',
    '',
    '- [ ] Chase the contract @dana ^chase',
    'A caret ^ alone is not a marker, nor is one ^mid-line followed by words.',
  ].join('\n');

  const indexOf = (notes: Record<string, string>): WorkspaceIndex => ({
    files: new Map(
      Object.entries(notes).map(([path, content]) => [
        path,
        parseMarkdown(path, content),
      ]),
    ),
    sections: new Map(),
    tasks: new Map(),
    tags: new Map(),
    entities: new Map(),
    updatedAt: Date.now(),
  });

  test('reads the markers a note carries, and only those', () => {
    const lines = NOTE.split('\n');
    const blockIds = findBlockIds(lines, findFencedLines(lines));

    assert.deepStrictEqual(blockIds, { 'lift-slip': 4, chase: 11 });
  });

  test('keeps the first of a repeated marker, because a link means one line', () => {
    const lines = ['First. ^same', 'Second. ^same'];
    assert.deepStrictEqual(findBlockIds(lines, new Set()), { same: 1 });
  });

  test('carries the markers on the parsed note', () => {
    const file = parseMarkdown('notes/check-in.md', NOTE);
    assert.deepStrictEqual(file.blockIds, { 'lift-slip': 4, chase: 11 });

    // A note with nothing marked carries nothing, rather than an empty map
    // every note would then have to be asked about.
    assert.strictEqual(parseMarkdown('notes/plain.md', '# Plain\nProse.').blockIds, undefined);
  });

  test('tells a line from a heading in what a link names', () => {
    assert.deepStrictEqual(parseWikiTarget('Check-in#^lift-slip'), {
      note: 'Check-in',
      block: 'lift-slip',
    });
    assert.deepStrictEqual(parseWikiTarget('Check-in#Vendor review'), {
      note: 'Check-in',
      heading: 'Vendor review',
    });
    // `[[#^id]]` names a line of the note the link is written in.
    assert.deepStrictEqual(parseWikiTarget('#^lift-slip'), {
      note: '',
      block: 'lift-slip',
    });
    // A caret with nothing after it names nothing.
    assert.deepStrictEqual(parseWikiTarget('Check-in#^'), { note: 'Check-in' });
  });

  test('opens a note at the line a link names', () => {
    const index = indexOf({ 'notes/Check-in.md': NOTE });

    const [link] = findWikiLinkTargets(
      'See [[Check-in#^lift-slip]].',
      index,
      'notes/other.md',
    );

    assert.strictEqual(link.filePath, 'notes/Check-in.md');
    assert.strictEqual(link.line, 4);
  });

  test('opens the note itself when the line it names is gone', () => {
    const index = indexOf({ 'notes/Check-in.md': NOTE });

    const [link] = findWikiLinkTargets(
      'See [[Check-in#^never-written]].',
      index,
      'notes/other.md',
    );

    assert.strictEqual(link.filePath, 'notes/Check-in.md');
    assert.strictEqual(link.line, undefined, 'the link still opens the note');
  });

  test('previews the line, under the headings it sits beneath', () => {
    const index = indexOf({ 'notes/Check-in.md': NOTE });
    const backlinks = buildBacklinkIndex(index);

    const preview = createLinkPreview(
      index,
      backlinks,
      parseWikiTarget('Check-in#^lift-slip'),
      'notes/other.md',
    );

    assert.strictEqual(preview.kind, 'found');
    if (preview.kind !== 'found') {
      return;
    }
    assert.strictEqual(preview.line, 4);
    assert.match(preview.excerpt, /The lift survey slipped/);
    // The marker is how the line is addressed, not part of what it says.
    assert.ok(!preview.excerpt.includes('^lift-slip'));
    assert.match(preview.title, /Vendor review/);
    assert.strictEqual(preview.missingBlock, undefined);
  });

  test('says when the line a link names is not there', () => {
    const index = indexOf({ 'notes/Check-in.md': NOTE });

    const preview = createLinkPreview(
      index,
      buildBacklinkIndex(index),
      parseWikiTarget('Check-in#^never-written'),
      'notes/other.md',
    );

    assert.strictEqual(preview.kind, 'found');
    if (preview.kind !== 'found') {
      return;
    }
    assert.strictEqual(preview.missingBlock, 'never-written');
    assert.strictEqual(preview.line, 1, 'the preview shows the note itself');
  });

  test('counts the links written to one line', () => {
    const index = indexOf({
      'notes/Check-in.md': NOTE,
      'notes/plan.md': 'Rested on [[Check-in#^lift-slip]].',
      'notes/other.md': 'Also [[Check-in#^lift-slip]] and [[Check-in#^chase]].',
    });

    const backlinks = buildBacklinkIndex(index);

    assert.deepStrictEqual(
      backlinks
        .toBlock('notes/Check-in.md', 'lift-slip')
        .map((link) => link.sourcePath)
        .sort(),
      ['notes/other.md', 'notes/plan.md'],
    );
    assert.strictEqual(
      backlinks.toBlock('notes/Check-in.md', 'chase').length,
      1,
    );
    assert.strictEqual(backlinks.toNote('notes/Check-in.md').length, 3);
  });

  test('completes a note\'s markers past a caret', async () => {
    const index = indexOf({ 'notes/Check-in.md': NOTE });
    const provider = new WikiLinkCompletionProvider({
      ready: Promise.resolve(),
      getSnapshot: () => index,
      getFilePath: () => 'notes/other.md',
    });
    const line = 'See [[Check-in#^';
    const document = createDocument('/tmp/deckard/notes/other.md', line);

    const items = await provider.provideCompletionItems(
      document,
      new vscode.Position(0, line.length),
    );

    assert.deepStrictEqual(
      items.map((item) => item.label),
      ['^chase', '^lift-slip'],
    );
    // The line says more about a marker than its name does.
    assert.match(String(items[1].detail), /The lift survey slipped/);
    assert.strictEqual(items[1].insertText, '^lift-slip]]');
    provider.dispose();
  });

  test('narrows the markers it offers as the id is typed', async () => {
    const index = indexOf({ 'notes/Check-in.md': NOTE });
    const provider = new WikiLinkCompletionProvider({
      ready: Promise.resolve(),
      getSnapshot: () => index,
      getFilePath: () => 'notes/other.md',
    });
    const line = 'See [[Check-in#^lift';
    const items = await provider.provideCompletionItems(
      createDocument('/tmp/deckard/notes/other.md', line),
      new vscode.Position(0, line.length),
    );

    assert.deepStrictEqual(
      items.map((item) => item.label),
      ['^lift-slip'],
    );
    provider.dispose();
  });

  test('knows when a caret is being typed, and for which note', () => {
    assert.deepStrictEqual(getBlockCompletionContext('Check-in#^li'), {
      note: 'Check-in',
      query: 'li',
    });
    assert.deepStrictEqual(getBlockCompletionContext('#^'), {
      note: '',
      query: '',
    });
    assert.strictEqual(getBlockCompletionContext('Check-in#Vendor'), undefined);
    assert.strictEqual(getBlockCompletionContext('Check-in'), undefined);
  });
});

function createDocument(uriPath: string, text: string): vscode.TextDocument {
  return {
    uri: vscode.Uri.file(uriPath),
    lineAt: () => ({ text }),
  } as unknown as vscode.TextDocument;
}
