import * as assert from 'assert';

import {
  addDays,
  addMonths,
  DAY_MS,
  daysInMonth,
  formatIsoDate,
  makeDay,
  MONTH_NUMBERS,
  parseIsoDate,
  startOfDay,
  WEEKDAY_NAMES,
} from '../core/markdown/calendar';

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
