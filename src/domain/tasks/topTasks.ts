import { createNoteTitleMap, findLinkedBlock, noteTitle, parseWikiTarget, resolveWikiTarget } from '../index/backlinks';
import { addDays, formatIsoDate, startOfDay } from '../markdown/calendar';
import { findFrontmatterEnd } from '../markdown/frontmatter';
import { findFencedLines, readHeading } from '../markdown/lineShapes';
import { stripTags } from '../markdown/parser';
import { BLOCK_ID_PATTERN } from '../markdown/taskFields';
import { findNoteLinkSpans, formatNoteLink, type NoteLinkStyle } from '../markdown/wikiLinks';
import type { ParsedFile, Task, WorkspaceIndex } from '../model';
import { isCarriedOver } from '../notes/carriedHeadings';
import { type DailyNoteEntry, listDailyNotes } from '../notes/periodicNotes';

/**
 * A day's top tasks (docs/implementation/50-top-three.md).
 *
 * The few tasks chosen in the morning to do first, three unless
 * `deckard.tasks.topCount` says otherwise, are written in the day's note
 * under a heading, `## Top three`, each a link to its task's line by the
 * `^marker` at the line's end, and read back from there: nothing is kept
 * outside the notes, so the section can be written by hand and a week's
 * notes say what mattered each day.
 *
 * Here are the name the number gives, which headings are the section, how
 * a section is read into tasks, how a task's line gets a marker, and the
 * edit a new set of picks makes to the day's note. Pure, so the rules can
 * be read and tested apart from the editor.
 */

/** How many tasks a day's picks hold when the setting says nothing. */
export const DEFAULT_TOP_COUNT = 3;

/** The most a day's picks can hold. */
export const MAX_TOP_COUNT = 9;

/** How many days back a section in a daily note counts as using the practice. */
export const TOP_OFFER_DAYS = 14;

/** The numbers a heading or a label writes as a word, by their value. */
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'] as const;

/** The part of a settings section the reader here needs. */
interface SettingsReader {
  get<T>(key: string, defaultValue: T): T;
}

/**
 * How many tasks a day's picks hold, from `deckard.tasks.topCount`: a whole
 * number from 0, which turns the feature off, to {@link MAX_TOP_COUNT};
 * {@link DEFAULT_TOP_COUNT} for a value that is not a number.
 */
export function readTopCount(settings: SettingsReader): number {
  const value = settings.get<unknown>('tasks.topCount', DEFAULT_TOP_COUNT);
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_TOP_COUNT, Math.max(0, Math.round(value)))
    : DEFAULT_TOP_COUNT;
}

/** A count as a word, `three`, as the names here write it. */
export function topCountWord(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}

/** What a day's picks are called: **Top three**, **Top five**, and **Top task** for one. */
export function topTasksName(count: number): string {
  return count === 1 ? 'Top task' : `Top ${topCountWord(count)}`;
}

/** What picking is called where it is offered: **Pick today's three**, or **Pick today's top task** for one. */
export function topOfferLabel(count: number): string {
  return count === 1 ? "Pick today's top task" : `Pick today's ${topCountWord(count)}`;
}

/** The limit said in words, as the picker refuses one more: `Three is the limit.` */
export function topLimitSentence(count: number): string {
  const word = topCountWord(count);
  return `${word.charAt(0).toUpperCase()}${word.slice(1)} is the limit.`;
}

/** A heading that is a day's section: `Top` and a number, as a word or in digits, or `Top task`. */
const TOP_HEADING = new RegExp(String.raw`^top\s+(?:tasks?|\d+|${NUMBER_WORDS.join('|')})$`, 'i');

/**
 * Whether a heading's words name a day's top tasks: `Top three`, `Top 5`,
 * or `Top task`, in any case, tags aside.
 */
export function isTopHeading(heading: string): boolean {
  return TOP_HEADING.test(stripTags(heading).replace(/\s+/g, ' ').trim());
}

/** One list item of a section: a pick as it is written. */
export interface TopItem {
  /** The zero-based line its bullet is on. */
  line: number;
  /** The last zero-based line of the item, with the lines indented under it. */
  end: number;
  /** What follows the bullet, as written. */
  written: string;
  /** Whether it is a checkbox line, which is a pick itself, not a link to one. */
  checkbox: boolean;
}

/** A day's section as its note's text holds it. */
export interface TopSection {
  /** The zero-based line of its heading. */
  headingLine: number;
  level: number;
  /** The heading's words, as written. */
  heading: string;
  /** The zero-based line after its own lines: the next heading's, or the note's length. */
  bodyEnd: number;
  items: TopItem[];
}

/** A list item's bullet, at the left edge, with what follows it as group 1. */
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d+[.)])[ \t]+(\S.*)$/;

/** A checkbox at the start of a list item's words, with the words after it as group 1. */
const CHECKBOX = /^\[.\][ \t]+(.*)$/u;

/** The headings of a note's lines outside front matter and code, in order. */
function readHeadings(lines: readonly string[]): { line: number; level: number; text: string }[] {
  const frontmatterEnd = findFrontmatterEnd(lines) ?? -1;
  const fenced = findFencedLines(lines);
  return lines.flatMap((text, line) => {
    const heading = line > frontmatterEnd && !fenced.has(line) ? readHeading(text) : undefined;
    return heading ? [{ line, ...heading }] : [];
  });
}

/**
 * A note's section for its day's top tasks: the first heading that reads
 * as one ({@link isTopHeading}), other than the note's title and any under
 * Carried over, where a rollover writes yesterday's heading again above a
 * task it carried from under it. Its items are the list items of its own
 * lines, before the next heading of any level.
 */
export function findTopSection(lines: readonly string[]): TopSection | undefined {
  const headings = readHeadings(lines);
  let carriedLevel: number | undefined;
  for (const [at, heading] of headings.entries()) {
    if (carriedLevel !== undefined && heading.level <= carriedLevel) {
      carriedLevel = undefined;
    }
    if (isCarriedOver(stripTags(heading.text).trim())) {
      carriedLevel = heading.level;
    }
    const title = at === 0 && heading.level === 1;
    if (carriedLevel === undefined && !title && isTopHeading(heading.text)) {
      const bodyEnd = headings[at + 1]?.line ?? lines.length;
      return {
        headingLine: heading.line,
        level: heading.level,
        heading: heading.text,
        bodyEnd,
        items: readItems(lines, heading.line + 1, bodyEnd),
      };
    }
  }
  return undefined;
}

/** The list items of the lines from `start` up to `end`, each with the lines indented under it. */
function readItems(lines: readonly string[], start: number, end: number): TopItem[] {
  const fenced = findFencedLines(lines);
  const items: TopItem[] = [];
  for (let line = start; line < end; line += 1) {
    const match = fenced.has(line) ? null : LIST_ITEM.exec(lines[line]);
    if (!match) {
      continue;
    }
    let last = line;
    while (last + 1 < end && /^[ \t]+\S/.test(lines[last + 1])) {
      last += 1;
    }
    items.push({ line, end: last, written: match[1].trim(), checkbox: CHECKBOX.test(match[1]) });
    line = last;
  }
  return items;
}

/** One pick of a day, as its note writes it and as the index resolves it. */
export interface TopPick {
  /** The item as written, without its bullet. */
  written: string;
  /** What it shows: its link's words, or its task's. */
  words: string;
  /** The task it names; absent for a link that leads to no task, and for a line that is not one. */
  task?: Task;
  /** Set when the item is itself a task's line, written under the heading, and not a link to one. */
  ownLine?: true;
}

/** A day's picks, read from its note. */
export interface DayTop {
  /** The day, `YYYY-MM-DD`. */
  date: string;
  filePath: string;
  /** The section's heading, as written. */
  heading: string;
  /** The zero-based line of the heading. */
  headingLine: number;
  /** Every item of the section, in order, those past the limit too. */
  picks: TopPick[];
}

/** The picks of a day that name a task, in order. */
export function topTasksOf(top: DayTop | undefined): Task[] {
  return (top?.picks ?? []).flatMap((pick) => pick.task ?? []);
}

/** What a list item shows: a link's words, a checkbox line's words, or the item itself. */
function readWords(written: string): string {
  const checkbox = CHECKBOX.exec(written);
  if (checkbox) {
    return checkbox[1].replace(BLOCK_ID_PATTERN, '').trim();
  }
  const wiki = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(written);
  if (wiki) {
    return (wiki[2] ?? wiki[1]).trim();
  }
  return /(?<!!)\[((?:[^\]\\\n]|\\.)*)\]\(/.exec(written)?.[1].trim() || written;
}

/** The task on a one-based line of a note, as the index holds it. */
function taskOnLine(index: WorkspaceIndex, tasks: readonly Task[], line: number): Task | undefined {
  const found = tasks.find((task) => task.lineNumber === line);
  return found ? (index.tasks.get(found.id) ?? found) : undefined;
}

/** The task a list item's first link leads to: the one on the line its `#^marker` names. */
function resolveLinkedTask(index: WorkspaceIndex, written: string, sourcePath: string): Task | undefined {
  const span = findNoteLinkSpans(written, sourcePath)[0];
  const target = span ? parseWikiTarget(span.target) : undefined;
  if (!target?.block) {
    return undefined;
  }
  const filePath = resolveWikiTarget(createNoteTitleMap(index), target.note, sourcePath);
  const file = filePath ? index.files.get(filePath) : undefined;
  const line = file ? findLinkedBlock(file, target.block) : undefined;
  return file && line !== undefined ? taskOnLine(index, file.tasks, line) : undefined;
}

/**
 * The top tasks a note's text holds for `date`, each item resolved against
 * the index: a checkbox line is the task on that line, and any other item
 * the task its link leads to. `note` is the note as it is read now, which
 * an editor's lenses parse from unsaved text. Undefined when the note has
 * no section.
 */
export function readTopOf(
  index: WorkspaceIndex,
  note: Pick<ParsedFile, 'filePath' | 'content' | 'tasks'>,
  date: string,
): DayTop | undefined {
  const section = findTopSection(note.content.split(/\r?\n/));
  if (!section) {
    return undefined;
  }
  return {
    date,
    filePath: note.filePath,
    heading: section.heading,
    headingLine: section.headingLine,
    picks: section.items.map((item) => {
      const task = item.checkbox
        ? taskOnLine(index, note.tasks, item.line + 1)
        : resolveLinkedTask(index, item.written, note.filePath);
      return {
        written: item.written,
        words: task && item.checkbox ? task.title : readWords(item.written),
        ...(task ? { task } : {}),
        ...(task && item.checkbox ? { ownLine: true as const } : {}),
      };
    }),
  };
}

/** What is read of one index once: its daily notes, and each one's picks as they are asked for. */
interface TopState {
  /** Each day's own note: the first `listDailyNotes` lists for it. */
  notes: DailyNoteEntry[];
  tops: Map<string, DayTop | undefined>;
  ids: Map<string, ReadonlySet<string>>;
}

/** Each index's daily notes and their picks, read the first time they are asked for. */
const topStates = new WeakMap<WorkspaceIndex, TopState>();

/** The daily notes and picks of an index, kept with it. */
function getTopState(index: WorkspaceIndex): TopState {
  const cached = topStates.get(index);
  if (cached) {
    return cached;
  }
  const seen = new Set<string>();
  const notes = listDailyNotes(index).filter((note) => !seen.has(note.date) && Boolean(seen.add(note.date)));
  const state: TopState = { notes, tops: new Map(), ids: new Map() };
  topStates.set(index, state);
  return state;
}

/** A daily note's picks, read once for its index. */
function readNoteTop(index: WorkspaceIndex, state: TopState, note: DailyNoteEntry): DayTop | undefined {
  if (!state.tops.has(note.date)) {
    const file = index.files.get(note.filePath);
    state.tops.set(note.date, file ? readTopOf(index, file, note.date) : undefined);
  }
  return state.tops.get(note.date);
}

/** The picks written in the daily note for `date`, `YYYY-MM-DD`; undefined with no note or no section. */
export function readDayTop(index: WorkspaceIndex, date: string): DayTop | undefined {
  const state = getTopState(index);
  const note = state.notes.find((entry) => entry.date === date);
  return note ? readNoteTop(index, state, note) : undefined;
}

/** The path of the daily note for `date`, `YYYY-MM-DD`, when the index has one. */
export function findDayNotePath(index: WorkspaceIndex, date: string): string | undefined {
  return getTopState(index).notes.find((entry) => entry.date === date)?.filePath;
}

/** Today's picks, on the day `now` falls in. */
export function readTodayTop(index: WorkspaceIndex, now: number): DayTop | undefined {
  return readDayTop(index, formatIsoDate(now));
}

/** The ids of the tasks picked for today, which `is:top` and a card's details ask of each task. */
export function getTopTaskIds(index: WorkspaceIndex, now: number): ReadonlySet<string> {
  const state = getTopState(index);
  const date = formatIsoDate(now);
  let ids = state.ids.get(date);
  if (!ids) {
    ids = new Set(topTasksOf(readDayTop(index, date)).map((task) => task.id));
    state.ids.set(date, ids);
  }
  return ids;
}

/** The picks of the latest daily note before `date` that has a section. */
export function findEarlierTop(index: WorkspaceIndex, date: string): DayTop | undefined {
  const state = getTopState(index);
  for (const note of [...state.notes].reverse()) {
    const top = note.date < date ? readNoteTop(index, state, note) : undefined;
    if (top) {
      return top;
    }
  }
  return undefined;
}

/**
 * Whether the practice is in use: a daily note of the last
 * {@link TOP_OFFER_DAYS} days, today's included, has a section. Until it
 * is, nothing offers picking where no one asked.
 */
export function usesTopTasks(index: WorkspaceIndex, now: number): boolean {
  const today = formatIsoDate(now);
  const since = formatIsoDate(addDays(startOfDay(now), -TOP_OFFER_DAYS));
  const state = getTopState(index);
  return state.notes.some((note) => note.date > since && note.date <= today && readNoteTop(index, state, note) !== undefined);
}

/** One day of a period that has a daily note, with its picks when it has a section. */
export interface TopDay {
  date: string;
  top?: DayTop;
}

/** The days from `start` up to `end`, as timestamps, that have a daily note, oldest first. */
export function listTopDays(index: WorkspaceIndex, start: number, end: number): TopDay[] {
  const from = formatIsoDate(start);
  const to = formatIsoDate(end);
  const state = getTopState(index);
  return state.notes
    .filter((note) => note.date >= from && note.date < to)
    .map((note) => {
      const top = readNoteTop(index, state, note);
      return { date: note.date, ...(top ? { top } : {}) };
    });
}

/** The `^marker` a line ends with, without its caret. */
export function readMarker(line: string): string | undefined {
  return BLOCK_ID_PATTERN.exec(line)?.[1];
}

/**
 * A marker for a task's line: up to three of its title's words, lowercased
 * and joined with `-`, the letters and digits a marker can hold only, then
 * `-2`, `-3` until no line of its note has it. `task` for a title with
 * none of those.
 */
export function makeMarker(title: string, taken: ReadonlySet<string>): string {
  const words = stripTags(title)
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .slice(0, 3);
  const base = words.join('-') || 'task';
  let marker = base;
  for (let count = 2; taken.has(marker); count += 1) {
    marker = `${base}-${count}`;
  }
  return marker;
}

/** A line with a marker at its very end, where one is read. */
export function addMarker(line: string, marker: string): string {
  return `${line.replace(/[ \t]+$/, '')} ^${marker}`;
}

/** A task's words as a pick's link shows them: its title, tags and the characters a link's words cannot hold aside. */
function linkWords(title: string): string {
  const words = (stripTags(title).trim() || title).replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim();
  return words || 'Task';
}

/**
 * A pick's link, written in today's note: `[[Borealis#^vendor-quote|Send
 * the vendor quote]]`, or in the Markdown style `[Send the vendor
 * quote](Borealis.md#^vendor-quote)`.
 */
export function formatTopLink({
  title,
  marker,
  todayPath,
  targetPath,
  style,
}: {
  title: string;
  marker: string;
  todayPath: string;
  targetPath: string;
  style: NoteLinkStyle;
}): string {
  const words = linkWords(title);
  if (style === 'wiki') {
    return `[[${noteTitle(targetPath)}#^${marker}|${words}]]`;
  }
  return `${formatNoteLink(words, todayPath, targetPath, style).slice(0, -1)}#^${marker})`;
}

/** One pick as the picker hands it over: a task that exists, or the words of a new one. */
export type TopChoice = { task: Task } | { title: string };

/** A replacement of a run of a note's text, by zero-based lines and characters. */
export interface TopEdit {
  start: { line: number; character: number };
  end: { line: number; character: number };
  text: string;
}

/** What a new set of picks writes. */
export interface TopPlan {
  /** The change to today's note; absent when its section already reads so. */
  today?: TopEdit;
  /**
   * The tasks of other notes whose lines get a marker, each with the one
   * made for it and its line as it then reads. A marker for a line of
   * today's note is part of `today`.
   */
  markers: { task: Task; marker: string; line: string }[];
}

/** What a plan is made from. */
export interface TopPlanRequest {
  index: WorkspaceIndex;
  /** Today's note as it is now. */
  content: string;
  todayPath: string;
  /** The link style of today's note. */
  style: NoteLinkStyle;
  /** `deckard.tasks.topCount`, which names a section written new. */
  count: number;
  /** The picks, in the order they were checked. */
  choices: readonly TopChoice[];
}

/**
 * The edits a new set of picks makes: today's section rewritten, its
 * heading written first when the note has none, and a marker for each
 * picked task whose line has none.
 *
 * A pick that is already a task line under the heading keeps its line as
 * it is; every other task is a link to its line, and a new task is written
 * as one. Only the section's list items change: other lines under the
 * heading stay, after the items. With no picks the heading stays and its
 * items go; a note with no heading and no picks is left as it is. Each
 * picked task's line is taken to read as the index read it.
 */
export function planTopTasks({ index, content, todayPath, style, count, choices }: TopPlanRequest): TopPlan {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const section = findTopSection(lines);
  const markers: TopPlan['markers'] = [];
  const base = [...lines];
  const taken = new Map<string, Set<string>>();
  const items = choices.flatMap((choice): string[] => {
    if (!('task' in choice)) {
      return [`- [ ] ${choice.title.replace(/\s+/g, ' ').trim()}`];
    }
    const { task } = choice;
    const own = task.filePath === todayPath ? section?.items.find((item) => item.checkbox && item.line === task.lineNumber - 1) : undefined;
    if (own) {
      return lines.slice(own.line, own.end + 1);
    }
    const marker = readMarker(task.sourceLineText) ?? newMarker(index, task, taken);
    if (!readMarker(task.sourceLineText)) {
      const line = addMarker(task.sourceLineText, marker);
      if (task.filePath === todayPath) {
        base[task.lineNumber - 1] = line;
      } else {
        markers.push({ task, marker, line });
      }
    }
    return [`- ${formatTopLink({ title: task.title, marker, todayPath, targetPath: task.filePath, style })}`];
  });
  if (!section && items.length === 0) {
    return { markers };
  }
  const written = section ? rewriteSection(base, section, items) : insertSection(base, topTasksName(count), items);
  const today = diffLines(lines, written, eol);
  return { ...(today ? { today } : {}), markers };
}

/** A marker no line of the task's note has, nor any pick of this set in that note. */
function newMarker(index: WorkspaceIndex, task: Task, taken: Map<string, Set<string>>): string {
  const inNote = taken.get(task.filePath) ?? new Set(Object.keys(index.files.get(task.filePath)?.blockIds ?? {}));
  taken.set(task.filePath, inNote);
  const marker = makeMarker(task.title, inNote);
  inNote.add(marker);
  return marker;
}

/** Lines without the blank ones they start and end with. */
function trimBlank(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') {
    start += 1;
  }
  while (end > start && lines[end - 1].trim() === '') {
    end -= 1;
  }
  return lines.slice(start, end);
}

/**
 * The note's lines with the section's items replaced by `items`: what was
 * written under the heading before its first item, the items, then every
 * other line of the section, each after one blank line.
 */
function rewriteSection(lines: readonly string[], section: TopSection, items: readonly string[]): string[] {
  const bodyStart = section.headingLine + 1;
  const first = section.items[0]?.line ?? bodyStart;
  const inItem = new Set(section.items.flatMap((item) => Array.from({ length: item.end - item.line + 1 }, (_, at) => item.line + at)));
  const before = trimBlank(lines.slice(bodyStart, first));
  const rest = trimBlank(lines.slice(first, section.bodyEnd).filter((_, at) => !inItem.has(first + at)));
  const closes = section.bodyEnd < lines.length || lines[lines.length - 1] === '';
  return [
    ...lines.slice(0, bodyStart),
    ...[before, items, rest].filter((chunk) => chunk.length > 0).flatMap((chunk) => ['', ...chunk]),
    ...(closes ? [''] : []),
    ...lines.slice(section.bodyEnd),
  ];
}

/**
 * The note's lines with a new section: one level below the title, after
 * the title's own lines and above every other section. In a note whose
 * first heading is no title, above that heading and at its level; in one
 * with no heading, at its end.
 */
function insertSection(lines: readonly string[], name: string, items: readonly string[]): string[] {
  const headings = readHeadings(lines);
  const titled = headings[0]?.level === 1;
  const next = titled ? headings[1] : headings[0];
  const at = next?.line ?? lines.length;
  const level = titled ? 2 : (headings[0]?.level ?? 2);
  const above = lines.slice(0, at);
  while (above.length > 0 && above[above.length - 1].trim() === '') {
    above.pop();
  }
  return [
    ...above,
    ...(above.length > 0 ? [''] : []),
    `${'#'.repeat(level)} ${name}`,
    '',
    ...items,
    '',
    ...lines.slice(at),
  ];
}

/**
 * The one replacement that turns `before` into `after`: the lines that
 * differ, with a line they share kept beside them when either run is
 * empty, so the edit never starts or ends past the note. Undefined when
 * the two are the same.
 */
function diffLines(before: readonly string[], after: readonly string[], eol: string): TopEdit | undefined {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) {
    head += 1;
  }
  if (head === before.length && head === after.length) {
    return undefined;
  }
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) {
    tail += 1;
  }
  if (before.length - tail === head || after.length - tail === head) {
    if (head > 0) {
      head -= 1;
    } else {
      tail -= 1;
    }
  }
  const last = before.length - tail - 1;
  return {
    start: { line: head, character: 0 },
    end: { line: last, character: before[last].length },
    text: after.slice(head, after.length - tail).join(eol),
  };
}
