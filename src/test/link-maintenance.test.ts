import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { WorkspaceIndex } from '../core/types';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import {
  applyLinkRewrites,
  findHeadingAtLine,
  LinkMaintenance,
  planHeadingRenameRewrites,
  planNoteRenameRewrites,
} from '../ui/commands/linkMaintenance';

function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(
      Object.entries(notes).map(([filePath, content]) => [
        filePath,
        parseMarkdown(filePath, content),
      ]),
    ),
  );
}

/** What each rewrite does, as the note reads before and after it. */
function rewritten(
  rewrites: readonly { filePath: string; from: string; text: string }[],
): string[] {
  return rewrites.map(
    (rewrite) => `${rewrite.filePath}: ${rewrite.from} -> ${rewrite.text}`,
  );
}

suite('Link maintenance', () => {
  const index = indexOf({
    'notes/Atlas.md': [
      '---',
      'aliases: [Atlas Program]',
      '---',
      '# Atlas',
      '',
      '## Decision',
      '',
      'Back to [[#Decision]] and the [[Vendor review]].',
    ].join('\n'),
    'notes/Log.md': [
      'Read [[Atlas]] and [[Atlas#Decision]] and [[Atlas#^k1|the line]].',
      'Also [[atlas]] lowercase, [[Atlas Program]] by alias.',
      '```',
      '[[Atlas]] inside a fence',
      '```',
    ].join('\n'),
    'archive/Atlas.md': '# Atlas\n\nThe old one.',
    'notes/Vendor review.md': '# Vendor review',
  });

  test('carries every link to a renamed note, keeping what was written around it', () => {
    assert.deepStrictEqual(
      rewritten(planNoteRenameRewrites(index, 'notes/Log.md', 'Journal')),
      [],
      'no link names the Log',
    );

    // Atlas is ambiguous with archive/Atlas.md, so no link resolves to it and
    // none is rewritten. A unique note is the case that matters.
    const unique = indexOf({
      'notes/Vendor review.md': '# Vendor review',
      'notes/Log.md': [
        'Read [[Vendor review]], [[Vendor review#Terms]], and',
        '[[vendor review|the review]] plus [[Vendor review#^k1]].',
        '```',
        '[[Vendor review]] inside a fence',
        '```',
      ].join('\n'),
    });
    assert.deepStrictEqual(
      rewritten(
        planNoteRenameRewrites(unique, 'notes/Vendor review.md', 'Supplier review'),
      ),
      [
        'notes/Log.md: [[Vendor review]] -> [[Supplier review]]',
        'notes/Log.md: [[Vendor review#Terms]] -> [[Supplier review#Terms]]',
        'notes/Log.md: [[vendor review|the review]] -> [[Supplier review|the review]]',
        'notes/Log.md: [[Vendor review#^k1]] -> [[Supplier review#^k1]]',
      ],
    );
  });

  test('leaves alias links, and links to the note that keeps the name, alone', () => {
    const rewrites = planNoteRenameRewrites(
      index,
      'archive/Atlas.md',
      'Atlas 2024',
    );
    assert.deepStrictEqual(
      rewritten(rewrites),
      [],
      'two notes are named Atlas, so no link resolves to either',
    );

    const aliased = indexOf({
      'notes/Atlas.md': '---\naliases: [Atlas Program]\n---\n# Atlas',
      'notes/Log.md': 'Read [[Atlas]] and [[Atlas Program]].',
    });
    assert.deepStrictEqual(
      rewritten(planNoteRenameRewrites(aliased, 'notes/Atlas.md', 'Atlas 2026')),
      ['notes/Log.md: [[Atlas]] -> [[Atlas 2026]]'],
      'the alias still resolves, so its link is left as written',
    );
  });

  test('says nothing to do when a note only moves folders', () => {
    assert.deepStrictEqual(
      planNoteRenameRewrites(index, 'notes/Vendor review.md', 'Vendor review'),
      [],
    );
  });

  test('carries the links that name a renamed heading', () => {
    const headings = indexOf({
      'notes/Atlas.md': [
        '# Atlas',
        '',
        '## Decision #project/atlas',
        '',
        'See [[#Decision]].',
      ].join('\n'),
      'notes/Log.md': [
        'Read [[Atlas#Decision]], [[Atlas#decision|the call]], and [[Atlas]].',
        'The line [[Atlas#^k1]] is not a heading.',
      ].join('\n'),
    });

    assert.deepStrictEqual(
      rewritten(
        planHeadingRenameRewrites(
          headings,
          'notes/Atlas.md',
          'Decision #project/atlas',
          'Decision to sign',
        ),
      ),
      [
        'notes/Atlas.md: [[#Decision]] -> [[#Decision to sign]]',
        'notes/Log.md: [[Atlas#Decision]] -> [[Atlas#Decision to sign]]',
        'notes/Log.md: [[Atlas#decision|the call]] -> [[Atlas#Decision to sign|the call]]',
      ],
    );
  });

  test('finds the heading a line sits in', () => {
    const file = parseMarkdown(
      'notes/Atlas.md',
      '# Atlas\n\nIntro.\n\n## Decision\n\nBody.\n',
    );
    assert.strictEqual(findHeadingAtLine(file.sections, 3)?.heading, 'Atlas');
    assert.strictEqual(findHeadingAtLine(file.sections, 7)?.heading, 'Decision');
    assert.strictEqual(findHeadingAtLine([], 1), undefined);
  });

  test('rewrites the notes on disk, and skips a link that has since changed', async () => {
    const root = await createTemporaryRoot();
    const write = async (name: string, content: string): Promise<string> => {
      const uri = vscode.Uri.joinPath(root, name);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
      return uri.fsPath;
    };
    const logPath = await write('Log.md', 'Read [[Vendor review]] today.\n');
    const movedPath = await write('Moved.md', 'Read [[Vendor review]] too.\n');
    const reviewPath = await write('Vendor review.md', '# Vendor review\n');
    const onDisk = indexOf({
      [logPath]: 'Read [[Vendor review]] today.\n',
      [movedPath]: 'Read [[Vendor review]] too.\n',
      [reviewPath]: '# Vendor review\n',
    });

    const rewrites = planNoteRenameRewrites(
      onDisk,
      reviewPath,
      'Supplier review',
    );
    // The note moved on between planning and applying: its link is gone.
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(movedPath),
      Buffer.from('Read [[Something else]] now.\n', 'utf8'),
    );

    const updated = await applyLinkRewrites(rewrites);
    const read = async (file: string): Promise<string> =>
      Buffer.from(
        await vscode.workspace.fs.readFile(vscode.Uri.file(file)),
      ).toString('utf8');

    assert.strictEqual(updated, 1);
    assert.strictEqual(await read(logPath), 'Read [[Supplier review]] today.\n');
    assert.strictEqual(
      await read(movedPath),
      'Read [[Something else]] now.\n',
      'the note that changed is left as its author left it',
    );
    await deleteTemporaryRoot(root);
  });

  test('plans the rename of a note as one edit over the workspace', async () => {
    const root = await createTemporaryRoot();
    const logUri = vscode.Uri.joinPath(root, 'Log.md');
    const reviewUri = vscode.Uri.joinPath(root, 'Vendor review.md');
    await vscode.workspace.fs.writeFile(
      logUri,
      Buffer.from('Read [[Vendor review]] today.\n', 'utf8'),
    );
    await vscode.workspace.fs.writeFile(
      reviewUri,
      Buffer.from('# Vendor review\n', 'utf8'),
    );
    const snapshot = indexOf({
      [logUri.fsPath]: 'Read [[Vendor review]] today.\n',
      [reviewUri.fsPath]: '# Vendor review\n',
    });
    const maintenance = new LinkMaintenance({
      ready: Promise.resolve(),
      getSnapshot: () => snapshot,
      getFilePath: (uri) => uri.fsPath,
      isNotesFile: () => true,
    });

    try {
      const edit = await maintenance.planRenames([
        {
          oldUri: reviewUri,
          newUri: vscode.Uri.joinPath(root, 'Supplier review.md'),
        },
      ]);
      const entries = edit.entries();
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0][0].fsPath, logUri.fsPath);
      assert.strictEqual(entries[0][1][0].newText, '[[Supplier review]]');

      const ignored = await maintenance.planRenames([
        {
          oldUri: vscode.Uri.joinPath(root, 'Notes.txt'),
          newUri: vscode.Uri.joinPath(root, 'Other.txt'),
        },
      ]);
      assert.strictEqual(ignored.entries().length, 0);
    } finally {
      maintenance.dispose();
      await deleteTemporaryRoot(root);
    }
  });
});

async function createTemporaryRoot(): Promise<vscode.Uri> {
  const directoryName = `deckard-links-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const temporaryRoot = vscode.Uri.file(path.join(os.tmpdir(), directoryName));
  await vscode.workspace.fs.createDirectory(temporaryRoot);
  return temporaryRoot;
}

async function deleteTemporaryRoot(temporaryRoot: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.delete(temporaryRoot, {
    recursive: true,
    useTrash: false,
  });
}
