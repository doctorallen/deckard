import * as assert from 'assert';

import { EDITOR_TOGGLES, isEditorToggleOn, readEditorPreset } from '../domain/editor/editorPresets';

suite('Editor presets', () => {
  test('full draws everything, as before; tasks and writing turn the extras down; a hand-set switch wins', () => {
    assert.ok(EDITOR_TOGGLES.every((toggle) => isEditorToggleOn(toggle, 'full', undefined)));
    assert.strictEqual(isEditorToggleOn('referenceCounts', 'tasks', undefined), false);
    assert.strictEqual(isEditorToggleOn('taskDueHints', 'tasks', undefined), true);
    assert.strictEqual(isEditorToggleOn('taskDueHints', 'writing', undefined), false);
    assert.strictEqual(isEditorToggleOn('linkDiagnostics', 'writing', undefined), true, 'problems are still reported');
    assert.strictEqual(isEditorToggleOn('slashMenu', 'writing', undefined), true);
    assert.strictEqual(isEditorToggleOn('referenceCounts', 'writing', true), true, 'set by hand');
    assert.strictEqual(isEditorToggleOn('slashMenu', 'full', false), false, 'set by hand');
    assert.strictEqual(readEditorPreset('nonsense'), 'full');
  });
});
