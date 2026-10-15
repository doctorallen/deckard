import * as assert from 'assert';

import type { WorkspaceIndex } from '../domain/model';
import { createQueryContext } from '../domain/query/queryContext';
import { createSearchPageSnapshot, evaluateSearchPage, readTagStory } from '../ui/state/searchPageState';
import { describeStory, formatStoryMarkdown, shownStoryLines, STORY_PAGE_SIZE, type StoryLine, viewStory } from '../ui/state/storySoFar';
import { createPreferences, MemoryStore } from './preferenceServices';
import { indexOf } from './typedWorkspace';

const lines = (...text: string[]): string => text.join('\n');

/** The moment the story is read at: 14 Oct 2026, noon. */
const context = createQueryContext(new Date(2026, 9, 14, 12).getTime());

/**
 * Project Atlas over two months of daily notes, a decision note, a note
 * dated by its front matter, and the project's hub.
 */
function atlas(extra: Record<string, string> = {}): WorkspaceIndex {
  return indexOf({
    'Types/Decision.md': lines('---', 'deckard-type: decision', 'rows: notes', '---', '# Decision', '', '| Field | Kind |', '| ----- | ---- |', '| status | Text |'),
    'Projects/Atlas.md': lines('---', 'describes: "#project/atlas"', '---', '# Atlas', 'The summary #project/atlas'),
    'journal/2026-09-03.md': lines(
      '# 2026-09-03',
      '## Kickoff #project/atlas',
      'We met the vendor.',
      '- [x] Send the brief',
      '',
      '```deckard',
      'tag = #project/atlas',
      '```',
      '## Lunch',
      'Nothing to do with it.',
      'One aside #project/atlas',
    ),
    'journal/2026-10-14.md': lines(
      '# 2026-10-14',
      '## Standup',
      '- [ ] Book the load test #project/atlas',
      '  - [x] Ask Ops for a window',
      '  - Answer: Thursday',
      '- [?] Who signs the contract? #project/atlas',
      '- [-] Drop the old plan #project/atlas',
      '- Not about it',
    ),
    'decisions/hosted-fields.md': lines('---', 'type: decision', 'tags: [project/atlas]', 'created: 2026-10-02', '---', 'We chose the hosted fields.', '', 'Cheaper to run.'),
    ...extra,
  });
}

/** The tag's story, oldest first, as its page's search finds it. */
function storyOf(index: WorkspaceIndex, query = '#project/atlas'): StoryLine[] {
  return readTagStory(index, evaluateSearchPage(index, query, { queryContext: context }), context) ?? [];
}

/** Each line as `date kind text (where)`, for reading a whole story at once. */
function read(story: readonly StoryLine[]): string[] {
  return story.map((line) => `${line.date} ${line.kind} ${line.text} (${line.where})`);
}

suite('The story so far', () => {
  test('takes every line under a tagged heading, in a tagged note, or carrying the tag, and leaves out the rest', () => {
    assert.deepStrictEqual(read(storyOf(atlas())), [
      '2026-09-03 note We met the vendor. (Kickoff)',
      '2026-09-03 done Send the brief (Kickoff)',
      '2026-09-03 note One aside #project/atlas (Lunch)',
      '2026-10-02 decision We chose the hosted fields. (hosted-fields)',
      '2026-10-02 decision Cheaper to run. (hosted-fields)',
      '2026-10-14 open Book the load test #project/atlas (Standup)',
      // A question, which is no task.
      '2026-10-14 question Who signs the contract? #project/atlas (Standup)',
      // A cancelled task is neither done nor open.
      '2026-10-14 note Drop the old plan #project/atlas (Standup)',
    ]);
  });

  test('leaves out headings, code, query blocks, blank lines, front matter, and the hub note', () => {
    const texts = storyOf(atlas()).map((line) => line.text);
    assert.ok(!texts.some((text) => text.includes('tag = ') || text.includes('```')), 'no query block');
    assert.ok(!texts.some((text) => text.includes('Kickoff') || text.includes('summary')), 'no heading, no hub');
    assert.ok(!texts.some((text) => text.includes('type: decision') || text.trim() === ''), 'no front matter, no blank line');
    assert.ok(!texts.includes('Not about it'), 'a line under an untagged heading that carries no tag');
  });

  test('dates a line by its daily note, else its note’s created:, else its file', () => {
    const story = storyOf(atlas({ 'notes/undated.md': lines('# Undated #project/atlas', 'Written some day.') }));
    assert.strictEqual(story.find((line) => line.text === 'We met the vendor.')?.date, '2026-09-03');
    assert.strictEqual(story.find((line) => line.text === 'Cheaper to run.')?.date, '2026-10-02');
    // The test's notes were all made on 8 Oct.
    assert.strictEqual(story.find((line) => line.text === 'Written some day.')?.date, '2026-10-08');
  });

  test('folds the lines indented under a row into it, a task’s steps and an answer among them', () => {
    const task = storyOf(atlas()).find((line) => line.text.startsWith('Book the load test'));
    assert.deepStrictEqual(task?.children, [{ text: 'Ask Ops for a window', mark: '✓' }, { text: 'Answer: Thursday' }]);
    assert.ok(!storyOf(atlas()).some((line) => line.text === 'Ask Ops for a window'), 'a step is not a row of its own');
  });

  test('reads a decision from a heading tagged with a row of the Decision type', () => {
    const index = atlas({
      'Types/Decision.md': lines('---', 'deckard-type: decision', 'rows: "#decision/*"', '---', '# Decision', '', '| Field | Kind |', '| ----- | ---- |', '| status | Text |'),
      'journal/2026-10-10.md': lines('# 2026-10-10', '## Payments #project/atlas', '### Hosted fields #decision/hosted', 'Go with the vendor’s fields.', '- [ ] Tell Legal'),
    });
    const kinds = Object.fromEntries(storyOf(index).filter((line) => line.date === '2026-10-10').map((line) => [line.text, line.kind]));
    assert.deepStrictEqual(kinds, { 'Go with the vendor’s fields.': 'decision', 'Tell Legal': 'open' });
  });

  test('a search that narrows the tag narrows its story', () => {
    assert.deepStrictEqual(storyOf(atlas(), '#project/atlas is:done').map((line) => line.text), ['Send the brief']);
    assert.strictEqual(readTagStory(atlas(), evaluateSearchPage(atlas(), 'vendor', { queryContext: context }), context), undefined, 'no tag, no story');
  });

  test('orders newest day first, or oldest first, each day as it was written', () => {
    const story = storyOf(atlas());
    const days = (view: StoryLine[]): string[] => [...new Set(view.map((line) => line.date))];
    assert.deepStrictEqual(days(viewStory(story, { filter: 'all', oldestFirst: false })), ['2026-10-14', '2026-10-02', '2026-09-03']);
    assert.deepStrictEqual(days(viewStory(story, { filter: 'all', oldestFirst: true })), ['2026-09-03', '2026-10-02', '2026-10-14']);
    assert.deepStrictEqual(
      viewStory(story, { filter: 'all', oldestFirst: false }).filter((line) => line.date === '2026-09-03').map((line) => line.text),
      ['We met the vendor.', 'Send the brief', 'One aside #project/atlas'],
    );
  });

  test('filters to decisions or to what is done', () => {
    const story = storyOf(atlas());
    assert.deepStrictEqual(viewStory(story, { filter: 'decisions', oldestFirst: true }).map((line) => line.text), ['We chose the hosted fields.', 'Cheaper to run.']);
    assert.deepStrictEqual(viewStory(story, { filter: 'done', oldestFirst: true }).map((line) => line.text), ['Send the brief']);
  });

  test('draws the Questions filter only once the story holds a question', () => {
    const filters = (index: WorkspaceIndex): string[] => describeStory(storyOf(index), { filter: 'all', oldestFirst: false, limit: 100 }, context).filters.map((filter) => filter.label);
    const without = atlas({ 'journal/2026-10-14.md': lines('# 2026-10-14', '- Shipped it #project/atlas') });
    assert.deepStrictEqual(filters(without), ['All', 'Decisions', 'Done']);
    assert.deepStrictEqual(filters(atlas()), ['All', 'Decisions', 'Done', 'Questions']);
  });

  test('reads a [?] line as a question, its Answer: line folded under it, which its filter keeps', () => {
    const content = lines(
      '# 2026-10-14',
      '## Standup',
      '- [?] Who signs the contract? #project/atlas',
      '    - Answer: Legal',
      '- [ ] Book the room #project/atlas',
    );
    const story = storyOf(indexOf({ 'journal/2026-10-14.md': content }));
    assert.deepStrictEqual(story.map((line) => [line.kind, line.text, line.children]), [
      ['question', 'Who signs the contract? #project/atlas', [{ text: 'Answer: Legal' }]],
      ['open', 'Book the room #project/atlas', []],
    ]);
    const drawn = describeStory(story, { filter: 'questions', oldestFirst: false, limit: 100 }, context);
    assert.deepStrictEqual(drawn.filters.map((filter) => [filter.label, filter.active === true]), [['All', false], ['Decisions', false], ['Done', false], ['Questions', true]]);
    assert.deepStrictEqual(drawn.months.flatMap((month) => month.rows.map((row) => row.kind)), ['question']);
  });

  test('draws the rows under their months, a page at a time, the tab counting every row', () => {
    const many = Object.fromEntries(Array.from({ length: 120 }, (_unused, at) => [
      `journal/2026-08-${String((at % 28) + 1).padStart(2, '0')}-${at}.md`,
      lines('---', `created: 2026-08-${String((at % 28) + 1).padStart(2, '0')}`, '---', `Line ${at} #project/atlas`),
    ]));
    const story = storyOf(atlas(many));
    const drawn = describeStory(story, { filter: 'all', oldestFirst: false, limit: STORY_PAGE_SIZE }, context);
    assert.strictEqual(drawn.count, story.length);
    assert.strictEqual(drawn.total, story.length);
    assert.deepStrictEqual(drawn.months.map((month) => month.label), ['October 2026', 'September 2026', 'August 2026']);
    assert.strictEqual(drawn.months.reduce((count, month) => count + month.rows.length, 0), STORY_PAGE_SIZE);
    const row = drawn.months[0].rows[0];
    assert.strictEqual(row.day, 'Wed, Oct 14');
    assert.strictEqual(row.kind, 'open');
    assert.deepStrictEqual(row.tags, [{ key: '#project/atlas', label: '#project/atlas' }]);
    assert.strictEqual(row.task?.completed, false);
    assert.deepStrictEqual(row.children?.map((child) => child.mark), ['✓', undefined]);
  });

  test('a tag’s page carries its story; any other search none', () => {
    const preferences = createPreferences(new MemoryStore()).reader.value;
    assert.ok(createSearchPageSnapshot(atlas(), preferences, '#project/atlas', { queryContext: context }).story);
    assert.strictEqual(createSearchPageSnapshot(atlas(), preferences, 'vendor', { queryContext: context }).story, undefined);
  });

  test('copies the rows shown as Markdown, under their months', () => {
    const story = storyOf(atlas());
    assert.strictEqual(formatStoryMarkdown(shownStoryLines(story, { filter: 'done', oldestFirst: false, limit: 100 })), lines(
      '## September 2026',
      '',
      '- 2026-09-03 · Send the brief (Kickoff)',
    ));
    assert.strictEqual(formatStoryMarkdown(shownStoryLines(story, { filter: 'all', oldestFirst: false, limit: 1 })), lines(
      '## October 2026',
      '',
      '- 2026-10-14 · Book the load test #project/atlas (Standup)',
      '  - ✓ Ask Ops for a window',
      '  - Answer: Thursday',
    ));
  });
});
