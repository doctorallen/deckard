import * as assert from 'assert';

import { narrowCalendarMessage } from '../ui/webview/pages/calendar/messages';

// The sidebar Calendar's narrowing table, with the payloads
// parseCalendarMessage was held to before it moved, in calendar.test.ts and
// calendar-day.test.ts: each accepted message, and each refused one.
suite('Calendar messages', () => {
  test('accepts only the messages its page posts', () => {
    assert.deepStrictEqual(narrowCalendarMessage({ type: 'openDay', date: '2026-09-13' }), {
      type: 'openDay',
      date: '2026-09-13',
    });
    assert.deepStrictEqual(narrowCalendarMessage({ type: 'openWeek', date: '2026-09-07' }), {
      type: 'openWeek',
      date: '2026-09-07',
    });
    assert.deepStrictEqual(narrowCalendarMessage({ type: 'showMonth', month: '2026-10' }), {
      type: 'showMonth',
      month: '2026-10',
    });
    assert.deepStrictEqual(narrowCalendarMessage({ type: 'openMonth', path: '/etc' }), {
      type: 'openMonth',
    });
    assert.strictEqual(narrowCalendarMessage({ type: 'showMonth', month: '2026-13' }), undefined);
    assert.strictEqual(narrowCalendarMessage({ type: 'openWeek', date: '../notes' }), undefined);
    assert.strictEqual(narrowCalendarMessage({ type: 'deleteNote' }), undefined);
    assert.strictEqual(narrowCalendarMessage('openDay'), undefined);
  });

  test('accepts the messages of the panel and nothing more', () => {
    assert.deepStrictEqual(narrowCalendarMessage({ type: 'selectDay', date: '2026-09-25' }), { type: 'selectDay', date: '2026-09-25' });
    assert.deepStrictEqual(narrowCalendarMessage({ type: 'createDay', date: '2026-09-25' }), { type: 'createDay', date: '2026-09-25' });
    assert.deepStrictEqual(narrowCalendarMessage({ type: 'openNote', filePath: 'notes/a.md' }), { type: 'openNote', filePath: 'notes/a.md' });
    assert.deepStrictEqual(narrowCalendarMessage({ type: 'showMonth', month: '2026-10', date: '2026-10-25' }), {
      type: 'showMonth',
      month: '2026-10',
      date: '2026-10-25',
    });
    assert.strictEqual(narrowCalendarMessage({ type: 'showMonth', month: '2026-10', date: 'soon' }), undefined);
    assert.strictEqual(narrowCalendarMessage({ type: 'selectDay', date: '2026-9-5' }), undefined);
    assert.strictEqual(narrowCalendarMessage({ type: 'selectDay', date: '2026-09-25', extra: 1 }), undefined);
    assert.strictEqual(narrowCalendarMessage({ type: 'openNote', filePath: '' }), undefined);
  });

  test('accepts the task messages, and only well formed ones', () => {
    assert.deepStrictEqual(narrowCalendarMessage({ type: 'toggleTask', taskId: 't', completed: true }), { type: 'toggleTask', taskId: 't', completed: true });
    assert.deepStrictEqual(narrowCalendarMessage({ type: 'moveTask', taskId: 't', field: 'scheduled', date: '2026-09-26' }), {
      type: 'moveTask',
      taskId: 't',
      field: 'scheduled',
      date: '2026-09-26',
    });
    assert.deepStrictEqual(narrowCalendarMessage({ type: 'openTask', taskId: 't' }), { type: 'openTask', taskId: 't' });
    assert.strictEqual(narrowCalendarMessage({ type: 'moveTask', taskId: 't', field: 'start', date: '2026-09-26' }), undefined);
    assert.strictEqual(narrowCalendarMessage({ type: 'moveTask', taskId: 't', field: 'due', date: 'tomorrow' }), undefined);
    assert.strictEqual(narrowCalendarMessage({ type: 'toggleTask', taskId: 't', completed: 'yes' }), undefined);
  });

  test('accepts a tag to open by any key, which the host looks up', () => {
    assert.deepStrictEqual(narrowCalendarMessage({ type: 'openTag', tagKey: '#project/atlas' }), { type: 'openTag', tagKey: '#project/atlas' });
    assert.strictEqual(narrowCalendarMessage({ type: 'openTag', tagKey: '' }), undefined);
    assert.strictEqual(narrowCalendarMessage({ type: 'openTag', tagKey: 7 }), undefined);
  });

  test('accepts a search for the notes created on a day', () => {
    assert.deepStrictEqual(narrowCalendarMessage({ type: 'searchCreated', date: '2026-09-25' }), { type: 'searchCreated', date: '2026-09-25' });
    assert.strictEqual(narrowCalendarMessage({ type: 'searchCreated', date: 'today' }), undefined);
  });

  test('keeps only the fields the host reads, where the page may send more', () => {
    assert.deepStrictEqual(narrowCalendarMessage({ type: 'ready', at: 1 }), { type: 'ready' });
    assert.deepStrictEqual(narrowCalendarMessage({ type: 'openDay', date: '2026-09-13', extra: 1 }), { type: 'openDay', date: '2026-09-13' });
    assert.deepStrictEqual(narrowCalendarMessage({ type: 'openWeek', date: '2026-09-07', extra: 1 }), { type: 'openWeek', date: '2026-09-07' });
    assert.deepStrictEqual(narrowCalendarMessage({ type: 'showMonth', month: '2026-10', extra: 1 }), { type: 'showMonth', month: '2026-10' });
  });

  test('refuses a message with a field more than it sends, or an id it could not have drawn', () => {
    for (const message of [
      { type: 'createDay', date: '2026-09-25', extra: 1 },
      { type: 'searchCreated', date: '2026-09-25', extra: 1 },
      { type: 'openNote', filePath: 'notes/a.md', line: 1 },
      { type: 'openNote', filePath: 'x'.repeat(4097) },
      { type: 'openTask', taskId: '' },
      { type: 'openTask', taskId: 't', extra: 1 },
      { type: 'toggleTask', taskId: '', completed: true },
      { type: 'toggleTask', taskId: 't', completed: true, extra: 1 },
      { type: 'moveTask', taskId: '', field: 'due', date: '2026-09-26' },
      { type: 'moveTask', taskId: 't', field: 'due', date: '2026-09-26', extra: 1 },
      { type: 'showMonth', month: '2026-1' },
      { type: 'showMonth', month: 202610 },
      { type: 'showMonth', month: '2026-10', date: 25 },
      { type: 'openDay' },
      { type: 'constructor' },
      { type: 'toString' },
      { type: 7 },
      null,
      undefined,
    ]) {
      assert.strictEqual(narrowCalendarMessage(message), undefined, JSON.stringify(message));
    }
    assert.deepStrictEqual(narrowCalendarMessage({ type: 'openNote', filePath: 'x'.repeat(4096) }), { type: 'openNote', filePath: 'x'.repeat(4096) });
  });

  test('refuses what only the calendar page sends', () => {
    for (const message of [
      { type: 'setShowRepeats', show: true },
      { type: 'setShowWeekends', show: false },
      { type: 'setZenMode', enabled: true },
      { type: 'chooseTheme' },
      { type: 'openHelp' },
    ]) {
      assert.strictEqual(narrowCalendarMessage(message), undefined, JSON.stringify(message));
    }
  });
});
