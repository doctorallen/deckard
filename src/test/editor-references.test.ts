import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import { WorkspaceIndex } from '../core/types';
import {
  buildBacklinkIndex,
  findWikiLinkAt,
} from '../core/workspace/backlinks';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import {
  countSharedTagEntries,
  createLinkPreview,
  createReferenceSummary,
  createTagSummary,
} from '../ui/state/referenceState';

suite('Editor references', () => {
  const index = createIndex();
  const backlinks = buildBacklinkIndex(index);
  const atlas = 'notes/Atlas.md';

  test('finds links into a note, outside code fences and not from itself', () => {
    assert.deepStrictEqual(
      backlinks
        .toNote(atlas)
        .map((link) => [link.sourcePath, link.line, link.startColumn, link.endColumn]),
      [
        ['notes/Log.md', 1, 4, 13],
        ['notes/Log.md', 1, 18, 45],
      ],
    );
  });

  test('matches heading links by text, ignoring tags and letter case', () => {
    assert.deepStrictEqual(
      backlinks
        .toHeading(atlas, 'Decision #project/atlas')
        .map((link) => link.sourcePath)
        .sort(),
      [atlas, 'notes/Log.md'],
    );
  });

  test('finds the link under the cursor', () => {
    assert.deepStrictEqual(findWikiLinkAt('See [[Atlas#Decision|call]] now', 8), {
      target: { note: 'Atlas', heading: 'Decision' },
      startColumn: 4,
      endColumn: 27,
    });
    assert.strictEqual(findWikiLinkAt('See [[Atlas]] now', 3), undefined);
  });

  test('counts references and open tasks for each heading', () => {
    const summary = createReferenceSummary(
      index.files.get(atlas) as NonNullable<ReturnType<typeof index.files.get>>,
      backlinks,
    );
    assert.strictEqual(summary.backlinks.length, 2);
    assert.deepStrictEqual(
      summary.headings.map((heading) => [
        heading.line,
        heading.references.length,
        heading.openTasks.length,
      ]),
      [
        // The top heading holds the open task of its sub-heading too.
        [0, 0, 1],
        [2, 2, 1],
      ],
    );
  });

  test('previews the section a link names', () => {
    const preview = createLinkPreview(
      index,
      backlinks,
      { note: 'atlas', heading: 'decision' },
      'notes/Log.md',
    );
    assert.strictEqual(preview.kind, 'found');
    if (preview.kind === 'found') {
      assert.strictEqual(preview.title, 'Atlas › Decision');
      assert.strictEqual(preview.line, 3);
      assert.match(preview.excerpt, /^We chose the relay\.\n- \[ \] Ship the relay/);
      assert.strictEqual(preview.backlinkCount, 1);
    }

    const missingHeading = createLinkPreview(
      index,
      backlinks,
      { note: 'Atlas', heading: 'Nowhere' },
      'notes/Log.md',
    );
    assert.strictEqual(
      missingHeading.kind === 'found' ? missingHeading.missingHeading : undefined,
      'Nowhere',
    );
    assert.deepStrictEqual(
      createLinkPreview(index, backlinks, { note: 'Missing' }, 'notes/Other.md'),
      { kind: 'missing', note: 'Missing' },
    );
  });

  test('summarizes a tag with its counts and recent entries', () => {
    const summary = createTagSummary(index, '#project/atlas');
    assert.ok(summary);
    assert.deepStrictEqual(
      [summary.noteCount, summary.taskCount, summary.openTaskCount],
      [1, 3, 2],
    );
    assert.deepStrictEqual(
      summary.entries.map((entry) => entry.title),
      ['Decision', 'Draft the memo', 'Follow up', 'Ship the relay'],
    );
    assert.strictEqual(createTagSummary(index, '#nowhere'), undefined);
  });

  test('names the hub note in a tag summary', () => {
    const files = [
      parseMarkdown('notes/Atlas.md', '---\ndescribes: project/atlas\n---\n# Atlas'),
      parseMarkdown('notes/Plan.md', '# Plan #project/atlas'),
    ];
    const hubIndex = buildWorkspaceIndex(
      new Map(files.map((file) => [file.filePath, file])),
    );
    assert.strictEqual(
      createTagSummary(hubIndex, '#project/atlas')?.hubFilePath,
      'notes/Atlas.md',
    );
    assert.strictEqual(createTagSummary(index, '#project/atlas')?.hubFilePath, undefined);
  });

  test('counts entries in other notes that share a tag', () => {
    // Atlas's own Decision section and its tasks are left out; Log's task is
    // the one entry elsewhere that carries the tag.
    assert.strictEqual(
      countSharedTagEntries(index, atlas, ['#project/atlas']),
      1,
    );
    // Seen from Log, Atlas's tasks sit inside its tagged section, so the
    // section counts and they do not count again.
    assert.strictEqual(
      countSharedTagEntries(index, 'notes/Log.md', ['#project/atlas']),
      1,
    );
    assert.strictEqual(countSharedTagEntries(index, atlas, ['#nowhere']), 0);
  });

  test('counts an entry sharing several tags once', () => {
    const files = [
      parseMarkdown('notes/A.md', '# Heading #alpha #beta'),
      parseMarkdown(
        'notes/B.md',
        [
          '# Both #alpha #beta',
          '- [ ] Inside #beta',
          '# Untagged',
          '- [ ] Loose #beta',
        ].join('\n'),
      ),
      parseMarkdown('notes/C.md', '---\ntags: [alpha]\n---\nNo headings here.'),
    ];
    const tagged = buildWorkspaceIndex(
      new Map(files.map((file) => [file.filePath, file])),
    );
    // B's Both section, B's loose task, and C's front matter.
    assert.strictEqual(
      countSharedTagEntries(tagged, 'notes/A.md', ['#alpha', '#beta']),
      3,
    );
    // From B, A's heading and C's front matter.
    assert.strictEqual(
      countSharedTagEntries(tagged, 'notes/B.md', ['#alpha']),
      2,
    );
  });
});

function createIndex(): WorkspaceIndex {
  const files: Record<string, string> = {
    'notes/Atlas.md': [
      '# Atlas',
      'Intro line.',
      '## Decision #project/atlas',
      'We chose the relay.',
      '- [ ] Ship the relay',
      '- [x] Draft the memo',
      'Back to [[#Decision]].',
    ].join('\n'),
    'notes/Log.md': [
      '# Log',
      'See [[atlas]] and [[Atlas#decision|the call]].',
      '```',
      '[[Atlas]]',
      '```',
      '- [ ] Follow up #project/atlas',
    ].join('\n'),
    'notes/Other.md': '[[Missing]] and [[Log]]',
  };
  return buildWorkspaceIndex(
    new Map(
      Object.entries(files).map(([filePath, content]) => [
        filePath,
        parseMarkdown(filePath, content),
      ]),
    ),
  );
}
