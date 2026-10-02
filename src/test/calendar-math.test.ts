import * as assert from 'assert';

import {
  addDays,
  addMonths,
  chooseFocusDay,
  DAY_MS,
  daysInMonth,
  formatIsoDate,
  makeDay,
  MONTH_NUMBERS,
  isWeekend,
  parseIsoDate,
  sameDayIn,
  shiftDate,
  skipWeekend,
  startOfDay,
  stepCalendar,
  stepDate,
  WEEKDAY_NAMES,
} from '../domain/markdown/calendar';

suite('Calendar math', () => {
  test('makeDay returns local midnight for a real day', () => {
    assert.strictEqual(makeDay(2026, 8, 30), new Date(2026, 8, 30).getTime());
    assert.strictEqual(makeDay(2024, 1, 29), new Date(2024, 1, 29).getTime());
  });

  test('makeDay refuses a day the month does not have, and a two-digit year', () => {
    assert.strictEqual(makeDay(2026, 1, 29), undefined);
    assert.strictEqual(makeDay(2026, 1, 31), undefined);
    assert.strictEqual(makeDay(2026, 12, 1), undefined);
    assert.strictEqual(makeDay(26, 0, 1), undefined);
  });

  test('parseIsoDate reads only YYYY-MM-DD, and only real days', () => {
    assert.strictEqual(parseIsoDate('2026-09-30'), new Date(2026, 8, 30).getTime());
    assert.strictEqual(parseIsoDate('2026-02-30'), undefined);
    assert.strictEqual(parseIsoDate('2026-9-30'), undefined);
    assert.strictEqual(parseIsoDate(' 2026-09-30'), undefined);
    assert.strictEqual(parseIsoDate('0050-01-01'), undefined);
    assert.strictEqual(parseIsoDate(''), undefined);
    assert.strictEqual(parseIsoDate(undefined), undefined);
  });

  test('formatIsoDate writes the local day, padded', () => {
    assert.strictEqual(formatIsoDate(new Date(2026, 0, 5, 23, 59).getTime()), '2026-01-05');
  });

  test('startOfDay and addDays move by calendar days', () => {
    const noon = new Date(2026, 2, 7, 12).getTime();
    assert.strictEqual(startOfDay(noon), new Date(2026, 2, 7).getTime());
    assert.strictEqual(addDays(noon, 2), new Date(2026, 2, 9).getTime());
    assert.strictEqual(addDays(new Date(2026, 0, 31).getTime(), 1), new Date(2026, 1, 1).getTime());
    assert.strictEqual(DAY_MS, 86_400_000);
  });

  test('addMonths keeps the day where the month allows it, and lands on midnight', () => {
    assert.strictEqual(addMonths(new Date(2026, 0, 31, 15).getTime(), 1), new Date(2026, 1, 28).getTime());
    assert.strictEqual(addMonths(new Date(2024, 0, 31).getTime(), 1), new Date(2024, 1, 29).getTime());
    assert.strictEqual(addMonths(new Date(2026, 10, 15).getTime(), 3), new Date(2027, 1, 15).getTime());
    assert.strictEqual(addMonths(new Date(2026, 2, 31).getTime(), -1), new Date(2026, 1, 28).getTime());
    assert.strictEqual(daysInMonth(new Date(2026, 1, 10)), 28);
  });

  test('the tables number weekdays and months as Date does', () => {
    assert.strictEqual(WEEKDAY_NAMES[new Date(2026, 8, 30).getDay()], 'wednesday');
    assert.strictEqual(WEEKDAY_NAMES.length, 7);
    assert.strictEqual(MONTH_NUMBERS.sept, 8);
    assert.strictEqual(MONTH_NUMBERS.may, 4);
  });
});

suite('Calendar page steps', () => {
  test('shiftDate moves a YYYY-MM-DD date by days, across months, years, and leap days', () => {
    assert.strictEqual(shiftDate('2026-09-30', 1), '2026-10-01');
    assert.strictEqual(shiftDate('2026-01-01', -1), '2025-12-31');
    assert.strictEqual(shiftDate('2024-02-28', 1), '2024-02-29');
    assert.strictEqual(shiftDate('2026-03-07', 7), '2026-03-14', 'a daylight-saving week is still seven days');
    assert.strictEqual(shiftDate('2026-09-13', 0), '2026-09-13');
  });

  test('isWeekend is Saturday and Sunday', () => {
    assert.deepStrictEqual(
      ['2026-09-12', '2026-09-13', '2026-09-14', '2026-09-18'].map(isWeekend),
      [true, true, false, false],
    );
  });

  test('skipWeekend goes on to a weekday either way, only with the weekends hidden', () => {
    assert.strictEqual(skipWeekend('2026-09-12', 1, true), '2026-09-14');
    assert.strictEqual(skipWeekend('2026-09-13', -1, true), '2026-09-11');
    assert.strictEqual(skipWeekend('2026-09-12', 1, false), '2026-09-12');
    assert.strictEqual(skipWeekend('2026-09-15', 1, true), '2026-09-15');
  });

  test('stepDate moves a row a week however many days it draws, and past a hidden weekend', () => {
    assert.strictEqual(stepDate('2026-09-16', 7, false), '2026-09-23');
    assert.strictEqual(stepDate('2026-09-16', -7, false), '2026-09-09');
    assert.strictEqual(stepDate('2026-09-16', 5, true), '2026-09-23', 'a row of five is still a week');
    assert.strictEqual(stepDate('2026-09-16', -5, true), '2026-09-09');
    assert.strictEqual(stepDate('2026-09-18', 1, true), '2026-09-21', 'Friday on to Monday');
    assert.strictEqual(stepDate('2026-09-14', -1, true), '2026-09-11', 'Monday back to Friday');
    assert.strictEqual(stepDate('2026-09-18', 1, false), '2026-09-19');
    assert.strictEqual(stepDate('2026-09-18', 0, true), '2026-09-18');
  });

  test('sameDayIn keeps the day of the month, or the month\'s last', () => {
    assert.strictEqual(sameDayIn('2026-09-14', '2026-10'), '2026-10-14');
    assert.strictEqual(sameDayIn('2026-01-31', '2026-02'), '2026-02-28');
    assert.strictEqual(sameDayIn('2024-01-31', '2024-02'), '2024-02-29');
    assert.strictEqual(sameDayIn('2026-03-31', '2026-04'), '2026-04-30');
  });

  test('chooseFocusDay: the chosen day if the focus is not drawn, else the focus, else today, else the first', () => {
    const days = [
      { date: '2026-08-31', isToday: false, inMonth: false },
      { date: '2026-09-01', isToday: false, inMonth: true },
      { date: '2026-09-02', isToday: true, inMonth: true },
      { date: '2026-09-03', isToday: false, inMonth: true },
    ];
    assert.strictEqual(chooseFocusDay(days, undefined, '2026-09-03'), '2026-09-03');
    assert.strictEqual(chooseFocusDay(days, '2026-10-01', '2026-09-03'), '2026-09-03', 'a focus not drawn yields to the chosen day');
    assert.strictEqual(chooseFocusDay(days, '2026-09-01', '2026-09-03'), '2026-09-01', 'a drawn focus wins');
    assert.strictEqual(chooseFocusDay(days, undefined, '2026-10-05'), '2026-09-02', 'a chosen day not drawn yields to today');
    assert.strictEqual(chooseFocusDay(days, undefined, undefined), '2026-09-02');
    assert.strictEqual(chooseFocusDay(days.filter((day) => !day.isToday), undefined, undefined), '2026-09-01', 'the first of the month');
    assert.strictEqual(chooseFocusDay(days.slice(0, 1), undefined, undefined), undefined);
  });

  test('stepCalendar moves a week seven days, and a month to the same day, on to a weekday when hidden', () => {
    const from = { date: '2026-09-30', previousMonth: '2026-08', nextMonth: '2026-10', hideWeekends: false };
    assert.deepStrictEqual(stepCalendar('week', 1, from), { date: '2026-10-07' });
    assert.deepStrictEqual(stepCalendar('week', -1, from), { date: '2026-09-23' });
    assert.deepStrictEqual(stepCalendar('month', 1, from), { month: '2026-10', date: '2026-10-30' });
    assert.deepStrictEqual(stepCalendar('month', -1, from), { month: '2026-08', date: '2026-08-30' });
    assert.deepStrictEqual(
      stepCalendar('month', -1, { ...from, hideWeekends: true }),
      { month: '2026-08', date: '2026-08-31' },
      'Sunday the 30th goes on to Monday',
    );
  });
});
