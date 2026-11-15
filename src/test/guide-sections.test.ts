import * as assert from 'assert';

import { cutGuideSections, findGuideSection, firstSentence, sentenceNaming, textOf } from '../ui/webview/pages/help/guideSections';

const PAGE = [
  '<h1 id="task-board">Task board</h1><p>Intro.</p>',
  '<h2 id="lanes" data-line="21">Lanes</h2><p><strong>Lanes</strong>, beside <strong>Group</strong>, splits the board. The board keeps your choice.</p>',
  '<h3 id="lane-heads">Lane heads</h3><ul><li>A lane&#39;s head folds it.</li></ul>',
  '<h2 id="searching-and-filtering">Searching and filtering</h2><p>Search with the same <a href="#">search box</a> as search pages. <strong>Refine</strong> counts only tasks.</p>',
].join('\n');

suite('Guide sections', () => {
  test('a rendered page is cut at its headings, each section holding its subsections', () => {
    const sections = cutGuideSections(PAGE);
    assert.deepStrictEqual(sections.map((section) => [section.id, section.level, section.title]), [
      ['task-board', 1, 'Task board'],
      ['lanes', 2, 'Lanes'],
      ['lane-heads', 3, 'Lane heads'],
      ['searching-and-filtering', 2, 'Searching and filtering'],
    ]);
    const lanes = findGuideSection(PAGE, 'lanes');
    assert.ok(lanes?.html.includes('Lane heads'), 'its h3 is part of it');
    assert.ok(!lanes?.html.includes('Searching'), 'the next h2 is not');
    assert.strictEqual(findGuideSection(PAGE, 'missing'), undefined);
  });

  test('a section is listed by its first sentence, and a page names a shared control in its own sentence', () => {
    assert.strictEqual(firstSentence(findGuideSection(PAGE, 'lanes')?.html ?? ''), 'Lanes, beside Group, splits the board.');
    const searching = findGuideSection(PAGE, 'searching-and-filtering')?.html ?? '';
    assert.strictEqual(sentenceNaming(searching, 'Refine'), 'Refine counts only tasks.');
    assert.strictEqual(sentenceNaming(searching, 'search box'), 'Search with the same search box as search pages.');
    assert.strictEqual(textOf('<p>A lane&#39;s head</p><p>folds &amp; opens</p>'), "A lane's head folds & opens");
  });
});
