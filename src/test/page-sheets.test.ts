import * as assert from 'assert';

import * as vscode from 'vscode';

import { getBaseCss, getPageTailCss } from '../ui/webview/components';
import { getCalendarHtml } from '../ui/webview/calendarHtml';
import { getDashboardHtml } from '../ui/webview/dashboardHtml';
import { getHelpHtml } from '../ui/webview/helpHtml';
import { getNotesGraphHtml } from '../ui/webview/notesGraphHtml';
import { getRelatedNotesDebugHtml } from '../ui/webview/relatedNotesDebugHtml';
import { getSearchPageHtml } from '../ui/webview/searchPageHtml';
import { getSidebarNotesHtml } from '../ui/webview/sidebarNotesHtml';
import { getStatsHtml } from '../ui/webview/statsHtml';
import { getTaskBoardHtml } from '../ui/webview/taskBoardHtml';

/**
 * What a page's own sheet may and may not do beside the shared ones.
 *
 * The Notes Graph carried a copy of the base palette for months: it was the
 * palette as first written, so after the base sheet desaturated its accents
 * the graph alone kept drawing the old ones, and nothing said so. A page
 * declares tokens of its own; the ones the base sheet owns it reads.
 */
suite('Page sheets', () => {
  const webview = {
    cspSource: 'vscode-webview://deckard',
    asWebviewUri: (resource: vscode.Uri) => resource,
  } as unknown as vscode.Webview;
  const pages: Array<[string, () => string]> = [
    ['Dashboard', () => getDashboardHtml(webview, vscode.Uri.file('/deckard'))],
    ['search page', () => getSearchPageHtml(webview)],
    ['Related Notes', () => getSidebarNotesHtml(webview, '1.0.0')],
    ['Notes Graph', () => getNotesGraphHtml(webview)],
    ['Help', () => getHelpHtml(webview, vscode.Uri.file('/deckard'))],
    ['Stats', () => getStatsHtml(webview)],
    ['Task Board', () => getTaskBoardHtml(webview)],
    ['Calendar', () => getCalendarHtml(webview)],
    [
      'Related Notes debug',
      () =>
        getRelatedNotesDebugHtml(webview, {
          filePath: 'notes/a.md',
          sourceLine: 1,
          title: 'Entry',
          tags: [],
          snapshot: { activeTags: [], notes: [], tagTitleDisplayMode: 'inline', state: 'ready' },
        } as never),
    ],
  ];
  const tokens = (css: string): string[] =>
    [...css.matchAll(/(--[a-z][\w-]*)\s*:/g)].map((match) => match[1]);

  test('no page sheet redeclares a token the base sheet owns', () => {
    const base = getBaseCss();
    const tail = getPageTailCss();
    const owned = new Set(tokens(base));
    assert.ok(owned.has('--text') && owned.has('--cyan-bright') && owned.has('--font-mono'), 'the base sheet owns the palette');
    for (const [name, render] of pages) {
      const html = render();
      const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n');
      assert.ok(styles.includes(base) && styles.includes(tail), `${name}: carries the shared sheets`);
      const own = styles.replace(base, '').replace(tail, '');
      const redeclared = [...new Set(tokens(own).filter((token) => owned.has(token)))];
      assert.deepStrictEqual(redeclared, [], `${name}: redeclares a base token`);
    }
  });
});
