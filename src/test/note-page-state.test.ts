import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';
import { createNotePageSnapshot, describeTagKind } from '../ui/state/notePageState';
import { NoteBlock } from '../ui/protocol/notePage';
import { WorkspaceIndex } from '../domain/model';
import { renderPage } from './pages';
import { openWebviewPage } from './webviewPage';
import { evaluateQuery } from '../domain/query/queryEvaluator';
import { parseQuery } from '../domain/query/queryParser';

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

  test('draws the bar every page draws: ‹ ›, Open in Editor, plain, and ⋯ with Appearance and Help', () => {
    const view = openWebviewPage(renderPage('notePage'), page);
    try {
      assert.strictEqual(view.find('.page-bar .eyebrow-trail').textContent, ' / NOTE / HUBS');
      const open = view.find('.page-bar-actions > [data-action="open-in-editor"]');
      assert.ok(!open.classList.contains('primary'), 'it goes somewhere, and commits nothing');
      assert.strictEqual(view.findAll('.primary').length, 0);
      assert.deepStrictEqual(view.findAll('.page-menu .view-options-section').map((section) => section.getAttribute('aria-label')), ['Appearance', 'Help']);
      assert.deepStrictEqual(view.findAll('.page-menu .view-options-group').map((group) => group.children[0].textContent), ['Theme', 'Zen', 'Page width']);
      assert.strictEqual(view.findAll('.help-button').length, 0, 'Help on this page is a row of ⋯');
      view.click('.page-menu [data-action="page-help"]');
      assert.deepStrictEqual(view.lastPosted('openHelp'), { type: 'openHelp' });
    } finally {
      view.dispose();
    }
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
    assert.strictEqual(page.hub?.kind, 'Project');
    assert.deepStrictEqual(['#team/harbor', '@dana', '#person/sable-ortiz', '#follow-up', '#area/home-office'].map(describeTagKind), ['Team', 'Person', 'Person', 'Tag', 'Area']);
    assert.match(page.hub?.label ?? '', /^\d+\/\d+ done \(\d+%\)/);
  });

  test('says how far along the note’s own tasks are, steps aside, and nothing for a note with none', () => {
    const { parts, ...progress } = page.taskProgress ?? { parts: [] };
    assert.deepStrictEqual(progress, { done: 1, total: 2, label: '1/2 done (50%) · next due in 6 days' });
    const found = (query: string | undefined): number => evaluateQuery(index, parseQuery(query ?? '').node, options.queryContext).tasks.length;
    assert.deepStrictEqual(parts.map((part) => [part.text, found(part.query)]), [['1/2 done (50%)', 1], ['next due in 6 days', 1]], 'each part searches the note’s own tasks it counts');
    assert.deepStrictEqual(
      page.hub?.parts.map((part) => [part.text, found(part.query)]),
      page.hub?.parts.map((part) => [part.text, Number(/^(\d+)/.exec(part.text)?.[1] ?? 1)]),
      'and the hub’s, the tag’s tasks it counts',
    );
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

  test('reads an embed of its own section, or of a note with front matter, at the lines it came from', () => {
    const edge = indexOf({
      'A.md': '# A\n\nintro\n\n![[#Sec]]\n\n## Sec\n\n- [ ] t1\n- [ ] t2\n- [ ] t3',
      'B.md': '---\nx: 1\n---\n\n# B\n\n- [ ] b1\n- [ ] b2',
      'C.md': '# C\n\n![[B]]',
    });
    const own = createNotePageSnapshot(edge, 'A.md', options).blocks.find((block) => block.kind === 'embed');
    assert.ok(own?.kind === 'embed');
    assert.deepStrictEqual(own.source, { filePath: 'A.md', line: 7 });
    const ownList = own.blocks?.find((block) => block.kind === 'list');
    assert.ok(ownList?.kind === 'list');
    const tasksOfA = [...edge.tasks.values()].filter((task) => task.filePath === 'A.md');
    assert.deepStrictEqual(
      ownList.items.map((item) => [item.line, item.task?.taskId]),
      tasksOfA.map((task) => [task.lineNumber, task.id]),
      'each box ticks the task on its own line',
    );
    const whole = createNotePageSnapshot(edge, 'C.md', options).blocks.find((block) => block.kind === 'embed');
    assert.ok(whole?.kind === 'embed');
    assert.deepStrictEqual(kinds(whole.blocks ?? []), ['heading@5', 'list@7']);
    const wholeList = whole.blocks?.[1];
    assert.ok(wholeList?.kind === 'list');
    const tasksOfB = [...edge.tasks.values()].filter((task) => task.filePath === 'B.md');
    assert.deepStrictEqual(wholeList.items.map((item) => item.task?.taskId), tasksOfB.map((task) => task.id));
  });

  test('draws an embed in a list item or a quote, and leaves an attachment a line of text', () => {
    const edge = indexOf({
      'A.md': '# A\n\n- item\n  ![[B]]\n- ![[B]]\n\n> ![[B]]\n\n![[report.pdf]]',
      'B.md': 'Bee.',
    });
    const blocks = createNotePageSnapshot(edge, 'A.md', options).blocks;
    const list = blocks[0];
    assert.ok(list.kind === 'list');
    assert.deepStrictEqual(list.items.map((item) => kinds(item.blocks)), [['paragraph@3', 'embed@4'], ['embed@5']]);
    const first = list.items[0].blocks[0];
    assert.deepStrictEqual(first.kind === 'paragraph' && first.children, [{ kind: 'text', text: 'item' }], 'the marker is not drawn as words');
    const quote = blocks[1];
    assert.deepStrictEqual(quote.kind === 'quote' && kinds(quote.children), ['embed@7']);
    assert.deepStrictEqual(kinds(blocks.slice(2)), ['paragraph@9'], 'an attachment is not a missing note');
  });

  test('takes the title from its heading without tags, marks, or a marker, and draws it once', () => {
    const edge = indexOf({
      'Tagged.md': '# Review **now** #project/atlas ^top\n\nBody.',
      'Linked.md': '# Meet [[Dana|Dana R]]\n\nBody.',
      'Late.md': 'Words first.\n\n# Heading',
    });
    const tagged = createNotePageSnapshot(edge, 'Tagged.md', options);
    assert.strictEqual(tagged.title, 'Review now');
    assert.deepStrictEqual(kinds(tagged.blocks), ['paragraph@3']);
    assert.strictEqual(createNotePageSnapshot(edge, 'Linked.md', options).title, 'Meet Dana R');
    assert.deepStrictEqual(kinds(createNotePageSnapshot(edge, 'Late.md', options).blocks), ['paragraph@1', 'heading@3'], 'a heading under words stays where it is');
  });

  test('reads an unindented list and a block as properties, and makes a tag only of what its field names', () => {
    const edge = indexOf({
      'P.md': [
        '---',
        'tags:',
        '- project/atlas',
        '- topic/finance',
        'title: Atlas',
        'description: |',
        '  Two lines',
        '  of words.',
        'owner: "@dana"',
        '---',
        '# P',
      ].join('\n'),
    });
    assert.deepStrictEqual(createNotePageSnapshot(edge, 'P.md', options).properties, [
      { name: 'tags', values: [{ text: 'project/atlas', tagKey: '#project/atlas' }, { text: 'topic/finance', tagKey: '#topic/finance' }] },
      { name: 'title', values: [{ text: 'Atlas' }] },
      { name: 'description', values: [{ text: 'Two lines of words.' }] },
      { name: 'owner', values: [{ text: '@dana', tagKey: '@dana' }] },
    ]);
  });

  test('keeps a box the index reads no task from as words', () => {
    const edge = indexOf({ 'Q.md': '# Q\n\n> - [ ] quoted' });
    const quote = createNotePageSnapshot(edge, 'Q.md', options).blocks[0];
    assert.ok(quote.kind === 'quote');
    const list = quote.children[0];
    assert.ok(list.kind === 'list');
    assert.strictEqual(list.items[0].task, undefined);
    const paragraph = list.items[0].blocks[0];
    assert.deepStrictEqual(paragraph.kind === 'paragraph' && paragraph.children, [{ kind: 'text', text: '[ ] quoted' }]);
  });

  test('says when the index has no such note', () => {
    const gone = createNotePageSnapshot(index, 'notes/Gone.md', options);
    assert.strictEqual(gone.missing, true);
    assert.strictEqual(gone.title, 'Gone');
    assert.deepStrictEqual(gone.blocks, []);
  });
});
