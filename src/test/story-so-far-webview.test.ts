import * as assert from 'assert';

import type { WorkspaceIndex } from '../domain/model';
import { createQueryContext } from '../domain/query/queryContext';
import type { StoryFilter } from '../ui/protocol/searchPage';
import { createSearchPageSnapshot } from '../ui/state/searchPageState';
import { createPreferences, MemoryStore } from './preferenceServices';
import { renderPage } from './pages';
import { indexOf } from './typedWorkspace';
import { openWebviewPage, type WebviewPage } from './webviewPage';

const lines = (...text: string[]): string => text.join('\n');

/** The moment the page is drawn: 14 Oct 2026, noon. */
const now = new Date(2026, 9, 14, 12).getTime();

/** Project Atlas over two months: a kickoff, a decision, and today's standup. */
const ATLAS = indexOf({
  'Projects/Atlas.md': lines('---', 'describes: "#project/atlas"', '---', '# Atlas', 'The summary.'),
  'journal/2026-09-03.md': lines('# 2026-09-03', '## Kickoff #project/atlas', 'We met the **vendor**.', '- [x] Send the brief'),
  'decisions/hosted-fields.md': lines('---', 'type: decision', 'tags: [project/atlas]', 'created: 2026-10-02', '---', 'We chose the hosted fields.'),
  'journal/2026-10-14.md': lines('# 2026-10-14', '## Standup', '- [ ] Book the load test #project/atlas', '  - [x] Ask Ops for a window'),
});

const pages: WebviewPage[] = [];

/** The project's page, with the Story tab shown, as the reader left it. */
function atlasPage(
  { index = ATLAS, layout, story }: { index?: WorkspaceIndex; layout?: 'split'; story?: { filter?: StoryFilter; oldestFirst?: boolean; limit?: number } } = {},
): WebviewPage {
  const snapshot = createSearchPageSnapshot(index, createPreferences(new MemoryStore()).reader.value, '#project/atlas', {
    queryContext: createQueryContext(now),
    story: { filter: story?.filter ?? 'all', oldestFirst: story?.oldestFirst ?? false, limit: story?.limit ?? 100 },
  });
  const page = openWebviewPage(renderPage('searchPage'), { ...snapshot, ...(layout ? { layout } : {}), parkedTags: [] }, { savedState: { tab: 'story' } });
  pages.push(page);
  return page;
}

/** Each row as its day, its mark, its words, and where it is. */
function rows(page: WebviewPage): string[][] {
  return page.findAll('.story-row').map((row) => [
    row.querySelector('.story-day')?.textContent ?? '',
    row.querySelector('.story-kind')?.textContent ?? (row.querySelector('input.story-box') ? 'box' : ''),
    row.querySelector('.story-text')?.textContent ?? '',
    row.querySelector('.story-where')?.textContent ?? '',
  ]);
}

suite('The story so far, drawn', () => {
  teardown(() => pages.splice(0).forEach((page) => page.dispose()));

  test('a tag’s page has a Story tab beside Notes and Tasks, counting its rows', () => {
    const page = atlasPage();
    assert.deepStrictEqual(page.findAll('[role="tab"]').map((tab) => tab.textContent), ['Notes (2)', 'Tasks (2)', 'Story (4)']);
    assert.strictEqual(page.find('[data-tab="story"]').getAttribute('aria-selected'), 'true');
    assert.strictEqual((page.find('#result-panel-story') as HTMLElement).hidden, false);
  });

  test('draws the rows newest first under their months, each its day, its mark, its line, and where it is', () => {
    const page = atlasPage();
    assert.deepStrictEqual(page.findAll('.story-month-heading').map((heading) => heading.textContent), ['October 2026', 'September 2026']);
    assert.deepStrictEqual(rows(page), [
      ['Wed, Oct 14', 'box', 'Book the load test #project/atlas', 'Standup'],
      ['Fri, Oct 2', 'D', 'We chose the hosted fields.', 'hosted-fields'],
      ['Thu, Sep 3', '·', 'We met the vendor.', 'Kickoff'],
      ['Thu, Sep 3', 'box', 'Send the brief', 'Kickoff'],
    ]);
    const first = page.find('.story-row');
    assert.strictEqual(first.querySelector('.story-child')?.textContent, '✓ Ask Ops for a window', 'a step reads with its task');
    assert.ok(first.querySelector('.story-text button[data-tag-key="#project/atlas"]'), 'a tag is the control that opens it');
    assert.ok(page.find('.story-row[data-kind="note"] .story-text strong'), 'Markdown drawn inline');
    assert.strictEqual(page.find('.story-row[data-kind="decision"] .story-kind').getAttribute('aria-label'), 'Decision');
  });

  test('selecting a row opens its line, and a task’s box completes it', () => {
    const page = atlasPage();
    page.click('.story-row[data-kind="decision"] .story-text');
    assert.deepStrictEqual(page.lastPosted('openSource'), { type: 'openSource', filePath: 'decisions/hosted-fields.md', line: 6 });
    const box = page.find('.story-row[data-kind="open"] input.story-box') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new page.window.Event('change', { bubbles: true }));
    assert.strictEqual(page.lastPosted('toggleTask')?.completed, true);
    assert.strictEqual(page.lastPosted('openSource')?.filePath, 'decisions/hosted-fields.md', 'the box opens nothing');
  });

  test('the filters are one row of chips, which ask the host to narrow the rows, and chosen again show them all', () => {
    const page = atlasPage();
    assert.deepStrictEqual(page.findAll('.story-chip').map((chip) => chip.textContent), ['All', 'Decisions', 'Done', 'Oldest first']);
    assert.strictEqual(page.find('.story-chip[data-filter="all"]').getAttribute('aria-pressed'), 'true');
    assert.ok(!page.find('.story-filters').closest('[data-zen-reveal]') && !page.find('.story-chip').hasAttribute('data-zen-reveal'), 'Zen leaves them drawn');
    page.click('.story-chip[data-filter="decisions"]');
    assert.deepStrictEqual(page.lastPosted('setStoryFilter'), { type: 'setStoryFilter', filter: 'decisions' });
    page.click('.story-order');
    assert.deepStrictEqual(page.lastPosted('setStoryOrder'), { type: 'setStoryOrder', oldestFirst: true });

    const decisions = atlasPage({ story: { filter: 'decisions', oldestFirst: true } });
    assert.deepStrictEqual(rows(decisions).map((row) => row[2]), ['We chose the hosted fields.']);
    assert.strictEqual(decisions.find('.story-order').getAttribute('aria-pressed'), 'true');
    decisions.click('.story-chip[data-filter="decisions"]');
    assert.deepStrictEqual(decisions.lastPosted('setStoryFilter'), { type: 'setStoryFilter', filter: 'all' });
  });

  test('draws a first page of rows, then Show more', () => {
    const page = atlasPage({ story: { limit: 2 } });
    assert.strictEqual(page.findAll('.story-row').length, 2);
    page.click('[data-action="story-more"]');
    assert.deepStrictEqual(page.lastPosted('showMoreStory'), { type: 'showMoreStory' });
    assert.strictEqual(atlasPage().findAll('[data-action="story-more"]').length, 0, 'nothing more to show');
  });

  test('Copy as Markdown is in ⋯ while the tab is shown, and the host writes it', () => {
    const page = atlasPage();
    page.click('.page-menu [data-action="copy-story"]');
    assert.deepStrictEqual(page.lastPosted('copyStory'), { type: 'copyStory' });
    page.click('[data-action="set-result-tab"][data-tab="notes"]');
    assert.strictEqual(page.findAll('.page-menu [data-action="copy-story"]').length, 0, 'not while Notes is shown');
  });

  test('side by side, the story is a pane under the notes and tasks', () => {
    const page = atlasPage({ layout: 'split' });
    assert.strictEqual(page.findAll('[role="tab"]').length, 0);
    assert.strictEqual(page.text('#story-heading'), 'Story (4)');
    assert.strictEqual(page.findAll('.story-pane .story-row').length, 4);
    assert.ok(page.find('.page-menu [data-action="copy-story"]'));
  });

  test('a search that is no tag’s page has no Story tab', () => {
    const snapshot = createSearchPageSnapshot(ATLAS, createPreferences(new MemoryStore()).reader.value, 'vendor', { queryContext: createQueryContext(now) });
    const page = openWebviewPage(renderPage('searchPage'), { ...snapshot, parkedTags: [] }, { savedState: { tab: 'story' } });
    pages.push(page);
    assert.deepStrictEqual(page.findAll('[role="tab"]').map((tab) => tab.getAttribute('data-tab')), ['notes', 'tasks']);
    assert.strictEqual(page.find('[data-tab="notes"]').getAttribute('aria-selected'), 'true');
  });
});
