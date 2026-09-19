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

  test('says what it is waiting for when it has nothing to rank', () => {
    const page = open({ notes: [], state: 'noMarkdown' });

    assert.strictEqual(page.findAll('.note').length, 0);
    assert.ok(
      (page.text('.empty') ?? '').length > 0,
      'an empty sidebar explains itself',
    );
  });
});
