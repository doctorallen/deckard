import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';
import { createSearchPageSnapshot } from '../ui/state/searchPageState';
import { createPreferences } from './preferenceServices';
import { openWebviewPage, type WebviewPage } from './webviewPage';
import { renderPage } from './pages';

/**
 * A tag's hub note on its search page, drawn as the note page draws a note:
 * its query blocks run, its links followed, and its tasks ticked.
 */
suite('Search page: the hub note drawn as a note', () => {
  let page: WebviewPage | undefined;

  teardown(() => {
    page?.dispose();
    page = undefined;
  });

  const NOTES: Record<string, string> = {
    'projects/Checkout v2.md': [
      '---',
      'describes: project/checkout-v2',
      '---',
      '# Checkout v2',
      'The card form from [[ADR-001 Card form]].',
      '## Still open',
      '```deckard',
      '#project/checkout-v2 is:open',
      '```',
      '## Launch checklist',
      '- [ ] Load test the new checkout #project/checkout-v2',
    ].join('\n'),
    'adr/ADR-001 Card form.md': '# ADR-001 Card form\nHosted fields.',
    'notes/work.md': '# Work\n- [ ] Map the error codes #project/checkout-v2',
  };

  const open = (renderMode: 'html' | 'markdown' = 'html'): WebviewPage => {
    const index = buildWorkspaceIndex(new Map(Object.entries(NOTES).map(([path, content]) => [path, parseMarkdown(path, content)])));
    const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
    const snapshot = createSearchPageSnapshot(index, { ...store.reader.value, renderMode }, '#project/checkout-v2', { queryContext: createQueryContext(Date.now()) });
    page = openWebviewPage(renderPage('searchPage'), snapshot);
    return page;
  };

  test('runs its query blocks and lists what they find', () => {
    const shown = open();
    const query = shown.find('.hub .note-query');
    const titles = Array.from(query.querySelectorAll('.note-query-title')).map((title) => title.textContent);
    assert.ok(titles.includes('Map the error codes'), titles.join(', '));
    assert.strictEqual(shown.findAll('.hub pre code.language-deckard, .hub .note-code').filter((code) => code.textContent?.includes('is:open')).length, 0, 'not shown as code');
  });

  test('follows a link from the hub note, read from the note it is written in', () => {
    const shown = open();
    shown.click('.hub .note-link');
    assert.deepStrictEqual(shown.lastPosted('openWikiLink'), { type: 'openWikiLink', target: 'ADR-001 Card form', from: 'projects/Checkout v2.md' });
  });

  test('ticks a task in the hub note where it is written', () => {
    const shown = open();
    const box = shown.find('.hub .note-task-box') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new (box.ownerDocument.defaultView as Window & typeof globalThis).Event('change', { bubbles: true }));
    const posted = shown.lastPosted('toggleTask') as { taskId?: string; completed?: boolean } | undefined;
    assert.strictEqual(posted?.completed, true);
    assert.ok(posted?.taskId, 'by its id');
  });

  test('as source, shows the note as written', () => {
    const shown = open('markdown');
    assert.strictEqual(shown.findAll('.hub .note-query').length, 0);
    assert.ok((shown.find('.hub').textContent ?? '').includes('```deckard'));
  });
});
