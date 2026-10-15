/**
 * Between you and a person (docs/implementation/36-between-you.md): every
 * open line between the reader and the person a tag's page is about, in
 * the groups a one-to-one goes through. Each group is one search the
 * language already says, so the card is a view over the evaluator, and
 * its label opens that search.
 *
 * - **You owe Sam**: open tasks that are yours, assigned to you or to
 *   nobody, not on hold, that mention Sam. A mention on your own task means
 *   you owe that person (D10).
 * - **Sam owes you**: open tasks assigned to Sam, and open tasks of yours on
 *   hold that mention Sam, as a hand-off is written: a waiting task that
 *   mentions someone counts as theirs (D11).
 *
 * A task assigned to a third person is theirs, and shows on their page,
 * not here, whoever it mentions. Plan 38 adds a third group, what to ask
 * them, from its questions.
 */
import { isPersonTag } from '../../domain/markdown/parser';
import { formatKeyWords } from '../../domain/markdown/tagKeys';
import { formatIsoDate, startOfDay } from '../../domain/markdown/calendar';
import type { Task, WorkspaceIndex } from '../../domain/model';
import type { QueryContext } from '../../domain/query/queryContext';
import { evaluateQuery, matchesPerson } from '../../domain/query/queryEvaluator';
import { parseWorkspaceQuery } from '../../domain/types/typeQueryFields';
import { getTypeIndex } from '../../domain/types/typeIndex';
import type { BetweenGroupKind, SearchPageBetween } from '../protocol/searchPage';
import { createDashboardTask } from './entryCards';
import { hubNoteLabel } from './hubTree';

/** How many lines a group draws; its label opens the rest. */
export const BETWEEN_ROW_LIMIT = 10;

/** One group of the card: what it is called, and the search it is. */
interface BetweenGroupRule {
  kind: BetweenGroupKind;
  label: (name: string) => string;
  query: (tagKey: string) => string;
}

/**
 * The card's groups, in its order. Parked tasks are left out, as the Task
 * board and the Tasks view leave them out. For a task of yours, `is:waiting`
 * is its on-hold status alone, since what is assigned to you or to nobody is
 * not assigned to someone else.
 */
const BETWEEN_GROUPS: readonly BetweenGroupRule[] = [
  {
    kind: 'youOwe',
    label: (name) => `You owe ${name}`,
    query: (tagKey) => `is:open is:mine -is:waiting -is:parked ${tagKey}`,
  },
  {
    kind: 'theyOwe',
    label: (name) => `${name} owes you`,
    query: (tagKey) => `is:open -is:parked (assignee = ${tagKey} OR (is:waiting is:mine ${tagKey}))`,
  },
];

/** The search each group of a person's card is, by group: what its label opens. */
export function betweenQueries(tagKey: string): Record<BetweenGroupKind, string> {
  return Object.fromEntries(BETWEEN_GROUPS.map((group) => [group.kind, group.query(tagKey)])) as Record<BetweenGroupKind, string>;
}

/** One group's lines, all of them, in the card's order. */
export interface BetweenGroupLines {
  kind: BetweenGroupKind;
  label: string;
  query: string;
  tasks: Task[];
}

/**
 * Every open line between the reader and a person, by group, each sorted
 * overdue first, then oldest; undefined for a tag that is no person, or
 * that names the reader.
 */
export function collectBetweenLines(index: WorkspaceIndex, tagKey: string, context: QueryContext): BetweenGroupLines[] | undefined {
  if (!isPersonTag(tagKey) || (context.identity !== undefined && matchesPerson(context.identity, tagKey))) {
    return undefined;
  }
  const name = personFirstName(index, tagKey);
  return BETWEEN_GROUPS.map((group) => {
    const query = group.query(tagKey);
    const tasks = evaluateQuery(index, parseWorkspaceQuery(index, query).node, context).tasks;
    return { kind: group.kind, label: group.label(name), query, tasks: sortBetween(tasks, context.now) };
  });
}

/**
 * The Between you card of a person's page: each group with its first lines
 * drawn as the board draws a task. Undefined for a tag that is no person,
 * for the reader's own page, and for a person with no open line between
 * you, who gets no card.
 */
export function describeBetween(index: WorkspaceIndex, tagKey: string, context: QueryContext): SearchPageBetween | undefined {
  const groups = collectBetweenLines(index, tagKey, context);
  if (!groups || groups.every((group) => group.tasks.length === 0)) {
    return undefined;
  }
  return {
    name: personFirstName(index, tagKey),
    ...(context.identity === undefined ? { needsIdentity: true as const } : {}),
    groups: groups.map((group) => ({
      kind: group.kind,
      label: group.label,
      query: group.query,
      count: group.tasks.length,
      tasks: group.tasks.slice(0, BETWEEN_ROW_LIMIT).map((task) => createDashboardTask(task, index.sections, context)),
    })),
  };
}

/**
 * The card as a one-to-one's agenda, in Markdown: each group that holds
 * anything under its own heading, then its lines as open tasks, titles
 * only, with the due date. Empty when there is nothing between you.
 *
 * ```
 * ## You owe Sam
 * - [ ] Send Sam the recon field mapping (due 2026-10-06)
 * ```
 */
export function formatBetweenAgenda(groups: readonly BetweenGroupLines[]): string {
  return groups
    .filter((group) => group.tasks.length > 0)
    .map((group) => [
      `## ${group.label}`,
      ...group.tasks.map((task) => `- [ ] ${task.title.trim()}${task.dueAt === undefined ? '' : ` (due ${formatIsoDate(task.dueAt)})`}`),
    ].join('\n'))
    .join('\n\n');
}

/**
 * How many lines each group holds, for an assistant: `You owe Sam: 3. Sam
 * owes you: 2.`; undefined for a tag that is no person or names the reader.
 */
export function describeBetweenCounts(index: WorkspaceIndex, tagKey: string, context: QueryContext): string | undefined {
  const groups = collectBetweenLines(index, tagKey, context);
  if (!groups) {
    return undefined;
  }
  const counts = groups.map((group) => `${group.label}: ${group.tasks.length}.`).join(' ');
  return context.identity === undefined
    ? `${counts} deckard.me names nobody, so only tasks for nobody count as yours.`
    : counts;
}

/**
 * Overdue first, the longest overdue first; then the oldest, by the day each
 * was added, its note's when it says none; then where it is written.
 */
function sortBetween(tasks: readonly Task[], now: number): Task[] {
  const today = startOfDay(now);
  const overdue = (task: Task): boolean => task.dueAt !== undefined && task.dueAt < today;
  return [...tasks].sort(
    (left, right) =>
      Number(overdue(right)) - Number(overdue(left)) ||
      (overdue(left) ? (left.dueAt ?? 0) - (right.dueAt ?? 0) : 0) ||
      (left.createdAt ?? Number.MAX_SAFE_INTEGER) - (right.createdAt ?? Number.MAX_SAFE_INTEGER) ||
      left.filePath.localeCompare(right.filePath) ||
      left.lineNumber - right.lineNumber,
  );
}

/**
 * The name a person goes by on the card: the first word of their row's
 * title, of their hub note's, or of their tag's name, `Sam` for
 * `@sam-okafor`.
 */
export function personFirstName(index: WorkspaceIndex, tagKey: string): string {
  const row = getTypeIndex(index).rowOfTag(tagKey);
  const hub = index.tags.get(tagKey)?.hubFilePaths?.[0];
  const bare = tagKey.replace(/^[#@]/, '');
  const title = row?.title ?? (hub ? hubNoteLabel(index, hub) : formatKeyWords(bare.slice(bare.lastIndexOf('/') + 1)));
  return title.trim().split(/\s+/)[0] || tagKey;
}
