import * as assert from 'assert';

import { narrowDashboardMessage } from '../ui/webview/pages/dashboard/messages';

/** Every value narrows to `expected`, or, with `undefined`, is refused. */
function check(cases: Array<[unknown, unknown]>): void {
  for (const [value, expected] of cases) {
    assert.deepStrictEqual(narrowDashboardMessage(value), expected, JSON.stringify(value));
  }
}

/** Every value is refused. */
function refuses(values: unknown[]): void {
  for (const value of values) {
    assert.strictEqual(narrowDashboardMessage(value), undefined, JSON.stringify(value));
  }
}

// The Dashboard's narrowing table, with the payloads parseDashboardMessage
// was held to before it moved, in messages-rendering, parked-commands, and
// task-board: each accepted message, and each refused one.
suite('Dashboard messages', () => {
  test('accepts valid dashboard messages and rejects malformed payloads', () => {
    check([
      [{ type: 'setTaskFilter', filter: 'active' }, undefined],
      [{ type: 'toggleTask', taskId: 'task-1', completed: 'yes' }, undefined],
      [{ type: 'openSource', filePath: 'notes/a.md', line: 0 }, undefined],
      [{ type: 'unknown' }, undefined],
      // Home's widgets: a quick-add task is one line of text.
      [{ type: 'quickAdd', text: 'Call Ren', extra: 1 }, { type: 'quickAdd', text: 'Call Ren' }],
      [{ type: 'quickAdd', text: '  ' }, undefined],
      [{ type: 'quickAdd', text: 'a\nb' }, undefined],
      [{ type: 'unpinNote', filePath: 'notes/a.md' }, { type: 'unpinNote', filePath: 'notes/a.md' }],
      [{ type: 'pinNote', filePath: 7 }, undefined],
      [{ type: 'createTagHub', tagKey: '' }, undefined],
      [{ type: 'openDailyNote' }, { type: 'openDailyNote' }],
      [{ type: 'setTagSort', mode: 'custom' }, { type: 'setTagSort', mode: 'custom' }],
      // Tasks are chosen on the Task Board now, not with a Dashboard tag picker.
      [{ type: 'setTaskTags', tagKeys: ['work'] }, undefined],
      // The Search tab narrows notes with its search, not a tag picker.
      [{ type: 'setNoteTags', tagKeys: ['work'] }, undefined],
      [{ type: 'renameTag', tagKey: '#project/atlas' }, { type: 'renameTag', tagKey: '#project/atlas' }],
      [
        { type: 'openSavedFilter', filterId: 'atlas-follow-up' },
        { type: 'openSavedFilter', filterId: 'atlas-follow-up' },
      ],
      [
        { type: 'removeSavedFilter', filterId: 'atlas-follow-up' },
        { type: 'removeSavedFilter', filterId: 'atlas-follow-up' },
      ],
      [{ type: 'openSavedFilter', filterId: '' }, undefined],
      [{ type: 'openSavedFilter', filterId: 'atlas-follow-up', tagKeys: ['#untrusted'] }, undefined],
      [{ type: 'renameTag', tagKey: '' }, undefined],
      [{ type: 'setTaskSort', mode: 'updated' }, undefined],
      // Notes are listed on search pages now, which sort and render them.
      [{ type: 'setNoteSort', mode: 'access' }, undefined],
      [{ type: 'setRenderMode', mode: 'html' }, undefined],
      [{ type: 'saveDashboardSearch' }, undefined],
      [{ type: 'setTaskSort', mode: 'random' }, undefined],
      [
        { type: 'setDashboardColumns', section: 'tags', columns: 3 },
        { type: 'setDashboardColumns', section: 'tags', columns: 3 },
      ],
      [{ type: 'setDashboardColumns', section: 'tasks', columns: 5 }, undefined],
      [{ type: 'setDashboardColumns', section: 'notes', columns: 2 }, undefined],
      [{ type: 'setDashboardMode', mode: 'home' }, { type: 'setDashboardMode', mode: 'home' }],
      [{ type: 'setDashboardMode', mode: 'notes' }, undefined],
      [
        { type: 'setDashboardSearch', field: 'tags', query: 'atlas' },
        { type: 'setDashboardSearch', field: 'tags', query: 'atlas' },
      ],
      [{ type: 'setDashboardSearch', field: 'notes', query: 'atlas' }, undefined],
      [
        {
          type: 'setDashboardWidgets',
          widgets: [
            { id: 'a', kind: 'tasks', width: 'full', count: 3, query: 'is:open', extra: true },
            { id: 'b', kind: 'unknown', width: 'half' },
            'not a widget',
          ],
        },
        {
          type: 'setDashboardWidgets',
          widgets: [{ id: 'a', kind: 'tasks', width: 'full', count: 3, query: 'is:open' }],
        },
      ],
      [{ type: 'setDashboardWidgets', widgets: 'all' }, undefined],
      [{ type: 'resetDashboardWidgets' }, { type: 'resetDashboardWidgets' }],
      [{ type: 'openSearch', query: '#project/atlas' }, { type: 'openSearch', query: '#project/atlas' }],
      [{ type: 'openSearch', query: 42 }, undefined],
      [{ type: 'openTaskBoard', query: 'is:open' }, { type: 'openTaskBoard', query: 'is:open' }],
      [{ type: 'openTaskBoard' }, { type: 'openTaskBoard' }],
      [{ type: 'openView', view: 'agenda' }, { type: 'openView', view: 'agenda' }],
      [{ type: 'openView', view: 'settings' }, undefined],
      [
        { type: 'reorderTags', tagKeys: ['work'], tagKey: 'work', isFavorite: false },
        { type: 'reorderTags', tagKeys: ['work'], tagKey: 'work', isFavorite: false },
      ],
    ]);
  });

  test('accepts park messages and nothing else like them', () => {
    check([
      [{ type: 'parkTag', tagKey: '#a' }, { type: 'parkTag', tagKey: '#a' }],
      [{ type: 'unparkTag', tagKey: '#a' }, { type: 'unparkTag', tagKey: '#a' }],
      [{ type: 'parkTag', tagKey: 3 }, undefined],
      [{ type: 'parkTag', tagKey: '' }, undefined],
      [{ type: 'unparkTag', tagKey: '#a', extra: 1 }, undefined],
    ]);
  });

  test('no longer takes task messages', () => {
    refuses([
      { type: 'setDashboardTaskLayout', layout: 'board' },
      { type: 'setBoardGroup', groupBy: 'due' },
      { type: 'moveTask', taskId: 'a', column: 'status:doing' },
      { type: 'setTaskFilter', filter: 'all' },
      { type: 'setTaskTags', tagKeys: ['work'] },
      { type: 'reorderTasks', taskIds: ['a'] },
      { type: 'setDashboardMode', mode: 'tasks' },
    ]);
  });

  test('refuses anything that is not a message of a type the table names', () => {
    refuses([undefined, null, 'openTag', { tagKey: '#a' }, { type: 7 }, { type: 'constructor' }, { type: 'toString' }]);
  });

  test('keeps only the fields the host reads', () => {
    check([
      [
        { type: 'openSource', filePath: 'notes/a.md', line: 2, beside: true, pin: false, extra: 1 },
        { type: 'openSource', filePath: 'notes/a.md', line: 2, beside: true },
      ],
      [
        { type: 'toggleTask', taskId: 'a', completed: true, extra: 1 },
        { type: 'toggleTask', taskId: 'a', completed: true },
      ],
      [{ type: 'toggleFavorite', tagKey: '#a', extra: 1 }, { type: 'toggleFavorite', tagKey: '#a' }],
      [{ type: 'toggleFavoriteEntity', entityKey: 'ren', extra: 1 }, { type: 'toggleFavoriteEntity', entityKey: 'ren' }],
      [{ type: 'setEntitySort', mode: 'count', extra: 1 }, { type: 'setEntitySort', mode: 'count' }],
      [{ type: 'renameTag', tagKey: '#a', extra: 1 }, { type: 'renameTag', tagKey: '#a' }],
      [{ type: 'reorderEntities', entityKeys: ['ren'], extra: 1 }, { type: 'reorderEntities', entityKeys: ['ren'] }],
      [{ type: 'openTag', tagKey: '#a', filterTagKeys: ['#b'] }, { type: 'openTag', tagKey: '#a' }],
      [{ type: 'chooseTheme', theme: 'cooper' }, { type: 'chooseTheme' }],
      [{ type: 'openWhatsNew', extra: 1 }, { type: 'openWhatsNew' }],
      [{ type: 'dismissWhatsNew' }, { type: 'dismissWhatsNew' }],
      [{ type: 'resetDashboardWidgets', extra: 1 }, { type: 'resetDashboardWidgets' }],
      [{ type: 'openDailyNote', extra: 1 }, { type: 'openDailyNote' }],
      [{ type: 'openNote', filePath: 'notes/a.md', line: 3 }, { type: 'openNote', filePath: 'notes/a.md' }],
    ]);
  });

  test('accepts each of Home\'s own messages within its bounds', () => {
    check([
      [{ type: 'setZenMode', enabled: true }, { type: 'setZenMode', enabled: true }],
      [{ type: 'setZenMode', enabled: 'yes' }, undefined],
      [{ type: 'toggleFavorite', tagKey: '' }, { type: 'toggleFavorite', tagKey: '' }],
      [{ type: 'toggleFavorite', tagKey: 1 }, undefined],
      [{ type: 'toggleFavoriteEntity', entityKey: 1 }, undefined],
      [{ type: 'setEntitySort', mode: 'random' }, undefined],
      [{ type: 'setDashboardSearch', field: 'tags', query: 1 }, undefined],
      [{ type: 'setDashboardColumns', section: 'tags', columns: 0 }, undefined],
      [{ type: 'reorderTags', tagKeys: ['work', 1], tagKey: 'work', isFavorite: false }, undefined],
      [{ type: 'reorderTags', tagKeys: ['work'], tagKey: 'work' }, undefined],
      [{ type: 'reorderEntities', entityKeys: 'ren' }, undefined],
      [{ type: 'addSavedSearchWidget', filterId: 'kept' }, { type: 'addSavedSearchWidget', filterId: 'kept' }],
      [{ type: 'addSavedSearchWidget', filterId: 'kept', extra: 1 }, undefined],
      [{ type: 'recordRecentQuery', query: 'is:open' }, { type: 'recordRecentQuery', query: 'is:open' }],
      [{ type: 'recordRecentQuery', query: 'x'.repeat(2001) }, undefined],
      [{ type: 'openSearch', query: 'x'.repeat(2001) }, undefined],
      [{ type: 'openTaskBoard', query: 'x'.repeat(2001) }, undefined],
      [{ type: 'openTaskBoard', query: 3 }, undefined],
      [{ type: 'setDashboardWidgets', widgets: Array.from({ length: 61 }, () => ({})) }, undefined],
      [{ type: 'openView', view: 'walkthrough' }, { type: 'openView', view: 'walkthrough' }],
      [{ type: 'quickAdd', text: 'x'.repeat(1001) }, undefined],
      [{ type: 'quickAdd', text: ' Call Ren ' }, { type: 'quickAdd', text: ' Call Ren ' }],
      [{ type: 'createTagHub', tagKey: '#a' }, { type: 'createTagHub', tagKey: '#a' }],
      [{ type: 'addNextAction', tagKey: '#a' }, { type: 'addNextAction', tagKey: '#a' }],
      [{ type: 'addNextAction', tagKey: 'x'.repeat(201) }, undefined],
      [{ type: 'openNote', filePath: '' }, undefined],
      [
        { type: 'pinNote', filePath: 'notes/a.md', line: 3, pinKey: 'k' },
        { type: 'pinNote', filePath: 'notes/a.md', line: 3, pinKey: 'k' },
      ],
      [{ type: 'unpinNote', filePath: 'notes/a.md', line: 0, pinKey: '' }, { type: 'unpinNote', filePath: 'notes/a.md' }],
    ]);
  });

  test('answers Try next only by a key the host could have given', () => {
    check([
      [{ type: 'runTryNext', key: 'pin' }, { type: 'runTryNext', key: 'pin' }],
      [{ type: 'snoozeTryNext', key: 'pin', extra: 1 }, { type: 'snoozeTryNext', key: 'pin' }],
      [{ type: 'retireTryNext', key: 'pin' }, { type: 'retireTryNext', key: 'pin' }],
      [{ type: 'runTryNext', key: '' }, undefined],
      [{ type: 'runTryNext', key: 'x'.repeat(1001) }, undefined],
      [{ type: 'retireTryNext' }, undefined],
    ]);
  });

  test('takes what + Add widget offers, each choice as a value and a label', () => {
    check([
      [
        {
          type: 'widgetChoices',
          choices: [
            { value: 'tasks', label: 'Tasks', description: 'Open tasks', extra: 1 },
            { value: 'stats', label: 'Stats', description: '' },
          ],
        },
        {
          type: 'widgetChoices',
          choices: [
            { value: 'tasks', label: 'Tasks', description: 'Open tasks' },
            { value: 'stats', label: 'Stats' },
          ],
        },
      ],
      [{ type: 'widgetChoices', choices: [{ value: 'tasks' }] }, undefined],
      [{ type: 'widgetChoices', choices: [{ value: 'tasks', label: 'Tasks', description: 1 }] }, undefined],
      [{ type: 'widgetChoices', choices: Array.from({ length: 201 }, () => ({ value: 'a', label: 'A' })) }, undefined],
    ]);
  });
});
