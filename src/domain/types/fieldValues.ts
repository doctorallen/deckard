/**
 * Front-matter values read by a field's kind, as Deckard writes them and as
 * they are written by hand (docs/implementation/30-databases.md § Values):
 * numbers with or without thousands separators, ISO dates and the plain
 * words the task editor takes, checkbox words, and select options in any
 * case. Values that name rows are the type index's to resolve.
 */
import { parseIsoDate } from '../markdown/calendar';
import { parseDatePhrase } from '../markdown/dates';
import type { FieldKind } from '../model';

/** `12`, `-3`, `1,200`, `1.5`: digits, with commas between thousands and a decimal point. */
const NUMBER = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
/** An ISO date, with or without a time after it. */
const ISO_DATE = /^(\d{4}-\d{2}-\d{2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
/** The words a checkbox field reads as checked, and as not. */
const CHECKED = new Set(['true', 'yes', 'on']);
const UNCHECKED = new Set(['false', 'no', 'off']);

/** A number as written by hand, or undefined when the text is not one. */
export function readNumberValue(text: string): number | undefined {
  const trimmed = text.trim();
  return NUMBER.test(trimmed) ? Number(trimmed.replace(/,/g, '')) : undefined;
}

/**
 * A date as `YYYY-MM-DD`: an ISO date, with any time dropped, or the plain
 * words the task editor takes (`next friday`, `march 3`), read from `now`,
 * the moment they were written. Undefined when the text is not a day.
 */
export function readDateValue(text: string, now: number): string | undefined {
  const trimmed = text.trim();
  const iso = ISO_DATE.exec(trimmed);
  if (iso) {
    return parseIsoDate(iso[1]) === undefined ? undefined : iso[1];
  }
  return trimmed ? parseDatePhrase(trimmed, now)?.date : undefined;
}

/** A checkbox value: `true`, `yes`, `on`, or `false`, `no`, `off`, any case; undefined for anything else. */
export function readCheckboxValue(text: string): boolean | undefined {
  const word = text.trim().toLowerCase();
  if (CHECKED.has(word)) {
    return true;
  }
  return UNCHECKED.has(word) ? false : undefined;
}

/**
 * A select's option as the schema spells it, matched in any case.
 * A select with no options takes any value as written.
 */
export function readSelectValue(kind: Pick<FieldKind, 'options'>, text: string): string | undefined {
  const options = kind.options ?? [];
  const trimmed = text.trim();
  if (options.length === 0) {
    return trimmed || undefined;
  }
  const lowered = trimmed.toLowerCase();
  return options.find((option) => option.toLowerCase() === lowered);
}

/** A kind's name as a sentence says it: `Number`, `Date`, `Checkbox`. */
export function describeKindName(kind: Pick<FieldKind, 'name'>): string {
  return kind.name.charAt(0).toUpperCase() + kind.name.slice(1);
}
