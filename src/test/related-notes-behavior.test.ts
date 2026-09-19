import * as assert from 'assert';

import { RankedNote, SidebarNotesSnapshot } from '../core/types';
import { getSidebarNotesHtml } from '../ui/webview/sidebarNotesHtml';
import { openWebviewPage, WebviewPage } from './webviewPage';

/**
 * What the Related Notes sidebar does with the results it is given.
 *
 * Driven as VS Code drives it, so these hold for the page's behavior rather
 * than for the text of its script; see `webviewPage.ts`.
 */
suite('Related Notes behavior', () => {
  let page: WebviewPage | undefined;

  teardown(() => {
    page?.dispose();
    page = undefined;
  });

  const open = (snapshot: Partial<SidebarNotesSnapshot>): WebviewPage => {
    page = openWebviewPage(
      getSidebarNotesHtml({ cspSource: 'vscode-webview://deckard' }, '1.0.0'),
      {
        activeFileName: 'today.md',
        activeTags: [],
        notes: [],
        tagTitleDisplayMode: 'inline',
        state: 'ready',
        ...snapshot,
      },
    );
    return page;
  };

  const note = (values: Partial<RankedNote> = {}): RankedNote => ({
    sectionId: 'section-1',
    filePath: 'notes/atlas.md',
    title: 'Check-in',
    fileName: 'atlas.md',
    sourceLine: 12,
    headingPath: ['Atlas', 'Check-in'],
    titleTags: [],
    matchedTags: [],
    matchCount: 1,
    totalTagCount: 1,
    overlap: 1,
    relevanceScore: 84,
    ...values,
  });

  test('lists each result with its score and where it came from', () => {
    const page = open({ notes: [note()] });

    assert.strictEqual(page.findAll('.note').length, 1);
    assert.match(page.text('.note-title') ?? '', /Check-in/);
    assert.match(page.text('.relevance-score') ?? '', /84%/);
    assert.match(page.text('.source') ?? '', /atlas\.md \/ line 12/);
  });

  test('opens a result at its line, and beside the note when asked', () => {
    const page = open({ notes: [note()] });

    page.click('.note');
    assert.deepStrictEqual(page.lastPosted('openSource'), {
      type: 'openSource',
      filePath: 'notes/atlas.md',
      line: 12,
      beside: false,
    });

    page.find('.note').dispatchEvent(
      new page.window.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        metaKey: true,
      }),
    );
    assert.strictEqual(page.lastPosted('openSource')?.beside, true);
  });

  test('writes a link to a result at the cursor', () => {
    const page = open({ notes: [note()] });

    const button = page.find('.note [data-action="insert-link"]');
    assert.match(
      String(button.getAttribute('aria-label')),
      /Insert a link to Check-in/,
    );

    page.click('.note [data-action="insert-link"]');

    assert.deepStrictEqual(page.lastPosted('insertLink'), {
      type: 'insertLink',
      filePath: 'notes/atlas.md',
      line: 12,
    });
    assert.strictEqual(
      page.lastPosted('openSource'),
      undefined,
      'writing a link does not also open the result',
    );
  });

  test('opens a matching tag rather than the result carrying it', () => {
    // Matching tags are listed beneath a result only when titles are drawn
    // without their tags; inline, the title already carries them.
    const page = open({
      tagTitleDisplayMode: 'separate',
      notes: [
        note({
          matchedTags: [{ key: '#project/atlas', label: 'project/atlas' }],
        }),
      ],
    });

    page.click('.tag-list [data-action="open-tag"]');

    assert.strictEqual(
      page.lastPosted('openTag')?.tagKey,
      '#project/atlas',
    );
    assert.strictEqual(page.lastPosted('openSource'), undefined);
  });

  test('explains a score from its signals, and sorts the list', () => {
    const page = open({
      notes: [
        note({
          reasons: ['Shares #project/atlas'],
          relevanceEvidence: {
            directTagWeight: 1.5,
            associationWeight: 0.4,
            normalizedAssociationWeight: 0.4,
            appliedAssociationWeight: 0.4,
            entryLinkWeight: 0,
            fileLinkWeight: 0,
            lexicalWeight: 0,
            recencyWeight: 0,
            specificityPenalty: 0.2,
            lexicalTerms: [],
          },
        }),
      ],
      relatedNotesSortMode: 'tags',
    });

    const tooltip = page.find('.relevance-tooltip');
    assert.match(tooltip.textContent ?? '', /Shares #project\/atlas/);
    assert.match(tooltip.textContent ?? '', /Shared-tag weight/);
    assert.match(tooltip.textContent ?? '', /Association weight/);
    assert.match(tooltip.textContent ?? '', /Specificity adjustment/);

    const sort = page.find('[data-action="set-related-notes-sort"]') as HTMLSelectElement;
    assert.deepStrictEqual(
      [...sort.querySelectorAll('option')].map((option) => option.textContent),
      ['Relevance', 'Newest', 'Oldest', 'Most accessed'],
    );
    sort.value = 'newest';
    sort.dispatchEvent(new page.window.Event('change', { bubbles: true }));
    assert.deepStrictEqual(page.lastPosted('setRelatedNotesSort'), {
      type: 'setRelatedNotesSort',
      mode: 'newest',
    });
  });

  test('shows where a result sits in its note', () => {
    const page = open({ notes: [note({ headingPath: ['Atlas', 'Check-in'] })] });

    const path = page.find('.heading-path');
    assert.match(path.textContent ?? '', /Atlas/);
    assert.match(path.textContent ?? '', /Check-in/);
    assert.strictEqual(path.querySelectorAll('.heading-path-joiner').length, 1);
  });

  test('draws a tag with its weight beside it', () => {
    const page = open({
      tagTitleDisplayMode: 'separate',
      notes: [
        note({
          matchedTags: [{ key: '#project/atlas', label: 'project/atlas' }],
        }),
      ],
      activeTags: [
        { key: '#project/atlas', label: 'project/atlas', weight: 1, matches: { notes: 2, tasks: 1 } },
      ],
    });

    assert.strictEqual(page.text('.tag-list .tag-value'), 'project/atlas');
    // A tag's pull on the ranking is drawn as a rail beside it, and what a
    // search for it finds is in its label.
    assert.ok(page.findAll('.tag-weight-rail-segment').length > 0);
    assert.match(
      String(page.find('.active-tag-list [data-action="open-tag"]').getAttribute('title')),
      /weight 1\.00\. 2 notes · 1 task/,
    );
  });

  test('renames a tag from its context menu', () => {
    const page = open({
      activeTags: [{ key: '#project/atlas', label: 'project/atlas', weight: 1 }],
    });

    page.find('.active-tag-list [data-action="open-tag"]').dispatchEvent(
      new page.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    page.find('#tag-context-menu [data-context-action="rename-tag"]').dispatchEvent(
      new page.window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    assert.strictEqual(page.lastPosted('renameTag')?.tagKey, '#project/atlas');
  });

  test('lists a selected graph node\'s connections, and opens one', () => {
    const page = open({
      state: 'graph',
      graph: {
        selectedNode: {
          id: 'section:1',
          kind: 'note',
          title: 'Atlas',
          tagKeys: [],
          degree: 2,
        },
        connections: [
          {
            node: {
              id: 'tag:#project/atlas',
              kind: 'tag',
              title: 'project/atlas',
              tagKeys: [],
              degree: 5,
            },
            weight: 2,
            types: ['associated-tag'],
          },
        ],
      },
    });

    assert.match(page.text('.section-label') ?? '', /Connected nodes/);
    page.click('[data-action="open-selected-graph-node"]');
    assert.deepStrictEqual(page.lastPosted('activateNotesGraphNode'), {
      type: 'activateNotesGraphNode',
      nodeId: 'section:1',
      open: true,
    });

    page.click('.graph-node');
    assert.strictEqual(
      page.lastPosted('activateNotesGraphNode')?.nodeId,
      'tag:#project/atlas',
    );

    page.find('.graph-node').dispatchEvent(
      new page.window.MouseEvent('pointerover', { bubbles: true }),
    );
    assert.strictEqual(
      page.lastPosted('hoverNotesGraphNode')?.nodeId,
      'tag:#project/atlas',
    );
  });

  test('narrows the active search from its Refine options', () => {
    const page = open({
      state: 'refine',
      refine: {
        page: 'search',
        title: 'Project: Atlas',
        resultKinds: ['notes', 'tasks'],
        query: {
          text: '#project/atlas',
          terms: [],
          canAppend: true,
          isAdvanced: false,
          isBuildable: true,
          diagnostics: [],
          groups: [],
          tags: [],
          suggestions: {
            fields: [],
            values: {},
            operators: {} as never,
            conditions: [],
            recent: [],
            aliases: {},
          },
          matchCounts: { notes: 3, tasks: 1 },
          facets: [
            {
              id: 'related',
              label: 'Tags',
              applied: [],
              values: [
                { label: '#risk/vendor', count: 2, clause: '#risk/vendor', strength: 1 },
              ],
            },
          ],
        },
      },
    });

    // The sidebar lists the ways the search could be narrowed, headed by
    // the facet each belongs to.
    assert.strictEqual(page.text('.section-label'), 'Tags');
    assert.match(page.text('.refine-value') ?? '', /#risk\/vendor/);
    assert.match(page.text('.refine-count') ?? '', /2/);

    const value = page.find('[data-action="refine"]');
    value.dispatchEvent(
      new page.window.MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    assert.deepStrictEqual(page.lastPosted('refineActiveSearch'), {
      type: 'refineActiveSearch',
      facetId: 'related',
      clause: '#risk/vendor',
      mode: 'and',
    });

    // Alt leaves those results out; Shift allows the value beside another.
    value.dispatchEvent(
      new page.window.MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }),
    );
    assert.strictEqual(page.lastPosted('refineActiveSearch')?.mode, 'exclude');
    value.dispatchEvent(
      new page.window.MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }),
    );
    assert.strictEqual(page.lastPosted('refineActiveSearch')?.mode, 'or');

    // The tag itself opens in a tab of its own.
    page.click('.refine-open-tag');
    assert.strictEqual(page.lastPosted('openTag')?.tagKey, '#risk/vendor');
  });

  test('says what it is waiting for when it has nothing to rank', () => {
    const page = open({ notes: [], state: 'noMarkdown' });

    assert.strictEqual(page.findAll('.note').length, 0);
    assert.ok(
      (page.text('.empty') ?? '').length > 0,
      'an empty sidebar explains itself',
    );
  });
});
