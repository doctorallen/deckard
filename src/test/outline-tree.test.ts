import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import {
  buildOutline,
  findOutlineNodeAt,
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
});
