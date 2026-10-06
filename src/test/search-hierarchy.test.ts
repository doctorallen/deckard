import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';
import type { SearchHierarchy, TagOverviewLayout } from '../domain/model';
import { createSearchPageSnapshot } from '../ui/state/searchPageState';
import { collectTagParts } from '../domain/tasks/tagParts';
import type { SearchPageSnapshot } from '../ui/protocol/searchPage';
import { createPreferences } from './preferenceServices';
import { openWebviewPage, shownText, type WebviewPage } from './webviewPage';
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
    assert.strictEqual(tasks.querySelector('.result-group-progress-label [aria-hidden="true"]')?.textContent, '1/2 done (50%)');
    assert.strictEqual(tasks.querySelector('.result-group-progress-label .visually-hidden')?.textContent, '1 of 2 done, 50%', 'as a screen reader is given it');
    assert.strictEqual(tasks.querySelectorAll('.card').length, 0);
    (tasks.querySelector('.result-group-tag') as HTMLElement).click();
    assert.deepStrictEqual(page.lastPosted('setOverviewQuery'), { type: 'setOverviewQuery', query: '#project/atlas AND #decision/accepted', remember: false });
  });

  test('side by side, each group is a row of its notes beside its tasks', () => {
    page = openWebviewPage(renderPage('searchPage'), snapshotOf(PLAN, '#project/atlas', { layout: 'split' }));
    const decision = groupIn('.overview-split-groups', '#decision/accepted');
    assert.strictEqual(decision.querySelector('.result-group-count')?.textContent, '1 note · 2 tasks');
    assert.strictEqual(decision.querySelector('.result-group-progress-label [aria-hidden="true"]')?.textContent, '1/2 done (50%)');
    const [notes, tasks] = Array.from(decision.querySelectorAll('.result-group-column'));
    assert.strictEqual(notes.querySelectorAll('.card').length, 1);
    assert.strictEqual(tasks.querySelectorAll('.task-row').length, 2);
    assert.strictEqual(tasks.firstElementChild?.className, 'result-group-progress', 'the progress heads the tasks');
    assert.strictEqual(decision.querySelector('.result-group-header .progress-bar'), null);
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

suite('Search page: hierarchy by heading', () => {
  let page: WebviewPage | undefined;

  teardown(() => {
    page?.dispose();
    page = undefined;
  });

  /** Two projects for one client, each H1 a project and each H2 a part of it. */
  const PROJECTS: Record<string, string> = {
    'projects/checkout-v2.md': [
      '# Checkout v2 #project/checkout-v2 #client/acme',
      '- [x] Kickoff with finance',
      '## Design #phase/design',
      '- [x] Wireframes',
      '- [x] Review with legal',
      '- [ ] Final mockups',
      '## Build #phase/build',
      '- [x] Hosted fields spike',
      '- [ ] Error mapping',
      '- [ ] Load test',
    ].join('\n'),
    'projects/argent.md': [
      '# Argent #project/argent #client/acme',
      '- [ ] Confirm budget',
      '## Design #phase/design',
      '- [x] Brand review',
      '- [ ] Icon set',
      '## Launch #phase/launch',
      '- [ ] Press kit',
      '- [ ] Launch checklist',
    ].join('\n'),
    'notes/loose.md': '# Loose note #client/acme\nNo project here.',
  };

  const snapshotOf = (layout: TagOverviewLayout = 'tabs'): SearchPageSnapshot => {
    const index = buildWorkspaceIndex(new Map(Object.entries(PROJECTS).map(([path, content]) => [path, parseMarkdown(path, content)])));
    const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
    return createSearchPageSnapshot(index, { ...store.reader.value, tagOverviewLayout: layout, searchHierarchy: 'headings' }, '#client/acme', { queryContext: createQueryContext(Date.now()) });
  };

  /** Each level as its tag, its counts, and the levels inside it. */
  type Level = [string, string, Level[]];
  const levels = (groups: readonly NonNullable<SearchPageSnapshot['groups']>[number][]): Level[] =>
    groups.map((group) => [group.tag?.label ?? '(none)', `${group.noteCount}n ${group.taskCount}t ${group.doneCount}d`, levels(group.children ?? [])]);

  test('nests each project\'s parts under it, each part its own project\'s, the counts rolled up', () => {
    assert.deepStrictEqual(levels(snapshotOf().groups ?? []), [
      ['#project/argent', '3n 5t 1d', [['#phase/design', '1n 2t 1d', []], ['#phase/launch', '1n 2t 0d', []]]],
      ['#project/checkout-v2', '3n 7t 4d', [['#phase/design', '1n 3t 2d', []], ['#phase/build', '1n 3t 1d', []]]],
      ['(none)', '1n 0t 0d', []],
    ], 'in the order the notes write them');
  });

  test('a project holds its own tasks above its parts, and a part narrows the search to itself in its project', () => {
    const checkout = (snapshotOf().groups ?? []).find((group) => group.tag?.label === '#project/checkout-v2') as NonNullable<SearchPageSnapshot['groups']>[number];
    assert.deepStrictEqual(checkout.tasks.map((item) => item.task.title), ['Kickoff with finance']);
    assert.deepStrictEqual([checkout.ownNoteCount, checkout.ownTaskCount], [1, 1]);
    assert.strictEqual(checkout.tag?.clause, '#project/checkout-v2');
    assert.strictEqual(checkout.children?.[0].tag?.clause, '(#project/checkout-v2 AND #phase/design)');
  });

  test('draws the parts inside their project, side by side, with the project\'s bar counting them', () => {
    page = openWebviewPage(renderPage('searchPage'), snapshotOf('split'));
    const project = page.findAll('.overview-split-groups > .result-groups > .result-group').find((group) => group.querySelector('.result-group-tag')?.textContent === '#project/checkout-v2') as Element;
    assert.strictEqual(project.querySelector('.result-group-heading')?.tagName, 'H2');
    assert.strictEqual(shownText(project.querySelector(':scope > .result-group-columns .result-group-progress-label')), '4/7 done (57%)');
    const parts = Array.from(project.querySelectorAll(':scope > .result-subgroups > .result-group.is-part'));
    assert.deepStrictEqual(parts.map((part) => part.querySelector('.result-group-tag')?.textContent), ['#phase/design', '#phase/build']);
    assert.strictEqual(parts[0].querySelector('.result-group-heading')?.tagName, 'H3', 'a part is a level below its project');
    assert.strictEqual(shownText(parts[0].querySelector('.result-group-progress-label')), '2/3 done (67%)');
    const ids = page.findAll('.result-group-heading').map((heading) => heading.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'every heading has an id of its own');
  });

  test('on a project\'s own page, its parts come first, and its own work is not in any part', () => {
    const index = buildWorkspaceIndex(new Map(Object.entries(PROJECTS).map(([path, content]) => [path, parseMarkdown(path, content)])));
    const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
    const own = createSearchPageSnapshot(index, { ...store.reader.value, searchHierarchy: 'headings' }, '#project/checkout-v2', { queryContext: createQueryContext(Date.now()) });
    assert.deepStrictEqual(levels(own.groups ?? []), [
      ['#phase/design', '1n 3t 2d', []],
      ['#phase/build', '1n 3t 1d', []],
      ['(none)', '1n 1t 1d', []],
    ]);
    page = openWebviewPage(renderPage('searchPage'), own);
    const headings = page.findAll('#result-panel-notes .result-group-heading').map((heading) => heading.textContent);
    assert.strictEqual(headings[headings.length - 1], 'Not in any part');
  });

  test('the gear offers it beside By tag', () => {
    page = openWebviewPage(renderPage('searchPage'), snapshotOf());
    page.click('[data-action="set-hierarchy"][data-value="headings"]');
    assert.deepStrictEqual(page.lastPosted('setSearchHierarchy'), { type: 'setSearchHierarchy', hierarchy: 'headings' });
    assert.ok(page.find('[data-action="set-hierarchy"][data-value="headings"]').classList.contains('active'), 'and shows it chosen');
  });
});

suite('A project\'s parts on its tag\'s page', () => {
  let page: WebviewPage | undefined;

  teardown(() => {
    page?.dispose();
    page = undefined;
  });

  const NOTES: Record<string, string> = {
    'projects/checkout-v2.md': [
      '# Checkout v2 #project/checkout-v2',
      '- [x] Kickoff with finance',
      '## Design #phase/design',
      '- [x] Wireframes',
      '- [ ] Final mockups',
      '  - [ ] A step, part of its task',
      '### Icons #topic/icons',
      '- [ ] Draw the icons',
      '## Build #phase/build',
      '- [ ] Error mapping',
    ].join('\n'),
    'meetings/sync.md': '# Payments sync #project/checkout-v2\n## Design #phase/design\n- [x] Review with legal',
    'projects/argent.md': '---\ntags: [project/argent]\n---\n# Argent\n## Launch #phase/launch\n- [ ] Press kit',
  };

  const indexOf = () => buildWorkspaceIndex(new Map(Object.entries(NOTES).map(([path, content]) => [path, parseMarkdown(path, content)])));

  test('counts each part\'s tasks across the project\'s notes, a deeper tagged heading in its part, steps aside', () => {
    const parts = collectTagParts(indexOf(), '#project/checkout-v2', Date.now());
    assert.deepStrictEqual(parts.map((part) => [part.label, part.progress.done, part.progress.total]), [
      ['#phase/design', 2, 4],
      ['#phase/build', 0, 1],
    ], 'Design holds the meeting\'s task and the Icons heading\'s, ordered as the notes first give them');
  });

  test('a note tagged in its front matter has parts too, and a tag with no tagged heading under it has none', () => {
    assert.deepStrictEqual(collectTagParts(indexOf(), '#project/argent', Date.now()).map((part) => part.label), ['#phase/launch']);
    assert.deepStrictEqual(collectTagParts(indexOf(), '#phase/build', Date.now()), []);
  });

  test('the tag\'s page lists its parts under its progress, each narrowing the page to it, and back', () => {
    const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
    const snapshot = createSearchPageSnapshot(indexOf(), store.reader.value, '#project/checkout-v2', { queryContext: createQueryContext(Date.now()) });
    page = openWebviewPage(renderPage('searchPage'), snapshot);
    const links = page.findAll('.tag-parts [data-action="search-part"]');
    assert.deepStrictEqual(links.map((link) => shownText(link)), ['#phase/design 2/4 done (50%)', '#phase/build 0/1 done (0%)']);
    page.click('.tag-parts [data-part="0"]');
    assert.deepStrictEqual(page.lastPosted('setOverviewQuery'), { type: 'setOverviewQuery', query: '#project/checkout-v2 AND #phase/design' });

    const narrowed = createSearchPageSnapshot(indexOf(), store.reader.value, '#project/checkout-v2 AND #phase/design', { queryContext: createQueryContext(Date.now()) });
    page.dispose();
    page = openWebviewPage(renderPage('searchPage'), narrowed);
    assert.ok(page.find('.tag-parts [data-part="0"]').classList.contains('is-on'), 'the part the page is narrowed to is on');
    page.click('.tag-parts [data-part="0"]');
    assert.deepStrictEqual(page.lastPosted('setOverviewQuery'), { type: 'setOverviewQuery', query: '#project/checkout-v2' }, 'and goes back to the project');
  });
});
