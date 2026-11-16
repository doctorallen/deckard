import { noteTitle } from '../index/backlinks';
import { formatIsoDate, parseIsoDate } from '../markdown/calendar';
import { isDatedHeading } from '../markdown/datedHeadings';
import { extractTags } from '../markdown/parser';
import type { NoteLinkStyle } from '../markdown/wikiLinks';
import type { Section, TagReference, WorkspaceIndex } from '../model';
import { formatSectionLink } from './moveSection';

/**
 * Start a meeting (docs/implementation/49-meetings-and-types.md).
 *
 * A meeting's notes go where the meeting belongs: in the note of the
 * project or the person it is about, under a heading that starts with the
 * day and the time, `## 2026-11-16 10:00 Vendor sync @priya`, so the note
 * holds the project's meetings in order and each is found by its day.
 * Today's note keeps a link to it, so the day still lists what happened.
 *
 * What a meeting can be about is offered by what has been written about
 * lately, since the next meeting is most likely about the same things. A
 * meeting about several takes the first picked as its home and the rest as
 * tags on its heading; one about no one thing is written in today's note;
 * one that recurs has a note of its own, a dated heading for each time it
 * is held. Pure, so the rules can be read and tested apart from the editor.
 */

/** The days a subject's score takes to halve when nothing more is written about it. */
export const MEETING_HALF_LIFE_DAYS = 14;

/** How far back writing counts toward what a meeting is offered, in days. */
export const MEETING_LOOKBACK_DAYS = 60;

/** The most subjects, and the most meeting notes, the list offers. */
export const MAX_MEETING_SUBJECTS = 12;
export const MAX_MEETING_NOTES = 5;

const DAY = 24 * 60 * 60 * 1000;

/** A project, a person, or another tag a meeting can be about. */
export interface MeetingSubject {
  tag: TagReference;
  /** Its hub note, where the meeting is written; absent when it has none yet. */
  hubPath?: string;
  /** How much has been written about it lately: each heading counts, less the longer ago it was written. */
  score: number;
}

/** A note that holds meetings: one with dated headings that describes no tag. */
export interface MeetingNote {
  filePath: string;
  title: string;
  /** The day of its latest dated heading, `YYYY-MM-DD`. */
  lastDay: string;
}

/**
 * The tags written about most lately, most first: those that name a
 * person or sit in a namespace, as `#project/borealis` does, and those
 * with a hub note. A bare `#urgent` says how something is, not what a
 * meeting is about. Each heading that carries the tag, and each dated
 * heading of its hub note, counts for less the longer ago it was written,
 * and not at all past {@link MEETING_LOOKBACK_DAYS}.
 */
export function listMeetingSubjects(index: WorkspaceIndex, now: number, limit = MAX_MEETING_SUBJECTS): MeetingSubject[] {
  const subjects: MeetingSubject[] = [];
  for (const tag of index.tags.values()) {
    const hubPath = tag.hubFilePaths?.[0];
    if (!hubPath && !isSubjectKey(tag.key)) {
      continue;
    }
    const sections = new Map<string, Section>();
    tag.sectionIds.forEach((id) => {
      const section = index.sections.get(id);
      if (section) {
        sections.set(id, section);
      }
    });
    (hubPath ? (index.files.get(hubPath)?.sections ?? []) : [])
      .filter((section) => isDatedHeading(section))
      .forEach((section) => sections.set(section.id, section));
    const score = [...sections.values()].reduce((sum, section) => sum + recency(section.updatedAt, now), 0);
    if (score > 0) {
      subjects.push({ tag: { key: tag.key, label: tag.label }, hubPath, score });
    }
  }
  return subjects
    .sort((left, right) => right.score - left.score || left.tag.label.localeCompare(right.tag.label))
    .slice(0, limit);
}

/** Whether a tag names a person or sits in a namespace: `@priya`, `#project/borealis`. */
function isSubjectKey(key: string): boolean {
  return key.startsWith('@') || key.indexOf('/') > 1;
}

/** What something written at `at` counts for now: 1 today, half after each half-life, nothing past the lookback. */
function recency(at: number | undefined, now: number): number {
  if (at === undefined) {
    return 0;
  }
  const ageDays = Math.max(0, (now - at) / DAY);
  return ageDays > MEETING_LOOKBACK_DAYS ? 0 : 0.5 ** (ageDays / MEETING_HALF_LIFE_DAYS);
}

/**
 * The notes that hold meetings, latest held first: those with a dated
 * heading within {@link MEETING_LOOKBACK_DAYS} that are no tag's hub note,
 * since a hub note is offered by its tag. A meeting that recurs is offered
 * here from the second time on.
 */
export function listMeetingNotes(index: WorkspaceIndex, now: number, limit = MAX_MEETING_NOTES): MeetingNote[] {
  const notes: MeetingNote[] = [];
  index.files.forEach((file, filePath) => {
    if (file.hub) {
      return;
    }
    const days = file.sections.filter((section) => isDatedHeading(section)).map((section) => section.dated ?? '');
    const lastDay = days.sort().pop();
    const at = parseIsoDate(lastDay);
    if (lastDay && at !== undefined && now - at <= MEETING_LOOKBACK_DAYS * DAY) {
      notes.push({ filePath, title: noteTitle(filePath), lastDay });
    }
  });
  return notes
    .sort((left, right) => right.lastDay.localeCompare(left.lastDay) || left.title.localeCompare(right.title))
    .slice(0, limit);
}

/** What a meeting was picked to be about, in the list Start a Meeting shows. */
export type MeetingPick =
  | { kind: 'today' }
  | { kind: 'subject'; tag: TagReference; hubPath?: string }
  | { kind: 'note'; filePath: string }
  | { kind: 'ownNote' };

/**
 * The picks in the order they were made: those still picked keep their
 * place, and one newly picked goes last. A list with checkboxes reports
 * what is checked in the order it lists it, and the first picked is the
 * meeting's home, so the order is kept here as the checks change.
 */
export function orderPicks<T>(ordered: readonly T[], selected: readonly T[]): T[] {
  const kept = ordered.filter((pick) => selected.includes(pick));
  return [...kept, ...selected.filter((pick) => !kept.includes(pick))];
}

/** Where a meeting is written, and the tags its heading takes. */
export interface MeetingPlan {
  /** The first pick: today's note when nothing was picked. */
  home: MeetingPick;
  /** The other subjects picked, in order, each once: the home's own tag is the note's already. */
  tags: TagReference[];
}

/**
 * Where a meeting goes, from what was picked in order: the first is its
 * home, and every subject after it is a tag on its heading. A note picked
 * after the first is left out, since a meeting is written in one place.
 */
export function planMeeting(picks: readonly MeetingPick[]): MeetingPlan {
  const [home = { kind: 'today' } as MeetingPick, ...rest] = picks;
  const tags = new Map<string, TagReference>();
  for (const pick of rest) {
    if (pick.kind === 'subject' && !(home.kind === 'subject' && home.tag.key === pick.tag.key)) {
      tags.set(pick.tag.key, pick.tag);
    }
  }
  return { home, tags: [...tags.values()] };
}

/** The time of day a meeting is headed with: the clock's, to the nearest five minutes, `HH:MM`. */
export function formatMeetingTime(now: number): string {
  const rounded = new Date(Math.round(now / (5 * 60 * 1000)) * 5 * 60 * 1000);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(rounded.getHours())}:${pad(rounded.getMinutes())}`;
}

/** What a meeting's heading is made of. */
export interface MeetingHeading {
  /** The moment the meeting starts. */
  now: number;
  /** The meeting's name; empty for one that needs none, as in a note named for it. */
  name: string;
  /** The tags to end the heading with; one the name already writes is not written twice. */
  tags: readonly TagReference[];
  /** Whether it is written in a daily note, whose day is the meeting's, so the heading gives the time alone. */
  daily: boolean;
}

/**
 * A meeting's heading, without its `##`: the day and the time, its name,
 * and its tags, `2026-11-16 10:00 Vendor sync #project/borealis @priya`.
 * The day is the day the rounded time falls on, so a meeting started at
 * 23:58 is headed with tomorrow's 00:00.
 */
export function formatMeetingHeading({ now, name, tags, daily }: MeetingHeading): string {
  const rounded = Math.round(now / (5 * 60 * 1000)) * 5 * 60 * 1000;
  const words = name.replace(/\s+/g, ' ').trim();
  const written = new Set(extractTags(words).map((tag) => tag.key));
  return [
    ...(daily ? [] : [formatIsoDate(rounded)]),
    formatMeetingTime(now),
    ...(words ? [words] : []),
    ...tags.filter((tag) => !written.has(tag.key)).map((tag) => tag.label),
  ].join(' ');
}

/** The level a meeting's heading is written at: a dated heading is `##` or deeper. */
export const MEETING_HEADING_LEVEL = 2;

/** Where a meeting's heading goes in its note, and where the cursor waits under it. */
export interface MeetingPlacement {
  start: { line: number; character: number };
  end: { line: number; character: number };
  text: string;
  /** The zero-based line under the heading, after a blank line, where its notes begin. */
  cursorLine: number;
}

/**
 * A meeting's heading at the end of its note, after a blank line, with a
 * blank line under it and an empty line for its notes: the note's
 * meetings run oldest first, below what describes its subject. Replaces
 * the blank lines the note ends with.
 */
export function placeMeeting(content: string, heading: string): MeetingPlacement {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const end = { line: lines.length - 1, character: lines[lines.length - 1].length };
  let last = lines.length - 1;
  while (last >= 0 && lines[last].trim() === '') {
    last -= 1;
  }
  const block = `${'#'.repeat(MEETING_HEADING_LEVEL)} ${heading}${eol}${eol}`;
  if (last < 0) {
    return { start: { line: 0, character: 0 }, end, text: block, cursorLine: 2 };
  }
  return {
    start: { line: last, character: lines[last].length },
    end,
    text: `${eol}${eol}${block}`,
    cursorLine: last + 4,
  };
}

/**
 * The line today's note keeps for a meeting written elsewhere: its time
 * and a link to its heading, `- 10:00 [[Borealis#2026-11-16 10:00 Vendor
 * sync]]`, in the link style of today's note.
 */
export function formatMeetingLink({
  heading,
  time,
  todayPath,
  homePath,
  style,
}: {
  /** The heading as written, tags and all. */
  heading: string;
  time: string;
  todayPath: string;
  homePath: string;
  style: NoteLinkStyle;
}): string {
  return `- ${time} ${formatSectionLink({ heading, sourcePath: todayPath, targetPath: homePath, style })}`;
}
