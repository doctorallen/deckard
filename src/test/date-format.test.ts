import * as assert from 'assert';

import {
  createDateFormats,
  DEFAULT_DATE_FORMATS,
  type DateFormats,
  formatDisplayDate,
  formatDisplayDay,
  hasWeekdayToken,
  isReadableDateFormat,
  nameDisplayDay,
  ordinal,
} from '../domain/markdown/dateFormat';

/**
 * A date written in the reader's format: Moment's tokens, each one, text in
 * brackets, the weeks around New Year, the 12-hour clock, the display
 * language's own forms, and the default for a format that writes no date.
 */
suite('Date formats', () => {
  // Friday 2026-10-02, 9:05:07 in the evening.
  const evening = new Date(2026, 9, 2, 21, 5, 7).getTime();
  const formatted = (format: string, at = evening, settings: Partial<DateFormats> = {}): string =>
    formatDisplayDate(at, { ...DEFAULT_DATE_FORMATS, ...settings, date: format });
  // Intl may write a narrow no-break space before AM and PM.
  const spaced = (text: string): string => text.replace(/\s/g, ' ');

  test('the default writes a date as Deckard always has', () => {
    assert.strictEqual(formatDisplayDate(evening), '2026-10-02');
    assert.strictEqual(formatDisplayDate(evening, DEFAULT_DATE_FORMATS, 'short'), 'Fri, Oct 2');
  });

  test('every token of the year, quarter, month, and day', () => {
    const cases: [string, string][] = [
      ['YYYY', '2026'], ['YY', '26'], ['Q', '4'], ['Qo', '4th'],
      ['M', '10'], ['MM', '10'], ['Mo', '10th'], ['MMM', 'Oct'], ['MMMM', 'October'],
      ['D', '2'], ['DD', '02'], ['Do', '2nd'], ['DDD', '275'], ['DDDD', '275'],
      ['d', '5'], ['do', '5th'], ['dd', 'Fr'], ['ddd', 'Fri'], ['dddd', 'Friday'], ['E', '5'],
      ['X', String(Math.floor(evening / 1000))], ['x', String(evening)],
    ];
    for (const [format, expected] of cases) {
      assert.strictEqual(formatted(format), expected, format);
    }
  });

  test('pads what a doubled token pads', () => {
    const january = new Date(2009, 0, 5, 3, 4, 6).getTime();
    const cases: [string, string][] = [
      ['YY', '09'], ['MM', '01'], ['M', '1'], ['DD', '05'], ['DDD', '5'], ['DDDD', '005'],
      ['HH', '03'], ['H', '3'], ['hh', '03'], ['mm', '04'], ['m', '4'], ['ss', '06'], ['s', '6'],
      ['ww', '02'], ['WW', '02'],
    ];
    for (const [format, expected] of cases) {
      assert.strictEqual(formatted(format, january), expected, format);
    }
    assert.strictEqual(formatted('YYYY', new Date(2026, 0, 1).setFullYear(987)), '0987');
  });

  test('ordinals, the teens included', () => {
    const cases: [number, string][] = [
      [1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [11, '11th'], [12, '12th'], [13, '13th'],
      [21, '21st'], [22, '22nd'], [23, '23rd'], [101, '101st'], [111, '111th'], [112, '112th'], [0, '0th'],
    ];
    for (const [value, expected] of cases) {
      assert.strictEqual(ordinal(value), expected);
    }
    assert.strictEqual(formatted('Do', new Date(2026, 9, 13).getTime()), '13th');
    assert.strictEqual(formatted('Do', new Date(2026, 9, 31).getTime()), '31st');
  });

  test('the 12- and 24-hour clocks', () => {
    const at = (hour: number): number => new Date(2026, 9, 2, hour, 30).getTime();
    assert.strictEqual(formatted('h:mm A', at(0)), '12:30 AM');
    assert.strictEqual(formatted('h:mm a', at(11)), '11:30 am');
    assert.strictEqual(formatted('h:mm A', at(12)), '12:30 PM');
    assert.strictEqual(formatted('hh:mm a', at(21)), '09:30 pm');
    assert.strictEqual(formatted('H:mm', at(0)), '0:30');
    assert.strictEqual(formatted('k:mm', at(0)), '24:30');
    assert.strictEqual(formatted('kk', at(9)), '09');
    assert.strictEqual(formatted('HH:mm', new Date(2026, 9, 2).getTime()), '00:00', 'a date with no time reads midnight');
  });

  test('text in brackets is written without them, and other characters as they are', () => {
    assert.strictEqual(formatted('[Week] W'), 'Week 40');
    assert.strictEqual(formatted('[Today is] dddd, [the] Do'), 'Today is Friday, the 2nd');
    assert.strictEqual(formatted('YYYY/MM/DD'), '2026/10/02');
    assert.strictEqual(formatted('DD.MM.YYYY'), '02.10.2026');
    assert.strictEqual(formatted('D MMM YYYY'), '2 Oct 2026');
    assert.strictEqual(formatted('YYYY-MM-DDTHH:mm'), '2026-10-02T21:05', 'a letter that is no token is text');
    assert.strictEqual(formatted('[YYYY'), '[2026', 'a bracket never closed is itself');
    assert.strictEqual(formatted('YYYYY D'), 'YYYYY 2', 'a run that names no token is text');
  });

  test('ISO weeks around New Year', () => {
    const cases: [number, number, number, string][] = [
      // Thursday 2026-01-01 is in 2026's week 1.
      [2026, 0, 1, '2026-W01'],
      // Monday 2024-12-30 is in 2025's week 1, since that week holds 2025's first Thursday.
      [2024, 11, 30, '2025-W01'],
      // Friday 2027-01-01 is in 2026's week 53.
      [2027, 0, 1, '2026-W53'],
      [2027, 0, 3, '2026-W53'],
      [2027, 0, 4, '2027-W01'],
      [2026, 9, 2, '2026-W40'],
    ];
    for (const [year, month, day, expected] of cases) {
      assert.strictEqual(formatted('GGGG-[W]WW', new Date(year, month, day).getTime()), expected, expected);
    }
    assert.strictEqual(formatted('Wo'), '40th');
    assert.strictEqual(formatted('E', new Date(2026, 9, 4).getTime()), '7', 'Sunday is ISO day 7');
  });

  test('weeks from the reader\'s week start, week 1 holding January 1st', () => {
    // Thursday 2026-12-31 shares its Sunday week with 2027-01-01.
    assert.strictEqual(formatted('gggg w', new Date(2026, 11, 31).getTime()), '2027 1');
    assert.strictEqual(formatted('gggg w', new Date(2026, 11, 26).getTime()), '2026 52');
    assert.strictEqual(formatted('gggg w', new Date(2026, 0, 1).getTime()), '2026 1');
    assert.strictEqual(formatted('gggg w', new Date(2026, 0, 4).getTime()), '2026 2', 'a Sunday starts week 2');
    assert.strictEqual(formatted('gggg w', new Date(2026, 0, 4).getTime(), { weekStart: 1 }), '2026 1', 'but not when weeks start on Monday');
    assert.strictEqual(formatted('gggg w', new Date(2026, 0, 5).getTime(), { weekStart: 1 }), '2026 2');
    assert.strictEqual(formatted('ww wo'), '40 40th');
  });

  test('L to llll are the display language\'s own forms', () => {
    const morning = new Date(2026, 9, 2, 9, 30).getTime();
    const cases: [string, string][] = [
      ['L', '10/02/2026'], ['l', '10/2/2026'],
      ['LL', 'October 2, 2026'], ['ll', 'Oct 2, 2026'],
      ['LLL', 'October 2, 2026 9:30 AM'], ['lll', 'Oct 2, 2026 9:30 AM'],
      ['LLLL', 'Friday, October 2, 2026 9:30 AM'], ['llll', 'Fri, Oct 2, 2026 9:30 AM'],
    ];
    for (const [format, expected] of cases) {
      assert.strictEqual(spaced(formatted(format, morning)), expected, format);
    }
    assert.strictEqual(formatted('L', morning, { locale: 'de' }), '02.10.2026');
    assert.strictEqual(formatted('L', morning, { locale: 'not a language!' }), '10/02/2026', 'a language Intl cannot read is English');
  });

  test('a short date in another year is written in full', () => {
    const now = new Date(2026, 9, 6).getTime();
    const formats = { ...DEFAULT_DATE_FORMATS, date: 'D MMM YYYY', short: 'D MMM' };
    assert.strictEqual(formatDisplayDate(new Date(2026, 1, 3).getTime(), formats, 'short', now), '3 Feb');
    assert.strictEqual(formatDisplayDate(new Date(2025, 1, 3).getTime(), formats, 'short', now), '3 Feb 2025');
    assert.strictEqual(formatDisplayDate(new Date(2025, 1, 3).getTime(), formats, 'short'), '3 Feb', 'without now, short is short');
    assert.strictEqual(formatDisplayDate(new Date(2025, 1, 3).getTime(), formats, 'date', now), '3 Feb 2025');
  });

  test('an empty or unreadable format falls back to the default', () => {
    for (const written of ['', '   ', '[YYYY]', 42, undefined, null]) {
      const formats = createDateFormats({ date: written, short: written });
      assert.strictEqual(formats.date, 'YYYY-MM-DD', String(written));
      assert.strictEqual(formats.short, 'ddd, MMM D', String(written));
    }
    assert.strictEqual(isReadableDateFormat('hello there'), true, 'h writes the hour, as in Moment');
    assert.strictEqual(isReadableDateFormat('[only text]'), false);
    assert.strictEqual(formatDisplayDate(evening, { ...DEFAULT_DATE_FORMATS, date: '[no date]' }), '2026-10-02', 'formatting falls back too');
    assert.deepStrictEqual(createDateFormats({ date: ' DD/MM/YYYY ', locale: 'de', weekStart: 1 }), {
      date: 'DD/MM/YYYY', short: 'ddd, MMM D', locale: 'de', weekStart: 1,
    });
    assert.strictEqual(createDateFormats({ weekStart: 9 }).weekStart, 0);
    assert.strictEqual(createDateFormats({ locale: '' }).locale, 'en');
  });

  test('a day named with its weekday, unless the format names it already', () => {
    const friday = new Date(2026, 8, 25).getTime();
    assert.strictEqual(nameDisplayDay(friday), 'Friday 2026-09-25');
    assert.strictEqual(nameDisplayDay(friday, DEFAULT_DATE_FORMATS, { weekday: 'short' }), 'Fri 2026-09-25');
    assert.strictEqual(nameDisplayDay(friday, { ...DEFAULT_DATE_FORMATS, date: 'dddd D MMMM' }), 'Friday 25 September');
    assert.strictEqual(nameDisplayDay(friday, DEFAULT_DATE_FORMATS, { weekday: 'short', kind: 'short' }), 'Fri, Sep 25');
    assert.strictEqual(hasWeekdayToken('ddd, MMM D'), true);
    assert.strictEqual(hasWeekdayToken('LLLL'), true);
    assert.strictEqual(hasWeekdayToken('[dddd] YYYY'), false, 'a weekday in brackets is text');
    assert.strictEqual(hasWeekdayToken('DD/MM/YYYY'), false);
  });

  test('a YYYY-MM-DD date is written as its day, and anything else as it is', () => {
    const formats = { ...DEFAULT_DATE_FORMATS, date: 'MM/DD/YYYY' };
    assert.strictEqual(formatDisplayDay('2026-10-02', formats), '10/02/2026');
    assert.strictEqual(formatDisplayDay('next week', formats), 'next week');
    assert.strictEqual(formatDisplayDay('2026-02-30', formats), '2026-02-30');
  });
});
