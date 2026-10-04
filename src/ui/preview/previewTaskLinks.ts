import { randomBytes } from 'crypto';

/**
 * The links behind a query block's checkboxes in the Markdown preview.
 *
 * The preview is VS Code's own page, so Deckard cannot listen to it; a link
 * is all it may hold. A box links to Deckard's URI handler, which completes
 * or reopens the task the box was drawn for. Any web page could link to the
 * same handler, so each link carries a token made when Deckard starts and
 * known only to the previews it draws: a link without it, or with one from
 * an earlier session, writes nothing.
 */

/** The path a checkbox's link opens. */
export const TOGGLE_TASK_PATH = '/toggle-task';

/** What a checkbox's link asks for: the task, the state to put it in, and the session it was drawn in. */
export interface TaskToggleRequest {
  taskId: string;
  completed: boolean;
  token: string;
}

/** What a link to the handler turned out to be. */
export type TaskToggleLink =
  | { kind: 'toggle'; request: TaskToggleRequest }
  /** A checkbox drawn before Deckard last started, whose token is gone. */
  | { kind: 'stale' }
  /** Not a checkbox's link at all. */
  | { kind: 'other' };

/** A token for one session's links: random, and long enough not to be guessed. */
export function createSessionToken(): string {
  return randomBytes(16).toString('hex');
}

/**
 * The link a checkbox opens: Deckard's URI handler at `base`, such as
 * `vscode://esperinnovations.deckard-notes`, asked to put the task in the
 * state the box offers.
 */
export function createTaskToggleHref(base: string, request: TaskToggleRequest): string {
  // Each value is percent-encoded rather than form-encoded, so a space is
  // %20 and survives VS Code reading the link and writing it out again.
  const query = [
    `task=${encodeURIComponent(request.taskId)}`,
    `done=${request.completed ? '1' : '0'}`,
    `token=${encodeURIComponent(request.token)}`,
  ].join('&');
  return `${base}${TOGGLE_TASK_PATH}?${query}`;
}

/** A task id as the parser makes them, `task-b1msng-tjudor`: nothing a query could misread. */
const TASK_ID = /^[\w:.-]+$/;

/**
 * Reads a link the handler was opened with, by its path and its query as
 * VS Code hands them over, decoded (`vscode.Uri.query`), against this
 * session's token.
 */
export function readTaskToggleLink(path: string, query: string, token: string): TaskToggleLink {
  if (path !== TOGGLE_TASK_PATH) {
    return { kind: 'other' };
  }
  const params = new URLSearchParams(query);
  const taskId = params.get('task');
  const done = params.get('done');
  const given = params.get('token');
  if (!taskId || !TASK_ID.test(taskId) || (done !== '0' && done !== '1') || !given) {
    return { kind: 'other' };
  }
  if (given !== token) {
    return { kind: 'stale' };
  }
  return { kind: 'toggle', request: { taskId, completed: done === '1', token } };
}
