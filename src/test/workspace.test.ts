import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { buildWorkspaceIndex, WorkspaceIndexer } from '../core/workspace/indexer';
import {
  collectExcludePatterns,
  createExcludeMatcher,
  toExcludeGlob,
  WorkspaceFileAccess,
  WorkspaceScanner,
} from '../core/workspace/scanner';
import { createSearchPageSnapshot } from '../ui/state/dashboardState';
import { setTimingLog } from '../core/timing';
import { normalizeIndex } from './indexCorpus';

const defaultPreferences = {
  searchPageSize: 30 as const,
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
  dashboardViewState: {
    mode: 'home' as const,
    tagSearchQuery: '',
  },
  taskBoardLayout: 'board' as const,
  taskBoardGroup: 'status' as const,
  taskBoardTaskFilter: 'active' as const,
  renderMode: 'markdown' as const,
  searchPreview: 'lines' as const,
  tagOverviewSortMode: 'alphabetical' as const,
  tagOverviewLayout: 'tabs' as const,
  relatedNotesSortMode: 'tags' as const,
  sectionAccessCounts: {},
  savedFilters: [],
  dashboardWidgets: [],
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

  test('says which notes it could not read, and why, rather than only logging it', async () => {
    const workspaceUri = vscode.Uri.file('/tmp/deckard-unreadable');
    const good = vscode.Uri.joinPath(workspaceUri, 'good.md');
    const bad = vscode.Uri.joinPath(workspaceUri, 'notes', 'bad.md');
    const workspaceFolder = { uri: workspaceUri, name: 'w', index: 0 } as vscode.WorkspaceFolder;
    const scanner = new WorkspaceScanner({
      workspaceFolders: [workspaceFolder],
      findFiles: async () => [good, bad],
      readFile: async (uri) => {
        if (uri.path === bad.path) {
          throw new Error('EACCES: permission denied, open \'/tmp/deckard-unreadable/notes/bad.md\'\n    at Object.openSync');
        }
        return Buffer.from('# Good #project/atlas', 'utf8');
      },
    });

    const files = await scanner.scan();

    assert.deepStrictEqual(files.map((file) => file.filePath), ['good.md'], 'the readable note is indexed');
    assert.deepStrictEqual(scanner.failures, [
      { filePath: 'notes/bad.md', reason: "EACCES: permission denied, open '/tmp/deckard-unreadable/notes/bad.md'" },
    ], 'one line of reason, not a stack');

    // The indexer carries it to where a reader can see it.
    const indexer = new WorkspaceIndexer(scanner);
    await indexer.refresh();
    assert.deepStrictEqual(indexer.getUnreadable().map((note) => note.filePath), ['notes/bad.md']);
    indexer.dispose();
  });

  test('a save updates only that note in the index, and the index is still the full build', async () => {
    const workspaceUri = vscode.Uri.file('/tmp/deckard-update');
    const workspaceFolder = { uri: workspaceUri, name: 'w', index: 0 } as vscode.WorkspaceFolder;
    const texts = new Map([
      ['a.md', '# A #project/atlas\n- [ ] Task #topic/maps'],
      ['b.md', '# B #project/atlas #topic/maps\n## Child #topic/detail'],
      ['c.md', '---\ntags: [area/home]\n---\nNo headings.'],
    ]);
    const uriOf = (name: string) => vscode.Uri.joinPath(workspaceUri, name);
    const scanner = new WorkspaceScanner({
      workspaceFolders: [workspaceFolder],
      findFiles: async () => [...texts.keys()].map(uriOf),
      readFile: async (uri) => Buffer.from(texts.get(uri.path.split('/').pop() ?? '') ?? '', 'utf8'),
    });
    const indexer = new WorkspaceIndexer(scanner);
    const lines: string[] = [];
    setTimingLog({
      logLevel: 2,
      trace: () => undefined,
      debug: (line) => lines.push(line),
      info: (line) => lines.push(line),
    });
    const controller = indexer as unknown as {
      queueUpsert(uri: vscode.Uri, content?: string, now?: boolean): void;
      queueDelete(uri: vscode.Uri): void;
    };
    const published = () =>
      new Promise<void>((resolve) => {
        const subscription = indexer.onDidUpdate(() => {
          subscription.dispose();
          resolve();
        });
      });
    const fullBuild = () =>
      normalizeIndex(buildWorkspaceIndex(new Map(indexer.getSnapshot().files)));
    try {
      await indexer.refresh();
      assert.ok(lines.some((line) => line.startsWith('Build index')));

      lines.length = 0;
      texts.set('a.md', '# A #project/atlas #topic/new\n- [ ] Task #topic/maps');
      let update = published();
      controller.queueUpsert(uriOf('a.md'), undefined, true);
      await update;
      assert.ok(
        lines.some((line) => /^Update index: .* \(1 note changed, 3 notes\)$/.test(line)),
        lines.join('\n'),
      );
      assert.ok(!lines.some((line) => line.startsWith('Build index')), 'no full build');
      assert.ok(indexer.getSnapshot().tags.has('#topic/new'));
      assert.deepStrictEqual(normalizeIndex(indexer.getSnapshot()), fullBuild());

      texts.delete('b.md');
      update = published();
      controller.queueDelete(uriOf('b.md'));
      await update;
      assert.deepStrictEqual([...indexer.getSnapshot().files.keys()], ['a.md', 'c.md']);
      assert.strictEqual(indexer.getSnapshot().tags.has('#topic/detail'), false);
      assert.deepStrictEqual(normalizeIndex(indexer.getSnapshot()), fullBuild());
    } finally {
      setTimingLog(undefined);
      indexer.dispose();
    }
  });

  test('reads eight notes at a time, keeps the order found, and rereads only what changed', async () => {
    const workspaceUri = vscode.Uri.file('/tmp/deckard-rescan');
    const workspaceFolder = { uri: workspaceUri, name: 'w', index: 0 } as vscode.WorkspaceFolder;
    const names = Array.from({ length: 30 }, (_, index) => `n${index}.md`);
    const texts = new Map(names.map((name, index) => [name, `# Note ${index} #topic/t${index % 4}`]));
    const times = new Map(names.map((name) => [name, 1000]));
    const uriOf = (name: string) => vscode.Uri.joinPath(workspaceUri, name);
    const nameOf = (uri: vscode.Uri) => uri.path.split('/').pop() ?? '';
    let reading = 0;
    let mostAtOnce = 0;
    const reads: string[] = [];
    const scanner = new WorkspaceScanner({
      workspaceFolders: [workspaceFolder],
      findFiles: async () => names.filter((name) => texts.has(name)).map(uriOf),
      readFile: async (uri) => {
        reading += 1;
        mostAtOnce = Math.max(mostAtOnce, reading);
        reads.push(nameOf(uri));
        // Later notes come back sooner, so order is not arrival order.
        await new Promise((resolve) => setTimeout(resolve, 30 - names.indexOf(nameOf(uri))));
        reading -= 1;
        return Buffer.from(texts.get(nameOf(uri)) ?? '', 'utf8');
      },
      stat: async (uri) => ({
        type: vscode.FileType.File,
        ctime: 1,
        mtime: times.get(nameOf(uri)) ?? 0,
        size: Buffer.byteLength(texts.get(nameOf(uri)) ?? '', 'utf8'),
      }),
    });

    const files = await scanner.scan();
    assert.deepStrictEqual(files.map((file) => file.filePath), names, 'in the order found');
    assert.strictEqual(mostAtOnce, 8, 'eight reads at a time, never more');

    const indexer = new WorkspaceIndexer(scanner);
    try {
      await indexer.refresh();
      reads.length = 0;
      await indexer.refresh();
      assert.deepStrictEqual(reads, [], 'a rescan reads no note that has not changed');

      texts.set('n3.md', '# Note 3 changed #topic/new');
      times.set('n3.md', 2000);
      await indexer.refresh();
      assert.deepStrictEqual(reads, ['n3.md'], 'only the note that changed');
      assert.ok(indexer.getSnapshot().tags.has('#topic/new'));
      assert.deepStrictEqual(
        normalizeIndex(indexer.getSnapshot()),
        normalizeIndex(buildWorkspaceIndex(new Map(indexer.getSnapshot().files))),
      );

      reads.length = 0;
      await indexer.refresh({ reuse: 'none' });
      assert.strictEqual(reads.length, names.length, 'Reindex Workspace reads every note');
    } finally {
      indexer.dispose();
    }
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
    assert.deepStrictEqual(scanner.lastScan, { found: 2, templates: 1, excluded: 0, read: 1 }, 'the scan says what it kept out');
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

  test('leaves out what search.exclude hides, unless deckard.exclude takes it back', () => {
    assert.deepStrictEqual(
      collectExcludePatterns(
        { archive: true },
        { '**/.git': true },
        { '**/node_modules': true, '**/*.code-search': { when: 'x' } },
      ),
      ['**/.git', '**/node_modules', 'archive'],
      'a pattern with a when clause is not applied',
    );
    assert.deepStrictEqual(
      collectExcludePatterns({ '**/node_modules': false }, {}, { '**/node_modules': true }),
      [],
      'false in deckard.exclude brings a hidden folder back',
    );
    assert.strictEqual(
      toExcludeGlob(['**/node_modules', 'a/{b,c}']),
      '{**/node_modules,**/node_modules/**}',
    );
    assert.strictEqual(toExcludeGlob([]), undefined);
  });

  test('asks findFiles to skip what search.exclude hides, such as node_modules', async () => {
    const workspaceUri = vscode.Uri.file('/tmp/deckard-search-exclude');
    const noteUri = vscode.Uri.joinPath(workspaceUri, 'readme.md');
    const dependencyUri = vscode.Uri.joinPath(workspaceUri, 'pkg', 'node_modules', 'x', 'README.md');
    const workspaceFolder = {
      uri: workspaceUri,
      name: 'deckard-search-exclude',
      index: 0,
    } as vscode.WorkspaceFolder;
    const excludes: (vscode.GlobPattern | undefined)[] = [];
    const scanner = new WorkspaceScanner({
      workspaceFolders: [workspaceFolder],
      findFiles: async (_include, exclude) => {
        excludes.push(exclude);
        return [noteUri, dependencyUri];
      },
      readFile: async () => Buffer.from('# Readme', 'utf8'),
    });

    // VS Code's default search.exclude hides node_modules.
    const files = await scanner.scan();
    const exclude = excludes[0];
    assert.ok(exclude instanceof vscode.RelativePattern, 'an exclude is passed');
    assert.ok(exclude.pattern.includes('**/node_modules'), exclude.pattern);
    assert.deepStrictEqual(files.map((file) => file.filePath), ['readme.md']);
    assert.strictEqual(scanner.isNotesFile(dependencyUri), false);
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
    const snapshot = createSearchPageSnapshot(
      index,
      defaultPreferences,
      '#work',
    );

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
    const snapshot = createSearchPageSnapshot(
      index,
      defaultPreferences,
      '#project/neon-relay',
    );
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
