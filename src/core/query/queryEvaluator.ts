import { TASK_PRIORITY_RANKS } from '../markdown/taskMetadata';
import {
  ParsedFile,
  Section,
  Task,
  TaskPriority,
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

/** How many notes and tasks a search for a tag finds. */
export interface TagMatchCount {
  notes: number;
  tasks: number;
}

const tagMatchCounts = new WeakMap<WorkspaceIndex, Map<string, TagMatchCount>>();

/**
 * Counts, for every tag, the notes and tasks `tag = <tag>` finds: the same
 * units the evaluator tests, with the tags they inherit, so a count shown
 * beside a tag agrees with the search it starts. Counted once per index.
 */
export function countTagMatches(
  index: WorkspaceIndex,
): ReadonlyMap<string, TagMatchCount> {
  const cached = tagMatchCounts.get(index);
  if (cached) {
    return cached;
  }
  const counts = new Map<string, TagMatchCount>();
  const add = (tagKeys: Set<string>, kind: keyof TagMatchCount): void => {
    tagKeys.forEach((tagKey) => {
      const count = counts.get(tagKey) ?? { notes: 0, tasks: 0 };
      count[kind] += 1;
      counts.set(tagKey, count);
    });
  };
  const membership = buildTagMembership(index);
  index.sections.forEach((section) =>
    add(createSectionUnit(index, membership, section).tagKeys, 'notes'),
  );
  index.tasks.forEach((task) =>
    add(createTaskUnit(index, membership, task).tagKeys, 'tasks'),
  );
  index.files.forEach((file) => {
    if ((membership.files.get(file.filePath)?.size ?? 0) > 0) {
      add(createFileUnit(membership, file).tagKeys, 'notes');
    }
  });
  tagMatchCounts.set(index, counts);
  return counts;
}

/** How many notes and tasks a search for two tags together finds. */
export interface TagPairMatchCount extends TagMatchCount {
  tags: [string, string];
}

const tagPairMatchCounts = new WeakMap<
  WorkspaceIndex,
  TagPairMatchCount[]
>();

/**
 * Two tags, in the order a pair is always keyed in, so the same two tags are
 * one pair however they were written.
 */
function pairKey(left: string, right: string): string {
  return left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`;
}

/**
 * How many notes and tasks `tag = A AND tag = B` finds, for every pair of
 * tags that any entry carries together.
 *
 * Counted over the same units the evaluator tests, with the tags they inherit
 * from their headings and their note's front matter, so the number beside a
 * pair is the number the search for that pair opens. Two tags written on one
 * line are the strongest case of this and no longer the only one: tags that
 * meet because a heading scopes them both count too, which is how most notes
 * put tags together.
 *
 * A unit carrying n tags contributes n(n-1)/2 pairs, so a unit with an
 * unreasonable number of tags is left out rather than allowed to dominate
 * the pass.
 */
export function countTagPairMatches(
  index: WorkspaceIndex,
): readonly TagPairMatchCount[] {
  const cached = tagPairMatchCounts.get(index);
  if (cached) {
    return cached;
  }
  const counts = new Map<string, TagPairMatchCount>();
  const add = (tagKeys: Set<string>, kind: keyof TagMatchCount): void => {
    if (tagKeys.size < 2 || tagKeys.size > MAX_TAGS_PER_UNIT) {
      return;
    }
    const keys = [...tagKeys];
    for (let left = 0; left < keys.length; left += 1) {
      for (let right = left + 1; right < keys.length; right += 1) {
        const key = pairKey(keys[left], keys[right]);
        const count = counts.get(key) ?? {
          tags: key.split('\u0000') as [string, string],
          notes: 0,
          tasks: 0,
        };
        count[kind] += 1;
        counts.set(key, count);
      }
    }
  };
  const membership = buildTagMembership(index);
  index.sections.forEach((section) =>
    add(createSectionUnit(index, membership, section).tagKeys, 'notes'),
  );
  index.tasks.forEach((task) =>
    add(createTaskUnit(index, membership, task).tagKeys, 'tasks'),
  );
  index.files.forEach((file) => {
    if ((membership.files.get(file.filePath)?.size ?? 0) > 0) {
      add(createFileUnit(membership, file).tagKeys, 'notes');
    }
  });
  const pairs = [...counts.values()];
  tagPairMatchCounts.set(index, pairs);
  return pairs;
}

/**
 * The most tags an entry may carry before its pairs are skipped. A note that
 * tags one line with dozens of things says little about any two of them, and
 * the pairs grow with the square of the count.
 */
const MAX_TAGS_PER_UNIT = 40;

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
  dueAt?: number;
  scheduledAt?: number;
  startAt?: number;
  doneAt?: number;
  priority?: TaskPriority;
  /** 🆔 this task's own name, which other tasks depend on. */
  dependencyId?: string;
  /** ⛔ the names of the tasks this one waits for. */
  dependsOn?: string[];
  /** Open, and waiting for a task that is still open. */
  blocked?: boolean;
  /** Open, and an open task is waiting for it. */
  blocking?: boolean;
}

/**
 * The live dependency edges of a workspace, built once per index.
 *
 * Only an edge between two open tasks counts: a task a completed task waited
 * for is holding nothing up, and a task whose blockers are all done is ready
 * to start. Computing this once keeps `is:blocked` and `is:blocking` from
 * scanning every other task for each task they test.
 */
interface DependencyState {
  /** 🆔 names of the open tasks, so a ⛔ can be told from a stale name. */
  openIds: Set<string>;
  /** 🆔 names that an open task waits for. */
  neededIds: Set<string>;
}

const dependencyStates = new WeakMap<WorkspaceIndex, DependencyState>();

function getDependencyState(index: WorkspaceIndex): DependencyState {
  const cached = dependencyStates.get(index);
  if (cached) {
    return cached;
  }
  const state: DependencyState = { openIds: new Set(), neededIds: new Set() };
  index.tasks.forEach((task) => {
    if (task.completed) {
      return;
    }
    if (task.dependencyId) {
      state.openIds.add(task.dependencyId);
    }
    task.dependsOn?.forEach((id) => state.neededIds.add(id));
  });
  dependencyStates.set(index, state);
  return state;
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
  const dependencies = getDependencyState(index);
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
    dueAt: task.dueAt,
    scheduledAt: task.scheduledAt,
    startAt: task.startAt,
    doneAt: task.doneAt,
    priority: task.priority,
    dependencyId: task.dependencyId,
    dependsOn: task.dependsOn,
    blocked:
      !task.completed &&
      (task.dependsOn?.some((id) => dependencies.openIds.has(id)) ?? false),
    blocking:
      !task.completed &&
      task.dependencyId !== undefined &&
      dependencies.neededIds.has(task.dependencyId),
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
    case 'is':
      return applyNegation(condition, matchesIs(condition.value, unit));
    case 'has':
      return matchesHas(condition, unit);
    case 'in':
      return applyNegation(condition, isInFolder(condition.value, unit.filePath));
    case 'kind':
      return applyNegation(condition, matchesKind(condition.value, unit));
    case 'file':
      return matchesPathValue(condition, getFileName(unit.filePath));
    case 'path':
      return matchesPathValue(condition, unit.filePath);
    case 'created':
      return matchesDate(condition, unit.createdAt, 'past');
    case 'updated':
      return matchesDate(condition, unit.updatedAt, 'past');
    case 'due':
      return matchesTaskDate(condition, unit, unit.dueAt, 'future');
    case 'scheduled':
      return matchesTaskDate(condition, unit, unit.scheduledAt, 'future');
    case 'start':
      return matchesTaskDate(condition, unit, unit.startAt, 'future');
    case 'done':
      return matchesTaskDate(condition, unit, unit.doneAt, 'past');
    case 'priority':
      return matchesPriority(condition, unit);
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
 * Answers `is:`. `note` is anything that is not a task; the rest are tasks.
 * `due` means open and due within the next seven days, overdue included.
 * `blocked` and `blocking` read the ⛔ and 🆔 dependency edges between open
 * tasks; `has:dependsOn` and `has:id` read the markers themselves, whether or
 * not the task at the other end is still open.
 */
function matchesIs(
  value: string,
  unit: QueryUnit,
  now: number = Date.now(),
): boolean {
  if (value === 'note') {
    return unit.kind !== 'task';
  }
  if (unit.kind !== 'task') {
    return false;
  }
  const open = unit.completed !== true;
  switch (value) {
    case 'open':
      return open;
    case 'done':
      return !open;
    case 'task':
      return true;
    case 'overdue':
      return open && unit.dueAt !== undefined && unit.dueAt < startOfDay(now);
    case 'due':
      return (
        open &&
        unit.dueAt !== undefined &&
        unit.dueAt < startOfDay(now) + 7 * DAY
      );
    case 'blocked':
      return unit.blocked === true;
    case 'blocking':
      return unit.blocking === true;
    default:
      return false;
  }
}

/**
 * Answers `has:` and `no:`. Like the task date fields themselves, only tasks
 * can satisfy either, so `no:due` lists tasks without a due date rather than
 * every note as well.
 */
function matchesHas(condition: QueryConditionNode, unit: QueryUnit): boolean {
  if (unit.kind !== 'task') {
    return false;
  }
  const present = isTaskFieldPresent(unit, condition.value);
  return condition.operator === 'neq' ? !present : present;
}

function isTaskFieldPresent(unit: QueryUnit, field: string): boolean {
  switch (field) {
    case 'priority':
      return unit.priority !== undefined;
    case 'id':
      return unit.dependencyId !== undefined;
    case 'dependsOn':
      return (unit.dependsOn?.length ?? 0) > 0;
    default:
      return getTaskDate(unit, field) !== undefined;
  }
}

function getTaskDate(unit: QueryUnit, field: string): number | undefined {
  switch (field) {
    case 'due':
      return unit.dueAt;
    case 'scheduled':
      return unit.scheduledAt;
    case 'start':
      return unit.startAt;
    case 'done':
      return unit.doneAt;
    default:
      return undefined;
  }
}

/**
 * Answers `in:`, which matches a folder and everything beneath it. A folder
 * with `*` or `?` is matched against each folder above the file.
 */
export function isInFolder(folder: string, filePath: string): boolean {
  const wanted = folder.replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();
  const candidate = filePath.toLowerCase();
  if (!wanted) {
    return false;
  }
  if (wanted.includes('*') || wanted.includes('?')) {
    const pattern = createGlob(wanted, true);
    const parts = candidate.split('/').slice(0, -1);
    return parts.some((_, index) =>
      pattern.test(parts.slice(0, index + 1).join('/')),
    );
  }
  return candidate.startsWith(`${wanted}/`);
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
 * Whether a relative window such as `7d` looks back from today, as `created`
 * and `updated` do, or ahead, as a due date does.
 */
export type DateDirection = 'past' | 'future';

/**
 * Task dates answer only for tasks, so `due != today` never lists notes.
 * `none` asks whether the date is written at all.
 */
function matchesTaskDate(
  condition: QueryConditionNode,
  unit: QueryUnit,
  timestamp: number | undefined,
  direction: DateDirection,
): boolean {
  if (unit.kind !== 'task') {
    return false;
  }
  if (condition.value === 'none') {
    return condition.operator === 'neq'
      ? timestamp !== undefined
      : timestamp === undefined;
  }
  return matchesDate(condition, timestamp, direction);
}

/**
 * Compares a task's priority. A task without one ranks between medium and
 * low, as it does in Obsidian Tasks, so `priority > medium` finds high and
 * highest.
 */
function matchesPriority(
  condition: QueryConditionNode,
  unit: QueryUnit,
): boolean {
  if (unit.kind !== 'task') {
    return false;
  }
  const actual = TASK_PRIORITY_RANKS[unit.priority ?? 'none'];
  const wanted = TASK_PRIORITY_RANKS[condition.value as TaskPriority | 'none'];
  switch (condition.operator) {
    case 'eq':
      return actual === wanted;
    case 'neq':
      return actual !== wanted;
    case 'gt':
      return actual > wanted;
    case 'gte':
      return actual >= wanted;
    case 'lt':
      return actual < wanted;
    case 'lte':
      return actual <= wanted;
    default:
      return false;
  }
}

/**
 * Compares a unit timestamp against an absolute date, a relative window such
 * as `30d`, or a named day such as `today`.
 *
 * A plain `created = 2026-09-13` means "on that day", so a bare date does not
 * require an exact millisecond match no author could reproduce. A window is
 * compared by its far end: `updated > 7d` means more recently than seven days
 * ago, and `due < 7d` means sooner than seven days from now.
 */
function matchesDate(
  condition: QueryConditionNode,
  timestamp: number | undefined,
  direction: DateDirection,
  now: number = Date.now(),
): boolean {
  if (timestamp === undefined) {
    return false;
  }
  const range = resolveDateRange(condition.value, now, direction);
  if (!range) {
    return false;
  }

  if (
    range.isWindow &&
    condition.operator !== 'eq' &&
    condition.operator !== 'neq'
  ) {
    const boundary = direction === 'past' ? range.start : range.end;
    return condition.operator === 'gt' || condition.operator === 'gte'
      ? timestamp >= boundary
      : timestamp < boundary;
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
  /** True for a relative window such as 7d, rather than one named day. */
  isWindow: boolean;
}

/**
 * Turns a date value into the half-open interval it names.
 */
export function resolveDateRange(
  value: string,
  now: number = Date.now(),
  direction: DateDirection = 'past',
): DateRange | undefined {
  const normalized = value.trim().toLowerCase();

  const namedDayOffsets: Record<string, number> = {
    yesterday: -1,
    today: 0,
    tomorrow: 1,
  };
  if (Object.hasOwn(namedDayOffsets, normalized)) {
    const start = startOfDay(now) + namedDayOffsets[normalized] * DAY;
    return { start, end: start + DAY, isWindow: false };
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
    // A window counts today as its first day: `updated = 7d` is the last seven
    // days including today, and `due = 7d` is today and the six after it.
    return direction === 'past'
      ? {
          start: startOfDay(now) - (days - 1) * DAY,
          end: startOfDay(now) + DAY,
          isWindow: true,
        }
      : {
          start: startOfDay(now),
          end: startOfDay(now) + days * DAY,
          isWindow: true,
        };
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
    return { start, end: start + DAY, isWindow: false };
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
