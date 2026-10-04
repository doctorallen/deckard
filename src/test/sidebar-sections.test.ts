import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildOutline } from '../ui/state/outlineState';
import { buildSidebarSections, findActiveLine } from '../ui/state/sidebarSections';
import { openWebviewPage } from './webviewPage';
import { renderPage } from './pages';

const NOTE = [
  '# Atlas #project/atlas',
  'Intro.',
  '## Kickoff #meeting',
  '- [x] Book the room',
  '## Vendor review #vendor',
  '- [ ] Call the vendor',
  '- [ ] Send the terms',
  '### Terms',
  'Net 30.',
  '## Open questions',
].join('\n');

suite('Sections in the Context view', () => {
  const roots = buildOutline(parseMarkdown('notes/atlas.md', NOTE));

  test('lays the headings out in reading order, each with its depth, tags, and counts, and marks the cursor\'s', () => {
    const sections = buildSidebarSections({ roots, tags: [], cursorLine: 9, showTags: true, showCounts: true });
    assert.deepStrictEqual(
      sections.rows.map((row) => [row.label, row.depth, row.tags.map((tag) => tag.label), row.tasks ? `${row.tasks.done}/${row.tasks.total}` : '']),
      [
        ['Atlas', 0, ['#project/atlas'], '1/3'],
        ['Kickoff', 1, ['#meeting'], '1/1'],
        ['Vendor review', 1, ['#vendor'], '0/2'],
        ['Terms', 2, [], ''],
        ['Open questions', 1, [], ''],
      ],
    );
    assert.strictEqual(sections.activeLine, 8, 'the deepest heading holding line 9');
    assert.strictEqual(findActiveLine(sections.rows, 4), 3);
    assert.strictEqual(buildSidebarSections({ roots, tags: [], showTags: false, showCounts: true }).rows[0].tags.length, 0, 'tags can be left off');
  });

  test('draws each heading as a control that opens it, with Focus, the filter, and Show all past a dozen', () => {
    const many = Array.from({ length: 14 }, (_, at) => ({ line: at + 1, endLine: at + 1, label: `Heading ${at + 1}`, depth: 0, tags: [] }));
    const page = openWebviewPage(renderPage('sidebarNotes'), {
      activeFileName: 'atlas.md',
      activeTags: [],
      tagTitleDisplayMode: 'inline',
      state: 'noMatches',
      notes: [],
      sections: {
        rows: many,
        activeLine: 2,
        tags: [{ key: '#vendor', label: '#vendor' }],
        showCounts: true,
      },
    });
    try {
      assert.strictEqual(page.findAll('.section-row').length, 12, 'the first dozen');
      assert.strictEqual(page.find('.section-row.is-active .section-open').getAttribute('aria-current'), 'location');
      page.click('[data-action="reveal-section"][data-line="3"]');
      assert.deepStrictEqual(page.lastPosted('revealSection'), { type: 'revealSection', line: 3 });
      page.click('[data-action="focus-section"][data-line="3"]');
      assert.deepStrictEqual(page.lastPosted('focusSection'), { type: 'focusSection', line: 3 });
      const select = page.find('[data-action="filter-sections"]') as HTMLSelectElement;
      select.value = '#vendor';
      select.dispatchEvent(new page.window.Event('change', { bubbles: true }));
      assert.deepStrictEqual(page.lastPosted('filterSections'), { type: 'filterSections', tagKey: '#vendor' });
      page.click('[data-action="show-all-sections"]');
      assert.strictEqual(page.findAll('.section-row').length, 14, 'every heading once asked');
    } finally {
      page.dispose();
    }
  });
});
