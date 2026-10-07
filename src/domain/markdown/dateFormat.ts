import { DAY_MS, parseIsoDate } from './calendar';

/**
 * A date as the reader asked to read it.
 *
 * Every date Deckard shows a reader goes through `formatDisplayDate`, in the
 * format set in `deckard.display.dateFormat`, or for a day with little room
 * in `deckard.display.shortDateFormat`. A format is written with Moment's
 * tokens, which Obsidian's daily notes, Templater, and Periodic Notes use,
 * so a format copied from a vault works here unchanged: a run of the same
 * letter is one token, any other character is written as it is, and text in
 * `[brackets]` is written without its brackets.
 *
 * Dates Deckard writes into notes, file names, and searches are not shown
 * here: they stay `YYYY-MM-DD` (calendar.ts's formatIsoDate), since other
 * tools and other people's settings read them.
 *
 * Only `Date` and `Intl.DateTimeFormat` are used. Names are English, as
 * every other word Deckard writes is; `L` to `llll` are the display
 * language's own forms. Pages import this module too, so it stays pure.
 */

/** The formats a reader set, with what they depend on besides. */
export interface DateFormats {
  /** Every full date, `deckard.display.dateFormat`. */
  readonly date: string;
  /** A day in this year where there is little room, `deckard.display.shortDateFormat`. */
  readonly short: string;
  /** The display language `L` to `llll` follow, as VS Code names it: `en`, `de`, `zh-cn`. */
  readonly locale: string;
  /** The day a week starts on for `w` and `gggg`, 0 for Sunday, from `deckard.calendar.weekStart`. */
  readonly weekStart: number;
}

/** Which of the two formats a date is written in. */
export type DateKind = 'date' | 'short';

/** The full format, as Deckard has always written a date. */
export const DEFAULT_DATE_FORMAT = 'YYYY-MM-DD';
/** The short format, as Deckard has always written a day in a narrow place. */
export const DEFAULT_SHORT_DATE_FORMAT = 'ddd, MMM D';
/** The language `L` to `llll` follow when none is given. */
export const DEFAULT_DATE_LOCALE = 'en';

/** The formats nobody has changed: dates read as they did before there was a setting. */
export const DEFAULT_DATE_FORMATS: DateFormats = {
  date: DEFAULT_DATE_FORMAT,
  short: DEFAULT_SHORT_DATE_FORMAT,
  locale: DEFAULT_DATE_LOCALE,
  weekStart: 0,
};

/**
 * DateFormats from settings as written, each one that is empty or
 * unreadable at its default: a format that is not text, or writes no part
 * of a date, falls back rather than writing the same words for every day.
 */
export function createDateFormats(settings: {
  readonly date?: unknown;
  readonly short?: unknown;
  readonly locale?: unknown;
  readonly weekStart?: unknown;
}): DateFormats {
  const weekStart = Number(settings.weekStart);
  return {
    date: readableFormat(settings.date) ?? DEFAULT_DATE_FORMAT,
    short: readableFormat(settings.short) ?? DEFAULT_SHORT_DATE_FORMAT,
    locale: typeof settings.locale === 'string' && settings.locale.trim() ? settings.locale.trim() : DEFAULT_DATE_LOCALE,
    weekStart: Number.isInteger(weekStart) && weekStart >= 0 && weekStart <= 6 ? weekStart : 0,
  };
}

/** A format trimmed, when it writes some part of a date; undefined otherwise. */
function readableFormat(format: unknown): string | undefined {
  if (typeof format !== 'string') {
    return undefined;
  }
  const trimmed = format.trim();
  return trimmed && isReadableDateFormat(trimmed) ? trimmed : undefined;
}

/** Whether a format writes some part of a date: text with at least one token in it. */
export function isReadableDateFormat(format: unknown): format is string {
  return typeof format === 'string' && readFormat(format).some((part) => part.token !== undefined);
}

/** Whether both formats are the defaults, so every date reads as it always has. */
export function isDefaultDateFormats(formats: DateFormats): boolean {
  return formats.date === DEFAULT_DATE_FORMAT && formats.short === DEFAULT_SHORT_DATE_FORMAT;
}

/**
 * A moment written in one of the reader's formats. A short date in another
 * year than `now`'s is written in the full format, so a short format needs
 * no year and a date never reads as this year's when it isn't; without
 * `now`, a short date is always short. A format that is unreadable writes
 * the default.
 */
export function formatDisplayDate(
  at: number,
  formats: DateFormats = DEFAULT_DATE_FORMATS,
  kind: DateKind = 'date',
  now?: number,
): string {
  return writeFormat(readFormat(chosenFormat(at, formats, kind, now)), new Date(at), formats);
}

/**
 * The format a moment is written in: the short one for a short date in
 * `now`'s year, else the full one, each at its default when unreadable.
 */
function chosenFormat(at: number, formats: DateFormats, kind: DateKind, now: number | undefined): string {
  return kind === 'short' && (now === undefined || new Date(at).getFullYear() === new Date(now).getFullYear())
    ? usableFormat(formats.short, DEFAULT_SHORT_DATE_FORMAT)
    : usableFormat(formats.date, DEFAULT_DATE_FORMAT);
}

/**
 * A `YYYY-MM-DD` date written in one of the reader's formats, as
 * formatDisplayDate writes its day. Anything that is not such a date is
 * given back as it is.
 */
export function formatDisplayDay(
  date: string,
  formats: DateFormats = DEFAULT_DATE_FORMATS,
  kind: DateKind = 'date',
  now?: number,
): string {
  const at = parseIsoDate(date);
  return at === undefined ? date : formatDisplayDate(at, formats, kind, now);
}

/**
 * A date with its weekday before it, where Deckard names the day as well as
 * the date: `Friday 2026-09-25`, `Mon 2026-09-14`. A format that already
 * writes a weekday is written alone, so the day is never named twice.
 * `kind` and `now` choose the format as formatDisplayDate does.
 */
export function nameDisplayDay(
  at: number,
  formats: DateFormats = DEFAULT_DATE_FORMATS,
  { weekday = 'long', kind = 'date', now }: { readonly weekday?: 'long' | 'short'; readonly kind?: DateKind; readonly now?: number } = {},
): string {
  const date = formatDisplayDate(at, formats, kind, now);
  if (hasWeekdayToken(chosenFormat(at, formats, kind, now))) {
    return date;
  }
  const names = englishNames();
  const day = new Date(at).getDay();
  return `${weekday === 'long' ? names.weekdays[day] : names.shortWeekdays[day]} ${date}`;
}

/** Whether a format writes the day of the week: `d`, `do`, `dd`, `ddd`, `dddd`, `E`, `LLLL`, or `llll`. */
export function hasWeekdayToken(format: string): boolean {
  return readFormat(format).some((part) => part.token !== undefined && WEEKDAY_TOKENS.has(part.token));
}

/** Whether a format counts weeks from the reader's week start: `w`, `ww`, `wo`, or `gggg`. */
export function usesLocaleWeeks(format: string): boolean {
  return readFormat(format).some((part) => part.token !== undefined && LOCALE_WEEK_TOKENS.has(part.token));
}

/** The tokens that count weeks from the reader's week start. */
const LOCALE_WEEK_TOKENS: ReadonlySet<string> = new Set(['w', 'ww', 'wo', 'gggg']);

/**
 * Whether a format writes the day of the month before the month, as
 * `DD/MM/YYYY` and `D MMM` do, so a date box reads `3/10` as the 3rd of
 * October for its reader.
 */
export function writesDayFirst(format: string): boolean {
  const tokens = readFormat(format).flatMap((part) => (part.token === undefined ? [] : [part.token]));
  const day = tokens.findIndex((token) => token === 'D' || token === 'DD' || token === 'Do');
  const month = tokens.findIndex((token) => token.startsWith('M'));
  return day !== -1 && month !== -1 && day < month;
}

/** The tokens that write the day of the week. */
const WEEKDAY_TOKENS: ReadonlySet<string> = new Set(['d', 'do', 'dd', 'ddd', 'dddd', 'E', 'LLLL', 'llll']);

/** A format when it is readable, else the default it falls back to. */
function usableFormat(format: string, fallback: string): string {
  return isReadableDateFormat(format) ? format : fallback;
}

/** Every token a format can hold, Moment's names. */
const TOKENS: ReadonlySet<string> = new Set([
  'YYYY', 'YY', 'Q', 'Qo',
  'M', 'MM', 'Mo', 'MMM', 'MMMM',
  'D', 'DD', 'Do', 'DDD', 'DDDD',
  'd', 'do', 'dd', 'ddd', 'dddd', 'E',
  'w', 'ww', 'wo', 'W', 'WW', 'Wo', 'GGGG', 'gggg',
  'H', 'HH', 'h', 'hh', 'k', 'kk', 'm', 'mm', 's', 'ss', 'A', 'a',
  'X', 'x',
  'L', 'l', 'LL', 'll', 'LLL', 'lll', 'LLLL', 'llll',
]);

/** One piece of a format: a token to fill in, or text written as it is. */
interface FormatPart {
  readonly token?: string;
  readonly text?: string;
}

/** Formats already read, since every page draws many dates in one or two. */
const readFormats = new Map<string, readonly FormatPart[]>();

/**
 * A format as its pieces. A run of the same letter is one token, with an
 * `o` after it when that names an ordinal (`Do`, `Mo`); a run that names no
 * token, and every other character, is text; `[text]` is text without its
 * brackets, and a `[` never closed is itself.
 */
function readFormat(format: string): readonly FormatPart[] {
  const known = readFormats.get(format);
  if (known) {
    return known;
  }
  const parts: FormatPart[] = [];
  const addText = (text: string): void => {
    const last = parts[parts.length - 1];
    if (last && last.text !== undefined) {
      parts[parts.length - 1] = { text: last.text + text };
    } else if (text) {
      parts.push({ text });
    }
  };
  let at = 0;
  while (at < format.length) {
    const char = format[at];
    if (char === '[') {
      const close = format.indexOf(']', at + 1);
      if (close >= 0) {
        addText(format.slice(at + 1, close));
        at = close + 1;
        continue;
      }
    }
    if (!/[A-Za-z]/.test(char)) {
      addText(char);
      at += 1;
      continue;
    }
    let end = at;
    while (format[end] === char) {
      end += 1;
    }
    const run = format.slice(at, end);
    if (format[end] === 'o' && TOKENS.has(`${run}o`)) {
      parts.push({ token: `${run}o` });
      at = end + 1;
    } else if (TOKENS.has(run)) {
      parts.push({ token: run });
      at = end;
    } else {
      addText(run);
      at = end;
    }
  }
  if (readFormats.size > 32) {
    readFormats.clear();
  }
  readFormats.set(format, parts);
  return parts;
}

/** Writes a format's pieces for one moment. */
function writeFormat(parts: readonly FormatPart[], date: Date, formats: DateFormats): string {
  return parts.map((part) => (part.token === undefined ? part.text ?? '' : writeToken(part.token, date, formats))).join('');
}

/** A number padded with zeros to a width. */
function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** A number as an ordinal: 1st, 2nd, 3rd, 4th, 11th, 21st, 112th. */
export function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) {
    return `${value}th`;
  }
  const suffix = ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th';
  return `${value}${suffix}`;
}

/** What each token writes for one moment. */
function writeToken(token: string, date: Date, formats: DateFormats): string {
  const names = englishNames();
  switch (token) {
    case 'YYYY': return pad(date.getFullYear(), 4);
    case 'YY': return pad(date.getFullYear() % 100, 2);
    case 'Q': return String(Math.floor(date.getMonth() / 3) + 1);
    case 'Qo': return ordinal(Math.floor(date.getMonth() / 3) + 1);
    case 'M': return String(date.getMonth() + 1);
    case 'MM': return pad(date.getMonth() + 1, 2);
    case 'Mo': return ordinal(date.getMonth() + 1);
    case 'MMM': return names.shortMonths[date.getMonth()];
    case 'MMMM': return names.months[date.getMonth()];
    case 'D': return String(date.getDate());
    case 'DD': return pad(date.getDate(), 2);
    case 'Do': return ordinal(date.getDate());
    case 'DDD': return String(dayOfYear(date));
    case 'DDDD': return pad(dayOfYear(date), 3);
    case 'd': return String(date.getDay());
    case 'do': return ordinal(date.getDay());
    case 'dd': return names.shortWeekdays[date.getDay()].slice(0, 2);
    case 'ddd': return names.shortWeekdays[date.getDay()];
    case 'dddd': return names.weekdays[date.getDay()];
    case 'E': return String(date.getDay() || 7);
    default: return writeWeekToken(token, date, formats) ?? writeTimeToken(token, date) ?? writeLocaleToken(token, date, formats.locale);
  }
}

/** The week tokens, or undefined for any other. */
function writeWeekToken(token: string, date: Date, formats: DateFormats): string | undefined {
  switch (token) {
    case 'w': return String(localeWeek(date, formats.weekStart).week);
    case 'ww': return pad(localeWeek(date, formats.weekStart).week, 2);
    case 'wo': return ordinal(localeWeek(date, formats.weekStart).week);
    case 'gggg': return pad(localeWeek(date, formats.weekStart).year, 4);
    case 'W': return String(isoWeek(date).week);
    case 'WW': return pad(isoWeek(date).week, 2);
    case 'Wo': return ordinal(isoWeek(date).week);
    case 'GGGG': return pad(isoWeek(date).year, 4);
    default: return undefined;
  }
}

/** The time tokens, or undefined for any other. A date in a note has no time, so it reads 00:00. */
function writeTimeToken(token: string, date: Date): string | undefined {
  const hours = date.getHours();
  switch (token) {
    case 'H': return String(hours);
    case 'HH': return pad(hours, 2);
    case 'h': return String(hours % 12 || 12);
    case 'hh': return pad(hours % 12 || 12, 2);
    case 'k': return String(hours || 24);
    case 'kk': return pad(hours || 24, 2);
    case 'm': return String(date.getMinutes());
    case 'mm': return pad(date.getMinutes(), 2);
    case 's': return String(date.getSeconds());
    case 'ss': return pad(date.getSeconds(), 2);
    case 'A': return hours < 12 ? 'AM' : 'PM';
    case 'a': return hours < 12 ? 'am' : 'pm';
    case 'X': return String(Math.floor(date.getTime() / 1000));
    case 'x': return String(date.getTime());
    default: return undefined;
  }
}

/** The day of the year, 1 for January 1st. */
function dayOfYear(date: Date): number {
  const first = new Date(date.getFullYear(), 0, 1);
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((day.getTime() - first.getTime()) / DAY_MS) + 1;
}

/** The first day of the week a day falls in, for weeks that start on `weekStart`. */
function weekBegins(year: number, month: number, day: number, weekStart: number): Date {
  const weekday = new Date(year, month, day).getDay();
  return new Date(year, month, day - ((weekday - weekStart + 7) % 7));
}

/** Whole days from one local midnight to another, whatever daylight saving does between them. */
function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

/**
 * The week of the year by the reader's week start, as Moment counts it for
 * English: week 1 is the week January 1st falls in, so the last days of
 * December can be in the next year's week 1.
 */
function localeWeek(date: Date, weekStart: number): { week: number; year: number } {
  const year = date.getFullYear();
  const begins = weekBegins(year, date.getMonth(), date.getDate(), weekStart);
  if (begins.getTime() >= weekBegins(year + 1, 0, 1, weekStart).getTime()) {
    return { week: 1, year: year + 1 };
  }
  return { week: Math.floor(daysBetween(weekBegins(year, 0, 1, weekStart), begins) / 7) + 1, year };
}

/**
 * The ISO week and its year: weeks start on Monday, and week 1 is the one
 * holding the year's first Thursday, so early January can be in the last
 * year's week 52 or 53.
 */
function isoWeek(date: Date): { week: number; year: number } {
  const fromMonday = (date.getDay() + 6) % 7;
  const thursday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - fromMonday + 3);
  const year = thursday.getFullYear();
  return { week: Math.floor(daysBetween(new Date(year, 0, 1), thursday) / 7) + 1, year };
}

/** Month and weekday names, read once from Intl in English. */
interface EnglishNames {
  readonly months: readonly string[];
  readonly shortMonths: readonly string[];
  readonly weekdays: readonly string[];
  readonly shortWeekdays: readonly string[];
}

let names: EnglishNames | undefined;

/**
 * The names `MMM`, `MMMM`, `dd`, `ddd`, and `dddd` write, in English, as
 * Intl gives them, so following the display language later changes one
 * argument.
 */
function englishNames(): EnglishNames {
  if (!names) {
    const list = (count: number, options: Intl.DateTimeFormatOptions, day: (index: number) => Date): string[] => {
      const format = new Intl.DateTimeFormat('en', options);
      return Array.from({ length: count }, (_, index) => format.format(day(index)));
    };
    // January 4th, 2026 is a Sunday, so the weekdays come out in getDay()'s order.
    names = {
      months: list(12, { month: 'long' }, (index) => new Date(2026, index, 1)),
      shortMonths: list(12, { month: 'short' }, (index) => new Date(2026, index, 1)),
      weekdays: list(7, { weekday: 'long' }, (index) => new Date(2026, 0, 4 + index)),
      shortWeekdays: list(7, { weekday: 'short' }, (index) => new Date(2026, 0, 4 + index)),
    };
  }
  return names;
}

/** What `L` to `llll` ask Intl for: the date, and whether a time follows. */
const LOCALE_TOKENS: Readonly<Record<string, { readonly date: Intl.DateTimeFormatOptions; readonly time?: true }>> = {
  L: { date: { year: 'numeric', month: '2-digit', day: '2-digit' } },
  l: { date: { year: 'numeric', month: 'numeric', day: 'numeric' } },
  LL: { date: { year: 'numeric', month: 'long', day: 'numeric' } },
  ll: { date: { year: 'numeric', month: 'short', day: 'numeric' } },
  LLL: { date: { year: 'numeric', month: 'long', day: 'numeric' }, time: true },
  lll: { date: { year: 'numeric', month: 'short', day: 'numeric' }, time: true },
  LLLL: { date: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }, time: true },
  llll: { date: { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }, time: true },
};

/** Intl's formatters for `L` to `llll`, by language and token. */
const localeFormatters = new Map<string, Intl.DateTimeFormat>();

/** One Intl formatter, made once; a language Intl cannot read is English. */
function localeFormatter(locale: string, key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const name = `${locale}\n${key}`;
  let formatter = localeFormatters.get(name);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat(locale, options);
    } catch {
      formatter = new Intl.DateTimeFormat(DEFAULT_DATE_LOCALE, options);
    }
    localeFormatters.set(name, formatter);
  }
  return formatter;
}

/**
 * `L` to `llll`, the display language's own forms, so `L` reads
 * `10/02/2026` in English and `02.10.2026` in German. A time follows the
 * date after a space, as Moment writes it.
 */
function writeLocaleToken(token: string, date: Date, locale: string): string {
  const asked = LOCALE_TOKENS[token];
  if (!asked) {
    return token;
  }
  const day = localeFormatter(locale, token, asked.date).format(date);
  return asked.time ? `${day} ${localeFormatter(locale, 'time', { hour: 'numeric', minute: '2-digit' }).format(date)}` : day;
}
