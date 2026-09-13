import {
  ParsedFile,
  Section,
  Task,
  WorkspaceIndex,
} from '../types';
import { resolveIndexedTagKey } from '../workspace/tagNavigation';
import { QueryConditionNode, QueryNode } from './queryTypes';

/**
 * Evaluates a parsed DQL query against the workspace index.
 *
 * The evaluator works on source units — a tagged section, a task, or a
 * front-matter-only file — which is the same granularity the overview already
 * renders, so an advanced query produces the same kind of cards as a tag.
 */
export interface QueryResults {
  sections: Section[];
  tasks: Task[];
  files: ParsedFile[];
}

/**
 * Reverse membership built once per evaluation.
 *
 * Reading tag membership out of `index.tags` rather than recomputing it keeps
 * an advanced query in exact agreement with what the tag chips already match,
 * including tags a note inherits from its front matter.
 */
interface TagMembership {
  sections: Map<string, Set<string>>;
  tasks: Map<string, Set<string>>;
  files: Map<string, Set<string>>;
}

export function evaluateQuery(
  index: WorkspaceIndex,
  node: QueryNode | undefined,
): QueryResults {
  if (!node) {
    return { sections: [], tasks: [], files: [] };
  }

  const membership = buildTagMembership(index);
  const sections = [...index.sections.values()].filter((section) =>
    matchesNode(node, createSectionUnit(index, membership, section)),
  );
  const tasks = [...index.tasks.values()].filter((task) =>
    matchesNode(node, createTaskUnit(index, membership, task)),
  );
  const files = [...index.files.values()]
    .filter((file) => (membership.files.get(file.filePath)?.size ?? 0) > 0)
    .filter((file) => matchesNode(node, createFileUnit(membership, file)));

  return { sections, tasks, files };
}

/**
 * One thing a condition can be tested against.
 */
interface QueryUnit {
  kind: 'section' | 'task' | 'file';
  tagKeys: Set<string>;
  text: string;
  filePath: string;
  completed?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

function buildTagMembership(index: WorkspaceIndex): TagMembership {
  const membership: TagMembership = {
    sections: new Map(),
    tasks: new Map(),
    files: new Map(),
  };
  const add = (
    target: Map<string, Set<string>>,
    id: string,
    tagKey: string,
  ): void => {
    const existing = target.get(id);
    if (existing) {
      existing.add(tagKey);
      return;
    }
    target.set(id, new Set([tagKey]));
  };

  index.tags.forEach((tag) => {
    tag.sectionIds.forEach((sectionId) =>
      add(membership.sections, sectionId, tag.key),
    );
    tag.taskIds.forEach((taskId) => add(membership.tasks, taskId, tag.key));
    tag.filePaths.forEach((filePath) =>
      add(membership.files, filePath, tag.key),
    );
  });
  return membership;
}

/**
 * Adds tags a section inherits from its parent headings.
 *
 * A tagged heading scopes everything beneath it, so a nested section answers
 * `tag:` conditions for its ancestors exactly as the tag intersection does.
 */
function collectInheritedTagKeys(
  index: WorkspaceIndex,
  section: Section,
  target: Set<string>,
): void {
  let parentSectionId = section.parentSectionId;
  const visited = new Set<string>();
  while (parentSectionId && !visited.has(parentSectionId)) {
    visited.add(parentSectionId);
    const parent = index.sections.get(parentSectionId);
    if (!parent) {
      return;
    }
    parent.headingTags?.forEach((tag) => target.add(tag.key));
    parentSectionId = parent.parentSectionId;
  }
}

function createSectionUnit(
  index: WorkspaceIndex,
  membership: TagMembership,
  section: Section,
): QueryUnit {
  const tagKeys = new Set(membership.sections.get(section.id) ?? []);
  section.tags.forEach((tagKey) => tagKeys.add(tagKey));
  collectInheritedTagKeys(index, section, tagKeys);
  return {
    kind: 'section',
    tagKeys,
    text: `${section.heading}\n${section.rawContent}`.toLowerCase(),
    filePath: section.filePath,
    createdAt: section.createdAt,
    updatedAt: section.updatedAt,
  };
}

function createTaskUnit(
  index: WorkspaceIndex,
  membership: TagMembership,
  task: Task,
): QueryUnit {
  const tagKeys = new Set(membership.tasks.get(task.id) ?? []);
  task.tags.forEach((tagKey) => tagKeys.add(tagKey));
  const section = task.sectionId
    ? index.sections.get(task.sectionId)
    : undefined;
  if (section) {
    section.tags.forEach((tagKey) => tagKeys.add(tagKey));
    collectInheritedTagKeys(index, section, tagKeys);
  }
  return {
    kind: 'task',
    tagKeys,
    text: `${task.title}\n${task.sourceLineText}`.toLowerCase(),
    filePath: task.filePath,
    completed: task.completed,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function createFileUnit(
  membership: TagMembership,
  file: ParsedFile,
): QueryUnit {
  const tagKeys = new Set(membership.files.get(file.filePath) ?? []);
  file.frontmatterTags.forEach((tag) => tagKeys.add(tag.key));
  return {
    kind: 'file',
    tagKeys,
    text: file.content.toLowerCase(),
    filePath: file.filePath,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

function matchesNode(node: QueryNode, unit: QueryUnit): boolean {
  switch (node.type) {
    case 'and':
      return node.children.every((child) => matchesNode(child, unit));
    case 'or':
      return node.children.some((child) => matchesNode(child, unit));
    case 'not':
      return !matchesNode(node.child, unit);
    case 'condition':
      return matchesCondition(node, unit);
  }
}

function matchesCondition(
  condition: QueryConditionNode,
  unit: QueryUnit,
): boolean {
  switch (condition.field) {
    case 'tag':
      return applyNegation(condition, matchesTag(condition.value, unit));
    case 'text':
      return matchesText(condition, unit);
    case 'task':
      return applyNegation(condition, matchesTaskState(condition.value, unit));
    case 'kind':
      return applyNegation(condition, matchesKind(condition.value, unit));
    case 'file':
      return matchesPathValue(condition, getFileName(unit.filePath));
    case 'path':
      return matchesPathValue(condition, unit.filePath);
    case 'created':
      return matchesDate(condition, unit.createdAt);
    case 'updated':
      return matchesDate(condition, unit.updatedAt);
  }
}

/**
 * Inverts a positive match for the operators that mean "does not".
 */
function applyNegation(
  condition: QueryConditionNode,
  matched: boolean,
): boolean {
  return condition.operator === 'neq' ||
    condition.operator === 'notContains'
    ? !matched
    : matched;
}

/**
 * Matches a tag by canonical key, accepting the same spellings the rest of
 * Deckard accepts and supporting `*` for namespace queries.
 */
function matchesTag(value: string, unit: QueryUnit): boolean {
  if (value.includes('*') || value.includes('?')) {
    const pattern = createGlob(value, true);
    return [...unit.tagKeys].some((tagKey) => pattern.test(tagKey));
  }

  const tagMap = new Map([...unit.tagKeys].map((tagKey) => [tagKey, tagKey]));
  return resolveIndexedTagKey(tagMap, value) !== undefined;
}

function matchesText(condition: QueryConditionNode, unit: QueryUnit): boolean {
  const needle = condition.value.toLowerCase();
  if (condition.operator === 'eq' || condition.operator === 'neq') {
    // Whole-word match keeps `text:plan` from matching "planning".
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}_])${escapeRegExp(needle)}([^\\p{L}\\p{N}_]|$)`,
      'u',
    );
    const matched = pattern.test(unit.text);
    return condition.operator === 'neq' ? !matched : matched;
  }
  return applyNegation(condition, unit.text.includes(needle));
}

function matchesTaskState(value: string, unit: QueryUnit): boolean {
  if (unit.kind !== 'task') {
    return false;
  }
  if (value === 'any') {
    return true;
  }
  return value === 'done' ? unit.completed === true : unit.completed !== true;
}

/**
 * Matches an entity namespace, so `kind = project` finds every project tag.
 */
function matchesKind(value: string, unit: QueryUnit): boolean {
  const kind = value.toLowerCase();
  return [...unit.tagKeys].some((tagKey) => getTagKind(tagKey) === kind);
}

/**
 * Derives the namespace of a tag key, treating `@name` as a person.
 */
export function getTagKind(tagKey: string): string | undefined {
  if (tagKey.startsWith('@')) {
    return 'person';
  }
  const withoutMarker = tagKey.replace(/^#/, '');
  const separator = withoutMarker.indexOf('/');
  return separator > 0
    ? withoutMarker.slice(0, separator).toLowerCase()
    : undefined;
}

function matchesPathValue(
  condition: QueryConditionNode,
  candidate: string,
): boolean {
  const value = condition.value;
  if (
    condition.operator === 'contains' ||
    condition.operator === 'notContains'
  ) {
    return applyNegation(
      condition,
      candidate.toLowerCase().includes(value.toLowerCase()),
    );
  }
  const matched = createGlob(value, true).test(candidate);
  return applyNegation(condition, matched);
}

/**
 * Compares a unit timestamp against an absolute date, a relative window such
 * as `30d`, or `today`.
 *
 * A plain `created = 2026-09-13` means "on that day", so a bare date does not
 * require an exact millisecond match no author could reproduce.
 */
function matchesDate(
  condition: QueryConditionNode,
  timestamp: number | undefined,
  now: number = Date.now(),
): boolean {
  if (timestamp === undefined) {
    return false;
  }
  const range = resolveDateRange(condition.value, now);
  if (!range) {
    return false;
  }

  switch (condition.operator) {
    case 'eq':
      return timestamp >= range.start && timestamp < range.end;
    case 'neq':
      return timestamp < range.start || timestamp >= range.end;
    case 'gt':
      return timestamp >= range.end;
    case 'gte':
      return timestamp >= range.start;
    case 'lt':
      return timestamp < range.start;
    case 'lte':
      return timestamp < range.end;
    default:
      return false;
  }
}

interface DateRange {
  start: number;
  end: number;
}

/**
 * Turns a date value into the half-open interval it names.
 */
export function resolveDateRange(
  value: string,
  now: number = Date.now(),
): DateRange | undefined {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'today' || normalized === 'yesterday') {
    const start = startOfDay(now) - (normalized === 'yesterday' ? DAY : 0);
    return { start, end: start + DAY };
  }

  const relative = /^(\d+)([dwmy])$/.exec(normalized);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    const days =
      unit === 'd'
        ? amount
        : unit === 'w'
          ? amount * 7
          : unit === 'm'
            ? amount * 30
            : amount * 365;
    // `updated > 7d` reads as "in the last seven days", so the window starts
    // in the past and runs to the end of today.
    return { start: startOfDay(now) - (days - 1) * DAY, end: startOfDay(now) + DAY };
  }

  const absolute = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (absolute) {
    const start = new Date(
      Number(absolute[1]),
      Number(absolute[2]) - 1,
      Number(absolute[3]),
    ).getTime();
    if (Number.isNaN(start)) {
      return undefined;
    }
    return { start, end: start + DAY };
  }

  return undefined;
}

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Compiles a `*`/`?` glob into an anchored, case-insensitive pattern.
 */
export function createGlob(value: string, anchored: boolean): RegExp {
  const body = value
    .split('')
    .map((character) => {
      if (character === '*') {
        return '.*';
      }
      if (character === '?') {
        return '.';
      }
      return escapeRegExp(character);
    })
    .join('');
  return new RegExp(anchored ? `^${body}$` : body, 'i');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getFileName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}
