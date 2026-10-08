import * as assert from 'assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EDITOR_TOGGLES, EditorPreset, isEditorToggleOn, readEditorPreset } from '../domain/editor/editorPresets';

/** The repository's root, from the compiled test in out/test. */
const ROOT = join(__dirname, '..', '..');

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

  test('off draws nothing, and a switch set by hand still draws its part', () => {
    assert.strictEqual(readEditorPreset('off'), 'off');
    assert.ok(EDITOR_TOGGLES.every((toggle) => !isEditorToggleOn(toggle, 'off', undefined)));
    assert.strictEqual(isEditorToggleOn('linkDiagnostics', 'off', true), true, 'set by hand');
  });

  test('each switch in Settings says it overrides the preset, and has no default, since Off turns every one off', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      contributes: { configuration: Array<{ properties?: Record<string, { default?: unknown; description?: string }> }> };
    };
    const settings = Object.assign({}, ...manifest.contributes.configuration.map((section) => section.properties ?? {})) as Record<
      string,
      { default?: unknown; description?: string }
    >;
    const presets: Array<[EditorPreset, string]> = [['full', 'Full'], ['tasks', 'Tasks'], ['writing', 'Writing'], ['off', 'Off']];
    const names = (list: string[]): string => (list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);
    for (const toggle of EDITOR_TOGGLES) {
      const setting = settings[`deckard.editor.${toggle}`];
      const on = presets.filter(([preset]) => isEditorToggleOn(toggle, preset, undefined)).map(([, name]) => name);
      const off = presets.filter(([preset]) => !isEditorToggleOn(toggle, preset, undefined)).map(([, name]) => name);
      const follows = `Left unset, it follows the editor preset: on in ${names(on)}, off in ${names(off)}.`;
      assert.ok(setting.description?.includes(follows), `${toggle} says: ${follows}`);
      assert.ok(setting.description?.includes('override the preset'), `${toggle} says it overrides the preset`);
      assert.strictEqual(setting.default, undefined, `${toggle}'s default in Settings`);
    }
  });
});
