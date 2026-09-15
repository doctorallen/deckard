import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import {
  createExcludeMatcher,
  WorkspaceFileAccess,
  WorkspaceScanner,
} from '../core/workspace/scanner';
import { createTagOverviewSnapshot } from '../ui/state/dashboardState';

const defaultPreferences = {
  version: 1 as const,
  favoriteTags: [],
  favoriteEntities: [],
  tagSortMode: 'alphabetical' as const,
  entitySortMode: 'alphabetical' as const,
  tagAccessOrder: [],
  tagAccessCounts: {},
  entityAccessOrder: [],
  entityAccessCounts: {},
  taskOrder: [],
  taskSortMode: 'rank' as const,
  dashboardTaskColumns: 1 as const,
  dashboardNoteColumns: 1 as const,
  dashboardTagColumns: 2 as const,
  dashboardNoteSortMode: 'alphabetical' as const,
  dashboardViewState: {
    mode: 'tasks' as const,
    taskFilter: 'active' as const,
    selectedTaskTags: [],
    taskSearchQuery: '',
    noteSearchQuery: '',
    tagSearchQuery: '',
    taskTagQuery: '',
  },
  renderMode: 'markdown' as const,
  tagOverviewSortMode: 'alphabetical' as const,
  tagOverviewLayout: 'tabs' as const,
  relatedNotesSortMode: 'tags' as const,
  sectionAccessCounts: {},
  savedFilters: [],
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

  test('leaves the templates folder out of the notes', async () => {
    const workspaceUri = vscode.Uri.file('/tmp/deckard-scanner');
    const noteUri = vscode.Uri.joinPath(workspaceUri, 'case.md');
    const templateUri = vscode.Uri.joinPath(workspaceUri, 'templates', 'meeting.md');
    const workspaceFolder = {
      uri: workspaceUri,
      name: 'deckard-scanner',
      index: 0,
    } as vscode.WorkspaceFolder;
    const scanner = new WorkspaceScanner({
      workspaceFolders: [workspaceFolder],
      findFiles: async () => [noteUri, templateUri],
      readFile: async () => Buffer.from('# Meeting #project/atlas\n- [ ] Agenda', 'utf8'),
    });

    const files = await scanner.scan();

    assert.deepStrictEqual(files.map((file) => file.filePath), ['case.md']);
    assert.strictEqual(scanner.isNotesFile(noteUri), true);
    assert.strictEqual(scanner.isNotesFile(templateUri), false);
    assert.strictEqual(
      scanner.getTemplatesFolderUri(workspaceFolder)?.path,
      templateUri.path.replace(/\/meeting\.md$/, ''),
    );
  });

  test('reads exclude patterns the way VS Code reads files.exclude', () => {
    const isExcluded = createExcludeMatcher({
      '**/archive': true,
      'drafts/*.md': true,
      'scratch/*': true,
      journal: false,
      '': true,
    });

    assert.strictEqual(isExcluded('archive/old.md'), true);
    assert.strictEqual(isExcluded('notes/archive/2024/old.md'), true);
    assert.strictEqual(isExcluded('.trash/archive/old.md'), true);
    assert.strictEqual(isExcluded('notes/archived.md'), false);
    assert.strictEqual(isExcluded('drafts/idea.md'), true);
    assert.strictEqual(isExcluded('drafts/nested/idea.md'), false);
    assert.strictEqual(isExcluded('scratch/.todo.md'), true);
    assert.strictEqual(isExcluded('journal/today.md'), false);
    assert.strictEqual(createExcludeMatcher(undefined)('archive/old.md'), false);
    assert.strictEqual(createExcludeMatcher(['archive'])('archive/old.md'), false);
    assert.strictEqual(
      createExcludeMatcher({ archive: false }, { '**/archive': true })('archive/old.md'),
      true,
    );
  });

  test('leaves out notes that deckard.exclude or files.exclude matches', async () => {
    const workspaceUri = vscode.Uri.file('/tmp/deckard-exclude');
    const noteUri = vscode.Uri.joinPath(workspaceUri, 'notes', 'case.md');
    const archivedUri = vscode.Uri.joinPath(workspaceUri, 'notes', 'archive', 'old.md');
    const hiddenUri = vscode.Uri.joinPath(workspaceUri, 'notes', 'hidden', 'secret.md');
    const workspaceFolder = {
      uri: workspaceUri,
      name: 'deckard-exclude',
      index: 0,
    } as vscode.WorkspaceFolder;
    const scanner = new WorkspaceScanner({
      workspaceFolders: [workspaceFolder],
      // The fake returns every file, as a note saved in a hidden folder
      // reaches the scanner through a watcher or save event.
      findFiles: async () => [noteUri, archivedUri, hiddenUri],
      readFile: async () => Buffer.from('# Case #project/atlas', 'utf8'),
    });
    const configuration = vscode.workspace.getConfiguration('deckard');
    const filesConfiguration = vscode.workspace.getConfiguration('files');
    await configuration.update(
      'exclude',
      { '**/archive': true },
      vscode.ConfigurationTarget.Global,
    );
    await filesConfiguration.update(
      'exclude',
      { '**/hidden': true },
      vscode.ConfigurationTarget.Global,
    );

    try {
      const files = await scanner.scan();

      assert.deepStrictEqual(files.map((file) => file.filePath), ['notes/case.md']);
      assert.strictEqual(scanner.isNotesFile(noteUri), true);
      assert.strictEqual(scanner.isNotesFile(archivedUri), false);
      assert.strictEqual(scanner.isNotesFile(hiddenUri), false);
    } finally {
      await configuration.update(
        'exclude',
        undefined,
        vscode.ConfigurationTarget.Global,
      );
      await filesConfiguration.update(
        'exclude',
        undefined,
        vscode.ConfigurationTarget.Global,
      );
    }
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
      true,
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
    assert.deepStrictEqual(index.tags.get('#shared')?.sectionIds.length, 2);
    assert.deepStrictEqual(index.tags.get('#shared')?.taskIds.length, 2);
    assert.strictEqual(index.tags.get('#shared')?.count, 2);
    assert.strictEqual(index.tags.get('@done')?.count, 1);
    assert.strictEqual(index.entities.get('@done')?.kind, 'person');
    assert.strictEqual(index.entities.get('@done')?.count, 1);
  });

  test('counts inherited entity tasks once with their section', () => {
    const note = parseMarkdown(
      'notes/atlas.md',
      '# Atlas #project/atlas\n\n- [ ] Publish the field brief',
    );
    const index = buildWorkspaceIndex(new Map([[note.filePath, note]]));

    assert.strictEqual(index.entities.get('#project/atlas')?.count, 1);
  });

  test('weights direct co-occurrence above heading proximity', () => {
    const parsed = parseMarkdown(
      'notes/relationships.md',
      [
        '# Relay map #parent/alpha #parent/beta',
        '## Un tagged operating notes',
        '### Signal route #child/alpha #child/beta',
        '- [ ] Review route #child/alpha #task/review',
        'Tagged line #child/alpha #line/evidence',
        '# Alternate relay #parent/alpha',
        '## Signal route #child/alpha',
        '# Repeated marker #same',
        '## Nested repeated marker #same',
      ].join('\n'),
    );
    const index = buildWorkspaceIndex(new Map([[parsed.filePath, parsed]]));

    const childAssociations = index.tagAssociations?.get('#child/alpha') ?? [];
    assert.deepStrictEqual(
      childAssociations.map((association) => ({
        key: association.associatedTag.key,
        weight: association.weight,
        coOccurrenceCount: association.coOccurrenceCount,
        headingRelationshipCount: association.headingRelationshipCount,
      })),
      [
        { key: '#child/beta', weight: 1, coOccurrenceCount: 1, headingRelationshipCount: 0 },
        { key: '#line/evidence', weight: 1, coOccurrenceCount: 1, headingRelationshipCount: 0 },
        { key: '#task/review', weight: 1, coOccurrenceCount: 1, headingRelationshipCount: 0 },
        { key: '#parent/alpha', weight: 0.75, coOccurrenceCount: 0, headingRelationshipCount: 2 },
        { key: '#parent/beta', weight: 0.25, coOccurrenceCount: 0, headingRelationshipCount: 1 },
      ],
    );
    assert.deepStrictEqual(
      index.tagAssociations?.get('#same') ?? [],
      [],
    );
  });

  test('does not associate tags on separate headings or inherited front matter', () => {
    const parsed = parseMarkdown(
      'notes/association-boundaries.md',
      [
        '---',
        'project: Relay map',
        '---',
        '# First route #first',
        '# Second route #second',
        'Separate line #third',
        'Another line #fourth',
      ].join('\n'),
    );
    const index = buildWorkspaceIndex(new Map([[parsed.filePath, parsed]]));
    assert.deepStrictEqual(index.tagAssociations?.get('#first') ?? [], []);
    assert.deepStrictEqual(index.tagAssociations?.get('#third') ?? [], []);
    assert.deepStrictEqual(index.tagAssociations?.get('#project/relay-map') ?? [], []);
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
      '#work',
    );

    assert.ok(snapshot);
    assert.strictEqual(snapshot.sections.length, 1);
    assert.strictEqual(snapshot.sections[0].startLine, 1);
  });

  test('indexes front-matter entities without a heading or task', () => {
    const parsed = parseMarkdown(
      'notes/metadata-only.md',
      [
        '---',
        'projects: [neon-relay]',
        'topics: [operations]',
        '---',
        'A note described only by its metadata.',
      ].join('\n'),
    );
    const index = buildWorkspaceIndex(
      new Map([[parsed.filePath, parsed]]),
    );

    assert.deepStrictEqual(parsed.frontmatterTags, [
      { key: '#project/neon-relay', label: '#project/neon-relay' },
      { key: '#topic/operations', label: '#topic/operations' },
    ]);
    assert.deepStrictEqual(index.tags.get('#project/neon-relay')?.filePaths, [
      'notes/metadata-only.md',
    ]);
    assert.strictEqual(index.tags.get('#project/neon-relay')?.count, 1);
    assert.strictEqual(index.entities.get('#project/neon-relay')?.count, 1);
    const snapshot = createTagOverviewSnapshot(
      index,
      defaultPreferences,
      '#project/neon-relay',
    );
    assert.ok(snapshot);
    assert.strictEqual(snapshot.sections.length, 1);
    assert.strictEqual(snapshot.sections[0].heading, 'metadata-only.md');
  });

  test('collects the notes that describe a tag, first by path', () => {
    const files = [
      ['notes/b.md', '---\ndescribes: project/atlas\n---\n# B'],
      ['notes/a.md', '---\ndescribes: project/atlas\n---\n# A'],
      ['notes/c.md', '# C #project/atlas'],
    ].map(([filePath, content]) => parseMarkdown(filePath, content));
    const index = buildWorkspaceIndex(
      new Map(files.map((file) => [file.filePath, file])),
    );

    assert.deepStrictEqual(index.tags.get('#project/atlas')?.hubFilePaths, [
      'notes/a.md',
      'notes/b.md',
    ]);
  });
});
