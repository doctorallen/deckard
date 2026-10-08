import * as assert from 'assert';

import { carryMovedSettingsOnce, MOVED_SETTINGS_CARRIED_KEY } from '../composition/movedSettings';
import { carryMovedSettings, type MovedSetting } from '../core/storage/movedSettings';
import { createMemoryPreferences, MemoryStore } from './preferenceServices';

suite('Moved settings', () => {
  test('each value a reader set comes to its preference, and the default to nothing', () => {
    assert.deepStrictEqual(
      carryMovedSettings({
        'agenda.groupBy': 'tag',
        'agenda.groupNamespace': 'Context',
        'agenda.sort': 'created',
        'board.parentTag': true,
        'calendar.dayPanel': true,
        'calendar.showWeekends': false,
        'display.pageWidth': 'full',
        'pages.style': 'list',
        'pages.shown': { home: true, stats: false, help: false },
        'outline.followCursor': false,
      }),
      {
        agendaGroupBy: 'tag',
        agendaGroupNamespace: 'context',
        agendaSort: 'created',
        boardParentTag: true,
        calendarDayPanel: true,
        calendarHideWeekends: true,
        pageWidth: 'full',
        contextPagesStyle: 'list',
        contextPagesHidden: ['stats', 'help'],
        outlineFollowCursorOff: true,
      },
    );
    assert.deepStrictEqual(
      carryMovedSettings({
        'agenda.groupBy': 'due',
        'agenda.groupNamespace': 'project',
        'calendar.showWeekends': true,
        'pages.style': 'icons',
        'pages.shown': { home: true },
      }),
      { agendaGroupBy: undefined, agendaGroupNamespace: undefined, calendarHideWeekends: undefined, contextPagesStyle: undefined, contextPagesHidden: undefined },
      'a default set by hand clears the preference, as choosing it in the view would',
    );
    assert.deepStrictEqual(
      carryMovedSettings({ 'agenda.groupBy': 'sideways', 'agenda.sort': 7, 'display.pageWidth': 'wide', 'board.parentTag': 'yes' }),
      {},
      'a value the setting never took carries nothing',
    );
  });

  test('carries the user\'s values once a machine and the workspace\'s once a workspace, the workspace\'s over the user\'s', async () => {
    const values: Partial<Record<MovedSetting, { globalValue?: unknown; workspaceValue?: unknown }>> = {
      'agenda.groupBy': { globalValue: 'priority', workspaceValue: 'status' },
      'board.parentTag': { globalValue: true },
      'calendar.dayPanel': { workspaceValue: true },
    };
    const read = (setting: MovedSetting) => values[setting];
    const preferences = createMemoryPreferences();
    const memory = { global: new MemoryStore(), workspace: new MemoryStore() };
    await carryMovedSettingsOnce(preferences.repository, memory, read);
    const current = preferences.repository.current;
    assert.deepStrictEqual(
      [current.agendaGroupBy, current.boardParentTag, current.calendarDayPanel],
      ['status', true, true],
    );
    assert.strictEqual(memory.global.get(MOVED_SETTINGS_CARRIED_KEY), true);
    assert.strictEqual(memory.workspace.get(MOVED_SETTINGS_CARRIED_KEY), true);

    // Another workspace on the same machine carries its own values alone.
    const other = createMemoryPreferences();
    await carryMovedSettingsOnce(other.repository, { global: memory.global, workspace: new MemoryStore() }, read);
    assert.deepStrictEqual(
      [other.repository.current.agendaGroupBy, other.repository.current.boardParentTag, other.repository.current.calendarDayPanel],
      ['status', undefined, true],
      'the user\'s were carried already, on this machine',
    );

    // Once both are carried, nothing is read.
    await carryMovedSettingsOnce(preferences.repository, memory, () => {
      throw new Error('read again');
    });
  });
});
