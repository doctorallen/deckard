import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { listToggleCommands, SETTING_TOGGLES } from '../ui/commands/toggles/settingToggles';

const root = path.resolve(__dirname, '..', '..');

/** The manifest's commands, and its settings with their types. */
function readManifest() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    contributes: {
      commands: Array<{ command: string }>;
      configuration: Array<{ properties: Record<string, { type?: string }> }>;
    };
  };
  return {
    commands: new Set(manifest.contributes.commands.map((entry) => entry.command)),
    settings: Object.assign({}, ...manifest.contributes.configuration.map((section) => section.properties)) as Record<
      string,
      { type?: string }
    >,
  };
}

suite('Setting toggles', () => {
  test('registers each command with the setting, value, and target it always wrote', () => {
    assert.deepStrictEqual(
      listToggleCommands(SETTING_TOGGLES).map(({ id, setting, value, target }) => `${id} ${setting}=${value} ${target}`),
      [
        'deckard.calendar.openDayPanel calendar.dayPanel=true where-set',
        'deckard.calendar.closeDayPanel calendar.dayPanel=false where-set',
        'deckard.calendar.includeWeekends calendar.showWeekends=true where-set',
        'deckard.calendar.hideWeekends calendar.showWeekends=false where-set',
        'deckard.calendar.showRepeats calendar.showRepeats=true where-set',
        'deckard.calendar.hideRepeats calendar.showRepeats=false where-set',
        'deckard.outline.enableFollowCursor outline.followCursor=true user',
        'deckard.outline.disableFollowCursor outline.followCursor=false user',
        'deckard.enableZenMode zenMode=true folder-where-set',
        'deckard.disableZenMode zenMode=false folder-where-set',
      ],
    );
  });

  test('names only contributed commands and boolean settings, each once', () => {
    const { commands, settings } = readManifest();
    const ids = listToggleCommands(SETTING_TOGGLES).map((command) => command.id);
    assert.strictEqual(new Set(ids).size, ids.length);
    for (const id of ids) {
      assert.ok(commands.has(id), `${id} is contributed`);
    }
    for (const toggle of SETTING_TOGGLES) {
      assert.strictEqual(settings[`deckard.${toggle.setting}`]?.type, 'boolean', `deckard.${toggle.setting}`);
    }
  });

  test('uses the Outline and zen setters only for their own settings', () => {
    // Those two targets are the setters that also set a context key, and
    // each writes one setting it names itself.
    const own = { user: 'outline.followCursor', 'folder-where-set': 'zenMode' } as const;
    for (const toggle of SETTING_TOGGLES) {
      if (toggle.target !== 'where-set') {
        assert.strictEqual(toggle.setting, own[toggle.target]);
      }
    }
  });
});
