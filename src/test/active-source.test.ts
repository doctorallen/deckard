import * as assert from 'assert';

import { ActiveSource } from '../ui/webview/host/activeSource';

suite('ActiveSource', () => {
  test('knows the page in front, and tells the sidebar when it or what it shows changes', () => {
    const active = new ActiveSource<{ name: string }>();
    const board = { name: 'board' };
    const search = { name: 'search' };
    const events: string[] = [];
    active.onDidChange(() => events.push('change'));
    active.onDidChangeSidebarVisibility(() => events.push('sidebar'));
    try {
      active.setActive(board);
      active.setActive(board);
      active.notifyChanged(search);
      active.notifyChanged(board);
      active.release(search);
      assert.strictEqual(active.active, board);
      active.release(board);
      assert.strictEqual(active.active, undefined);
      assert.deepStrictEqual(events, ['change', 'change', 'change']);
    } finally {
      active.dispose();
    }
  });

  test('moves the active page\'s part to the sidebar while it is open', () => {
    const active = new ActiveSource<{ name: string }>();
    const board = { name: 'board' };
    const search = { name: 'search' };
    const events: string[] = [];
    active.onDidChangeSidebarVisibility(() => events.push('sidebar'));
    try {
      active.setSidebarVisible(true);
      assert.deepStrictEqual(events, [], 'nothing to move with no page in front');
      active.setActive(board);
      assert.strictEqual(active.isShownInSidebar(board), true);
      assert.strictEqual(active.isShownInSidebar(search), false);
      active.setActive(search);
      active.setSidebarVisible(true);
      active.setSidebarVisible(false);
      assert.strictEqual(active.isShownInSidebar(search), false);
      active.setActive(board);
      assert.deepStrictEqual(events, ['sidebar', 'sidebar', 'sidebar']);
    } finally {
      active.dispose();
    }
  });
});
