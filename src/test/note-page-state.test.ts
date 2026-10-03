import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';
import { createNotePageSnapshot } from '../ui/state/notePageState';
import { NoteBlock } from '../ui/protocol/notePage';
import { WorkspaceIndex } from '../domain/model';

function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(Object.entries(notes).map(([filePath, content]) => [filePath, parseMarkdown(filePath, content)])),
  );
}

const index = indexOf({
  'hubs/Atlas.md': [
    '---',
    'describes: project/atlas',
    'status: active',
    'owner: "@dana"',
    '---',
    '# Atlas',
    '',
    'Migration of billing onto the **new** ledger, with #topic/finance.',
    '',
    '## Decision',
    'We chose the ledger. ^choice',
    '',
    '- [ ] Send the proposal 📅 2026-10-09',
    '  - [x] Draft it',
    '- [x] Pick a vendor',
    '- Plain item',
    '',
    '```deckard view=table columns=due',
    '#project/atlas is:task',
    '```',
    '',
    '```js',
    'const x = 1;',
    '```',
    '',
    '![[Review#Notes]]',
    '![[Missing]]',
    '',
    '| A | B |',
    '| - | - |',
    '| 1 | 2 |',
  ].join('\n'),
  'notes/Review.md': '# Review #project/atlas\n\n## Notes\nSee [[Atlas]] and [[Atlas#Decision]].\n- [ ] Follow up',
  'notes/Kickoff.md': '---\nup: "[[Review]]"\n---\n# Kickoff\nAlso [[Atlas]].',
});

const options = {
  queryContext: createQueryContext(new Date(2026, 9, 3).getTime()),
  history: { back: false, forward: false },
  visit: 1,
};

/** The kinds of the blocks, nested ones in brackets. */
function kinds(blocks: readonly NoteBlock[]): string[] {
  return blocks.map((block) => `${block.kind}@${block.line}`);
}

suite('The note page', () => {
  const page = createNotePageSnapshot(index, 'hubs/Atlas.md', { ...options, focusLine: 11 });

  test('draws the note’s blocks, each with its line, its title heading left to the header', () => {
    assert.strictEqual(page.title, 'Atlas');
    assert.strictEqual(page.folder, 'hubs');
    assert.strictEqual(page.focusLine, 11);
    assert.deepStrictEqual(kinds(page.blocks), [
      'paragraph@8',
      'heading@10',
      'paragraph@11',
      'list@13',
      'query@18',
      'code@22',
      'embed@26',
      'embed@27',
      'table@29',
    ]);
  });

  test('gives each task its box, and a step its own', () => {
    const list = page.blocks.find((block) => block.kind === 'list');
    assert.ok(list && list.kind === 'list');
    assert.deepStrictEqual(list.items.map((item) => [item.line, item.task?.completed]), [[13, false], [15, true], [16, undefined]]);
    const first = list.items[0];
    assert.deepStrictEqual(first.blocks[0], { kind: 'paragraph', line: 13, children: [{ kind: 'text', text: 'Send the proposal 📅 2026-10-09' }] });
    const steps = first.blocks[1];
    assert.ok(steps.kind === 'list');
    assert.strictEqual(steps.items[0].task?.completed, true, 'the step has a box too');
    assert.ok(first.task?.taskId);
  });

  test('runs a query block, as a table for view=table', () => {
    const query = page.blocks.find((block) => block.kind === 'query');
    assert.ok(query && query.kind === 'query');
    assert.strictEqual(query.query, '#project/atlas is:task');
    assert.deepStrictEqual(query.result.table, { noteHead: ['Note', 'Updated', 'Linked from', 'Tasks'], taskHead: ['Due'] });
    assert.ok(query.result.tasks.length >= 3);
    assert.ok(query.result.tasks.every((row) => row.task && row.cells?.length === 1));
  });

  test('draws an embed as what it names, and a missing one as why', () => {
    const [found, missing] = page.blocks.filter((block) => block.kind === 'embed');
    assert.ok(found.kind === 'embed' && missing.kind === 'embed');
    assert.strictEqual(found.title, 'Review › Notes');
    assert.deepStrictEqual(found.source, { filePath: 'notes/Review.md', line: 3 });
    assert.deepStrictEqual(kinds(found.blocks ?? []), ['heading@3', 'paragraph@4', 'list@5']);
    const embedded = found.blocks?.[2];
    assert.ok(embedded?.kind === 'list' && embedded.items[0].task, 'an embedded task keeps its box');
    assert.match(missing.missing ?? '', /No note is named "Missing"/);
  });

  test('says its properties, a tag among them a button, and the tags it writes', () => {
    assert.deepStrictEqual(page.properties, [
      { name: 'describes', values: [{ text: 'project/atlas', tagKey: '#project/atlas' }] },
      { name: 'status', values: [{ text: 'active' }] },
      { name: 'owner', values: [{ text: '@dana', tagKey: '@dana' }] },
    ]);
    assert.ok(page.tags.some((tag) => tag.label === '#topic/finance'));
    assert.strictEqual(page.hub?.tagKey, '#project/atlas');
    assert.match(page.hub?.label ?? '', /done/);
  });

  test('says how far along the note’s own tasks are, steps aside, and nothing for a note with none', () => {
    assert.deepStrictEqual(page.taskProgress, { done: 1, total: 2, label: '1 of 2 done · next due in 6 days' });
    const plain = createNotePageSnapshot(index, 'notes/Kickoff.md', options);
    assert.strictEqual(plain.taskProgress, undefined);
  });

  test('lists what links to it, most links first, and where it sits', () => {
    assert.strictEqual(page.backlinkCount, 2);
    assert.deepStrictEqual(page.backlinks.map((link) => [link.filePath, link.count]), [['notes/Kickoff.md', 1], ['notes/Review.md', 1]], 'as many links each, by title');
    assert.deepStrictEqual(page.backlinks[1].lines, [{ line: 4, text: 'See [[Atlas]] and [[Atlas#Decision]].' }]);
    const kickoff = createNotePageSnapshot(index, 'notes/Kickoff.md', options);
    assert.deepStrictEqual(kickoff.breadcrumbs, [
      { labels: ['Projects', 'Atlas', 'Review', 'Kickoff'], notes: ['hubs/Atlas.md', 'notes/Review.md', 'notes/Kickoff.md'] },
    ], 'Review sits under Atlas by its heading’s tag, and Kickoff under Review by up:');
  });

  test('says when the index has no such note', () => {
    const gone = createNotePageSnapshot(index, 'notes/Gone.md', options);
    assert.strictEqual(gone.missing, true);
    assert.strictEqual(gone.title, 'Gone');
    assert.deepStrictEqual(gone.blocks, []);
  });
});
