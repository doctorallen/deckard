import * as assert from 'assert';

import { createQueryContext, type QueryContext } from '../domain/query/queryContext';
import { betweenQueries } from '../ui/state/betweenYou';
import { createSearchPageSnapshot } from '../ui/state/searchPageState';
import { createPreferences, MemoryStore } from './preferenceServices';
import { renderPage } from './pages';
import { indexOf } from './typedWorkspace';
import { openWebviewPage, type WebviewPage } from './webviewPage';

const lines = (...text: string[]): string => text.join('\n');

/** The moment the page is drawn at: 14 Oct 2026, noon. */
const now = new Date(2026, 9, 14, 12).getTime();

const index = indexOf({
  'People/Sam Okafor.md': lines('---', 'describes: "@sam-okafor"', '---', '# Sam Okafor'),
  'notes/2026-10-02.md': lines(
    '# 2026-10-02',
    '- [ ] Send @sam-okafor the recon field mapping 📅 2026-10-06',
    '- [ ] Rates lineage diagram 👤 @sam-okafor',
    '- [ ] Chase the vendor @sam-okafor 👤 @lena-brandt',
    '- [?] Who approves access to the bond UAT? @sam-okafor',
  ),
  'notes/quiet.md': lines('# Quiet @quiet', '- [x] Done with @quiet'),
});

const pages: WebviewPage[] = [];

/** A search page drawn for a search, as the reader named in `context` reads it. */
function searchPage(query: string, context: QueryContext = createQueryContext(now, { identity: '@david' }), notes = index): WebviewPage {
  const preferences = createPreferences(new MemoryStore()).reader.value;
  const snapshot = createSearchPageSnapshot(notes, preferences, query, { queryContext: context });
  const page = openWebviewPage(renderPage('searchPage'), { ...snapshot, parkedTags: [] });
  pages.push(page);
  return page;
}

suite('Between you, drawn', () => {
  teardown(() => pages.splice(0).forEach((page) => page.dispose()));

  test('draws the card between the hub and the tabs, each group with its label, count, and tasks', () => {
    const page = searchPage('@sam-okafor');
    const card = page.find('section.between');
    assert.strictEqual(card.getAttribute('data-zen-region'), '');
    assert.strictEqual(page.text('.between-title'), 'Between you');
    const order = [...page.document.querySelectorAll('.hub, section.between, .result-tabs, [role="tablist"]')].map((element) => element.className.split(' ')[0] || element.getAttribute('role'));
    assert.ok(order.indexOf('hub') < order.indexOf('between'), `the card is under the hub: ${order.join(', ')}`);
    assert.ok(card.compareDocumentPosition(page.find('[role="tablist"]')) & page.window.Node.DOCUMENT_POSITION_FOLLOWING, 'and above the tabs');
    assert.deepStrictEqual(
      page.findAll('.between-group').map((group) => [
        group.querySelector('.between-group-label')?.textContent,
        group.querySelector('.between-count')?.textContent,
        [...group.querySelectorAll('.task-row .task-title')].map((title) => title.textContent?.trim()),
      ]),
      [
        ['You owe Sam', '1', ['Send @sam-okafor the recon field mapping']],
        ['Sam owes you', '1', ['Rates lineage diagram']],
        ['To ask Sam', '1', []],
      ],
    );
    assert.match(page.text('.between-group[data-group="youOwe"] .due-date') ?? '', /^Overdue/, 'an overdue date reads as overdue');
  });

  test('a row’s box completes it, and the row opens where it is written', () => {
    const page = searchPage('@sam-okafor');
    const box = page.find('.between-group[data-group="theyOwe"] input[data-action="toggle-task"]') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new page.window.Event('change', { bubbles: true }));
    assert.deepStrictEqual(page.lastPosted('toggleTask'), { type: 'toggleTask', taskId: box.dataset.taskId, completed: true });
    page.click('.between-group[data-group="theyOwe"] .task-row .task-title');
    assert.deepStrictEqual(page.lastPosted('openSource'), { type: 'openSource', filePath: 'notes/2026-10-02.md', line: 3 });
  });

  test('To ask lists the questions as the Questions tab does: each opens its line and offers Answer…, quiet under Zen', () => {
    const page = searchPage('@sam-okafor');
    const rows = page.findAll('.between-group[data-group="toAsk"] .search-question');
    assert.deepStrictEqual(rows.map((row) => row.querySelector('.search-question-text')?.textContent), ['Who approves access to the bond UAT?']);
    page.click('.between-group[data-group="toAsk"] .search-question-open');
    assert.deepStrictEqual(page.lastPosted('openSource'), { type: 'openSource', filePath: 'notes/2026-10-02.md', line: 5 });
    const answer = page.find('.between-group[data-group="toAsk"] [data-action="answer-question"]');
    assert.strictEqual(answer.getAttribute('data-zen-reveal'), '');
    page.click('.between-group[data-group="toAsk"] [data-action="answer-question"]');
    assert.strictEqual(page.lastPosted('questionAction')?.action, 'answer');
    page.click('.between-group[data-group="toAsk"] .between-group-label');
    assert.deepStrictEqual(page.lastPosted('openSearch'), { type: 'openSearch', query: betweenQueries('@sam-okafor').toAsk });
  });

  test('a group’s label opens its search, and Copy as agenda asks the host for the text, quieted under Zen', () => {
    const page = searchPage('@sam-okafor');
    page.click('.between-group[data-group="theyOwe"] .between-group-label');
    assert.deepStrictEqual(page.lastPosted('openSearch'), { type: 'openSearch', query: betweenQueries('@sam-okafor').theyOwe });
    const copy = page.find('.between-copy');
    assert.strictEqual(copy.textContent, 'Copy as agenda');
    assert.strictEqual(copy.getAttribute('data-zen-reveal'), '');
    page.click('.between-copy');
    assert.deepStrictEqual(page.lastPosted('copyBetweenAgenda'), { type: 'copyBetweenAgenda' });
  });

  test('says so while deckard.me names nobody, with the setting a click away', () => {
    const page = searchPage('@sam-okafor', createQueryContext(now));
    assert.match(page.text('.between-identity') ?? '', /only tasks for nobody count as yours/);
    page.click('.between-identity [data-action="set-identity"]');
    assert.deepStrictEqual(page.lastPosted('openIdentitySetting'), { type: 'openIdentitySetting' });
    assert.strictEqual(searchPage('@sam-okafor').findAll('.between-identity').length, 0);
  });

  test('draws no card for someone with nothing open between you, nor on a page that is no person’s', () => {
    assert.strictEqual(searchPage('@quiet').findAll('section.between').length, 0);
    assert.strictEqual(searchPage('is:open').findAll('section.between').length, 0);
  });

  test('a group with nothing in it says so', () => {
    const page = searchPage('@ren', undefined, indexOf({ 'notes/a.md': lines('# A', '- [ ] Ping @ren') }));
    assert.strictEqual(page.text('.between-group[data-group="theyOwe"] .between-none'), 'Nothing open.');
    assert.strictEqual(page.text('.between-group[data-group="theyOwe"] .between-count'), '0');
  });
});
