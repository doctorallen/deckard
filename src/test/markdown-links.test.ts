import * as assert from 'assert';

import { findMissingLinkTargets, findLinkedSection, getBacklinkIndex } from '../domain/index/backlinks';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { findLinkProblems } from '../domain/links/linkProblems';
import { parseMarkdown } from '../domain/markdown/parser';
import { findNoteLinkSpans, formatNoteLink, headingSlug, resolveMarkdownLinkTarget } from '../domain/markdown/wikiLinks';
import { createNotesGraphSnapshot } from '../domain/graph/notesGraph';
import type { WorkspaceIndex } from '../domain/model';

function createIndex(notes: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(Object.entries(notes).map(([path, content]) => [path, parseMarkdown(path, content)])),
  );
}

suite('Markdown links to notes', () => {
  test('resolve against the note they are written in', () => {
    const from = 'docs/notes/standup.md';
    assert.strictEqual(resolveMarkdownLinkTarget('../adr/0042-cache.md', from), 'docs/adr/0042-cache.md');
    assert.strictEqual(resolveMarkdownLinkTarget('./plan.md#Decision', from), 'docs/notes/plan.md#Decision');
    assert.strictEqual(resolveMarkdownLinkTarget('<01 Tasks.md>', 'README.md'), '01 Tasks.md');
    assert.strictEqual(resolveMarkdownLinkTarget('01%20Tasks.md', 'README.md'), '01 Tasks.md');
    assert.strictEqual(resolveMarkdownLinkTarget('https://example.com/a.md', from), undefined);
    assert.strictEqual(resolveMarkdownLinkTarget('mailto:me@example.com', from), undefined);
    assert.strictEqual(resolveMarkdownLinkTarget('/abs/a.md', from), undefined);
    assert.strictEqual(resolveMarkdownLinkTarget('#heading', from), undefined);
    assert.strictEqual(resolveMarkdownLinkTarget('diagram.png', from), undefined);
    assert.strictEqual(resolveMarkdownLinkTarget('../../../outside.md', from), undefined);
  });

  test('are found beside wiki links, and not in code or as images', () => {
    const text = [
      'See [the ADR](../adr/0042.md "title") and [[Atlas]].',
      '![diagram](pic.md) `[code](x.md)`',
      '```',
      '[fenced](y.md)',
      '```',
    ].join('\n');
    assert.deepStrictEqual(
      findNoteLinkSpans(text, 'notes/a.md').map((span) => [span.kind, span.target, span.line]),
      [
        ['markdown', 'adr/0042.md', 0],
        ['wiki', 'Atlas', 0],
      ],
    );
  });

  test('count in Linked from, the graph, and the parser, and a slug finds its heading', () => {
    const index = createIndex({
      'docs/adr/0042.md': '# Cache layer\n## Decision record\nUse SQLite.\n',
      'docs/README.md': '# Docs\nRead [the decision](adr/0042.md#decision-record).\n',
      'notes/README.md': '# Notes\n',
    });
    const backlinks = getBacklinkIndex(index);
    assert.deepStrictEqual(
      backlinks.toNote('docs/adr/0042.md').map((link) => link.sourcePath),
      ['docs/README.md'],
    );
    assert.strictEqual(backlinks.toHeading('docs/adr/0042.md', 'Decision record').length, 1);
    assert.strictEqual(headingSlug('Decision record: v2?'), 'decision-record-v2');
    assert.strictEqual(findLinkedSection(index.files.get('docs/adr/0042.md')!, 'decision-record')?.heading, 'Decision record');
    assert.ok(index.files.get('docs/README.md')!.links.includes('docs/adr/0042.md#decision-record'));
    const graph = createNotesGraphSnapshot(index);
    const pathOf = new Map(graph.nodes.map((node) => [node.id, node.filePath]));
    assert.ok(
      graph.edges.some(
        (edge) =>
          edge.types.includes('wiki-link') &&
          [pathOf.get(edge.source), pathOf.get(edge.target)].sort().join(' ') === 'docs/README.md docs/adr/0042.md',
      ),
    );
  });

  test('a link to a file outside the notes is neither a missing note nor a warning', () => {
    const index = createIndex({ 'notes/a.md': '# A\nSee [the code](../src/README.md).\n' });
    assert.deepStrictEqual(findMissingLinkTargets(index), []);
    assert.deepStrictEqual(findLinkProblems(index.files.get('notes/a.md')!.content, index, 'notes/a.md'), []);
  });

  test('a link Deckard makes is written in the style asked for, with a path from the note it is in', () => {
    assert.strictEqual(formatNoteLink('atlas', 'notes/daily/2026-10-04.md', 'notes/projects/Atlas.md', 'wiki'), '[[atlas]]');
    assert.strictEqual(
      formatNoteLink('atlas', 'notes/daily/2026-10-04.md', 'notes/projects/Atlas Plan.md', 'markdown'),
      '[atlas](../projects/Atlas%20Plan.md)',
    );
    assert.strictEqual(formatNoteLink('Plan', 'a.md', 'Plan (v2).md', 'markdown'), '[Plan](Plan%20%28v2%29.md)');
    assert.strictEqual(resolveMarkdownLinkTarget('../projects/Atlas%20Plan.md', 'notes/daily/2026-10-04.md'), 'notes/projects/Atlas Plan.md');
  });
});
