import * as assert from 'assert';

import {
  createSessionToken,
  createTaskToggleHref,
  readTaskToggleLink,
} from '../ui/preview/previewTaskLinks';
import { renderQueryBlockHtml } from '../ui/preview/queryBlockHtml';
import { parseQueryBlockInfo } from '../ui/state/queryBlockState';
import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';

const BASE = 'vscode://esperinnovations.deckard-notes';

suite('Query block checkboxes in the preview', () => {
  test('a link carries the task, the state it asks for, and the session’s token', () => {
    const token = createSessionToken();
    assert.match(token, /^[0-9a-f]{32}$/);
    assert.notStrictEqual(createSessionToken(), token, 'each session has its own');
    const href = createTaskToggleHref(BASE, { taskId: 'task a&b', completed: true, token });
    assert.strictEqual(href, `${BASE}/toggle-task?task=task%20a%26b&done=1&token=${token}`);
    const query = href.split('?')[1];
    assert.deepStrictEqual(readTaskToggleLink('/toggle-task', query, token), {
      kind: 'toggle',
      request: { taskId: 'task a&b', completed: true, token },
    });
  });

  test('a link from another session, or not a checkbox’s, asks for nothing', () => {
    const token = createSessionToken();
    const old = createTaskToggleHref(BASE, { taskId: 't', completed: false, token: createSessionToken() }).split('?')[1];
    assert.deepStrictEqual(readTaskToggleLink('/toggle-task', old, token), { kind: 'stale' });
    assert.deepStrictEqual(readTaskToggleLink('/toggle-task', 'task=t&done=1', token), { kind: 'other' }, 'no token');
    assert.deepStrictEqual(readTaskToggleLink('/toggle-task', `task=t&done=yes&token=${token}`, token), { kind: 'other' });
    assert.deepStrictEqual(readTaskToggleLink('/other', `task=t&done=1&token=${token}`, token), { kind: 'other' });
  });

  test('a block draws each box as a link that offers the other state, named for what it does', () => {
    const file = parseMarkdown('notes/atlas.md', '# Atlas #project/atlas\n- [ ] Send the **proposal**\n- [x] Book the room');
    const index = buildWorkspaceIndex(new Map([[file.filePath, file]]));
    const hrefs: Array<[string, boolean | undefined]> = [];
    const render = (info: string) =>
      renderQueryBlockHtml('#project/atlas', parseQueryBlockInfo(info)!, index, {
        queryContext: createQueryContext(Date.now()),
        taskHref: (item) => {
          hrefs.push([item.title, item.completed]);
          return createTaskToggleHref(BASE, { taskId: item.id, completed: !item.completed, token: 'abc' });
        },
      });
    const list = render('deckard');
    assert.ok(list.includes('role="checkbox" aria-checked="false" aria-label="Complete Send the proposal"'), list);
    assert.ok(list.includes('aria-checked="true" aria-label="Reopen Book the room"'));
    assert.ok(list.includes('done=1&amp;token=abc'), 'the open task’s box completes it');
    assert.ok(list.includes('done=0&amp;token=abc'), 'the done task’s box reopens it');
    const table = render('deckard view=table');
    assert.strictEqual(table.split('class="deckard-query-checkbox is-action"').length, 3, 'the table’s boxes act too');
    const still = renderQueryBlockHtml('#project/atlas', parseQueryBlockInfo('deckard')!, index, { queryContext: createQueryContext(Date.now()) });
    assert.ok(still.includes('role="img" aria-label="Open"'), 'without a link the box is a picture, as before');
  });
});
