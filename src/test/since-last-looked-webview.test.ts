import * as assert from 'assert';

import { DAY_MS } from '../domain/markdown/calendar';
import { createQueryContext } from '../domain/query/queryContext';
import type { SinceChipKind } from '../ui/protocol/searchPage';
import { captureTagPageState, createSearchPageSnapshot } from '../ui/state/searchPageState';
import { toTagVisit } from '../ui/state/sinceLastLooked';
import { createPreferences, MemoryStore } from './preferenceServices';
import { renderPage } from './pages';
import { indexOf } from './typedWorkspace';
import { openWebviewPage, type WebviewPage } from './webviewPage';

const lines = (...text: string[]): string => text.join('\n');

/** Now: 14 Oct 2026, noon; the last visit was twelve days before. */
const now = new Date(2026, 9, 14, 12).getTime();
const before = now - 12 * DAY_MS;

const THEN = indexOf({
  'Teams/Rates.md': lines('---', 'describes: team/rates', 'lead: "@alex-rivera"', '---', '# Rates desk'),
  'notes/standup.md': lines('# Rates standup #team/rates', 'The curve feed lagged.', '- [ ] Ask Ops about the loader #team/rates'),
});

const NOW = indexOf({
  'Teams/Rates.md': lines('---', 'describes: team/rates', 'lead: "@sam-okafor"', '---', '# Rates desk'),
  'notes/standup.md': lines('# Rates standup #team/rates', 'The curve feed lagged.', '- [x] Ask Ops about the loader #team/rates', '- [ ] Book the restart window #team/rates'),
  'notes/handover.md': lines('# Lead handover #team/rates', 'Alex moves to FX.'),
});

const visit = toTagVisit(captureTagPageState(THEN, '#team/rates', createQueryContext(before)), before);

const pages: WebviewPage[] = [];

/** The Rates team's page as it is now, set beside the visit, with a chip filtering it or not. */
function ratesPage(filter?: SinceChipKind): WebviewPage {
  const snapshot = createSearchPageSnapshot(NOW, createPreferences(new MemoryStore()).reader.value, '#team/rates', {
    queryContext: createQueryContext(now),
    since: { visit, ...(filter ? { filter } : {}) },
  });
  const page = openWebviewPage(renderPage('searchPage'), { ...snapshot, parkedTags: [] });
  pages.push(page);
  return page;
}

suite('Since you last looked, drawn', () => {
  teardown(() => pages.splice(0).forEach((page) => page.dispose()));

  test('draws the band under the page’s bar, above the search box, with when and a chip for each change', () => {
    const page = ratesPage();
    const band = page.find('section.since');
    assert.strictEqual(band.getAttribute('data-zen-region'), '');
    assert.match(page.text('.since-title') ?? '', /^Since you last looked · .+, 12 days ago$/);
    assert.ok(page.find('header.page-bar').compareDocumentPosition(band) & page.window.Node.DOCUMENT_POSITION_FOLLOWING, 'under the bar');
    assert.ok(band.compareDocumentPosition(page.find('.hub')) & page.window.Node.DOCUMENT_POSITION_FOLLOWING, 'above the fields');
    assert.deepStrictEqual(page.findAll('.since-chip').map((chip) => chip.textContent), ['1 new mention', '1 field changed', '1 task done', '1 task added']);
    assert.strictEqual(page.find('.since-seen').getAttribute('data-zen-reveal'), '', 'Mark seen waits under Zen');
  });

  test('Mark seen asks the host to count the visit', () => {
    const page = ratesPage();
    page.click('.since-seen');
    assert.deepStrictEqual(page.lastPosted('markSeen'), { type: 'markSeen' });
  });

  test('a chip filters its tab, and chosen again lets it go', () => {
    const page = ratesPage();
    page.click('.since-chip[data-kind="added"]');
    assert.deepStrictEqual(page.lastPosted('setSinceFilter'), { type: 'setSinceFilter', kind: 'added' });
    const filtered = ratesPage('added');
    assert.strictEqual(filtered.find('.since-chip[data-kind="added"]').getAttribute('aria-pressed'), 'true');
    filtered.click('.since-chip[data-kind="added"]');
    assert.deepStrictEqual(filtered.lastPosted('setSinceFilter'), { type: 'setSinceFilter' });
  });

  test('the fields’ chip opens the hub card, where the changed field shows its old value once', () => {
    const page = ratesPage();
    // The reader folds the hub, as the browser tells the page.
    const hub = page.find('details.hub') as HTMLDetailsElement;
    hub.open = false;
    hub.dispatchEvent(new page.window.Event('toggle'));
    page.click('.since-chip[data-kind="fields"]');
    assert.strictEqual(page.lastPosted('setSinceFilter'), undefined, 'a field is no result to filter by');
    assert.strictEqual((page.find('details.hub') as HTMLDetailsElement).open, true);
    const lead = page.findAll('.hub-properties > div').find((row) => row.querySelector('dt')?.textContent === 'lead');
    assert.strictEqual(lead?.querySelector('.field-was')?.textContent, ' changed · was @alex-rivera');
  });

  test('heads the new notes first, then Earlier, each with its count, and marks them and the added task NEW', () => {
    const page = ratesPage();
    const headings = page.findAll('.cards > .since-group-heading').map((heading) => heading.textContent ?? '');
    assert.match(headings[0], /^New since .+ 1$/);
    assert.strictEqual(headings[1], 'Earlier 1');
    assert.deepStrictEqual(
      [...page.find('.cards').children].map((element) => (element.classList.contains('card') ? element.getAttribute('data-file-path') : 'heading')),
      ['heading', 'notes/handover.md', 'heading', 'notes/standup.md'],
    );
    assert.strictEqual(page.findAll('.card .new-label').length, 1);
    assert.deepStrictEqual(page.findAll('.task-row').filter((row) => row.querySelector('.new-label')).map((row) => row.querySelector('.task-title')?.textContent?.trim()), ['Book the restart window #team/rates']);
  });
});
