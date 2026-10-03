import * as assert from 'assert';

import { VIEW_PRIORITY } from '../core/workspace/publishing';
import { panelPriority, viewPriority } from '../ui/webview/host/panelPriority';

// On its own, since the panels' priorities are the UI's, and the suite that
// publishes the index to views runs without VS Code.
suite("A view's redraw priority", () => {
  test('ranks a panel by whether it is in front or visible, and a side view by whether it is visible', () => {
    assert.strictEqual(panelPriority({ active: true, visible: true }), VIEW_PRIORITY.active);
    assert.strictEqual(panelPriority({ active: false, visible: true }), VIEW_PRIORITY.visible);
    assert.strictEqual(panelPriority({ active: false, visible: false }), VIEW_PRIORITY.hidden);
    assert.strictEqual(panelPriority(undefined), VIEW_PRIORITY.hidden);
    assert.strictEqual(viewPriority({ visible: true }), VIEW_PRIORITY.visible);
    assert.strictEqual(viewPriority(undefined), VIEW_PRIORITY.hidden);
  });
});
