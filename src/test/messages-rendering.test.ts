import * as assert from 'assert';

import {
  parseDashboardMessage,
  parseSidebarMessage,
  parseTagOverviewMessage,
} from '../ui/webview/messages';
import { renderMarkdown } from '../ui/webview/rendering';

suite('Webview contracts', () => {
  test('accepts valid dashboard messages and rejects malformed payloads', () => {
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'setTaskFilter', filter: 'active' }),
      {
        type: 'setTaskFilter',
        filter: 'active',
      },
    );
    assert.strictEqual(
      parseDashboardMessage({
        type: 'toggleTask',
        taskId: 'task-1',
        completed: 'yes',
      }),
      undefined,
    );
    assert.strictEqual(
      parseDashboardMessage({
        type: 'openSource',
        filePath: 'notes/a.md',
        line: 0,
      }),
      undefined,
    );
    assert.strictEqual(parseDashboardMessage({ type: 'unknown' }), undefined);
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'setTagSort', mode: 'custom' }),
      { type: 'setTagSort', mode: 'custom' },
    );
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'setTaskTags', tagKeys: ['work'] }),
      { type: 'setTaskTags', tagKeys: ['work'] },
    );
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'setTaskSort', mode: 'updated' }),
      { type: 'setTaskSort', mode: 'updated' },
    );
    assert.strictEqual(
      parseDashboardMessage({ type: 'setTaskSort', mode: 'random' }),
      undefined,
    );
    assert.deepStrictEqual(
      parseDashboardMessage({
        type: 'reorderTags',
        tagKeys: ['work'],
        tagKey: 'work',
        isFavorite: false,
      }),
      {
        type: 'reorderTags',
        tagKeys: ['work'],
        tagKey: 'work',
        isFavorite: false,
      },
    );
  });

  test('accepts only supported tag overview messages', () => {
    assert.deepStrictEqual(
      parseTagOverviewMessage({ type: 'setRenderMode', mode: 'html' }),
      {
        type: 'setRenderMode',
        mode: 'html',
      },
    );
    assert.strictEqual(
      parseTagOverviewMessage({ type: 'setRenderMode', mode: 'unsafe' }),
      undefined,
    );
    assert.deepStrictEqual(
      parseTagOverviewMessage({ type: 'openTag', tagKey: 'other' }),
      { type: 'openTag', tagKey: 'other' },
    );
    assert.deepStrictEqual(
      parseTagOverviewMessage({
        type: 'setTagOverviewSort',
        mode: 'access',
      }),
      { type: 'setTagOverviewSort', mode: 'access' },
    );
    assert.strictEqual(
      parseTagOverviewMessage({
        type: 'setTagOverviewSort',
        mode: 'random',
      }),
      undefined,
    );
  });

  test('renders safe Markdown without executable HTML or unsafe links', () => {
    const rendered = renderMarkdown(
      '[bad](javascript:alert(1))\n\n<script>alert(1)</script>\n\n**safe**',
    );

    assert.strictEqual(rendered.includes('<script'), false);
    assert.strictEqual(rendered.includes('href="javascript:'), false);
    assert.strictEqual(rendered.includes('<strong>safe</strong>'), true);
  });

  test('accepts only valid sidebar navigation messages', () => {
    assert.deepStrictEqual(
      parseSidebarMessage({
        type: 'openSource',
        filePath: 'notes/related.md',
        line: 4,
      }),
      { type: 'openSource', filePath: 'notes/related.md', line: 4 },
    );
    assert.deepStrictEqual(
      parseSidebarMessage({ type: 'openTag', tagKey: 'work' }),
      { type: 'openTag', tagKey: 'work' },
    );
    assert.deepStrictEqual(parseSidebarMessage({ type: 'openDashboard' }), {
      type: 'openDashboard',
    });
    assert.deepStrictEqual(parseSidebarMessage({ type: 'createDailyNote' }), {
      type: 'createDailyNote',
    });
    assert.strictEqual(
      parseSidebarMessage({
        type: 'openSource',
        filePath: 'notes/a.md',
        line: 0,
      }),
      undefined,
    );
  });
});
