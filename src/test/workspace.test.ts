import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import {
  WorkspaceFileAccess,
  WorkspaceScanner,
} from '../core/workspace/scanner';
import { createTagOverviewSnapshot } from '../ui/state/dashboardState';

const defaultPreferences = {
  version: 1 as const,
  favoriteTags: [],
  tagSortMode: 'alphabetical' as const,
  tagAccessOrder: [],
  tagAccessCounts: {},
  taskOrder: [],
  taskSortMode: 'rank' as const,
  renderMode: 'markdown' as const,
  tagOverviewSortMode: 'alphabetical' as const,
  sectionAccessCounts: {},
};

suite('Workspace scanner and index', () => {
  test('keeps case-variant Windows paths under one workspace-relative key', () => {
    if (process.platform !== 'win32') {
      return;
    }

    const workspaceUri = vscode.Uri.file('C:\\Temp\\Deckard');
    const workspaceFolder = {
      uri: workspaceUri,
      name: 'deckard',
      index: 0,
    } as vscode.WorkspaceFolder;
    const scanner = new WorkspaceScanner({
      workspaceFolders: [workspaceFolder],
      findFiles: async () => [],
      readFile: async () => Buffer.from('', 'utf8'),
    });

    assert.strictEqual(
      scanner.getFilePath(vscode.Uri.file('c:\\temp\\deckard\\notes\\case.md')),
      'notes/case.md',
    );
  });

  test('reads notes with workspace-relative paths', async () => {
    const workspaceUri = vscode.Uri.file('/tmp/deckard-scanner');
    const noteUri = vscode.Uri.joinPath(workspaceUri, 'notes', 'case.md');
    const textUri = vscode.Uri.joinPath(workspaceUri, 'notes', 'case.txt');
    const workspaceFolder = {
      uri: workspaceUri,
      name: 'deckard-scanner',
      index: 0,
    } as vscode.WorkspaceFolder;
    const access: WorkspaceFileAccess = {
      workspaceFolders: [workspaceFolder],
      findFiles: async () => [noteUri, textUri],
      readFile: async () =>
        Buffer.from('# Case @work\n\n- [ ] Follow lead', 'utf8'),
      stat: async () => ({ ctime: 10, mtime: 20 }) as vscode.FileStat,
    };

    const scanner = new WorkspaceScanner(access);
    const files = await scanner.scan();

    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].filePath, 'notes/case.md');
    assert.strictEqual(files[0].tasks[0].filePath, 'notes/case.md');
    assert.strictEqual(files[0].createdAt, 10);
    assert.strictEqual(files[0].updatedAt, 20);
    assert.strictEqual(files[0].sections[0].createdAt, 10);
    assert.strictEqual(files[0].sections[0].updatedAt, 20);
    assert.strictEqual(files[0].tasks[0].createdAt, 10);
    assert.strictEqual(files[0].tasks[0].updatedAt, 20);
    assert.strictEqual(scanner.isNotesFile(noteUri), true);
    assert.strictEqual(scanner.isNotesFile(textUri), false);
    assert.strictEqual(
      scanner.isNotesFile(vscode.Uri.joinPath(workspaceUri, 'README.md')),
      false,
    );
  });

  test('does not parse non-Markdown files', () => {
    const scanner = new WorkspaceScanner({
      findFiles: async () => [],
      readFile: async () => Buffer.from('', 'utf8'),
    });
    const textUri = vscode.Uri.file('/tmp/deckard-scanner/notes/case.txt');

    assert.throws(
      () => scanner.parse(textUri, '# Not Markdown'),
      /only parses Markdown files/,
    );
  });

  test('aggregates sections, tasks, and tags into one index', () => {
    const first = parseMarkdown(
      'notes/first.md',
      '# First #shared\n\n- [ ] One',
    );
    const second = parseMarkdown(
      'notes/second.md',
      '# Second #shared\n\n- [x] Two @done',
    );
    const index = buildWorkspaceIndex(
      new Map([
        [first.filePath, first],
        [second.filePath, second],
      ]),
    );

    assert.strictEqual(index.sections.size, 2);
    assert.strictEqual(index.tasks.size, 2);
    assert.deepStrictEqual(index.tags.get('shared')?.sectionIds.length, 2);
    assert.deepStrictEqual(index.tags.get('shared')?.taskIds.length, 2);
    assert.strictEqual(index.tags.get('shared')?.count, 2);
    assert.strictEqual(index.tags.get('done')?.count, 1);
  });

  test('carries inline-only notes from scanner into tag overview', () => {
    const workspaceUri = vscode.Uri.file('/tmp/deckard-inline-overview');
    const noteUri = vscode.Uri.joinPath(
      workspaceUri,
      'notes',
      'inline-only.md',
    );
    const workspaceFolder = {
      uri: workspaceUri,
      name: 'deckard-inline-overview',
      index: 0,
    } as vscode.WorkspaceFolder;
    const access: WorkspaceFileAccess = {
      workspaceFolders: [workspaceFolder],
      findFiles: async () => [noteUri],
      readFile: async () => Buffer.from('Inline note #work', 'utf8'),
    };

    const scanner = new WorkspaceScanner(access);
    const parsed = scanner.parse(noteUri, 'Inline note #work');
    const index = buildWorkspaceIndex(new Map([[parsed.filePath, parsed]]));
    const snapshot = createTagOverviewSnapshot(
      index,
      defaultPreferences,
      'work',
    );

    assert.ok(snapshot);
    assert.strictEqual(snapshot.sections.length, 1);
    assert.strictEqual(snapshot.sections[0].startLine, 1);
  });
});
