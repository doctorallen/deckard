import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';
import type { SearchHierarchy, TagOverviewLayout } from '../domain/model';
import { createSearchPageSnapshot } from '../ui/state/searchPageState';
import type { SearchPageSnapshot } from '../ui/protocol/searchPage';
import { createPreferences } from './preferenceServices';
import { openWebviewPage, type WebviewPage } from './webviewPage';
import { renderPage } from './pages';

/**
 * The search page's hierarchy, in either layout: the results under each tag
 * Refine offers, each shown where it is most specific, and no card repeating
 * the text of a heading that is a note of its own, or its tasks.
 */
suite('Search page: Hierarchy', () => {
  let page: WebviewPage | undefined;

  teardown(() => {
    page?.dispose();
    page = undefined;
  });

  const snapshotOf = (
    notes: Record<string, string>,
    query: string,
    { layout = 'tabs', hierarchy = 'tags' }: { layout?: TagOverviewLayout; hierarchy?: SearchHierarchy } = {},
  ): SearchPageSnapshot => {
    const index = buildWorkspaceIndex(new Map(Object.entries(notes).map(([path, content]) => [path, parseMarkdown(path, content)])));
    const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
    return createSearchPageSnapshot(index, { ...store.reader.value, tagOverviewLayout: layout, ...(hierarchy === 'tags' ? { searchHierarchy: 'tags' as const } : {}) }, query, { queryContext: createQueryContext(Date.now()) });
  };

  const PLAN: Record<string, string> = {
    'notes/atlas.md': [
      '# Atlas plan #project/atlas #client/acme',
      'The overview.',
      '## Decision #decision/accepted',
      'We chose the hosted fields.',
      '- [x] Sign the contract',
      '- [ ] Map the errors',
      '- [ ] Ask the client #client/acme',
      '## Risks',
      'The lift is stuck.',
      '- [ ] Chase the vendor #risk/vendor',
    ].join('\n'),
    'notes/other.md': '# Other #project/atlas\nNothing else.',
  };

  /** A card's heading without the tags written on it. */
  const titleOf = (heading: string): string => heading.replace(/\s+#\S+/g, '').trim();

  /** Each group's tag, or none, with the titles of its notes and tasks. */
  const groupsOf = (snapshot: SearchPageSnapshot) =>
    (snapshot.groups ?? []).map((group) => ({
      tag: group.tag?.clause,
      notes: group.notes.map((card) => titleOf(card.heading)),
      tasks: group.tasks.map((item) => titleOf(item.task.title)),
    }));

  test('groups the results under Refine\'s tags, each where it is most specific', () => {
    const snapshot = snapshotOf(PLAN, '#project/atlas');
    const offered = snapshot.query.facets.find((facet) => facet.id === 'related')?.values.map((value) => value.clause) ?? [];
    const groups = groupsOf(snapshot);
    assert.deepStrictEqual(groups.filter((group) => group.tag).map((group) => group.tag), offered.filter((clause) => groups.some((group) => group.tag === clause)), 'in Refine\'s order');
    const byTag = (tag: string | undefined) => groups.find((group) => group.tag === tag);
    // The plan carries client/acme itself; its Decision inherits it but has a
    // tag of its own. A task goes by its own line's tags first, then its
    // heading's: the vendor task's tag is not one Refine offers, so it sits
    // with the plan whose untagged Risks heading it is under.
    assert.deepStrictEqual(byTag('#client/acme'), { tag: '#client/acme', notes: ['Atlas plan'], tasks: ['Ask the client', 'Chase the vendor'] });
    assert.deepStrictEqual(byTag('#decision/accepted'), { tag: '#decision/accepted', notes: ['Decision'], tasks: ['Sign the contract', 'Map the errors'] });
    assert.deepStrictEqual(byTag(undefined), { tag: undefined, notes: ['Other'], tasks: [] }, 'what carries none of them comes last');
  });

  test('counts each group\'s tasks and how many are done', () => {
    const group = snapshotOf(PLAN, '#project/atlas').groups?.find((candidate) => candidate.tag?.clause === '#decision/accepted');
    assert.deepStrictEqual([group?.taskCount, group?.doneCount, group?.noteCount], [2, 1, 1]);
  });

  /** The group for a tag inside a part of the page. */
  const groupIn = (container: string, tag: string): Element =>
    (page as WebviewPage).findAll(`${container} .result-group`).find((group) => group.querySelector('.result-group-tag')?.textContent === tag) as Element;

  test('in tabs, the Notes tab groups the notes and the Tasks tab the tasks, with their progress', () => {
    page = openWebviewPage(renderPage('searchPage'), snapshotOf(PLAN, '#project/atlas'));
    assert.ok(page.findAll('[role="tab"]').length >= 2, 'the Notes and Tasks tabs stay');
    const notes = groupIn('#result-panel-notes', '#decision/accepted');
    const tasks = groupIn('#result-panel-tasks', '#decision/accepted');
    assert.ok(notes && tasks, 'the decision group in both tabs');
    assert.strictEqual(notes.querySelector('.result-group-count')?.textContent, '1 note');
    assert.strictEqual(notes.querySelector('.progress-bar'), null, 'the notes tab draws no bar');
    assert.strictEqual(notes.querySelectorAll('.task-row').length, 0);
    assert.strictEqual(tasks.querySelector('.result-group-count')?.textContent, '2 tasks');
    assert.strictEqual(tasks.querySelector('.result-group-progress-label')?.textContent, '1 of 2 done');
    assert.strictEqual(tasks.querySelectorAll('.card').length, 0);
    (tasks.querySelector('.result-group-tag') as HTMLElement).click();
    assert.deepStrictEqual(page.lastPosted('setOverviewQuery'), { type: 'setOverviewQuery', query: '#project/atlas AND #decision/accepted', remember: false });
  });

  test('side by side, each group is a row of its notes beside its tasks', () => {
    page = openWebviewPage(renderPage('searchPage'), snapshotOf(PLAN, '#project/atlas', { layout: 'split' }));
    const decision = groupIn('.overview-split-groups', '#decision/accepted');
    assert.strictEqual(decision.querySelector('.result-group-count')?.textContent, '1 note · 2 tasks');
    assert.strictEqual(decision.querySelector('.result-group-progress-label')?.textContent, '1 of 2 done');
    const [notes, tasks] = Array.from(decision.querySelectorAll('.result-group-column'));
    assert.strictEqual(notes.querySelectorAll('.card').length, 1);
    assert.strictEqual(tasks.querySelectorAll('.task-row').length, 2);
    assert.strictEqual(page.findAll('[role="tab"]').length, 0, 'no tabs side by side');
  });

  test('a grouped card leaves out its task lines, which are listed under it', () => {
    const decision = snapshotOf(PLAN, '#project/atlas').groups?.find((group) => group.tag?.clause === '#decision/accepted')?.notes[0];
    assert.ok(decision?.rawContent.includes('We chose the hosted fields.'));
    assert.ok(!decision?.rawContent.includes('Sign the contract'), decision?.rawContent);
    const ungrouped = snapshotOf(PLAN, '#project/atlas', { hierarchy: 'off' }).sections.find((card) => card.heading.startsWith('Decision'));
    assert.ok(ungrouped?.rawContent.includes('Sign the contract'), 'without the hierarchy a card is as written');
  });

  test('the gear turns the hierarchy on and off, apart from the layout', () => {
    page = openWebviewPage(renderPage('searchPage'), snapshotOf(PLAN, '#project/atlas', { hierarchy: 'off' }));
    page.click('[data-action="set-hierarchy"][data-value="tags"]');
    assert.deepStrictEqual(page.lastPosted('setSearchHierarchy'), { type: 'setSearchHierarchy', hierarchy: 'tags' });
  });

  test('a group with more than it draws offers the rest as a narrower search', () => {
    const notes: Record<string, string> = {};
    for (let at = 0; at < 14; at += 1) {
      notes[`notes/n${at}.md`] = `# Note ${at} #work #topic/a\nProse.`;
    }
    notes['notes/b.md'] = '# Lone #work #topic/b\nProse.';
    const snapshot = snapshotOf(notes, '#work');
    const group = snapshot.groups?.find((candidate) => candidate.tag?.clause === '#topic/a');
    assert.deepStrictEqual([group?.notes.length, group?.noteCount], [10, 14]);
    page = openWebviewPage(renderPage('searchPage'), snapshot);
    assert.ok(page.findAll('.result-group-more button').some((button) => button.textContent === 'Show all 14 notes in #topic/a'));
  });

  test('a search Refine has no tags for is one group', () => {
    const snapshot = snapshotOf({ 'notes/a.md': '# Alpha\nPlain words.' }, 'plain');
    assert.deepStrictEqual(groupsOf(snapshot), [{ tag: undefined, notes: ['Alpha'], tasks: [] }]);
    page = openWebviewPage(renderPage('searchPage'), snapshot);
    assert.strictEqual(page.text('.result-groups-note'), 'Refine has no tags to group these results by.');
    assert.strictEqual(page.text('.result-group-heading'), 'Results');
  });

  test('with the hierarchy off, no groups are sent', () => {
    assert.strictEqual(snapshotOf(PLAN, '#project/atlas', { hierarchy: 'off' }).groups, undefined);
  });
});

suite('Search cards never repeat a note of their own', () => {
  const snapshotOf = (notes: Record<string, string>, query: string, preview: 'full' | 'lines' = 'full'): SearchPageSnapshot => {
    const index = buildWorkspaceIndex(new Map(Object.entries(notes).map(([path, content]) => [path, parseMarkdown(path, content)])));
    const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
    return createSearchPageSnapshot(index, { ...store.reader.value, searchPreview: preview }, query, { queryContext: createQueryContext(Date.now()) });
  };
  const titleOf = (heading: string): string => heading.replace(/\s+#\S+/g, '').trim();
  const cardText = (snapshot: SearchPageSnapshot, heading: string): string =>
    snapshot.sections.find((card) => titleOf(card.heading) === heading)?.rawContent ?? '';

  test('a tagged heading whose only headings are tagged leaves their text to their cards', () => {
    const snapshot = snapshotOf({ 'notes/p.md': '# Parent #p\nParent body.\n## Child #c\nChild body.' }, '#p');
    assert.ok(cardText(snapshot, 'Parent').includes('Parent body.'));
    assert.ok(!cardText(snapshot, 'Parent').includes('Child body.'), 'the child is a card of its own');
    assert.ok(cardText(snapshot, 'Child').includes('Child body.'));
  });

  const BETA = [
    '---',
    'tags: [project/beta]',
    '---',
    '# Beta',
    'Intro.',
    '## Detail',
    'Detail text.',
    '## Milestone #milestone/one',
    'The zebra milestone.',
  ].join('\n');

  test('a note tagged in its front matter draws its own text, not a heading with tags of its own', () => {
    const snapshot = snapshotOf({ 'notes/beta.md': BETA }, '#project/beta');
    const beta = cardText(snapshot, 'Beta');
    assert.ok(beta.includes('Intro.') && beta.includes('Detail text.'), beta);
    assert.ok(!beta.includes('zebra'), 'the milestone is a card of its own');
    assert.ok(!beta.startsWith('# Beta'), 'the title is the card\'s heading, not its first line');
  });

  test('a word under a heading with tags of its own finds that note alone', () => {
    const snapshot = snapshotOf({ 'notes/beta.md': BETA }, 'zebra');
    assert.deepStrictEqual(snapshot.sections.map((card) => titleOf(card.heading)), ['Milestone']);
  });

  test('a match in a front-matter note\'s owned heading opens at its line and names it', () => {
    const snapshot = snapshotOf({ 'notes/beta.md': [...BETA.split('\n').slice(0, 7), '', 'More.', 'Further.', 'The detail word quokka.'].join('\n') }, 'quokka', 'lines');
    const card = snapshot.sections.find((candidate) => candidate.heading === 'Beta');
    assert.strictEqual(card?.snippet?.line, 9, 'the paragraph holding the word');
    assert.strictEqual(card?.snippet?.heading, 'Detail');
  });
});
