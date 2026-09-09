import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

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
  favoriteEntities: [],
  tagSortMode: 'alphabetical' as const,
  entitySortMode: 'alphabetical' as const,
  tagAccessOrder: [],
  tagAccessCounts: {},
  entityAccessOrder: [],
  entityAccessCounts: {},
  taskOrder: [],
  taskSortMode: 'rank' as const,
  renderMode: 'markdown' as const,
  tagOverviewSortMode: 'alphabetical' as const,
  tagOverviewLayout: 'tabs' as const,
  relatedNotesSortMode: 'tags' as const,
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

  test('aggregates heading tag relationships through untagged headings', () => {
    const parsed = parseMarkdown(
      'notes/relationships.md',
      [
        '# Relay map #parent/alpha #parent/beta',
        '## Un tagged operating notes',
        '### Signal route #child/alpha #child/beta',
        '# Alternate relay #parent/alpha',
        '## Signal route #child/alpha',
        '# Repeated marker #same',
        '## Nested repeated marker #same',
      ].join('\n'),
    );
    const index = buildWorkspaceIndex(new Map([[parsed.filePath, parsed]]));

    const childParents = index.tagParents?.get('#child/alpha') ?? [];
    assert.deepStrictEqual(
      childParents.map((relationship) => ({
        parent: relationship.parent.key,
        child: relationship.child.key,
        count: relationship.count,
      })),
      [
        {
          parent: '#parent/alpha',
          child: '#child/alpha',
          count: 2,
        },
        {
          parent: '#parent/beta',
          child: '#child/alpha',
          count: 1,
        },
      ],
    );

    const parentChildren = index.tagChildren?.get('#parent/alpha') ?? [];
    assert.deepStrictEqual(
      parentChildren.map((relationship) => ({
        parent: relationship.parent.key,
        child: relationship.child.key,
        count: relationship.count,
      })),
      [
        {
          parent: '#parent/alpha',
          child: '#child/alpha',
          count: 2,
        },
        {
          parent: '#parent/alpha',
          child: '#child/beta',
          count: 1,
        },
      ],
    );
    assert.strictEqual(
      (index.tagChildren?.get('#same') ?? []).some(
        (relationship) => relationship.child.key === '#same',
      ),
      false,
    );
  });

  test('finds relationships from headings starting at any Markdown level', () => {
    const parsed = parseMarkdown(
      'notes/daily-checkins.md',
      [
        '## #itd-common-checkins',
        '### Rob',
        '- #oracle',
        '### Math',
        '#### SDLC #sdlc',
        '## Keel workspace onboarding #sdlc',
      ].join('\n'),
    );
    const index = buildWorkspaceIndex(new Map([[parsed.filePath, parsed]]));

    assert.deepStrictEqual(
      index.tagChildren?.get('#itd-common-checkins')?.map((relationship) => ({
        parent: relationship.parent.key,
        child: relationship.child.key,
      })),
      [{ parent: '#itd-common-checkins', child: '#sdlc' }],
    );
  });

  test('aggregates sibling tag relationships for headings with one parent', () => {
    const parsed = parseMarkdown(
      'notes/sibling-relationships.md',
      [
        '# Top route A #top-a',
        '# Top route B #top-b',
        '# Relay map',
        '## Shared parent',
        '### First route #alpha',
        '### Second route #beta',
        '### Third route #alpha #gamma',
        '## Separate parent',
        '### Separate route #delta',
        '#### Combined route #same-a #same-b',
        '# Isolated parent',
        '## Isolated route #isolated-a',
      ].join('\n'),
    );
    const otherParsed = parseMarkdown(
      'notes/other-sibling-relationships.md',
      ['# Isolated parent', '## Isolated route #isolated-b'].join('\n'),
    );
    const index = buildWorkspaceIndex(
      new Map([
        [parsed.filePath, parsed],
        [otherParsed.filePath, otherParsed],
      ]),
    );

    assert.deepStrictEqual(
      (index.tagSiblings?.get('#top-a') ?? []).map(
        (relationship) => relationship.sibling.key,
      ),
      ['#top-b'],
    );
    assert.deepStrictEqual(
      (index.tagSiblings?.get('#alpha') ?? []).map((relationship) => ({
        sibling: relationship.sibling.key,
        count: relationship.count,
      })),
      [
        { sibling: '#beta', count: 2 },
        { sibling: '#gamma', count: 1 },
      ],
    );
    assert.deepStrictEqual(
      (index.tagSiblings?.get('#beta') ?? []).map((relationship) => ({
        sibling: relationship.sibling.key,
        count: relationship.count,
      })),
      [
        { sibling: '#alpha', count: 2 },
        { sibling: '#gamma', count: 1 },
      ],
    );
    assert.deepStrictEqual(index.tagSiblings?.get('#delta') ?? [], []);
    assert.deepStrictEqual(index.tagSiblings?.get('#same-a') ?? [], []);
    assert.deepStrictEqual(index.tagSiblings?.get('#same-b') ?? [], []);
    assert.deepStrictEqual(index.tagSiblings?.get('#isolated-a') ?? [], []);
    assert.deepStrictEqual(index.tagSiblings?.get('#isolated-b') ?? [], []);
  });

  test('keeps the Tag Scenarios fixture parent-focused', () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, '../../development/notes/Tag Scenarios.md'),
      'utf8',
    );
    const parsed = parseMarkdown('development/notes/Tag Scenarios.md', content);
    const index = buildWorkspaceIndex(new Map([[parsed.filePath, parsed]]));

    assert.deepStrictEqual(index.tagParents?.get('#management/performance') ?? [], []);
    assert.deepStrictEqual(
      (index.tagChildren?.get('#management/performance') ?? []).map(
        (relationship) => ({
          child: relationship.child.key,
          count: relationship.count,
        }),
      ),
      [
        { child: '#risk/thermal-leak', count: 1 },
        { child: '#topic/quantum-drift', count: 2 },
      ],
    );
  });

  test('does not infer relationships from inherited front-matter tags', () => {
    const parsed = parseMarkdown(
      'notes/frontmatter-relationships.md',
      [
        '---',
        'project: Relay map',
        '---',
        '# Parent heading',
        '## Child heading #child',
      ].join('\n'),
    );
    const index = buildWorkspaceIndex(new Map([[parsed.filePath, parsed]]));

    assert.deepStrictEqual(index.tagParents?.get('#child') ?? [], []);
    assert.deepStrictEqual(
      index.tagChildren?.get('#project/relay-map') ?? [],
      [],
    );
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
});
