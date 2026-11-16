import type { Section } from '../model';
import { parseIsoDate } from './calendar';

/**
 * Dated headings (docs/implementation/49-meetings-and-types.md): a heading
 * whose words start with a day, `## 2026-11-16 10:00 Vendor sync`, begins a
 * dated entry in a note that is not a daily note. A project's or a person's
 * note can then hold its meetings, each under the day it happened, and each
 * is found, sorted, and listed by that day, not by the day the note was
 * created.
 *
 * A daily note has no dated entries: the whole note is already about one
 * day, which is what its entries are dated by.
 */

/** The day a heading starts with, and the time of day when it gives one. */
export interface HeadingDate {
  /** The day, `YYYY-MM-DD`. */
  day: string;
  /** The time of day as written, `HH:MM`, when the heading gives one. */
  time?: string;
  /** The local time the day starts at, or the time of day on it. */
  at: number;
}

/**
 * A day at the start of a heading, then an optional time of day, and the
 * end of the heading or something that is not part of a longer number or
 * word: `2026-11-16`, `2026-11-16 10:00 Vendor sync`, `2026-11-16: Kickoff`.
 */
const DATE_LED = /^\s*(\d{4}-\d{2}-\d{2})(?:[ T]+(\d{1,2}):(\d{2}))?(?![\w-])/;

/**
 * The day a heading's words start with, or undefined when they start with
 * anything else, or with a day no calendar has, such as `2026-13-40`.
 */
export function readHeadingDate(heading: string): HeadingDate | undefined {
  const match = DATE_LED.exec(heading);
  const dayAt = match ? parseIsoDate(match[1]) : undefined;
  if (!match || dayAt === undefined || !isCalendarDay(match[1], dayAt)) {
    return undefined;
  }
  const hours = match[2] === undefined ? undefined : Number(match[2]);
  const minutes = match[3] === undefined ? undefined : Number(match[3]);
  if (hours === undefined || minutes === undefined || hours > 23 || minutes > 59) {
    return { day: match[1], at: dayAt };
  }
  const at = new Date(dayAt);
  at.setHours(hours, minutes, 0, 0);
  return { day: match[1], time: `${String(hours).padStart(2, '0')}:${match[3]}`, at: at.getTime() };
}

/** Whether `day` names the day `at` falls on, which `2026-02-31` does not: it reads as March 3. */
function isCalendarDay(day: string, at: number): boolean {
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return day === `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Dates a note's sections by its dated headings: each heading that starts
 * with a day, and every section under it, is marked `dated` with that day
 * and takes it as both its created and its updated time, since the note's
 * own times say when the note was started and last touched, not when the
 * meeting was. A dated heading under another takes its own day.
 *
 * Returns the time each dated section counts from, by section id, for the
 * tasks and questions written in it.
 */
export function dateSections(sections: Section[]): Map<string, number> {
  const byId = new Map(sections.map((section) => [section.id, section]));
  const own = new Map<string, HeadingDate>();
  for (const section of sections) {
    const date = section.isInline ? undefined : readHeadingDate(section.heading);
    if (date) {
      own.set(section.id, date);
    }
  }
  const dated = new Map<string, number>();
  if (own.size === 0) {
    return dated;
  }
  for (const section of sections) {
    const date = nearestDate(section, byId, own);
    if (date) {
      section.dated = date.day;
      section.createdAt = date.at;
      section.updatedAt = date.at;
      dated.set(section.id, date.at);
    }
  }
  return dated;
}

/**
 * Whether a section is a dated heading itself, rather than something
 * written under one: its heading starts with the day it is dated by.
 */
export function isDatedHeading(section: Pick<Section, 'heading' | 'isInline' | 'dated'>): boolean {
  return section.dated !== undefined && !section.isInline && readHeadingDate(section.heading)?.day === section.dated;
}

/** The day of the nearest dated heading at or above a section, walking up its parents. */
function nearestDate(
  section: Section,
  byId: ReadonlyMap<string, Section>,
  own: ReadonlyMap<string, HeadingDate>,
): HeadingDate | undefined {
  const seen = new Set<string>();
  let at: Section | undefined = section;
  while (at && !seen.has(at.id)) {
    const date = own.get(at.id);
    if (date) {
      return date;
    }
    seen.add(at.id);
    at = at.parentSectionId ? byId.get(at.parentSectionId) : undefined;
  }
  return undefined;
}

/**
 * The line ranges, one-based and inclusive, of a note's dated entries: each
 * dated heading that is not under another, with everything under it. What
 * is left of the note is what describes its subject.
 */
export function datedRanges(sections: readonly Section[]): Array<{ startLine: number; endLine: number }> {
  const byId = new Map(sections.map((section) => [section.id, section]));
  return sections
    .filter(
      (section) =>
        isDatedHeading(section) &&
        !(section.parentSectionId && byId.get(section.parentSectionId)?.dated !== undefined),
    )
    .map((section) => ({ startLine: section.startLine, endLine: section.endLine }))
    .sort((left, right) => left.startLine - right.startLine);
}

/**
 * A note's text without its dated entries: their lines left blank, so every
 * other line keeps its number, and the blank lines that leaves at the end
 * taken off.
 */
export function withoutDatedEntries(lines: readonly string[], sections: readonly Section[]): string[] {
  const ranges = datedRanges(sections);
  if (ranges.length === 0) {
    return [...lines];
  }
  const kept = lines.map((line, index) =>
    ranges.some((range) => index + 1 >= range.startLine && index + 1 <= range.endLine) ? '' : line,
  );
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') {
    kept.pop();
  }
  return kept;
}
