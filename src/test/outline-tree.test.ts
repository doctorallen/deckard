import * as assert from 'assert';

import MarkdownIt = require('markdown-it');

import { parseMarkdown } from '../domain/markdown/parser';
import {
  buildOutline,
  collectOutlineTags,
  describeOutlineCounts,
  filterOutline,
  findOutlineNodeAt,
  formatOutlineDescription,
  formatOutlineTags,
  mapOutlineParents,
  OutlineNode,
} from '../ui/state/outlineState';

const notes = [
  '---',
  'tags: [#area/notes]',
  '---',
  '',
  '# Weekly review #project/atlas #urgent',
  '',
  'Prose with an inline #topic/tagged line.',
  '',
  '### Skipped level child',
  '',
  '## Notes',
  '',
  '- [ ] a task #urgent',
  '',
  '## Notes',
  '',
  '## Sprint #3 planning',
  '',
  '## #project/atlas',
  '',
  '```',
  '# fenced, not a heading',
  '```',
  '',
  '## Tail @mara-vale',
].join('\n');

function outline(content = notes, options = {}): OutlineNode[] {
  return buildOutline(parseMarkdown('notes/a.md', content), options);
}

function labels(nodes: readonly OutlineNode[]): string[] {
  return nodes.map((node) => node.label);
}

suite('Outline tree', () => {
  test('nests headings by level and keeps untagged headings as structure', () => {
    const roots = outline();

    assert.deepStrictEqual(labels(roots), ['Weekly review']);
    assert.deepStrictEqual(labels(roots[0].children), [
      'Skipped level child',
      'Notes',
      'Notes',
      'Sprint #3 planning',
      '#project/atlas',
      'Tail',
    ]);
    assert.strictEqual(roots[0].children[0].level, 3);
  });

  test('strips heading markers and tags from the label and lists tags beside it', () => {
    const roots = outline();

    assert.strictEqual(roots[0].label, 'Weekly review');
    assert.strictEqual(
      formatOutlineTags(roots[0]),
      '#project/atlas #urgent',
    );
    assert.strictEqual(
      formatOutlineTags(roots[0].children[5]),
      '@mara-vale',
    );
  });

  test('keeps numeric hashes in the label because they are not tags', () => {
    const heading = outline()[0].children[3];

    assert.strictEqual(heading.label, 'Sprint #3 planning');
    assert.strictEqual(formatOutlineTags(heading), '');
  });

  test('falls back to the tags when a heading is nothing else', () => {
    const heading = outline()[0].children[4];

    assert.strictEqual(heading.label, '#project/atlas');
    assert.strictEqual(heading.labelFromTags, true);
    assert.strictEqual(formatOutlineTags(heading), '');
    assert.deepStrictEqual(
      heading.tags.map((tag) => tag.key),
      ['#project/atlas'],
    );
  });

  test('leaves out headings inside fenced blocks and inline tagged entries', () => {
    const roots = outline();
    const found = [roots[0], ...roots[0].children].map((node) => node.label);

    assert.ok(!found.includes('fenced, not a heading'));
    assert.ok(
      !found.some((label) => label.includes('Prose with an inline')),
      'inline tagged entries are note content, not document structure',
    );
  });

  test('gives identically named siblings distinct ids', () => {
    const children = outline()[0].children;

    assert.strictEqual(children[1].id, 'weekly-review/notes');
    assert.strictEqual(children[2].id, 'weekly-review/notes~2');
  });

  test('keeps ids stable when the headings move down the file', () => {
    const before = outline();
    const after = outline(`\n\n${notes}`);

    assert.deepStrictEqual(
      after.map((node) => node.id),
      before.map((node) => node.id),
    );
    assert.deepStrictEqual(
      after[0].children.map((node) => node.id),
      before[0].children.map((node) => node.id),
    );
    assert.notStrictEqual(after[0].line, before[0].line);
  });

  test('adds inherited front-matter tags only when asked', () => {
    assert.strictEqual(
      formatOutlineTags(outline()[0]),
      '#project/atlas #urgent',
    );
    assert.strictEqual(
      formatOutlineTags(outline(notes, { inheritedTags: true })[0]),
      '#project/atlas #urgent #area/notes',
    );
  });

  test('finds the deepest heading containing a line', () => {
    const roots = outline();

    assert.strictEqual(findOutlineNodeAt(roots, 13)?.label, 'Notes');
    assert.strictEqual(findOutlineNodeAt(roots, 5)?.label, 'Weekly review');
    assert.strictEqual(
      findOutlineNodeAt(roots, 9)?.label,
      'Skipped level child',
    );
    assert.strictEqual(findOutlineNodeAt(roots, 1), undefined);
  });

  test('walks every node upward to a root so reveal can find it', () => {
    const roots = outline();
    const parents = mapOutlineParents(roots);
    const child = roots[0].children[0];

    assert.strictEqual(parents.get(child.id), roots[0]);
    assert.strictEqual(parents.get(roots[0].id), undefined);
  });

  test('produces nothing for a file without headings', () => {
    assert.deepStrictEqual(outline('Just prose #urgent\n'), []);
  });
  test('counts the tasks under a heading and the links that name it', () => {
    const content = [
      '# Plan #project/atlas',
      '- [x] one',
      '- [ ] two',
      '## Steps',
      '- [x] three',
      '- [ ] four',
      '- [ ] five',
      '# Notes',
    ].join('\n');
    const backlinks = {
      toHeading: (filePath: string, heading: string) =>
        filePath === 'notes/a.md' && heading.startsWith('Plan') ? [1, 2, 3] : [],
    };
    const [plan, notesHeading] = buildOutline(parseMarkdown('notes/a.md', content), {
      backlinks,
      filePath: 'notes/a.md',
    });
    assert.deepStrictEqual(plan.tasks, { done: 2, total: 5 });
    assert.strictEqual(plan.links, 3);
    assert.deepStrictEqual(plan.children[0].tasks, { done: 1, total: 3 });
    assert.strictEqual(notesHeading.tasks, undefined);
    assert.strictEqual(
      formatOutlineDescription(plan, { tags: true, counts: true }),
      '2/5 (40%) · ↩3 · #project/atlas',
    );
    assert.strictEqual(formatOutlineDescription(plan, { tags: true, counts: false }), '#project/atlas');
    assert.strictEqual(formatOutlineDescription(notesHeading, { tags: true, counts: true }), '');
    assert.deepStrictEqual(describeOutlineCounts(plan), ['Tasks 2/5 done (40%)', 'Linked 3 times']);
  });
  test('filters to the headings that carry a tag, keeping their ancestors', () => {
    const content = [
      '# Plan',
      '## Atlas work #project/atlas',
      '### Detail',
      '## Orion work #project/orion',
      '# Other #topic/x',
    ].join('\n');
    const roots = buildOutline(parseMarkdown('notes/a.md', content));
    const atlas = filterOutline(roots, '#project/atlas');
    assert.deepStrictEqual(labels(atlas), ['Plan']);
    assert.deepStrictEqual(labels(atlas[0].children), ['Atlas work']);
    assert.strictEqual(atlas[0].id, roots[0].id, 'ids stay as they were');
    // A namespace keeps the tags under it.
    assert.deepStrictEqual(labels(filterOutline(roots, '#project')[0].children), ['Atlas work', 'Orion work']);
    assert.deepStrictEqual(filterOutline(roots, '#nothing'), []);
    assert.deepStrictEqual(
      collectOutlineTags(roots).map((tag) => tag.label),
      ['#project/atlas', '#project/orion', '#topic/x'],
    );
  });
});

suite('A heading with no words', () => {
  test('hashes alone, with or without spaces after them, are an empty heading everywhere, as in the preview', () => {
    const preview = new MarkdownIt();
    for (const bare of ['#', '# ', '#   ']) {
      const content = ['# Plan', 'Before.', bare, 'After.'].join('\n');
      const headings = preview.parse(content, {}).filter((token) => token.type === 'heading_open');
      assert.strictEqual(headings.length, 2, `the preview reads ${JSON.stringify(bare)} as a heading`);

      const file = parseMarkdown('notes/a.md', content);
      assert.deepStrictEqual(
        file.sections.map((section) => [section.heading, section.headingLevel, section.startLine, section.endLine]),
        [
          ['Plan', 1, 1, 2],
          ['', 1, 3, 4],
        ],
        `the parser ends Plan at ${JSON.stringify(bare)}`,
      );
      assert.deepStrictEqual(
        buildOutline(file).map((node) => [node.label, node.line]),
        [
          ['Plan', 1],
          ['Untitled heading', 3],
        ],
        `the Outline lists ${JSON.stringify(bare)}`,
      );
    }
  });
});
