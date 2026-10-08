import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../domain/markdown/parser';
import { createPreferences, TestPreferences } from './preferenceServices';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { renderedIcon, sourceIcon } from '../ui/webview/icons';
import { openWebviewPage, shownText, WebviewPage } from './webviewPage';
import { renderPage } from './pages';
import { createQueryContext } from '../domain/query/queryContext';
import { createSearchPageSnapshot } from '../ui/state/searchPageState';
import { SearchPageSnapshot } from '../ui/protocol/searchPage';
import { SearchPageSize } from '../domain/model';

/**
 * What a search page does, driven as VS Code drives it: the host's state goes
 * in, and the page is asked what it drew and what it posted back.
 *
 * These replace the checks that matched the page's script as text. A line of
 * script can be reformatted, or moved into a module and bundled, without any
 * of this changing; a line that stops running fails here and passed there.
 */
suite('Search page behavior', () => {
  let page: WebviewPage | undefined;
  let store: TestPreferences | undefined;

  teardown(() => {
    page?.dispose();
    page = undefined;
    store?.repository.dispose();
    store = undefined;
  });

  const open = (
    notes: Record<string, string>,
    query: string,
    options: Omit<Parameters<typeof createSearchPageSnapshot>[3], 'queryContext'> & {
      pageSize?: SearchPageSize;
    } = {},
  ): { page: WebviewPage; snapshot: SearchPageSnapshot } => {
    const index = buildWorkspaceIndex(
      new Map(
        Object.entries(notes).map(([path, content]) => [
          path,
          parseMarkdown(path, content),
        ]),
      ),
    );
    store = createPreferences(new MemoryMemento());
    const snapshot = createSearchPageSnapshot(
      index,
      options.pageSize === undefined
        ? store.reader.value
        : { ...store.reader.value, searchPageSize: options.pageSize },
      query,
      { queryContext: createQueryContext(Date.now()), ...options },
    );
    page = openWebviewPage(
      renderPage('searchPage'),
      snapshot,
    );
    return { page, snapshot };
  };

  /** A workspace with a hub note, a tagged note, and two tasks. */
  const NOTES: Record<string, string> = {
    'notes/atlas.md':
      '---\ndescribes: project/atlas\n---\n# Atlas\nThe hub note body.',
    'notes/one.md': [
      '# One #project/atlas #risk/vendor',
      'The lift is stuck.',
      '- [ ] Chase it #project/atlas',
      '- [x] Did it #project/atlas',
    ].join('\n'),
  };

  /** A search of `count` notes that all carry one tag. */
  const openMany = (
    count: number,
    options: Parameters<typeof open>[2],
  ): { page: WebviewPage; snapshot: SearchPageSnapshot } => {
    const notes: Record<string, string> = {};
    for (let index = 0; index < count; index += 1) {
      notes[`notes/note-${index}.md`] = `# Note ${index} #project/atlas\nProse.`;
    }
    return open(notes, '#project/atlas', options);
  };

  test('shows three lines of a result, and Show all opens the rest', () => {
    const long = ['Line one.', 'Line two.', 'Line three.', 'Line four.', 'Line five.'].join('\n');
    const { page, snapshot } = open({ 'notes/a.md': `# Long #work\n${long}` }, '#work');
    const body = page.find('.card .card-body');
    assert.ok(body.classList.contains('is-clamped'), 'three lines by default');
    const more = page.find('.card [data-action="toggle-card-body"]');
    assert.strictEqual(more.textContent, 'Show all');
    assert.strictEqual(more.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(more.getAttribute('aria-controls'), body.id);
    page.click('.card [data-action="toggle-card-body"]');
    assert.ok(!page.find('.card .card-body').classList.contains('is-clamped'), 'opened');
    assert.strictEqual(page.text('.card [data-action="toggle-card-body"]'), 'Show less');
    assert.strictEqual(page.find('.card [data-action="toggle-card-body"]').getAttribute('aria-expanded'), 'true');
    page.send(snapshot);
    assert.ok(!page.find('.card .card-body').classList.contains('is-clamped'), 'a redraw keeps it open');
    assert.strictEqual(page.lastPosted('openSource'), undefined, 'Show all does not open the note');
  });

  test('a result whose words are further down shows their paragraph, led by an ellipsis', () => {
    const body = ['Intro one.', 'Intro two.', 'Intro three.', '', 'The vendor review is late.'].join('\n');
    const { page } = open({ 'notes/a.md': `# Entry #work\n${body}` }, 'vendor');
    assert.ok(page.find('.card .card-snippet-lead'), 'the lead says it is from further down');
    assert.match(page.text('.card .card-body') ?? '', /vendor review/);
    assert.doesNotMatch(page.text('.card .card-body') ?? '', /Intro one/);
    page.click('.card [data-action="toggle-card-body"]');
    assert.match(page.text('.card .card-body') ?? '', /Intro one/, 'Show all shows the whole entry');
  });

  test('the gear\'s Preview shows no body, or all of it', () => {
    const long = ['One.', 'Two.', 'Three.', 'Four.'].join('\n');
    const { page, snapshot } = open({ 'notes/a.md': `# Long #work\n${long}` }, '#work');
    page.click('[data-action="set-preview"][data-value="none"]');
    assert.deepStrictEqual(page.lastPosted('setSearchPreview'), { type: 'setSearchPreview', preview: 'none' });
    page.send({ ...snapshot, preview: 'none' });
    assert.strictEqual(page.findAll('.card .card-body').length, 0);
    page.send({ ...snapshot, preview: 'full' });
    assert.ok(!page.find('.card .card-body').classList.contains('is-clamped'));
    assert.strictEqual(page.findAll('.card [data-action="toggle-card-body"]').length, 0);
  });

  test('Refine shows five values of a facet, and the rest on request', () => {
    const notes: Record<string, string> = {};
    for (let index = 0; index < 12; index += 1) {notes[`notes/n${index}.md`] = `# Note ${index} #work #t${index}`;}
    const { page, snapshot } = open(notes, '#work');
    const facet = () => page.find('.query-facet-more').closest('.query-facet') as Element;
    const values = () => facet().querySelectorAll('.query-facet-value').length;
    const total = snapshot.query.facets.find((candidate) => candidate.values.length > 5)?.values.length ?? 0;
    assert.ok(total > 5, 'a facet with more than five values');
    assert.strictEqual(values(), 5);
    const more = page.find('.query-facet-more');
    assert.strictEqual(more.textContent, `+${total - 5} more`);
    assert.strictEqual(more.getAttribute('aria-expanded'), 'false');
    page.click('.query-facet-more');
    assert.strictEqual(values(), total);
    assert.strictEqual(page.text('.query-facet-more'), 'Show fewer');
    page.send(snapshot);
    assert.strictEqual(values(), total, 'a redraw keeps it open');
    assert.ok(
      page.findAll('.query-facet').every((group) => group.querySelectorAll('.query-facet-value').length > 5 || !group.querySelector('.query-facet-more')),
      'a facet of five or fewer has no control',
    );
  });

  test('draws the notes and tasks a search found', () => {
    const { page } = open(
      {
        'notes/atlas.md': [
          '# Atlas #project/atlas',
          'The lift is still stuck.',
          '- [ ] Chase the vendor #project/atlas',
        ].join('\n'),
        'notes/other.md': '# Other\nNothing to do with it.',
      },
      '#project/atlas',
    );

    // A search of one entity tag is that entity's page, titled as the
    // entity rather than as the tag that names it.
    assert.strictEqual(page.text('h1'), 'Project: Atlas');
    assert.strictEqual(page.findAll('.card').length, 1, 'only the match is drawn');
    assert.strictEqual(page.findAll('.task-row').length, 1);
    assert.strictEqual(page.text('[data-search-count="tasks"]'), '1');
  });

  test('opens the note a card names, at its line', () => {
    const { page } = open(
      { 'notes/atlas.md': 'Intro.\n\n# Atlas #project/atlas\nThe lift.' },
      '#project/atlas',
    );

    page.click('.card');

    assert.deepStrictEqual(page.lastPosted('openSource'), {
      type: 'openSource',
      filePath: 'notes/atlas.md',
      line: 3,
    });
  });

  test('offers a closer spelling, and searches for it when pressed', () => {
    const { page } = open(
      { 'notes/atlas.md': '# Atlas\nThe elevator is stuck.' },
      'elevatr',
      {
        suggestWords: (words: readonly string[]) =>
          new Map(
            words
              .filter((word) => word === 'elevatr')
              .map((word) => [word, 'elevator']),
          ),
      },
    );

    assert.match(page.text('.did-you-mean') ?? '', /Nothing matched/);
    assert.match(page.text('.did-you-mean button') ?? '', /elevator/);

    page.click('.did-you-mean button');

    assert.deepStrictEqual(page.lastPosted('setOverviewQuery'), {
      type: 'setOverviewQuery',
      query: 'elevator',
    });
  });

  test('says nothing about spelling when the search found something', () => {
    const { page } = open(
      { 'notes/atlas.md': '# Atlas\nThe elevator is stuck.' },
      'elevator',
      {
        suggestWords: () => new Map([['elevator', 'elevators']]),
      },
    );

    assert.strictEqual(page.document.querySelector('.did-you-mean'), null);
  });

  test('draws one page of results and counts the whole search', () => {
    const { page } = openMany(25, { pageSize: 10 });

    assert.strictEqual(page.findAll('.card').length, 10, 'one page is drawn');
    assert.strictEqual(
      page.text('[data-search-count="notes"]'),
      '25',
      'the count is of the whole search, not the page',
    );
    assert.strictEqual(page.text('.pagination .page-range'), '1\u201310 of 25');
  });

  test('turns to the page a number names', () => {
    const { page } = openMany(25, { pageSize: 10 });

    page.click('.pagination .page-number[data-page="3"]');

    assert.deepStrictEqual(page.lastPosted('setResultPage'), {
      type: 'setResultPage',
      kind: 'notes',
      page: 3,
    });
  });

  test('steps to the next page, and marks the one being read', () => {
    const { page } = openMany(25, { pageSize: 10, notePage: 2 });

    assert.strictEqual(page.text('.pagination .page-range'), '11\u201320 of 25');
    assert.strictEqual(
      page.find('.pagination .page-number.is-current').textContent,
      '2',
    );
    assert.strictEqual(
      page.find('.pagination .page-number.is-current').getAttribute('aria-current'),
      'page',
    );

    page.click('.pagination .page-step[aria-label^="Next"]');

    assert.strictEqual(page.lastPosted('setResultPage')?.page, 3);
  });

  test('offers no way off either end of the pages', () => {
    const first = openMany(25, { pageSize: 10 }).page;
    assert.ok(
      first.find('.pagination .page-step[aria-label^="Previous"]').hasAttribute('disabled'),
      'the first page cannot go back',
    );
    assert.ok(
      !first.find('.pagination .page-step[aria-label^="Next"]').hasAttribute('disabled'),
    );
    first.dispose();

    const last = openMany(25, { pageSize: 10, notePage: 3 }).page;
    assert.strictEqual(last.text('.pagination .page-range'), '21\u201325 of 25');
    assert.ok(
      last.find('.pagination .page-step[aria-label^="Next"]').hasAttribute('disabled'),
      'the last page cannot go on',
    );
  });

  test('leaves out pages it cannot fit, keeping the ends and the way on', () => {
    const { page } = openMany(300, { pageSize: 10, notePage: 15 });

    const offered = page
      .findAll('.pagination [data-kind="notes"].page-number')
      .map((button) => button.textContent);
    assert.deepStrictEqual(offered, ['1', '14', '15', '16', '30']);
    assert.strictEqual(page.findAll('.pagination .page-gap').length, 2);
  });

  test('shows no pagination for a search smaller than the smallest page', () => {
    const { page } = openMany(3, { pageSize: 10 });

    assert.strictEqual(page.document.querySelector('.pagination'), null);
  });

  test('keeps the per-page chooser for a result that fills one large page', () => {
    // One page of 200 holds all 25, but the reader can still ask for ten to
    // a page, so the control has something to offer and stays.
    const { page } = openMany(25, { pageSize: 200 });

    assert.strictEqual(page.text('.pagination .page-range'), '1\u201325 of 25');
    assert.strictEqual(
      page.document.querySelector('.pagination .page-number'),
      null,
      'one page needs no page numbers',
    );
    assert.strictEqual(
      page.find('.pagination select').querySelectorAll('option').length,
      5,
    );
  });

  test('asks for a different page size, and marks the one in use', () => {
    const { page } = openMany(25, { pageSize: 10 });

    const select = page.find('.pagination select') as HTMLSelectElement;
    assert.strictEqual(select.value, '10');

    select.value = '50';
    select.dispatchEvent(new page.window.Event('change', { bubbles: true }));

    assert.deepStrictEqual(page.lastPosted('setResultsPerPage'), {
      type: 'setResultsPerPage',
      size: 50,
    });
  });

  test('narrows the whole search by the words being typed, not the page', () => {
    // The word is on the last note of a 25-note search shown ten to a page,
    // so a page that searched only what it was holding would not find it.
    const notes: Record<string, string> = {};
    for (let index = 0; index < 25; index += 1) {
      notes[`notes/note-${index}.md`] =
        `# Note ${index} #project/atlas\n${index === 24 ? 'The elevator survey.' : 'Prose.'}`;
    }
    const { page } = open(notes, '#project/atlas', {
      pageSize: 10,
      previewWords: ['elevator'],
    });

    assert.strictEqual(page.findAll('.card').length, 1);
    assert.match(page.text('.card') ?? '', /elevator/);
    // The count is of what the draft finds, so it never reports a page's
    // worth of matches against a workspace's worth of results.
    assert.strictEqual(page.text('[data-search-count="notes"]'), '1');
    assert.strictEqual(page.document.querySelector('.pagination'), null);
  });

  test('says the draft found nothing only when the search found nothing', () => {
    const notes: Record<string, string> = {};
    for (let index = 0; index < 25; index += 1) {
      notes[`notes/note-${index}.md`] = `# Note ${index} #project/atlas\nProse.`;
    }
    const { page } = open(notes, '#project/atlas', {
      pageSize: 10,
      previewWords: ['elevator'],
    });

    assert.strictEqual(page.findAll('.card').length, 0);
    assert.strictEqual(page.text('[data-search-count="notes"]'), '0');
    assert.match(page.text('.empty') ?? '', /No notes match/);
  });

  test('switches the layout, the format, and the columns', () => {
    const { page } = open(NOTES, '#project/atlas');

    page.click('[data-action="set-layout"][data-layout="split"]');
    assert.deepStrictEqual(page.lastPosted('setTagOverviewLayout'), {
      type: 'setTagOverviewLayout',
      layout: 'split',
    });

    page.click('[data-action="set-mode"][data-mode="html"]');
    assert.deepStrictEqual(page.lastPosted('setRenderMode'), {
      type: 'setRenderMode',
      mode: 'html',
    });

    page.click('[data-action="set-columns"][data-section="notes"][data-value="3"]');
    assert.deepStrictEqual(page.lastPosted('setSearchColumns'), {
      type: 'setSearchColumns',
      section: 'notes',
      columns: 3,
    });
  });

  test('each format button carries the icon of its own mode', () => {
    const { page } = open(NOTES, '#project/atlas');

    // Parsed by the same document, so both sides are serialized alike.
    const drawn = (icon: string): string => {
      const holder = page.find('body').ownerDocument.createElement('div');
      holder.innerHTML = icon;
      return holder.innerHTML;
    };
    assert.strictEqual(page.find('[data-mode="markdown"]').innerHTML, drawn(sourceIcon));
    assert.strictEqual(page.find('[data-mode="html"]').innerHTML, drawn(renderedIcon));
  });

  test('marks the control a reader is already using', () => {
    const { page } = open(NOTES, '#project/atlas');

    assert.strictEqual(
      page.find('[data-action="set-layout"][data-layout="tabs"]').getAttribute('aria-pressed'),
      'true',
    );
    assert.strictEqual(
      page.find('[data-action="set-layout"][data-layout="split"]').getAttribute('aria-pressed'),
      'false',
    );
  });

  test('moves between the notes and tasks tabs without asking the host', () => {
    const { page } = open(NOTES, '#project/atlas');

    const panel = (index: number) =>
      page.findAll('.overview-tab-panel')[index].hasAttribute('hidden');
    assert.strictEqual(panel(0), false, 'notes are shown first');
    assert.strictEqual(panel(1), true);

    page.click('[data-action="set-result-tab"][data-tab="tasks"]');

    assert.strictEqual(panel(0), true);
    assert.strictEqual(panel(1), false, 'tasks are shown now');
    assert.strictEqual(
      page.find('[data-action="set-result-tab"][data-tab="tasks"]').getAttribute('aria-selected'),
      'true',
    );
    assert.strictEqual(
      page.posted.length,
      0,
      'a tab is the page\'s own business, not the host\'s',
    );
  });

  test('says a count once per region', () => {
    const { page } = open(NOTES, '#project/atlas');
    assert.strictEqual(
      page.findAll('[data-search-count="notes"]').length,
      1,
      'in the tabs layout the tab carries the count and the heading does not repeat it',
    );
    assert.ok(
      page.find('.query-facets-count').classList.contains('visually-hidden'),
      'and the Refine strip keeps its live region without drawing the count again',
    );
    assert.ok(page.find('.page-menu [aria-label="View"] [data-action="set-sort"]'), 'Sort sits in ⋯ with the other view options');
  });

  test('marks a search box that holds a term, and shows its hint', () => {
    const { page } = open(NOTES, '#project/atlas');
    assert.strictEqual(
      page.find('.query-workspace').hasAttribute('data-has-text'),
      true,
      'a search page opens on its tag, which is a term',
    );
    assert.ok(page.find('.query-hint'), 'and the hint is in the page');
  });

  test('the result tabs behave as tabs from the keyboard', () => {
    const { page } = open(NOTES, '#project/atlas');
    const tab = (id: string) =>
      page.find(`[data-action="set-result-tab"][data-tab="${id}"]`);
    const key = (id: string, key: string) =>
      tab(id).dispatchEvent(
        new page.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );

    assert.strictEqual(tab('notes').getAttribute('tabindex'), '0', 'the chosen tab is the tab stop');
    assert.strictEqual(tab('tasks').getAttribute('tabindex'), '-1', 'the others are reached by arrow');
    assert.strictEqual(
      tab('notes').getAttribute('aria-controls'),
      page.find('.overview-tab-panel[role="tabpanel"]').id,
      'a tab names the panel it shows',
    );
    assert.strictEqual(
      page.find('#result-panel-notes').getAttribute('aria-labelledby'),
      tab('notes').id,
      'and the panel names its tab',
    );

    key('notes', 'ArrowRight');
    assert.strictEqual(tab('tasks').getAttribute('aria-selected'), 'true', 'Right chooses the next tab');
    assert.strictEqual(page.document.activeElement, tab('tasks'), 'and focuses it');
    key('tasks', 'ArrowRight');
    assert.strictEqual(tab('notes').getAttribute('aria-selected'), 'true', 'and wraps');
    key('notes', 'End');
    assert.strictEqual(tab('tasks').getAttribute('aria-selected'), 'true', 'End goes to the last');
    key('tasks', 'Home');
    assert.strictEqual(tab('notes').getAttribute('aria-selected'), 'true', 'Home to the first');
    key('notes', 'ArrowLeft');
    assert.strictEqual(tab('tasks').getAttribute('aria-selected'), 'true', 'Left wraps the other way');
  });

  test('a tag\'s context menu opens from the keyboard, and gives focus back', () => {
    const { page } = open(NOTES, '#project/atlas');
    const tag = page.find('.card [data-tag-key]') as HTMLElement;
    tag.focus();
    tag.dispatchEvent(
      new page.window.KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }),
    );
    const menu = page.find('#tag-context-menu');
    assert.strictEqual(menu.hasAttribute('hidden'), false, 'Shift+F10 opens the menu a right-click would');
    assert.strictEqual(
      page.document.activeElement,
      menu.querySelector('button'),
      'and focus is on its first item',
    );

    page.document.dispatchEvent(
      new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    assert.strictEqual(menu.hasAttribute('hidden'), true, 'Escape closes it');
    assert.strictEqual(page.document.activeElement, tag, 'and focus returns to the tag');
  });

  test('sends the reader to the results waiting on the other tab', () => {
    // A task-only search lands on Tasks rather than an empty Notes tab.
    const { page } = open(NOTES, '#project/atlas is:open');

    assert.strictEqual(page.findAll('.card').length, 0);
    const other = page.find('[data-action="show-other-results"]');
    assert.match(other.textContent ?? '', /task/);

    page.click('[data-action="show-other-results"]');
    assert.strictEqual(
      page.findAll('.overview-tab-panel')[1].hasAttribute('hidden'),
      false,
    );
  });

  test('a new search that finds nothing on the tab shown, and something on the other, shows the other', () => {
    const { page } = open(NOTES, '#project/atlas');
    const tasksShown = () => !page.findAll('.overview-tab-panel')[1].hasAttribute('hidden');
    page.click('[data-action="set-result-tab"][data-tab="notes"]');
    assert.strictEqual(tasksShown(), false, 'the reader chose Notes');

    const index = buildWorkspaceIndex(new Map(Object.entries(NOTES).map(([path, content]) => [path, parseMarkdown(path, content)])));
    const tasksOnly = createSearchPageSnapshot(index, store!.reader.value, '#project/atlas is:open', { queryContext: createQueryContext(Date.now()) });
    page.send(tasksOnly);
    assert.strictEqual(tasksShown(), true, 'only Tasks found something, so Tasks is shown');

    page.click('[data-action="set-result-tab"][data-tab="notes"]');
    page.send(tasksOnly);
    assert.strictEqual(tasksShown(), false, 'a redraw of the same search keeps the tab the reader chose');
  });

  test('each part of a tag’s progress that counts tasks is a link that searches them', () => {
    const late = new Date(Date.now() - 3 * 86_400_000);
    const day = `${late.getFullYear()}-${String(late.getMonth() + 1).padStart(2, '0')}-${String(late.getDate()).padStart(2, '0')}`;
    const { page } = open({ ...NOTES, 'notes/late.md': `# Late\n- [ ] Overdue one #project/atlas 📅 ${day}` }, '#project/atlas');
    const links = page.findAll('.tag-progress [data-action="search-progress"]');
    assert.deepStrictEqual(links.map((link) => shownText(link)), ['1/3 done (33%)', '1 overdue']);
    assert.strictEqual(shownText(page.find('.tag-progress-label')), '1/3 done (33%) · 1 overdue');
    assert.strictEqual(links[0].textContent, '1/3 done (33%)1 of 3 done, 33%', 'a screen reader is given the figure as it is spoken');
    page.click('.tag-progress [data-action="search-progress"][data-part="1"]');
    assert.deepStrictEqual(page.lastPosted('setOverviewQuery'), {
      type: 'setOverviewQuery',
      query: '#project/atlas is:overdue -is:needs-date -is:step -is:parked',
    });
  });

  test('a search that narrows the tag keeps its page: the hub folded, the part searched on, and the way back', () => {
    const late = new Date(Date.now() - 3 * 86_400_000);
    const day = `${late.getFullYear()}-${String(late.getMonth() + 1).padStart(2, '0')}-${String(late.getDate()).padStart(2, '0')}`;
    const notes = { ...NOTES, 'notes/late.md': `# Late\n- [ ] Overdue one #project/atlas 📅 ${day}` };
    const plain = open(notes, '#project/atlas');
    assert.strictEqual((plain.page.find('details.hub') as HTMLDetailsElement).open, true, 'the plain page opens its hub');
    const overdue = plain.snapshot.tagPage?.progress?.parts[1].query ?? '';
    plain.page.dispose();

    const { page } = open(notes, overdue);
    assert.ok(page.find('details.hub'), 'the hub stays');
    assert.strictEqual((page.find('details.hub') as HTMLDetailsElement).open, false, 'folded, so the tasks sit near the top');
    const on = page.find('.tag-progress [aria-pressed="true"]');
    assert.strictEqual(on.textContent, '1 overdue');
    assert.ok(shownText(page.find('.tag-progress-label')).startsWith('1/3 done (33%) · 1 overdue'), 'the bar counts the whole tag');
    page.click('.tag-progress [aria-pressed="true"]');
    assert.deepStrictEqual(page.lastPosted('setOverviewQuery'), { type: 'setOverviewQuery', query: '#project/atlas' }, 'the part on goes back to the tag');
  });

  test('says at the top of Refine where the tag’s name is written without it', () => {
    const { page } = open({ ...NOTES, 'notes/plain.md': '# Plain\nThe atlas review is late.' }, '#project/atlas');
    assert.match(page.text('.query-facets .query-facets-lead .tag-note') ?? '', /mentions? "atlas" without the tag/);
    assert.strictEqual(page.findAll('.tag-notes [data-action="show-mentions"]').length, 0, 'not among the lines under the hub');
  });

  test('shows the note that describes a tag, and offers to write one', () => {
    const { page } = open(NOTES, '#project/atlas');
    assert.match(page.text('.hub') ?? '', /The hub note body/);

    page.dispose();
    const without = open(
      { 'notes/one.md': '# One #risk/vendor\nProse.' },
      '#risk/vendor',
    ).page;
    assert.strictEqual(without.findAll('.hub').length, 0, 'no panel for a hub that is not there');
    assert.strictEqual(without.text('header .hub-offer [data-action="create-hub"]'), 'Create hub note', 'a line under the title offers one');

    without.click('[data-action="create-hub"]');
    assert.deepStrictEqual(without.lastPosted('createHubNote'), {
      type: 'createHubNote',
    });
  });

  test('completes a task from its checkbox', () => {
    const { page } = open(NOTES, '#project/atlas');

    const box = page.find('[data-action="toggle-task"]') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new page.window.Event('change', { bubbles: true }));

    const posted = page.lastPosted('toggleTask');
    assert.strictEqual(posted?.completed, true);
    assert.ok(String(posted?.taskId).length > 0, 'the task is named by its id');
  });

  test('sorts the notes a search found', () => {
    const { page } = open(NOTES, '#project/atlas');

    const sort = page.find('[data-action="set-sort"]') as HTMLSelectElement;
    sort.value = 'updated';
    sort.dispatchEvent(new page.window.Event('change', { bubbles: true }));

    assert.deepStrictEqual(page.lastPosted('setTagOverviewSort'), {
      type: 'setTagOverviewSort',
      mode: 'updated',
    });
  });

  test('renames a tag from its context menu', () => {
    const { page } = open(NOTES, '#project/atlas');

    page.find('.card [data-action="open-tag"]').dispatchEvent(
      new page.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    const menu = page.find('#tag-context-menu [data-context-action="rename-tag"]');
    menu.dispatchEvent(
      new page.window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    assert.ok(String(page.lastPosted('renameTag')?.tagKey).length > 0);
  });

  test('keeps a search under a name, from Save search…, the first row of ⋯', () => {
    const { page } = open(NOTES, '#project/atlas');
    const save = page.find('.page-menu [aria-label="Page"] .view-options-item');
    assert.strictEqual(save.getAttribute('data-action'), 'save-filter');
    assert.strictEqual(save.textContent, 'Save search…');
    assert.deepStrictEqual(page.findAll('.page-menu .view-options-section').map((section) => section.getAttribute('aria-label')), ['Page', 'View', 'Appearance', 'Help']);
    assert.strictEqual(page.findAll('.help-button').length, 0, 'Help on this page is a row of ⋯');

    page.click('[data-action="save-filter"]');

    assert.deepStrictEqual(page.lastPosted('saveTagOverviewFilter'), {
      type: 'saveTagOverviewFilter',
      query: '#project/atlas',
    });
  });

  test('draws a namespaced tag as its namespace and its value', () => {
    const { page } = open(NOTES, '#project/atlas');

    assert.strictEqual(page.text('.tag-namespace'), '#project/');
    assert.ok((page.text('.tag-value') ?? '').length > 0);
  });

  test('keeps what is being typed when the draft\'s results arrive', () => {
    const { page, snapshot } = open(NOTES, '#project/atlas');

    const box = page.find('[data-action="query-input"]') as HTMLInputElement;
    box.focus();
    box.value = 'lift';
    box.dispatchEvent(new page.window.Event('input', { bubbles: true }));
    assert.strictEqual(box.value, 'lift');

    // The host answers the draft with a fresh snapshot, which redraws the
    // page. The word being typed has to survive its own results arriving.
    page.send({ ...snapshot, draftWords: ['lift'] });

    const after = page.find('[data-action="query-input"]') as HTMLInputElement;
    assert.strictEqual(after.value, 'lift', 'the draft is still in the box');
    assert.strictEqual(
      page.document.activeElement,
      after,
      'and the caret is still in it, so the next letter lands there',
    );
  });

  test('leaves the caret where the typing was, not at the end', () => {
    const { page, snapshot } = open(NOTES, '#project/atlas');

    const box = page.find('[data-action="query-input"]') as HTMLInputElement;
    box.focus();
    box.value = 'lift survey';
    box.dispatchEvent(new page.window.Event('input', { bubbles: true }));
    // Mid-word, as it would be while a word is being corrected.
    box.setSelectionRange(4, 4);

    page.send({ ...snapshot, draftWords: ['lift', 'survey'] });

    const after = page.find('[data-action="query-input"]') as HTMLInputElement;
    assert.strictEqual(after.selectionStart, 4);
    assert.strictEqual(after.selectionEnd, 4);
  });

  test('keeps its search for a window reload', () => {
    const { page } = open(
      { 'notes/atlas.md': '# Atlas #project/atlas\nProse.' },
      '#project/atlas',
    );

    assert.deepStrictEqual(page.savedState(), {
      query: '#project/atlas',
      origin: '',
    });
  });

  test('marks the searched words in the results, and again after each draw', () => {
    const { page, snapshot } = open(
      { 'notes/a.md': '# Lift #work\nThe lift is stuck.\n- [ ] Fix the lift #work' },
      'lift',
    );
    const marked = (): string[] => page.findAll('#app mark').map((mark) => String(mark.textContent));
    assert.ok(marked().length > 0, 'the word is marked where it is written');
    assert.ok(marked().every((word) => word.toLowerCase() === 'lift'));
    assert.strictEqual(page.findAll('button mark, [data-tag-key] mark, code mark').length, 0, 'never in a control or a tag');

    // A draw of the page's own, such as another tab, draws the results
    // afresh and marks them again, as the next state from the host does.
    page.click('[data-action="set-result-tab"][data-tab="tasks"]');
    assert.ok(marked().length > 0, 'marked after a draw of the page\'s own');
    assert.ok(marked().every((word) => word.toLowerCase() === 'lift'));
    page.send(snapshot);
    assert.ok(marked().length > 0);
    assert.match(page.text('.card') ?? '', /The lift is stuck\./, 'the text reads as before');
  });

  test('marks a searched word that a pattern would read specially as written, and keeps its search', () => {
    const { page } = open(
      { 'notes/a.md': '# Languages\nLearning c++ and cxx.' },
      'c++',
    );

    const marked = page.findAll('#app mark').map((mark) => String(mark.textContent));
    assert.ok(marked.length > 0, 'the word is marked where it is written');
    assert.ok(marked.every((word) => word === 'c++'), `only "c++" is marked: ${marked.join(', ')}`);
    assert.deepStrictEqual(page.savedState(), { query: 'c++', origin: '' }, 'the state that marked it is kept for a window reload');
  });

  test('opens the page of a tag written on a card, not the note', () => {
    const { page } = open(
      { 'notes/atlas.md': '# Atlas #project/atlas #risk/vendor\nProse.' },
      '#project/atlas',
    );
    const tag = page
      .findAll('.card [data-action="open-tag"]')
      .find((button) =>
        String(button.getAttribute('data-tag-key')).includes('risk/vendor'),
      );
    assert.ok(tag, 'the card shows the other tag it carries');

    tag.dispatchEvent(
      new page.window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    assert.match(String(page.lastPosted('openTag')?.tagKey), /risk\/vendor/);
    assert.strictEqual(
      page.lastPosted('openSource'),
      undefined,
      'pressing a tag does not also open the note behind it',
    );
  });
});

class MemoryMemento implements vscode.Memento {
  private readonly values = new Map<string, unknown>();

  public keys(): readonly string[] {
    return [...this.values.keys()];
  }

  public get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.values.has(key) ? this.values.get(key) : defaultValue) as
      | T
      | undefined;
  }

  public async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}
