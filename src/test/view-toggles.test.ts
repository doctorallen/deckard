import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { readViewChoice, VIEW_CHOICES, viewChoiceChange } from '../core/storage/preferencesViewChoices';
import { normalizePreferences } from '../core/storage/preferencesSchema';
import { listToggleCommands, VIEW_CHOICE_CONTEXT_KEYS, VIEW_TOGGLES } from '../ui/commands/toggles/viewToggles';

const root = path.resolve(__dirname, '..', '..');

/** The manifest's commands, and every `when` clause its menus hold. */
function readManifest() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    contributes: {
      commands: Array<{ command: string }>;
      menus: Record<string, Array<{ command?: string; when?: string }>>;
    };
  };
  return {
    commands: new Set(manifest.contributes.commands.map((entry) => entry.command)),
    whens: Object.values(manifest.contributes.menus).flat().map((entry) => entry.when ?? ''),
  };
}

suite('View toggles', () => {
  test('registers each command with the choice and value it turns it to', () => {
    assert.deepStrictEqual(
      listToggleCommands(VIEW_TOGGLES).map(({ id, choice, value }) => `${id} ${choice}=${value}`),
      [
        'deckard.outline.enableFollowCursor outlineFollowCursor=true',
        'deckard.outline.disableFollowCursor outlineFollowCursor=false',
      ],
    );
  });

  test('names only contributed commands, each once, and every menu reads the choices by their context keys', () => {
    const { commands, whens } = readManifest();
    const ids = listToggleCommands(VIEW_TOGGLES).map((command) => command.id);
    assert.strictEqual(new Set(ids).size, ids.length);
    for (const id of ids) {
      assert.ok(commands.has(id), `${id} is contributed`);
    }
    for (const key of Object.values(VIEW_CHOICE_CONTEXT_KEYS)) {
      assert.ok(whens.some((when) => when.includes(key)), `a menu reads ${key}`);
    }
    // The weekends are the calendar page's gear's alone, and the sidebar
    // Calendar has no day panel.
    for (const removed of ['openDayPanel', 'closeDayPanel', 'hideWeekends', 'includeWeekends']) {
      assert.ok(!commands.has(`deckard.calendar.${removed}`), `deckard.calendar.${removed} is gone`);
    }
    assert.deepStrictEqual(whens.filter((when) => /deckard\.calendar(DayPanel|Weekends)\b/.test(when)), []);
    assert.deepStrictEqual(whens.filter((when) => /config\.deckard\.(calendar|outline)\./.test(when)), [], 'no menu reads a moved setting');
  });

  test('keeps each choice only away from its default, and reads it back', () => {
    for (const choice of VIEW_CHOICES) {
      const fallback = readViewChoice({}, choice);
      const changed = normalizePreferences(viewChoiceChange(choice, !fallback));
      assert.strictEqual(readViewChoice(changed, choice), !fallback, `${choice} turned away from its default`);
      const back = normalizePreferences({ ...changed, ...viewChoiceChange(choice, fallback) });
      assert.strictEqual(readViewChoice(back, choice), fallback, `${choice} back`);
      assert.deepStrictEqual(back, normalizePreferences({}), `${choice}: the default is kept as nothing`);
    }
    assert.deepStrictEqual(
      VIEW_CHOICES.map((choice) => readViewChoice({}, choice)),
      [true, true],
      'the weekends and following the cursor are on until chosen',
    );
  });
});
