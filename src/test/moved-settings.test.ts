import * as assert from 'assert';

import { carryMovedSettingsOnce, carryRenamedSettingsOnce, MOVED_SETTINGS_CARRIED_KEY, RENAMED_SETTINGS_CARRIED_KEY } from '../composition/movedSettings';
import { carryMovedSettings, carryRenamedSettings, type MovedSetting, type RenamedSettingWrite, type ScopedValues } from '../core/storage/movedSettings';
import { createMemoryPreferences, MemoryStore } from './preferenceServices';

suite('Moved settings', () => {
  test('each value a reader set comes to its preference, and the default to nothing', () => {
    assert.deepStrictEqual(
      carryMovedSettings({
        'agenda.groupBy': 'tag',
        'agenda.groupNamespace': 'Context',
        'agenda.sort': 'created',
        'board.parentTag': true,
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
      'outline.followCursor': { workspaceValue: false },
    };
    const read = (setting: MovedSetting) => values[setting];
    const preferences = createMemoryPreferences();
    const memory = { global: new MemoryStore(), workspace: new MemoryStore() };
    await carryMovedSettingsOnce(preferences.repository, memory, read);
    const current = preferences.repository.current;
    assert.deepStrictEqual(
      [current.agendaGroupBy, current.boardParentTag, current.outlineFollowCursorOff],
      ['status', true, true],
    );
    assert.strictEqual(memory.global.get(MOVED_SETTINGS_CARRIED_KEY), true);
    assert.strictEqual(memory.workspace.get(MOVED_SETTINGS_CARRIED_KEY), true);

    // Another workspace on the same machine carries its own values alone.
    const other = createMemoryPreferences();
    await carryMovedSettingsOnce(other.repository, { global: memory.global, workspace: new MemoryStore() }, read);
    assert.deepStrictEqual(
      [other.repository.current.agendaGroupBy, other.repository.current.boardParentTag, other.repository.current.outlineFollowCursorOff],
      ['status', undefined, true],
      'the user\'s were carried already, on this machine',
    );

    // Once both are carried, nothing is read.
    await carryMovedSettingsOnce(preferences.repository, memory, () => {
      throw new Error('read again');
    });
  });

  test('Display\'s step comes to Zen: Quiet and Zen turn it on, Full writes nothing, and only the user\'s counts', () => {
    const reading = (values: Record<string, ScopedValues>) => (key: string): ScopedValues | undefined => values[key];
    const both = { user: true, workspace: true };
    assert.deepStrictEqual(carryRenamedSettings(reading({ 'display.level': { globalValue: 'quiet' } }), both), {
      writes: [{ key: 'display.zen', value: true, scope: 'user' }],
      notices: ['Display is one Zen switch now, in each page\'s gear'],
    });
    assert.deepStrictEqual(carryRenamedSettings(reading({ 'display.level': { globalValue: 'zen' } }), both).writes, [{ key: 'display.zen', value: true, scope: 'user' }]);
    assert.deepStrictEqual(
      carryRenamedSettings(reading({ 'display.level': { globalValue: 'full' }, 'display.counts': { globalValue: 'hidden' } }), both),
      { writes: [], notices: ['Display is one Zen switch now, in each page\'s gear'] },
      'Full is Zen off, the default, and the notice still says where Display went',
    );
    assert.deepStrictEqual(
      carryRenamedSettings(reading({ 'display.level': { workspaceValue: 'zen' } }), both),
      { writes: [], notices: [] },
      'a workspace cannot set an application setting',
    );
    assert.deepStrictEqual(
      carryRenamedSettings(reading({ 'display.level': { globalValue: 'zen' }, 'display.zen': { globalValue: false } }), both).writes,
      [],
      'Zen set already is left as it is',
    );
    assert.deepStrictEqual(carryRenamedSettings(reading({ 'display.level': { globalValue: 'zen' } }), { user: false, workspace: true }).writes, [], 'the user\'s were carried already');
  });

  test('the Tasks view\'s search takes its new name in each scope it was set in, an empty one too', () => {
    const values: Record<string, ScopedValues> = { 'agenda.query': { globalValue: 'is:mine', workspaceValue: '' } };
    assert.deepStrictEqual(carryRenamedSettings((key) => values[key], { user: true, workspace: true }), {
      writes: [
        { key: 'tasks.viewQuery', value: 'is:mine', scope: 'user' },
        { key: 'tasks.viewQuery', value: '', scope: 'workspace' },
      ],
      notices: ['Agenda: Query is Tasks: View Query now'],
    });
    assert.deepStrictEqual(
      carryRenamedSettings((key) => values[key], { user: false, workspace: true }).writes,
      [{ key: 'tasks.viewQuery', value: '', scope: 'workspace' }],
      'a new workspace on a machine carried already carries its own',
    );
  });

  test('carries the renamed settings once, and says so in one notice', async () => {
    const values: Record<string, ScopedValues> = { 'display.level': { globalValue: 'quiet' }, 'display.density': { globalValue: 'compact' } };
    const written: RenamedSettingWrite[] = [];
    const notices: string[] = [];
    const ports = {
      read: (key: string) => values[key],
      write: async (write: RenamedSettingWrite) => {
        written.push(write);
      },
      notify: (message: string) => notices.push(message),
    };
    const memory = { global: new MemoryStore(), workspace: new MemoryStore() };
    await carryRenamedSettingsOnce(memory, ports);
    assert.deepStrictEqual(written, [{ key: 'display.zen', value: true, scope: 'user' }]);
    assert.deepStrictEqual(notices, ['Deckard moved settings you had set. Display is one Zen switch now, in each page\'s gear.']);
    assert.strictEqual(memory.global.get(RENAMED_SETTINGS_CARRIED_KEY), true);
    assert.strictEqual(memory.workspace.get(RENAMED_SETTINGS_CARRIED_KEY), true);

    await carryRenamedSettingsOnce(memory, { ...ports, read: () => {
      throw new Error('read again');
    } });
    assert.strictEqual(notices.length, 1, 'one notice');

    // Nothing set, nothing said.
    const quiet: string[] = [];
    await carryRenamedSettingsOnce({ global: new MemoryStore(), workspace: new MemoryStore() }, { ...ports, read: () => undefined, notify: (message) => quiet.push(message) });
    assert.deepStrictEqual(quiet, []);
  });
});
