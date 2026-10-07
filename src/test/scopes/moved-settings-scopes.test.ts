import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import * as vscode from 'vscode';

import { carryMovedSettingsOnce, MOVED_SETTINGS_CARRIED_KEY } from '../../composition/movedSettings';
import { createMemoryPreferences, MemoryStore } from '../preferenceServices';
import { deckard, firstFolder, isMultiRoot, settled } from './scopes';

/** The workspace's own settings: the folder's settings.json, or the multi-root workspace file's `settings`. */
function workspaceSettings(): { read(): Record<string, unknown>; write(settings: Record<string, unknown>): void } {
  const file = vscode.workspace.workspaceFile?.fsPath ?? path.join(firstFolder().uri.fsPath, '.vscode', 'settings.json');
  const readJson = (): Record<string, unknown> =>
    fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>) : {};
  if (isMultiRoot()) {
    return {
      read: () => (readJson().settings as Record<string, unknown> | undefined) ?? {},
      write: (settings) => fs.writeFileSync(file, JSON.stringify({ ...readJson(), settings }, null, 2)),
    };
  }
  return {
    read: readJson,
    write: (settings) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(settings, null, 2));
    },
  };
}

/**
 * A value a reader set for a setting that moved into a view's preferences
 * is carried there once, on the first activation after the update. The
 * setting is no longer contributed, so it is written into the workspace's
 * settings by hand, as a reader's settings.json still holds it; VS Code
 * still reads it, and the carry finds it there.
 */
suite(`Moved settings carried into the preferences (${isMultiRoot() ? 'multi-root' : 'single folder'})`, () => {
  const settings = workspaceSettings();
  let before: Record<string, unknown> = {};

  setup(() => {
    before = settings.read();
  });

  teardown(async () => {
    settings.write(before);
    await settled(() => deckard().inspect('agenda.groupBy')?.workspaceValue === undefined);
  });

  test('a workspace\'s value is carried once, and the old setting is not read again', async () => {
    settings.write({ ...before, 'deckard.agenda.groupBy': 'status', 'deckard.calendar.showWeekends': false });
    assert.ok(
      await settled(() => deckard().inspect('agenda.groupBy')?.workspaceValue === 'status'),
      'VS Code reads the setting it no longer has a schema for',
    );
    const preferences = createMemoryPreferences();
    const memory = { global: new MemoryStore(), workspace: new MemoryStore() };
    await carryMovedSettingsOnce(preferences.repository, memory);
    assert.strictEqual(preferences.repository.current.agendaGroupBy, 'status');
    assert.strictEqual(preferences.repository.current.calendarHideWeekends, true);
    assert.strictEqual(memory.workspace.get(MOVED_SETTINGS_CARRIED_KEY), true);
    assert.strictEqual(memory.global.get(MOVED_SETTINGS_CARRIED_KEY), true);

    // Chosen again in the view, the choice stays: the setting is not carried twice.
    await preferences.taskLayout.setAgendaGrouping('priority');
    await carryMovedSettingsOnce(preferences.repository, memory);
    assert.strictEqual(preferences.repository.current.agendaGroupBy, 'priority');
  });
});
