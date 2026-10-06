/**
 * Tasks as a calendar file (iCalendar, RFC 5545) that Apple Calendar,
 * Outlook, Google Calendar, or any other calendar app can subscribe to or
 * import: each dated task an all-day event on its due date, or on the day
 * it is scheduled for when it has no due date.
 *
 * Nothing here reads a clock: an event's stamp is when its task was last
 * written, so the same tasks always make the same file, and a file written
 * again for an unchanged workspace is the same bytes.
 */
import { formatIsoDate } from '../markdown/calendar';

/** A task as its event needs it. */
export interface CalendarTask {
  title: string;
  filePath: string;
  /** One-based line. */
  lineNumber: number;
  dueAt?: number;
  scheduledAt?: number;
  completed: boolean;
  /** Cancelled: closed without being done, which a calendar draws as a cancelled event. */
  cancelled?: boolean;
  /** When the task's note was last written; the event's stamp. */
  updatedAt?: number;
  /** A link that opens the task's line, put in the event's notes. */
  url?: string;
}

/** The longest a content line may be, in octets, before it is folded. */
const LINE_LIMIT = 75;

/** The product the file says made it. */
const PRODUCT_ID = '-//Esper Innovations//Deckard Notes//EN';

/**
 * The calendar for `tasks`: an event for each with a due or scheduled
 * date, in the order given, named `name` in apps that show a calendar's
 * name. Lines end in CRLF and are folded at 75 octets, as the format asks.
 */
export function buildTaskCalendar(tasks: readonly CalendarTask[], name: string): string {
  const seen = new Map<string, number>();
  const events = tasks.flatMap((task) => {
    const day = task.dueAt ?? task.scheduledAt;
    if (day === undefined) {
      return [];
    }
    const base = `${task.filePath}#${normalizeTitle(task.title)}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return [buildEvent(task, day, count === 1 ? base : `${base}#${count}`)];
  });
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODUCT_ID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    ...events.flat(),
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/**
 * One task's event, all day on `day`. Its UID is the note and the task's
 * words, not its line or its date, so moving a task's date or a line above
 * it moves the event rather than making a new one.
 */
function buildEvent(task: CalendarTask, day: number, key: string): string[] {
  const start = formatIsoDate(day).replace(/-/g, '');
  const end = formatIsoDate(nextDay(day)).replace(/-/g, '');
  const kind = task.dueAt === undefined ? 'Scheduled' : 'Due';
  const notes = [`${kind} in ${task.filePath}, line ${task.lineNumber}.`, ...(task.url ? [task.url] : [])].join('\n');
  return [
    'BEGIN:VEVENT',
    `UID:${uidOf(key)}@deckard`,
    `DTSTAMP:${formatStamp(task.updatedAt ?? 0)}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${escapeText(task.completed ? `✓ ${task.title}` : task.title)}`,
    `DESCRIPTION:${escapeText(notes)}`,
    // An event is tentative, confirmed, or cancelled; it has no done, which
    // the summary's ✓ says.
    ...(task.cancelled ? ['STATUS:CANCELLED'] : []),
    ...(task.url ? [`URL:${task.url}`] : []),
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
  ];
}

/** The day after `day`, by the calendar rather than by 24 hours, so a clock change cannot skip one. */
function nextDay(day: number): number {
  const date = new Date(day);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

/** A task's words, its case and spacing aside, for its event's UID. */
function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * A short, stable id for a key: FNV-1a over its UTF-16 units, twice with
 * different seeds, as hex. Not secret, only steady and short.
 */
function uidOf(key: string): string {
  const hash = (seed: number): string => {
    let value = seed;
    for (let index = 0; index < key.length; index += 1) {
      value ^= key.charCodeAt(index);
      value = Math.imul(value, 0x01000193) >>> 0;
    }
    return value.toString(16).padStart(8, '0');
  };
  return `${hash(0x811c9dc5)}${hash(0x01000193)}`;
}

/** A moment as the format's UTC stamp, `20261003T090000Z`. */
function formatStamp(moment: number): string {
  return new Date(moment).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Text as a property value writes it: backslashes, semicolons, commas, and line breaks escaped. */
export function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * A content line folded at 75 octets: each further piece on a line of its
 * own that starts with a space. A character is never split, however many
 * octets it takes.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= LINE_LIMIT) {
    return line;
  }
  const pieces: string[] = [];
  let piece = '';
  let octets = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    // A continuation line's leading space counts toward its 75.
    const limit = pieces.length === 0 ? LINE_LIMIT : LINE_LIMIT - 1;
    if (octets + size > limit) {
      pieces.push(piece);
      piece = '';
      octets = 0;
    }
    piece += character;
    octets += size;
  }
  pieces.push(piece);
  return pieces.join('\r\n ');
}
