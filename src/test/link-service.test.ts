import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { WorkspaceIndex } from '../domain/model';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { LinkRewrite } from '../domain/links/linkRewrites';
import { getExtractedNoteFileName, getLinkableNoteFileName } from '../domain/markdown/noteNames';
import type { ResourceUri } from '../ports/uri';
import {
  checkRewrites,
  LinkNoteService,
  LinkService,
  LiveNotes,
  Mention,
  NoteEdit,
  ReplaceOutcome,
} from '../services/linkService';
import { FakeFileSystem, fileUri, joinUri } from './fakeWorkspace';

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

/**
 * The notes as they stand now, by index path, each at `/ws/<path>`; a note
 * missing from `texts` has no file, and one in `unreadable` cannot be opened.
 */
function liveNotes(
  texts: Record<string, string>,
  unreadable: readonly string[] = [],
): LiveNotes<ResourceUri> & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    uriOf: async (filePath) => (filePath in texts || unreadable.includes(filePath) ? fileUri(`/ws/${filePath}`) : undefined),
    read: async (uri) => {
      const filePath = uri.fsPath.slice('/ws/'.length);
      reads.push(filePath);
      if (!(filePath in texts)) {
        throw new Error(`cannot open ${filePath}`);
      }
      return texts[filePath];
    },
  };
}

/** A value as data, so URIs compare by their fields rather than their methods. */
function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** Each edit as `path:line:start-end -> text`, for comparing a plan. */
function described(edits: readonly NoteEdit<ResourceUri>[]): string[] {
  return edits.map(
    (edit) => `${edit.uri.fsPath.slice('/ws/'.length)}:${edit.line}:${edit.startColumn}-${edit.endColumn} -> ${edit.text}`,
  );
}

suite('LinkService', () => {
  const review = {
    'notes/Vendor review.md': '# Vendor review\n\n## Terms\n\nSee [[#Terms]] above.',
    'notes/Log.md': 'Read [[Vendor review]] and [[Vendor review#Terms]].',
    'notes/Moved.md': 'Also [[Vendor review]].',
  };

  test('a note rename rewrites the links that still fit, and counts them by note', async () => {
    const index = indexOf(review);
    const notes = liveNotes({
      ...review,
      'notes/Moved.md': 'Now [[Something else]].',
    });
    const service = new LinkService({ index: { getSnapshot: () => index }, notes, findUnlinkedMentions: () => [] });

    const plan = await service.planNoteRenames(
      [
        { fromPath: 'notes/Vendor review.md', toTitle: 'Supplier review' },
        { fromPath: 'notes/Gone.md', toTitle: 'Anything' },
      ],
      () => undefined,
    );

    assert.deepStrictEqual(described(plan.edits), [
      'notes/Log.md:0:5-22 -> [[Supplier review]]',
      'notes/Log.md:0:27-50 -> [[Supplier review#Terms]]',
    ]);
    assert.strictEqual(plan.rewritten, 2);
    assert.strictEqual(plan.notes, 1, 'the note that moved on is left alone');
  });

  test('a note rename plans from an open editor’s text over the indexed one', async () => {
    const index = indexOf(review);
    const open = 'Typed [[Vendor review]] just now.';
    const notes = liveNotes({ ...review, 'notes/Log.md': open });
    const service = new LinkService({ index: { getSnapshot: () => index }, notes, findUnlinkedMentions: () => [] });

    const plan = await service.planNoteRenames(
      [{ fromPath: 'notes/Vendor review.md', toTitle: 'Supplier review' }],
      (filePath) => (filePath === 'notes/Log.md' ? open : undefined),
    );

    assert.deepStrictEqual(described(plan.edits), [
      'notes/Log.md:0:6-23 -> [[Supplier review]]',
      'notes/Moved.md:0:5-22 -> [[Supplier review]]',
    ]);
    assert.strictEqual(plan.notes, 2);
  });

  test('a heading rename is one set of edits: the heading, other notes, then its own links off the heading line', async () => {
    const index = indexOf(review);
    const notes = liveNotes(review);
    const service = new LinkService({ index: { getSnapshot: () => index }, notes, findUnlinkedMentions: () => [] });

    const plan = await service.planHeadingRename({
      index,
      filePath: 'notes/Vendor review.md',
      uri: fileUri('/ws/notes/Vendor review.md'),
      text: review['notes/Vendor review.md'],
      section: { startLine: 3 },
      from: 'Terms',
      to: 'Payment terms',
    });

    assert.strictEqual(plan.kind, 'planned');
    assert.deepStrictEqual(described(plan.kind === 'planned' ? plan.edits : []), [
      'notes/Vendor review.md:2:3-8 -> Payment terms',
      'notes/Log.md:0:27-50 -> [[Vendor review#Payment terms]]',
      'notes/Vendor review.md:4:4-14 -> [[#Payment terms]]',
    ]);
  });

  test('a heading rename writes nothing when the line has no heading marks', async () => {
    const index = indexOf(review);
    const service = new LinkService({
      index: { getSnapshot: () => index },
      notes: liveNotes(review),
      findUnlinkedMentions: () => [],
    });

    const plan = await service.planHeadingRename({
      index,
      filePath: 'notes/Vendor review.md',
      uri: fileUri('/ws/notes/Vendor review.md'),
      text: 'Terms, written plainly\n',
      section: { startLine: 1 },
      from: 'Terms',
      to: 'Payment terms',
    });

    assert.deepStrictEqual(plan, { kind: 'no-heading-line' });
  });

  test('mentions become links as written, and one changed since is left alone', async () => {
    const index = indexOf(review);
    const mentions: Mention[] = [
      { filePath: 'notes/Log.md', line: 0, startColumn: 0, endColumn: 4, text: 'Read' },
      { filePath: 'notes/Moved.md', line: 0, startColumn: 0, endColumn: 4, text: 'Gone' },
      { filePath: 'notes/Nowhere.md', line: 0, startColumn: 0, endColumn: 4, text: 'Read' },
    ];
    const notes = liveNotes(review);
    const service = new LinkService({
      index: { getSnapshot: () => index },
      notes,
      findUnlinkedMentions: () => mentions,
    });

    const plan = await service.planMentionLinks(index.files.get('notes/Log.md')!);

    assert.strictEqual(plan.kind, 'planned');
    assert.deepStrictEqual(described(plan.kind === 'planned' ? plan.edits : []), [
      'notes/Log.md:0:0-4 -> [[Read]]',
    ]);
  });

  test('no mention left to link is a plan of none', async () => {
    const index = indexOf(review);
    const service = new LinkService({
      index: { getSnapshot: () => index },
      notes: liveNotes(review),
      findUnlinkedMentions: () => [],
    });

    assert.deepStrictEqual(await service.planMentionLinks(index.files.get('notes/Log.md')!), { kind: 'none', skipped: 0 });
  });

  test('a note with a mention that cannot be opened is passed over and counted, and the rest are linked', async () => {
    const index = indexOf(review);
    const mention = (filePath: string): Mention => ({ filePath, line: 0, startColumn: 0, endColumn: 4, text: 'Read' });
    const service = (unreadable: readonly string[], mentions: readonly Mention[]) =>
      new LinkService({
        index: { getSnapshot: () => index },
        notes: liveNotes({ 'notes/Log.md': review['notes/Log.md'] }, unreadable),
        findUnlinkedMentions: () => mentions,
      });

    const plan = await service(['notes/Locked.md'], [mention('notes/Locked.md'), mention('notes/Log.md'), mention('notes/Locked.md')])
      .planMentionLinks(index.files.get('notes/Log.md')!);
    assert.strictEqual(plan.kind, 'planned');
    assert.deepStrictEqual(described(plan.kind === 'planned' ? plan.edits : []), ['notes/Log.md:0:0-4 -> [[Read]]']);
    assert.strictEqual(plan.skipped, 1, 'a note is counted once, however many mentions it has');

    assert.deepStrictEqual(
      await service(['notes/Locked.md'], [mention('notes/Locked.md')]).planMentionLinks(index.files.get('notes/Log.md')!),
      { kind: 'none', skipped: 1 },
    );
  });

  test('checked rewrites pass over a note that cannot be found or opened', async () => {
    const rewrite = (filePath: string): LinkRewrite => ({
      filePath,
      line: 0,
      startColumn: 5,
      endColumn: 22,
      from: '[[Vendor review]]',
      text: '[[Supplier review]]',
    });
    const notes = liveNotes({ 'notes/Log.md': review['notes/Log.md'] }, ['notes/Locked.md']);

    const checked = await checkRewrites(notes, [
      rewrite('notes/Log.md'),
      rewrite('notes/Locked.md'),
      rewrite('notes/Missing.md'),
    ]);

    assert.deepStrictEqual(described(checked.edits), ['notes/Log.md:0:5-22 -> [[Supplier review]]']);
    assert.deepStrictEqual(checked.applied.map((each) => each.filePath), ['notes/Log.md']);
    assert.deepStrictEqual(notes.reads, ['notes/Log.md', 'notes/Locked.md']);
  });
});

suite('LinkNoteService', () => {
  const folder = fileUri('/ws/notes');
  const text = (files: FakeFileSystem, fsPath: string): string | undefined => {
    const bytes = files.files.get(fsPath);
    return bytes && new TextDecoder().decode(bytes);
  };
  const section = parseMarkdown('notes/Log.md', '# Log\n\n## Lead\n\nThe lead.\n').sections[1];

  test('a link’s name becomes a note titled with it, and an existing one is kept', async () => {
    const files = new FakeFileSystem();
    const notes = new LinkNoteService(files);

    const created = await notes.createNoteNamed(folder, 'Q3 Planning');
    assert.deepStrictEqual(plain(created), plain({ kind: 'created', uri: joinUri(folder, 'Q3 Planning.md') }));
    assert.strictEqual(text(files, '/ws/notes/Q3 Planning.md'), '# Q3 Planning\n\n');

    files.files.set('/ws/notes/Q3 Planning.md', new TextEncoder().encode('Kept'));
    assert.strictEqual((await notes.createNoteNamed(folder, 'Q3 Planning')).kind, 'kept');
    assert.strictEqual(text(files, '/ws/notes/Q3 Planning.md'), 'Kept');
    assert.deepStrictEqual(await notes.createNoteNamed(folder, 'plans/Q3'), { kind: 'invalid-name' });
  });

  test('missing notes are made for the names that could be files and have none', async () => {
    const files = new FakeFileSystem();
    await files.createDirectory(folder);
    files.files.set('/ws/notes/Atlas.md', new TextEncoder().encode('# Atlas'));
    const notes = new LinkNoteService(files);

    assert.strictEqual(await notes.createMissingNotes(folder, ['Atlas', 'Budget', 'a/b', 'Vendors']), 2);
    assert.strictEqual(text(files, '/ws/notes/Atlas.md'), '# Atlas');
    assert.strictEqual(text(files, '/ws/notes/Budget.md'), '# Budget\n\n');
    assert.strictEqual(text(files, '/ws/notes/Vendors.md'), '# Vendors\n\n');
  });

  test('a heading is extracted into its note and swapped for a link to it', async () => {
    const files = new FakeFileSystem();
    const swaps: string[] = [];
    const notes = new LinkNoteService(files);

    const result = await notes.extractHeading(
      { section, sourceUri: fileUri('/ws/notes/Log.md'), notesFolderUri: folder, name: 'Lead' },
      async (_source, _section, link) => {
        swaps.push(link);
        return 'replaced';
      },
    );

    assert.deepStrictEqual(plain(result), plain({ kind: 'extracted', noteUri: joinUri(folder, 'Lead.md') }));
    assert.deepStrictEqual(swaps, ['[[Lead]]']);
    assert.strictEqual(text(files, '/ws/notes/Lead.md'), section.rawContent);
  });

  test('an extraction refuses a tagged line and a name that cannot be a file', async () => {
    const files = new FakeFileSystem();
    const notes = new LinkNoteService(files);
    const replace = async (): Promise<ReplaceOutcome> => assert.fail('nothing is swapped');
    const at = { sourceUri: fileUri('/ws/notes/Log.md'), notesFolderUri: folder };

    assert.deepStrictEqual(
      await notes.extractHeading({ ...at, section: { ...section, isInline: true }, name: 'Lead' }, replace),
      { kind: 'refused', reason: 'inline' },
    );
    assert.deepStrictEqual(
      await notes.extractHeading({ ...at, section, name: 'a:b' }, replace),
      { kind: 'refused', reason: 'invalid-name' },
    );
    assert.strictEqual(files.files.size + files.folders.size, 0, 'nothing is written');
  });

  test('an extraction refuses a name its link could not open', async () => {
    const files = new FakeFileSystem();
    const notes = new LinkNoteService(files);
    const replace = async (): Promise<ReplaceOutcome> => assert.fail('nothing is swapped');
    const at = { sourceUri: fileUri('/ws/notes/Log.md'), notesFolderUri: folder, section };
    for (const name of ['Issue #42 follow-up', 'Plan [draft]', 'Step ^2']) {
      assert.deepStrictEqual(await notes.extractHeading({ ...at, name }, replace), { kind: 'refused', reason: 'invalid-name' }, name);
    }
    assert.strictEqual(files.files.size + files.folders.size, 0, 'nothing is written');
    assert.strictEqual(getLinkableNoteFileName('Issue 42 follow-up'), 'Issue 42 follow-up.md');
    assert.strictEqual(getExtractedNoteFileName('Issue #42'), 'Issue #42.md', 'a note made some other way may still have one');
  });

  test('an extraction never writes over a note already at the name', async () => {
    const files = new FakeFileSystem();
    await files.createDirectory(folder);
    files.files.set('/ws/notes/Lead.md', new TextEncoder().encode('Mine'));
    const notes = new LinkNoteService(files);

    const result = await notes.extractHeading(
      { section, sourceUri: fileUri('/ws/notes/Log.md'), notesFolderUri: folder, name: 'Lead' },
      async () => assert.fail('nothing is swapped'),
    );

    assert.deepStrictEqual(
      plain(result),
      plain({ kind: 'exists', fileName: 'Lead.md', noteUri: joinUri(folder, 'Lead.md') }),
    );
    assert.strictEqual(text(files, '/ws/notes/Lead.md'), 'Mine');
  });

  test('the new note goes when the source is unchanged, and stays when the swap is half made', async () => {
    const files = new FakeFileSystem();
    const notes = new LinkNoteService(files);
    const at = { section, sourceUri: fileUri('/ws/notes/Log.md'), notesFolderUri: folder };

    assert.deepStrictEqual(await notes.extractHeading({ ...at, name: 'Undone' }, async () => 'unchanged'), {
      kind: 'unchanged',
    });
    assert.strictEqual(files.files.has('/ws/notes/Undone.md'), false);

    assert.deepStrictEqual(await notes.extractHeading({ ...at, name: 'Half' }, async () => 'half'), { kind: 'half' });
    assert.strictEqual(text(files, '/ws/notes/Half.md'), section.rawContent);
  });
});
