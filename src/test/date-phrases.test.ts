import * as assert from 'assert';

import {
  DatePhraseOptions,
  describeDay,
  formatShortDay,
  parseDatePhrase,
  resolveDatePeriod,
  startOfWeek,
} from '../domain/markdown/dates';
import { localeWeekStart, numericOrderFor } from '../ui/commands/datePrompt';
import { formatIsoDate } from '../domain/markdown/calendar';
import { DEFAULT_DATE_FORMATS } from '../domain/markdown/dateFormat';

suite('Dates in plain words', () => {
  // Friday 2026-09-25, noon.
  const friday = new Date(2026, 8, 25, 12).getTime();
  const sunday = new Date(2026, 8, 27, 12).getTime();
  const read = (
    text: string,
    now: number = friday,
    options: DatePhraseOptions = {},
  ): string | undefined | null => {
    const found = parseDatePhrase(text, now, options);
    return found === undefined ? null : found.date;
  };

  test('reads a day toward the future', () => {
    const cases: [string, string][] = [
      ['friday', '2026-10-02'],
      ['Fri', '2026-10-02'],
      ['next friday', '2026-10-02'],
      ['this friday', '2026-10-02'],
      ['on friday', '2026-10-02'],
      ['last friday', '2026-09-18'],
      ['oct 3', '2026-10-03'],
      ['3 Oct', '2026-10-03'],
      ['October 3rd', '2026-10-03'],
      ['sep 12', '2027-09-12'],
      ['Oct 3, 2027', '2027-10-03'],
      ['3 October 2027', '2027-10-03'],
      ['next week', '2026-09-28'],
      ['end of week', '2026-09-26'],
      ['eow', '2026-09-26'],
      ['end of the month', '2026-09-30'],
      ['eom', '2026-09-30'],
      ['next month', '2026-10-01'],
      ['weekend', '2026-09-26'],
      ['this weekend', '2026-09-26'],
      ['3 days ago', '2026-09-22'],
      ['2 weeks ago', '2026-09-11'],
      ['in 3 days', '2026-09-28'],
      ['+2w', '2026-10-09'],
      ['today', '2026-09-25'],
      ['Tomorrow.', '2026-09-26'],
      ['yesterday', '2026-09-24'],
      ['2026-10-02', '2026-10-02'],
      ['2026/10/02', '2026-10-02'],
    ];
    for (const [text, expected] of cases) {
      assert.strictEqual(read(text), expected, text);
    }
  });

  test('reads a bare weekday or month-day backward for a date already past', () => {
    const past = { direction: 'past' as const };
    assert.strictEqual(read('sep 12', friday, past), '2026-09-12');
    assert.strictEqual(read('friday', friday, past), '2026-09-18');
    assert.strictEqual(read('next friday', friday, past), '2026-10-02', 'next still means next');
  });

  test('a week follows the day it starts on', () => {
    assert.strictEqual(read('next week', sunday), '2026-10-05');
    assert.strictEqual(read('next week', sunday, { weekStart: 1 }), '2026-09-28');
    assert.strictEqual(read('end of week', sunday), '2026-10-03');
    assert.strictEqual(read('end of week', sunday, { weekStart: 1 }), '2026-09-27');
    assert.strictEqual(read('weekend', sunday), '2026-09-27', 'on a weekend, today');
    assert.strictEqual(formatIsoDate(startOfWeek(friday, 1)), '2026-09-21');
    assert.strictEqual(formatIsoDate(startOfWeek(friday, 0)), '2026-09-20');
    assert.strictEqual(localeWeekStart('en-US'), 0);
    assert.strictEqual(localeWeekStart('not a language'), 0, 'Sunday when it cannot say');
  });

  test('reads a numeric date only in the order it is given', () => {
    assert.strictEqual(read('10/3', friday, { numericOrder: 'mdy' }), '2026-10-03');
    assert.strictEqual(read('10/3', friday, { numericOrder: 'dmy' }), '2027-03-10');
    assert.strictEqual(read('25/9', friday, { numericOrder: 'mdy' }), '2026-09-25', 'the other order');
    assert.strictEqual(read('3.10.2026', friday, { numericOrder: 'dmy' }), '2026-10-03');
    assert.strictEqual(read('10/3/27', friday, { numericOrder: 'mdy' }), '2027-10-03');
    assert.strictEqual(read('10/3'), null, 'no order, no numeric date');
    assert.strictEqual(read('31/2/2027', friday, { numericOrder: 'mdy' }), null);
    assert.strictEqual(read('31/2/2027', friday, { numericOrder: 'dmy' }), null);
    assert.strictEqual(numericOrderFor('en'), 'mdy');
    assert.strictEqual(numericOrderFor('de'), 'dmy');
  });

  test('clears on empty, keeps a month end, and guesses nothing', () => {
    assert.strictEqual(read('+1m', new Date(2027, 0, 31, 12).getTime()), '2027-02-28');
    assert.deepStrictEqual(parseDatePhrase('', friday), { date: undefined });
    assert.strictEqual(read('the cat'), null);
    assert.strictEqual(read('2026-02-31'), null);
  });

  test('says a day back with how far off it is', () => {
    assert.strictEqual(describeDay('2026-09-28', friday), 'Monday 2026-09-28 · in 3 days');
    assert.strictEqual(describeDay('2026-09-25', friday), 'Friday 2026-09-25 · today');
    assert.strictEqual(describeDay('2026-09-24', friday), 'Thursday 2026-09-24 · yesterday');
    assert.strictEqual(describeDay('2026-09-22', friday), 'Tuesday 2026-09-22 · 3 days ago');
    assert.strictEqual(describeDay('2027-03-10', friday), 'Wednesday 2027-03-10');
    assert.strictEqual(formatShortDay('2026-10-02', friday), 'Fri, Oct 2');
    assert.strictEqual(formatShortDay('2027-03-10', friday), '2027-03-10', 'another year is written in full');
    const formats = { ...DEFAULT_DATE_FORMATS, date: 'D MMMM YYYY', short: 'ddd D MMM' };
    assert.strictEqual(describeDay('2026-09-28', friday, formats), 'Monday 28 September 2026 · in 3 days');
    assert.strictEqual(formatShortDay('2026-10-02', friday, formats), 'Fri 2 Oct');
    assert.strictEqual(formatShortDay('2027-03-10', friday, formats), '10 March 2027');
  });

  test('names a whole week or month', () => {
    const span = (text: string, weekStart: 0 | 1 = 0) => {
      const period = resolveDatePeriod(text, friday, weekStart);
      return period && [formatIsoDate(period.start), formatIsoDate(period.end)];
    };
    assert.deepStrictEqual(span('this-week'), ['2026-09-20', '2026-09-27']);
    assert.deepStrictEqual(span('this-week', 1), ['2026-09-21', '2026-09-28']);
    assert.deepStrictEqual(span('next-week'), ['2026-09-27', '2026-10-04']);
    assert.deepStrictEqual(span('last-month'), ['2026-08-01', '2026-09-01']);
    assert.deepStrictEqual(span('2026-08'), ['2026-08-01', '2026-09-01']);
    assert.strictEqual(span('2026-13'), undefined);
  });
});
