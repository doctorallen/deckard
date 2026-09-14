import * as assert from 'assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { WorkspaceIndex } from '../core/types';
import {
  CREATE_LINKED_NOTE_COMMAND,
  createNoteNamed,
  findLinkProblems,
  LinkHealth,
} from '../ui/commands/linkHealth';

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

suite('Link health', () => {
  const index = indexOf({
    'notes/Atlas.md': '---\naliases: [Atlas Program]\n---\n# Atlas\n## Decision',
    'notes/People.md': '# People',
    'archive/People.md': '# People',
  });

  test('finds links to a missing note or a name several notes share', () => {
    const content = [
      'See [[Atlas]], [[atlas program|the program]], [[Atlas#Nowhere]], and [[#Decision]].',
      'Ask [[People]] about [[Q3 Planning]].',
      '```',
      '[[Inside a fence]]',
      '```',
    ].join('\n');

    assert.deepStrictEqual(findLinkProblems(content, index, 'notes/Log.md'), [
      {
        line: 1,
        startColumn: 4,
        endColumn: 14,
        name: 'People',
        kind: 'ambiguous',
        paths: ['archive/People.md', 'notes/People.md'],
      },
      {
        line: 1,
        startColumn: 21,
        endColumn: 36,
        name: 'Q3 Planning',
        kind: 'missing',
        paths: [],
      },
    ]);
  });

  test('marks an open note and offers to create a missing one', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'deckard-links-'));
    const file = join(directory, 'Log.md');
    writeFileSync(file, 'Ask [[People]] about [[Q3 Planning]].\n');
    const updates = new vscode.EventEmitter<unknown>();
    const health = new LinkHealth({
      ready: Promise.resolve(),
      onDidUpdate: updates.event,
      getSnapshot: () => index,
      getFilePath: () => 'notes/Log.md',
      isNotesFile: () => true,
      getNotesFolderUri: () => vscode.Uri.file(directory),
    });
    try {
      await health.ready;
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      health.check(document);

      const diagnostics = vscode.languages
        .getDiagnostics(document.uri)
        .filter((diagnostic) => diagnostic.source === 'Deckard');
      assert.deepStrictEqual(
        diagnostics.map((diagnostic) => [
          diagnostic.code,
          diagnostic.severity,
          diagnostic.range.start.character,
        ]),
        [
          ['ambiguous-note', vscode.DiagnosticSeverity.Warning, 4],
          ['missing-note', vscode.DiagnosticSeverity.Information, 21],
        ],
      );

      const actions = health.provideCodeActions(document, {
        diagnostics,
        only: undefined,
        triggerKind: vscode.CodeActionTriggerKind.Invoke,
      });
      assert.deepStrictEqual(
        actions.map((action) => [action.title, action.command?.command, action.command?.arguments]),
        [
          [
            'Create note "Q3 Planning"',
            CREATE_LINKED_NOTE_COMMAND,
            [document.uri.toString(), 'Q3 Planning'],
          ],
        ],
      );
    } finally {
      health.dispose();
      updates.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('creates the note a link names without replacing one', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'deckard-links-'));
    const notes = vscode.Uri.file(join(directory, 'notes'));
    try {
      const uri = await createNoteNamed(notes, 'Q3 Planning');
      assert.ok(uri);
      assert.strictEqual(uri.fsPath, join(directory, 'notes', 'Q3 Planning.md'));
      assert.strictEqual(readFileSync(uri.fsPath, 'utf8'), '# Q3 Planning\n\n');

      writeFileSync(uri.fsPath, 'Kept');
      await createNoteNamed(notes, 'Q3 Planning');
      assert.strictEqual(readFileSync(uri.fsPath, 'utf8'), 'Kept', 'an existing note is kept');
      assert.strictEqual(await createNoteNamed(notes, 'plans/Q3'), undefined);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
