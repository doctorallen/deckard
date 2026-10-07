/**
 * What Edit Task Statuses checks as a list is typed, which the page shows
 * beside the rows and the host checks again before it saves: a character
 * given twice, a status with no name or no character; a name the search language keeps for itself; and, in the workflow, a
 * next character no status has, or Done not followed by to do or in
 * progress, the check Obsidian Tasks' Review report makes. It reads only
 * the list, so a page can run it.
 */
import type { TaskStatusType } from '../model/tasks';

/** One status as checked: as the setting writes it. */
export interface CheckedStatus {
  readonly symbol?: string;
  readonly name: string;
  readonly type: TaskStatusType;
  readonly next?: string;
}

/** One problem, the row it is on, and whether it stops a save. */
export interface StatusProblem {
  /** The row, zero-based. */
  readonly row: number;
  readonly severity: 'error' | 'warning';
  readonly text: string;
}

/** The names `status:` keeps for itself, which a status may have but a search can't reach by. */
const RESERVED_NAMES = new Set(['open', 'any']);

/** The problems one row has on its own. */
function checkRow(status: CheckedStatus, row: number): StatusProblem[] {
  const problems: StatusProblem[] = [];
  const name = status.name.trim();
  if (!name) {
    problems.push({ row, severity: 'error', text: 'Give it a name.' });
  }
  if (status.symbol === undefined) {
    problems.push({ row, severity: 'error', text: 'Give it a character.' });
  }
  if (status.symbol !== undefined && [...status.symbol].length !== 1) {
    problems.push({ row, severity: 'error', text: 'A character is one character.' });
  }
  if (status.symbol === '>' || status.symbol === ']') {
    problems.push({ row, severity: 'error', text: `[${status.symbol}] can't be a status: ${status.symbol === '>' ? 'it marks a task moved to another day' : 'it closes the box'}.` });
  }
  if (RESERVED_NAMES.has(name.toLowerCase())) {
    problems.push({ row, severity: 'warning', text: `status:${name.toLowerCase()} already means every ${name.toLowerCase() === 'open' ? 'open ' : ''}task, so a search can't find this status by its name. Search status:[${status.symbol ?? ' '}] instead, or rename it.` });
  }
  return problems;
}

/**
 * Every problem the list has, row by row: each row's own, then a character
 * given twice, then, in the workflow, the next characters.
 */
export function checkStatusList(statuses: readonly CheckedStatus[], workflow: boolean): StatusProblem[] {
  const problems = statuses.flatMap((status, row) => checkRow(status, row));
  const firstWith = new Map<string, number>();
  statuses.forEach((status, row) => {
    if (status.symbol === undefined) {
      return;
    }
    const first = firstWith.get(status.symbol);
    if (first === undefined) {
      firstWith.set(status.symbol, row);
    } else {
      problems.push({ row, severity: 'error', text: `[${status.symbol}] is already ${statuses[first].name || 'another status'}'s character.` });
    }
  });
  if (!workflow) {
    return problems;
  }
  statuses.forEach((status, row) => {
    if (status.next === undefined || status.next === '') {
      return;
    }
    const next = statuses.find((candidate) => candidate.symbol === status.next);
    if (!next) {
      problems.push({ row, severity: 'error', text: `No status has the character [${status.next}] that a click moves it to.` });
    } else if (status.type === 'done' && next.type !== 'todo' && next.type !== 'inProgress') {
      problems.push({ row, severity: 'warning', text: `A click on a done task should open it again, to do or in progress; [${next.symbol ?? ''}] is ${next.name}.` });
    }
  });
  return problems;
}
