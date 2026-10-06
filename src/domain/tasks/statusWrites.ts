/**
 * Writing a task's status: the one edit every way of changing a status goes
 * through, from a checkbox to the board, the task editor, bulk edit, and an
 * assistant. A status is written as its character, as its `#status/…` tag,
 * or as both a character and its closing date, as the status and
 * `deckard.tasks.writeStatusAs` say.
 */
import { escapeRegExp } from '../../shared/text';
import { findCodeAndLinkRanges, isInRanges } from '../markdown/inlineRanges';
import { TAG_WORD_CHARACTERS } from '../markdown/parser';
import { TaskMetadataFormat } from '../markdown/taskFields';
import { appendToTaskText, setTaskLineMark } from '../markdown/taskLineEdits';
import type { TaskStatus, TaskStatusType } from '../model';
import { statusForSymbol, statusForTag, type TaskStatusDefinition } from './taskStatuses';

/**
 * How a status with both a character and a tag is written
 * (`deckard.tasks.writeStatusAs`): `match` the way its line already writes
 * one, as a tag when it has a status tag and as the character when it
 * doesn't; `checkbox` always the character, taking a status tag away;
 * `tag` always the tag, in an empty box.
 */
export type StatusWriteMode = 'match' | 'checkbox' | 'tag';

/** The status writing modes, in the order Settings offers them. */
export const STATUS_WRITE_MODES: readonly StatusWriteMode[] = ['match', 'checkbox', 'tag'];

/** `deckard.tasks.writeStatusAs`, read: `match` for anything it does not name. */
export function readStatusWriteMode(value: unknown): StatusWriteMode {
  return STATUS_WRITE_MODES.find((mode) => mode === value) ?? 'match';
}

/** A status change, and how it is written. */
export interface StatusWrite {
  /** The status to write. */
  to: TaskStatusDefinition;
  /** The namespace of status tags, `status` for `#status/doing`. */
  namespace: string;
  writeAs: StatusWriteMode;
  /** The done date a change to a done status adds, when the line has none. */
  doneDate?: string;
  /** The cancelled date a change to a cancelled status adds, when the line has none. */
  cancelledDate?: string;
  /** The format of a new date on a line with no metadata yet. */
  preferredFormat?: TaskMetadataFormat;
}

/** A status tag in `namespace`, with the spaces or tabs before it. */
function statusTagPattern(namespace: string): RegExp {
  return new RegExp(
    `[ \\t]+#${escapeRegExp(namespace)}/[\\p{L}\\p{N}][${TAG_WORD_CHARACTERS}-]*(?![${TAG_WORD_CHARACTERS}/-])`,
    'giu',
  );
}

/** The status tag written on a task line after its box, outside code and links, as written after the namespace. */
export function readWrittenStatusTag(line: string, checkboxColumn: number, namespace: string): string | undefined {
  const text = line.slice(checkboxColumn + 2);
  const skipped = findCodeAndLinkRanges(text);
  for (const match of text.matchAll(statusTagPattern(namespace))) {
    if (!isInRanges(skipped, match.index ?? 0)) {
      return match[0].trim().slice(namespace.length + 2).toLowerCase();
    }
  }
  return undefined;
}

/**
 * Sets or clears a task's status tag. An existing status tag is changed where
 * it is written, and any others are removed; a new one goes at the end.
 */
export function setTaskStatusTag(
  line: string,
  checkboxColumn: number,
  namespace: string,
  status: string | undefined,
): string {
  const head = line.slice(0, checkboxColumn + 2);
  const text = line.slice(checkboxColumn + 2);
  const tag = `#${namespace}/${status ?? ''}`;
  let written = false;
  const skipped = findCodeAndLinkRanges(text);
  const next = text.replace(statusTagPattern(namespace), (match, offset: number) => {
    if (isInRanges(skipped, offset)) {
      return match;
    }
    if (!status || written) {
      return '';
    }
    written = true;
    return match.replace(/#.*$/, tag);
  });
  return head + (status && !written ? appendToTaskText(next, tag) : next);
}

/** The character a closing status is written with when it names none: Deckard's own for its type. */
function closingSymbol(type: TaskStatusType): string {
  return type === 'done' ? 'x' : '-';
}

/**
 * Writes a status on a task line. A done or cancelled status is always its
 * character, with its ✅ or ❌ date, and leaves any status tag where it is,
 * as completing a task always has. An open status with no character, such
 * as Waiting, is its tag in an empty box. Any other open status is its
 * character or its tag, as `writeAs` says; writing the character takes a
 * status tag away, so the line says its status once.
 */
export function setTaskStatus(line: string, checkboxColumn: number, write: StatusWrite): string {
  const { to, namespace } = write;
  const closed = to.type === 'done' || to.type === 'cancelled' ? to.type : undefined;
  const mark = (symbol: string): string =>
    setTaskLineMark(line, checkboxColumn, {
      symbol,
      closed,
      ...(closed === 'done' && write.doneDate ? { closedDate: write.doneDate } : {}),
      ...(closed === 'cancelled' && write.cancelledDate ? { closedDate: write.cancelledDate } : {}),
      ...(write.preferredFormat ? { preferredFormat: write.preferredFormat } : {}),
    });
  if (closed) {
    return mark(to.symbol ?? closingSymbol(closed));
  }
  const asTag =
    to.tag !== undefined &&
    (to.symbol === undefined ||
      write.writeAs === 'tag' ||
      (write.writeAs === 'match' && readWrittenStatusTag(line, checkboxColumn, namespace) !== undefined));
  if (asTag) {
    return setTaskStatusTag(mark(' '), checkboxColumn, namespace, to.tag);
  }
  return setTaskStatusTag(mark(to.symbol ?? ' '), checkboxColumn, namespace, undefined);
}

/**
 * The status a line says it has: its box's, or, in an empty box, the open
 * status its status tag stands for, read from the line as it is written.
 */
export function readLineStatus(
  line: string,
  checkboxColumn: number,
  statuses: readonly TaskStatusDefinition[],
  namespace: string,
): TaskStatus {
  const status = statusForSymbol(statuses, line[checkboxColumn] ?? ' ');
  if (status.symbol !== ' ') {
    return status;
  }
  const tag = readWrittenStatusTag(line, checkboxColumn, namespace);
  const tagged = tag === undefined ? undefined : statusForTag(statuses, tag);
  return tagged ? { symbol: ' ', name: tagged.name, type: tagged.type } : status;
}

/**
 * The status a click in the workflow moves a task to: its status's `next`
 * character, when there is a status that has it; undefined when its status
 * names none, or one no status has.
 */
export function nextStatus(
  current: TaskStatus,
  statuses: readonly TaskStatusDefinition[],
): TaskStatusDefinition | undefined {
  const definition = statuses.find(
    (status) =>
      status.name === current.name &&
      status.type === current.type &&
      (status.symbol === current.symbol || current.symbol === ' '),
  );
  const next = definition?.next;
  return next === undefined ? undefined : statuses.find((status) => status.symbol === next);
}

/** The first status of the list of a type, the status an open task is reopened as when it has to be one. */
export function firstStatusOf(statuses: readonly TaskStatusDefinition[], type: TaskStatusType): TaskStatusDefinition | undefined {
  return statuses.find((status) => status.type === type && status.symbol !== undefined);
}
