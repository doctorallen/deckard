import * as assert from 'assert';

import { narrowCalendarPageMessage } from '../ui/webview/pages/calendarPage/messages';

// The calendar page's narrowing table, with the payloads
// parseCalendarPageMessage was held to before it moved: the sidebar
// Calendar's messages, and the gear's and help's.
suite('Calendar page messages', () => {
  test("accepts the sidebar Calendar's messages, held as they are there", () => {
    assert.deepStrictEqual(narrowCalendarPageMessage({ type: 'ready' }), { type: 'ready' });
    assert.deepStrictEqual(narrowCalendarPageMessage({ type: 'selectDay', date: '2026-09-25' }), { type: 'selectDay', date: '2026-09-25' });
    assert.deepStrictEqual(narrowCalendarPageMessage({ type: 'moveTask', taskId: 't', field: 'due', date: '2026-09-26' }), {
      type: 'moveTask',
      taskId: 't',
      field: 'due',
      date: '2026-09-26',
    });
    assert.strictEqual(narrowCalendarPageMessage({ type: 'selectDay', date: '2026-09-25', extra: 1 }), undefined);
    assert.strictEqual(narrowCalendarPageMessage({ type: 'moveTask', taskId: 't', field: 'start', date: '2026-09-26' }), undefined);
  });

  test("accepts the gear's settings as a choice and nothing else", () => {
    assert.deepStrictEqual(narrowCalendarPageMessage({ type: 'setShowRepeats', show: false }), { type: 'setShowRepeats', show: false });
    assert.deepStrictEqual(narrowCalendarPageMessage({ type: 'setShowWeekends', show: true }), { type: 'setShowWeekends', show: true });
    for (const message of [
      { type: 'setShowRepeats' },
      { type: 'setShowRepeats', show: 'off' },
      { type: 'setShowRepeats', show: false, extra: 1 },
      { type: 'setShowWeekends', show: 1 },
    ]) {
      assert.strictEqual(narrowCalendarPageMessage(message), undefined, JSON.stringify(message));
    }
  });

  test("accepts the gear's zen row, theme, and help, keeping only what the host reads", () => {
    assert.deepStrictEqual(narrowCalendarPageMessage({ type: 'setZenMode', enabled: true, extra: 1 }), { type: 'setZenMode', enabled: true });
    assert.deepStrictEqual(narrowCalendarPageMessage({ type: 'chooseTheme', theme: 'corpo' }), { type: 'chooseTheme' });
    assert.deepStrictEqual(narrowCalendarPageMessage({ type: 'openHelp', section: 'tasks' }), { type: 'openHelp' });
    assert.strictEqual(narrowCalendarPageMessage({ type: 'setZenMode', enabled: 'yes' }), undefined);
  });

  test('refuses anything the page could not have posted', () => {
    for (const message of [undefined, null, 'chooseTheme', { type: 'deleteNote' }, { type: 'openSource', filePath: 'a.md', line: 1 }, { type: 'hasOwnProperty' }]) {
      assert.strictEqual(narrowCalendarPageMessage(message), undefined, JSON.stringify(message));
    }
  });
});
