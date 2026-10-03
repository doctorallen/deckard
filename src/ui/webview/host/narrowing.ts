/**
 * Narrowing what a page posts before its host acts on it.
 *
 * A message from a page crosses a trust boundary as `unknown`: the page may
 * be stale, or running a script that was tampered with. Each page keeps one
 * table, in `pages/<page>/messages.ts`, with a function for each message it
 * may send. A function returns the message rebuilt from only the fields
 * its handler reads, or undefined to refuse it. The functions here are the
 * ones several pages' tables share; a check only one page makes stays in
 * that page's table, so pages moved in parallel never edit one file.
 */
import { isObject } from '../../../shared/guards';
import type { MessageAs, MessageOf, PageMessage } from '../../protocol/messaging';
import type {
  ExportResultsMessage,
  OpenSearchMessage,
  OpenSourceMessage,
  OpenTagMessage,
  ParkTagMessage,
  PinNoteMessage,
  RenameTagMessage,
  SetZenModeMessage,
  ToggleTaskMessage,
} from '../../protocol/shared';

/**
 * A posted message whose `type` has been read, and whose other fields have
 * not been checked yet.
 */
export type UncheckedMessage = Record<string, unknown> & { type: string };

/** One page message's check: the message rebuilt, or undefined to refuse it. */
export type Narrower<T> = (value: UncheckedMessage) => T | undefined;

/** A page's checks, one for each message type it may send. */
export type NarrowingTable<M> = { readonly [K in keyof M]: Narrower<M[K]> };

/**
 * The longest search text a page may send. The parser is linear in its
 * input, but a bound keeps a runaway page from handing the host an
 * unreasonable string to read on every keystroke.
 */
export const MAX_QUERY_LENGTH = 2000;

/**
 * Turns a page's table into its narrowing function: anything that is not
 * an object with a `type` the table names is refused, and the rest goes to
 * that type's check. Only the table's own types count, so a `type` such as
 * `constructor` names nothing.
 */
export function narrowWith<M>(
  table: NarrowingTable<M>,
): (value: unknown) => MessageOf<M> | undefined {
  return (value) => {
    if (!isObject(value) || typeof value.type !== 'string') {
      return undefined;
    }
    if (!Object.prototype.hasOwnProperty.call(table, value.type)) {
      return undefined;
    }
    const narrow = table[value.type as keyof M] as Narrower<MessageOf<M>>;
    return narrow(value as UncheckedMessage);
  };
}

/**
 * One type of a shared check that serves several, as a table lists it
 * under each, such as `parkTag: narrowAs('parkTag', narrowParkTag)`. The
 * table hands a check only messages of the type it is listed under, and a
 * shared check keeps the type it was handed, so the message comes back of
 * that type; one that somehow did not is refused.
 */
export function narrowAs<M extends PageMessage, T extends M['type']>(
  type: T,
  narrow: Narrower<M>,
): Narrower<MessageAs<M, T>> {
  return (value) => {
    const message = narrow(value);
    return message?.type === type ? (message as MessageAs<M, T>) : undefined;
  };
}

/** A message that carries nothing but its type, whatever else it holds. */
export function onlyType<T extends string>(type: T): Narrower<{ type: T }> {
  return () => ({ type });
}

/** A message that carries nothing but its type, and is refused with more. */
export function exactlyType<T extends string>(type: T): Narrower<{ type: T }> {
  return (value) => (Object.keys(value).length === 1 ? { type } : undefined);
}

/**
 * Whether a value is a request's id, as a page numbers its requests (see
 * `Correlated`): a whole number JavaScript holds exactly.
 */
export function isRequestId(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

/** Whether a value is an array of strings, as a reordering sends. */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * A line of a note to open: a path, and a whole line number from 1. The
 * modifiers, when sent, must be true or false.
 */
export function isSourceLocation(value: Record<string, unknown>): boolean {
  return (
    typeof value.filePath === 'string' &&
    typeof value.line === 'number' &&
    Number.isInteger(value.line) &&
    value.line > 0 &&
    (value.beside === undefined || typeof value.beside === 'boolean') &&
    (value.pin === undefined || typeof value.pin === 'boolean')
  );
}

/**
 * The gear's zen row: on or off.
 */
export const narrowSetZenMode: Narrower<SetZenModeMessage> = (value) =>
  typeof value.enabled === 'boolean'
    ? { type: 'setZenMode', enabled: value.enabled }
    : undefined;

/**
 * A line to open, with Beside and Keep only when they are on: everything
 * `openResultAt` and `openSourceAt` read, which treat a modifier that is
 * off and one that is absent alike.
 */
export const narrowOpenSource: Narrower<OpenSourceMessage> = (value) =>
  isSourceLocation(value)
    ? {
        type: 'openSource',
        filePath: value.filePath as string,
        line: value.line as number,
        ...(value.beside === true ? { beside: true } : {}),
        ...(value.pin === true ? { pin: true } : {}),
      }
    : undefined;

/** A tag to open, by any non-empty key; the host finds it in the index. */
export const narrowOpenTag: Narrower<OpenTagMessage> = (value) =>
  typeof value.tagKey === 'string' && value.tagKey.length > 0
    ? { type: 'openTag', tagKey: value.tagKey }
    : undefined;

/** A tag to rename, by any non-empty key; Rename Tag finds it. */
export const narrowRenameTag: Narrower<RenameTagMessage> = (value) =>
  typeof value.tagKey === 'string' && value.tagKey.length > 0
    ? { type: 'renameTag', tagKey: value.tagKey }
    : undefined;

/**
 * Park Tag or Unpark Tag, for one non-empty key and nothing else. One
 * check serves both types.
 */
export const narrowParkTag: Narrower<ParkTagMessage> = (value) =>
  (value.type === 'parkTag' || value.type === 'unparkTag') &&
  typeof value.tagKey === 'string' &&
  value.tagKey.length > 0 &&
  Object.keys(value).length === 2
    ? { type: value.type, tagKey: value.tagKey }
    : undefined;

/** A task's box, checked or unchecked, by its id. */
export const narrowToggleTask: Narrower<ToggleTaskMessage> = (value) =>
  typeof value.taskId === 'string' && typeof value.completed === 'boolean'
    ? { type: 'toggleTask', taskId: value.taskId, completed: value.completed }
    : undefined;

/**
 * Pin the entry at a line, or unpin the pin a row names. The line and the
 * pin's key are kept only when they are well formed; a pin with neither
 * pins the whole note. One check serves both types.
 */
export const narrowPinNote: Narrower<PinNoteMessage> = (value) => {
  if (typeof value.filePath !== 'string' || !value.filePath) {
    return undefined;
  }
  const isLine = typeof value.line === 'number' && Number.isInteger(value.line) && value.line >= 1;
  return {
    type: value.type === 'unpinNote' ? 'unpinNote' : 'pinNote',
    filePath: value.filePath,
    ...(isLine ? { line: value.line as number } : {}),
    ...(typeof value.pinKey === 'string' && value.pinKey ? { pinKey: value.pinKey } : {}),
  };
};

/** A search to open on a search page, no longer than a search may be. */
export const narrowOpenSearch: Narrower<OpenSearchMessage> = (value) =>
  typeof value.query === 'string' && value.query.length <= MAX_QUERY_LENGTH
    ? { type: 'openSearch', query: value.query }
    : undefined;

/** Export, of the notes or the tasks a search found. */
export const narrowExportResults: Narrower<ExportResultsMessage> = (value) =>
  value.kind === 'notes' || value.kind === 'tasks'
    ? { type: 'exportResults', kind: value.kind }
    : undefined;
