import * as assert from 'assert';

import { buildTaskCalendar, CalendarTask, escapeText, foldLine } from '../domain/tasks/taskCalendar';

const day = (month: number, date: number): number => new Date(2026, month - 1, date).getTime();

suite('Tasks as a calendar file', () => {
  const tasks: CalendarTask[] = [
    { title: 'Send the proposal', filePath: 'notes/atlas.md', lineNumber: 3, dueAt: day(10, 9), completed: false, updatedAt: Date.UTC(2026, 9, 1, 8), url: 'vscode://file/w/notes/atlas.md:3' },
    { title: 'Plan, then book; the room', filePath: 'notes/atlas.md', lineNumber: 4, scheduledAt: day(12, 31), completed: true },
    { title: 'No date', filePath: 'notes/atlas.md', lineNumber: 5, completed: false },
  ];

  test('writes each dated task as an all-day event, on its due date or else its scheduled one', () => {
    const text = buildTaskCalendar(tasks, 'Deckard: notes');
    assert.ok(text.endsWith('END:VCALENDAR\r\n'));
    assert.ok(!/[^\r]\n/.test(text), 'every line ends in CRLF');
    const lines = text.split('\r\n');
    assert.deepStrictEqual(lines.slice(0, 6), ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Esper Innovations//Deckard Notes//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Deckard: notes']);
    assert.strictEqual(lines.filter((line) => line === 'BEGIN:VEVENT').length, 2, 'the undated task has none');
    assert.ok(lines.includes('DTSTART;VALUE=DATE:20261009'));
    assert.ok(lines.includes('DTEND;VALUE=DATE:20261010'));
    assert.ok(lines.includes('DTSTART;VALUE=DATE:20261231'));
    assert.ok(lines.includes('DTEND;VALUE=DATE:20270101'), 'the next day runs into the new year');
    assert.ok(lines.includes('DTSTAMP:20261001T080000Z'));
    assert.ok(lines.includes('SUMMARY:✓ Plan\\, then book\\; the room'), 'a done task is marked, and text escaped');
    assert.ok(lines.includes('URL:vscode://file/w/notes/atlas.md:3'));
    assert.ok(text.replace(/\r\n /g, '').includes('DESCRIPTION:Due in notes/atlas.md\\, line 3.\\nvscode://file/w/notes/atlas.md:3'));
  });

  test('keeps an event’s UID when its task’s date or line moves, and tells twins apart', () => {
    const uids = (list: CalendarTask[]): string[] =>
      buildTaskCalendar(list, 'x').split('\r\n').filter((line) => line.startsWith('UID:'));
    const before = uids([tasks[0]]);
    const moved = uids([{ ...tasks[0], dueAt: day(11, 2), lineNumber: 9 }]);
    assert.deepStrictEqual(moved, before);
    const twins = uids([tasks[0], { ...tasks[0], lineNumber: 8 }]);
    assert.strictEqual(new Set(twins).size, 2);
    assert.strictEqual(buildTaskCalendar(tasks, 'x'), buildTaskCalendar(tasks, 'x'), 'the same tasks make the same bytes');
  });

  test('escapes text and folds long lines at 75 octets without splitting a character', () => {
    assert.strictEqual(escapeText('a\\b;c,d\ne'), 'a\\\\b\\;c\\,d\\ne');
    assert.strictEqual(escapeText('A\rB\r\nC'), 'A\\nB\\nC', 'a lone carriage return is a line break too');
    const long = `SUMMARY:${'é'.repeat(60)}`;
    const folded = foldLine(long);
    const pieces = folded.split('\r\n');
    assert.ok(pieces.length > 1);
    assert.ok(pieces.every((piece) => new TextEncoder().encode(piece).length <= 75));
    assert.strictEqual(pieces.map((piece, at) => (at === 0 ? piece : piece.slice(1))).join(''), long);
    assert.strictEqual(foldLine('SHORT:x'), 'SHORT:x');
  });
});
