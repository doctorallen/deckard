/**
 * The sidebar Calendar's narrowing table: what each message it may send
 * must hold. Dates and months are checked for their shape; the host checks
 * that each names a real day, and finds each note and task itself.
 */
import type { ToggleTaskMessage } from '../../../protocol/shared';
import type {
  CalendarMoveTaskMessage,
  CalendarOpenNoteMessage,
  CalendarOpenTaskMessage,
  CalendarPageToHost,
  CalendarShowMonthMessage,
} from '../../../protocol/calendar';
import { isRequestId, Narrower, NarrowingTable, narrowOpenTag, narrowWith, onlyType, UncheckedMessage } from '../../host/narrowing';

/** The longest note path the day panel may ask to open. */
const MAX_FILE_PATH_LENGTH = 4096;

/** The message's `date`, when it is a string, or the empty string. */
function readDate(value: UncheckedMessage): string {
  return typeof value.date === 'string' ? value.date : '';
}

/** Whether a date has the shape YYYY-MM-DD; whether it is a real day is the host's to check. */
function isDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

/**
 * A message that carries a date, and anything else besides, rebuilt with
 * only its date.
 */
function dated<T extends 'openDay' | 'openWeek'>(type: T): Narrower<{ type: T; date: string }> {
  return (value) => {
    const date = readDate(value);
    return isDate(date) ? { type, date } : undefined;
  };
}

/** A message that carries a date and nothing else. */
function exactlyDated<T extends 'selectDay' | 'createDay' | 'searchCreated'>(
  type: T,
): Narrower<{ type: T; date: string }> {
  return (value) => {
    const date = readDate(value);
    return isDate(date) && Object.keys(value).length === 2 ? { type, date } : undefined;
  };
}

/**
 * A step to another month, YYYY-MM, with the day chosen in it when the
 * step sends one, which must then be a date.
 */
const narrowShowMonth: Narrower<CalendarShowMonthMessage> = (value) => {
  const date = readDate(value);
  return typeof value.month === 'string' &&
    /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value.month) &&
    (value.date === undefined || isDate(date))
    ? { type: 'showMonth', month: value.month, ...(isDate(date) ? { date } : {}) }
    : undefined;
};

/** A note the day panel lists: a path, not too long, Shift when it was held, and nothing else. */
const narrowOpenNote: Narrower<CalendarOpenNoteMessage> = (value) =>
  typeof value.filePath === 'string' &&
  value.filePath.length > 0 &&
  value.filePath.length <= MAX_FILE_PATH_LENGTH &&
  (value.opposite === undefined || typeof value.opposite === 'boolean') &&
  Object.keys(value).length === (value.opposite === undefined ? 2 : 3)
    ? { type: 'openNote', filePath: value.filePath, ...(value.opposite === true ? { opposite: true } : {}) }
    : undefined;

/** A task to open, by its id and nothing else. */
const narrowOpenTask: Narrower<CalendarOpenTaskMessage> = (value) =>
  typeof value.taskId === 'string' && value.taskId.length > 0 && Object.keys(value).length === 2
    ? { type: 'openTask', taskId: value.taskId }
    : undefined;

/**
 * A task's box, by its id and nothing else. Stricter than the shared
 * check, which lets an empty id and other fields through.
 */
const narrowToggleTask: Narrower<ToggleTaskMessage> = (value) =>
  typeof value.taskId === 'string' &&
  value.taskId.length > 0 &&
  typeof value.completed === 'boolean' &&
  Object.keys(value).length === 3
    ? { type: 'toggleTask', taskId: value.taskId, completed: value.completed }
    : undefined;

/**
 * A task dropped on a day: its id, which date moves, the day, the move's
 * number when it has one, and nothing else.
 */
const narrowMoveTask: Narrower<CalendarMoveTaskMessage> = (value) => {
  const date = readDate(value);
  const numbered = value.requestId !== undefined;
  return typeof value.taskId === 'string' &&
    value.taskId.length > 0 &&
    (value.field === 'due' || value.field === 'scheduled') &&
    isDate(date) &&
    (!numbered || isRequestId(value.requestId)) &&
    Object.keys(value).length === (numbered ? 5 : 4)
    ? {
        type: 'moveTask',
        taskId: value.taskId,
        field: value.field,
        date,
        ...(isRequestId(value.requestId) ? { requestId: value.requestId } : {}),
      }
    : undefined;
};

/** Each message the sidebar Calendar may send, and what it must hold. */
export const CALENDAR_MESSAGES: NarrowingTable<CalendarPageToHost> = {
  ready: onlyType('ready'),
  openMonth: onlyType('openMonth'),
  showMonth: narrowShowMonth,
  openDay: dated('openDay'),
  openWeek: dated('openWeek'),
  selectDay: exactlyDated('selectDay'),
  createDay: exactlyDated('createDay'),
  openNote: narrowOpenNote,
  searchCreated: exactlyDated('searchCreated'),
  openTask: narrowOpenTask,
  toggleTask: narrowToggleTask,
  moveTask: narrowMoveTask,
  openTag: narrowOpenTag,
};

/** A message from the sidebar Calendar, narrowed by its table, or undefined. */
export const narrowCalendarMessage = narrowWith(CALENDAR_MESSAGES);
