import { DEFAULT_TASK_POLICY, needsNewDate, readLineStatus } from '../tasks/taskPolicy';
import { addDays, startOfDay } from '../markdown/calendar';
import { getFileName } from '../../shared/paths';
import { isDailyNoteFile, isPeriodicNoteFile } from '../markdown/parser';
import {
  ParsedFile,
  Section,
  Task,
  TaskPriority,
  WorkspaceIndex,
} from '../model';
import { resolveIndexedTagKey } from '../index/tagNavigation';
import {
  getQueryLinkState,
  LinkQuery,
  LinkState,
  matchesLinkQuery,
  resolveLinkQuery,
  UnitLink,
} from './queryLinks';
import { QueryContext } from './queryContext';
import { DateDirection, resolveDateRange } from './queryDates';
import { compareByOperator, QueryConditionNode, QueryNode } from './queryTypes';
import { isWildcard, normalizeFolder } from './queryValues';
import { escapeRegExp } from '../../shared/text';
import { TASK_PRIORITY_RANKS } from '../markdown/taskFields';

/** What a search finds, by kind, each list in index order. */
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

/**
 * Evaluates a parsed DQL query against the workspace index: the sections,
 * tasks, and notes it finds, or none for a search that did not parse.
 *
 * The evaluator works on source units — a tagged section, a task, or a
 * front-matter-only file — which is the same granularity the overview already
 * renders, so an advanced query produces the same kind of cards as a tag.
 *
 * Everything the answer depends on besides the index and the search comes in
 * `query`, and its `now` is the one moment every date condition is compared
 * against, so `is:today` and `due = today` agree however long the pass takes.
 */
export function evaluateQuery(
  index: WorkspaceIndex,
  node: QueryNode | undefined,
  query: QueryContext,
): QueryResults {
  if (!node) {
    return { sections: [], tasks: [], files: [] };
  }

  const membership = buildTagMembership(index);
  const context = createEvaluationContext(index, node, query);
  const statusNamespace = query.taskPolicy.statusNamespace;
  const links = context.links;
  const withLinks = (unit: QueryUnit, key: string): QueryUnit =>
    links ? { ...unit, links: links.byUnit.get(key) } : unit;
  const sections = [...index.sections.values()].filter((section) =>
    matchesNode(
      node,
      withLinks(createSectionUnit(index, membership, section), `section:${section.id}`),
      context,
    ),
  );
  const tasks = [...index.tasks.values()].filter((task) =>
    matchesNode(
      node,
      withLinks(createTaskUnit(index, membership, task, statusNamespace), `task:${task.id}`),
      context,
    ),
  );
  // A note is a result of its own only when it has tags of its own, or, for
  // a search by link, a link none of its entries owns.
  const files = [...index.files.values()]
    .filter(
      (file) =>
        (membership.files.get(file.filePath)?.size ?? 0) > 0 ||
        (links?.looseFiles.has(file.filePath) ?? false),
    )
    .filter((file) =>
      matchesNode(
        node,
        withLinks(createFileUnit(index, membership, file), `file:${file.filePath}`),
        context,
      ),
    );

  return { sections, tasks, files };
}

/**
 * What one evaluation reads besides the unit itself: the settings and moment
 * it is asked at, the workspace's links, only when the search asks about
 * them, and each link value read once.
 */
interface EvaluationContext {
  index: WorkspaceIndex;
  query: QueryContext;
  links?: LinkState;
  linkQueries: Map<string, LinkQuery>;
}

/** The context of one evaluation; the links are gathered only when the search names `link`. */
function createEvaluationContext(
  index: WorkspaceIndex,
  node: QueryNode,
  query: QueryContext,
): EvaluationContext {
  return {
    index,
    query,
    ...(hasField(node, 'link') ? { links: getQueryLinkState(index) } : {}),
    linkQueries: new Map(),
  };
}

/** Whether any condition in a query names a field. */
function hasField(node: QueryNode, field: QueryConditionNode['field']): boolean {
  switch (node.type) {
    case 'condition':
      return node.field === field;
    case 'not':
      return hasField(node.child, field);
    case 'and':
    case 'or':
      return node.children.some((child) => hasField(child, field));
  }
}

/** Answers `link`, reading each link value once per evaluation. */
function matchesLinkCondition(
  condition: QueryConditionNode,
  unit: QueryUnit,
  context: EvaluationContext,
): boolean {
  let query = context.linkQueries.get(condition.value);
  if (!query) {
    query = resolveLinkQuery(context.index, condition.value);
    context.linkQueries.set(condition.value, query);
  }
  return applyNegation(condition, matchesLinkQuery(unit.links, query));
}

/** How many notes and tasks a search for a tag finds. */
export interface TagMatchCount {
  notes: number;
  tasks: number;
}

/** Each index's tag counts, counted the first time they are asked for. */
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
    add(createTaskUnit(index, membership, task, COUNTED_STATUS_NAMESPACE).tagKeys, 'tasks'),
  );
  index.files.forEach((file) => {
    if ((membership.files.get(file.filePath)?.size ?? 0) > 0) {
      add(createFileUnit(index, membership, file).tagKeys, 'notes');
    }
  });
  tagMatchCounts.set(index, counts);
  return counts;
}

/** How many notes and tasks a search for two tags together finds. */
export interface TagPairMatchCount extends TagMatchCount {
  tags: [string, string];
}

/** Each index's tag-pair counts, counted the first time they are asked for. */
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
    add(createTaskUnit(index, membership, task, COUNTED_STATUS_NAMESPACE).tagKeys, 'tasks'),
  );
  index.files.forEach((file) => {
    if ((membership.files.get(file.filePath)?.size ?? 0) > 0) {
      add(createFileUnit(index, membership, file).tagKeys, 'notes');
    }
  });
  const pairs = [...counts.values()];
  tagPairMatchCounts.set(index, pairs);
  return pairs;
}

/**
 * The namespace a count reads a task's status in. A count reads only a
 * unit's tags, never its status, so the count of an index is the same
 * whatever the setting says, and one cache per index serves every reader.
 */
const COUNTED_STATUS_NAMESPACE = DEFAULT_TASK_POLICY.statusNamespace;

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
  /** The person the task is for: whoever its 👤 field names. */
  assignee?: string;
  /** The status written on the task's line, such as `waiting`, or ''. */
  status?: string;
  /** The `[[links]]` on the unit's own lines, read for a `link` search. */
  links?: readonly UnitLink[];
  /** In a parked folder, or found by a search for a parked tag. */
  parked?: boolean;
  /** A step: written under another task. */
  step?: boolean;
  /** How many steps are written under the task. */
  stepCount?: number;
}

/**
 * Whether a written person matches a task's assignee, however either is
 * written: `@ren-kade`, `#person/ren-kade`, and `ren-kade` all name one
 * person.
 */
export function matchesPerson(written: string, assignee?: string): boolean {
  if (!assignee) {
    return false;
  }
  return personName(written) === personName(assignee);
}

/** A person's name without its marker or namespace, lowercased, for comparing two spellings. */
function personName(value: string): string {
  const text = value.trim().toLocaleLowerCase();
  const withoutMarker = text.startsWith('@') ? text.slice(1) : text;
  const separator = withoutMarker.lastIndexOf('/');
  return separator < 0 ? withoutMarker : withoutMarker.slice(separator + 1);
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

/** Each index's dependency edges, built the first time a task unit needs them. */
const dependencyStates = new WeakMap<WorkspaceIndex, DependencyState>();

/** The live dependency edges of an index, built once and kept with it. */
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

/**
 * The daily notes, and the daily, weekly, and monthly notes, of an index, by
 * path: what `is:daily` and `is:periodic` ask of any entry, task, or note.
 */
interface PeriodicState {
  daily: Set<string>;
  periodic: Set<string>;
}

/** Each index's daily and periodic notes, gathered the first time `is:` asks. */
const periodicStates = new WeakMap<WorkspaceIndex, PeriodicState>();

/** The daily and periodic notes of an index, gathered once and kept with it. */
function getPeriodicState(index: WorkspaceIndex): PeriodicState {
  const cached = periodicStates.get(index);
  if (cached) {
    return cached;
  }
  const state: PeriodicState = { daily: new Set(), periodic: new Set() };
  index.files.forEach((file, filePath) => {
    if (isDailyNoteFile(file)) {
      state.daily.add(filePath);
    }
    if (isPeriodicNoteFile(file)) {
      state.periodic.add(filePath);
    }
  });
  periodicStates.set(index, state);
  return state;
}

/** Which tags each section, task, and note holds, read from the index's tag records. */
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

/**
 * A section as a condition tests it: the tags it holds, those on its own
 * lines, and those of every heading above it, with its heading and text.
 */
function createSectionUnit(
  index: WorkspaceIndex,
  membership: TagMembership,
  section: Section,
): QueryUnit {
  const tagKeys = new Set(membership.sections.get(section.id) ?? []);
  section.tags.forEach((tagKey) => tagKeys.add(tagKey));
  // A tag written on one of the section's own lines answers for the section,
  // because the section is what contains that line.
  section.bodyTags?.forEach((tag) => tagKeys.add(tag.key));
  collectInheritedTagKeys(index, section, tagKeys);
  return {
    kind: 'section',
    tagKeys,
    text: `${section.heading}\n${section.rawContent}`.toLowerCase(),
    filePath: section.filePath,
    createdAt: section.createdAt,
    updatedAt: section.updatedAt,
    parked: index.parked?.sections.has(section.id) ?? false,
  };
}

/**
 * Every tag a `tag:` search finds a task by: its own line, the heading it is
 * under and every heading above that, and its note's front matter. The Tasks
 * view and the board group by the same set, so a column and the search for
 * its tag always hold the same tasks.
 */
export function readTaskTagKeys(index: WorkspaceIndex, task: Task): Set<string> {
  const tagKeys = new Set(task.tags);
  const section = task.sectionId
    ? index.sections.get(task.sectionId)
    : undefined;
  if (section) {
    section.tags.forEach((tagKey) => tagKeys.add(tagKey));
    collectInheritedTagKeys(index, section, tagKeys);
  }
  return tagKeys;
}

/** A task as a condition tests it, its status read in `statusNamespace`. */
function createTaskUnit(
  index: WorkspaceIndex,
  membership: TagMembership,
  task: Task,
  statusNamespace: string,
): QueryUnit {
  const tagKeys = readTaskTagKeys(index, task);
  membership.tasks.get(task.id)?.forEach((tagKey) => tagKeys.add(tagKey));
  const dependencies = getDependencyState(index);
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
    assignee: task.assignee,
    status: readLineStatus(task, statusNamespace),
    parked: index.parked?.tasks.has(task.id) ?? false,
    step: task.parentTaskId !== undefined,
    stepCount: task.steps?.total ?? 0,
    blocked:
      !task.completed &&
      (task.dependsOn?.some((id) => dependencies.openIds.has(id)) ?? false),
    blocking:
      !task.completed &&
      task.dependencyId !== undefined &&
      dependencies.neededIds.has(task.dependencyId),
  };
}

/** A note as a condition tests it: the tags its front matter gives it, and its whole text. */
function createFileUnit(
  index: WorkspaceIndex,
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
    parked: index.parked?.files.has(file.filePath) ?? false,
  };
}

/** Whether a unit satisfies a query: every child of an AND, any of an OR, not a NOT's. */
function matchesNode(
  node: QueryNode,
  unit: QueryUnit,
  context: EvaluationContext,
): boolean {
  switch (node.type) {
    case 'and':
      return node.children.every((child) => matchesNode(child, unit, context));
    case 'or':
      return node.children.some((child) => matchesNode(child, unit, context));
    case 'not':
      return !matchesNode(node.child, unit, context);
    case 'condition':
      return matchesCondition(node, unit, context);
  }
}

/** Whether a unit satisfies one condition, by the field the condition names. */
function matchesCondition(
  condition: QueryConditionNode,
  unit: QueryUnit,
  context: EvaluationContext,
): boolean {
  switch (condition.field) {
    case 'tag':
      return applyNegation(condition, matchesTag(condition.value, unit));
    case 'link':
      return matchesLinkCondition(condition, unit, context);
    case 'text':
      return matchesText(condition, unit);
    case 'task':
      return applyNegation(condition, matchesTaskState(condition.value, unit));
    case 'is':
      if (condition.value === 'daily' || condition.value === 'periodic') {
        const periodic = getPeriodicState(context.index);
        const notes = condition.value === 'daily' ? periodic.daily : periodic.periodic;
        return applyNegation(condition, notes.has(unit.filePath));
      }
      return applyNegation(condition, matchesIs(condition.value, unit, context.query));
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
      return matchesDate(condition, unit.createdAt, 'past', context.query);
    case 'updated':
      return matchesDate(condition, unit.updatedAt, 'past', context.query);
    case 'due':
    case 'scheduled':
    case 'start':
    case 'done':
      return matchesTaskDate(condition, unit, condition.field, context.query);
    case 'priority':
      return matchesPriority(condition, unit);
    case 'assignee':
      return matchesAssignee(condition, unit);
  }
}

/**
 * Answers `assignee = @ren-kade` and `assignee = none`. Only a task has one,
 * so a query using it returns no notes, as the date fields do.
 */
function matchesAssignee(
  condition: QueryConditionNode,
  unit: QueryUnit,
): boolean {
  if (unit.kind !== 'task') {
    return false;
  }
  const matched =
    condition.value.toLocaleLowerCase() === 'none'
      ? unit.assignee === undefined
      : matchesPerson(condition.value, unit.assignee);
  return applyNegation(condition, matched);
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
  if (isWildcard(value)) {
    const pattern = createGlob(value, true);
    return [...unit.tagKeys].some((tagKey) => pattern.test(tagKey));
  }

  const tagMap = new Map([...unit.tagKeys].map((tagKey) => [tagKey, tagKey]));
  return resolveIndexedTagKey(tagMap, value) !== undefined;
}

/**
 * Answers `text`: `=` and `!=` look for the value as a whole word, and `~`
 * and `!~` anywhere, in the unit's text, case aside.
 */
function matchesText(condition: QueryConditionNode, unit: QueryUnit): boolean {
  const needle = condition.value.toLowerCase();
  if (condition.operator === 'eq' || condition.operator === 'neq') {
    // Whole-word match keeps `text = plan` from matching "planning".
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}_])${escapeRegExp(needle)}([^\\p{L}\\p{N}_]|$)`,
      'u',
    );
    return applyNegation(condition, pattern.test(unit.text));
  }
  return applyNegation(condition, unit.text.includes(needle));
}

/** Answers `task`: any task, an open one, or a done one; never a note. */
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
 * not the task at the other end is still open. Today, the person who is me,
 * and what is on hold are the context's.
 */
function matchesIs(
  value: string,
  unit: QueryUnit,
  context: QueryContext,
): boolean {
  if (value === 'note') {
    return unit.kind !== 'task';
  }
  if (value === 'parked') {
    // Notes and tasks alike: parking is about where a thing is, not its kind.
    return unit.parked === true;
  }
  if (unit.kind !== 'task') {
    return false;
  }
  const matches = TASK_IS_PREDICATES.get(value);
  return matches ? matches(unit, unit.completed !== true, context) : false;
}

/** Whether a task, open or not as `open` says, is what one `is:` value names. */
type IsPredicate = (unit: QueryUnit, open: boolean, context: QueryContext) => boolean;

/**
 * Exactly the Tasks view's Today: open, and due today, or scheduled for
 * today or earlier and started, and not overdue.
 */
function isForToday(unit: QueryUnit, open: boolean, { now }: QueryContext): boolean {
  if (!open) {
    return false;
  }
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  if (unit.dueAt !== undefined && unit.dueAt < today) {
    return false;
  }
  if (unit.dueAt !== undefined && unit.dueAt < tomorrow) {
    return true;
  }
  const started = unit.startAt === undefined || unit.startAt < tomorrow;
  return started && unit.scheduledAt !== undefined && unit.scheduledAt < tomorrow;
}

/**
 * Waiting on a person, as the board's Waiting column means it: an open task
 * marked waiting, or handed to someone other than me. Waiting on another
 * task is `is:blocked`.
 */
function isWaiting(unit: QueryUnit, open: boolean, { identity }: QueryContext): boolean {
  return (
    open &&
    (unit.status === 'waiting' ||
      (unit.assignee !== undefined &&
        !(identity !== undefined && matchesPerson(identity, unit.assignee))))
  );
}

/**
 * The Task Board's Can start now, which narrows the board to this search,
 * so the two must agree: open, not parked, nothing it waits for still open,
 * started by today, and no on-hold status.
 */
function isAvailable(unit: QueryUnit, open: boolean, context: QueryContext): boolean {
  return (
    open &&
    unit.parked !== true &&
    unit.blocked !== true &&
    (unit.startAt === undefined || unit.startAt < addDays(startOfDay(context.now), 1)) &&
    !context.taskPolicy.onHoldStatuses.includes(unit.status ?? '')
  );
}

/**
 * Mine: a task nobody was asked to do falls to whoever is reading, so what
 * carries no 👤 is mine, and what names me is mine once I have a name.
 */
function isMine(unit: QueryUnit, _open: boolean, { identity }: QueryContext): boolean {
  return (
    unit.assignee === undefined ||
    (identity !== undefined && matchesPerson(identity, unit.assignee))
  );
}

/**
 * The `is:` values that only a task can be, each with its test. A Map, so
 * a value read from a search is never looked up on Object's prototype.
 */
const TASK_IS_PREDICATES: ReadonlyMap<string, IsPredicate> = new Map<string, IsPredicate>([
  ['open', (_unit, open) => open],
  ['done', (_unit, open) => !open],
  ['task', () => true],
  ['overdue', (unit, open, { now }) => open && unit.dueAt !== undefined && unit.dueAt < startOfDay(now)],
  [
    'due',
    (unit, open, { now }) =>
      open && unit.dueAt !== undefined && unit.dueAt < addDays(startOfDay(now), 7),
  ],
  ['needs-date', (unit, open, context) => open && needsNewDate(unit.dueAt, context.now, context.taskPolicy)],
  ['today', isForToday],
  ['waiting', isWaiting],
  ['available', isAvailable],
  ['blocked', (unit) => unit.blocked === true],
  ['blocking', (unit) => unit.blocking === true],
  ['mine', isMine],
  ['assigned', (unit) => unit.assignee !== undefined],
  ['unassigned', (unit) => unit.assignee === undefined],
  ['step', (unit) => unit.step === true],
]);

/**
 * Answers `has:` and `no:`. Like the task date fields themselves, only tasks
 * can satisfy either, so `no:due` lists tasks without a due date rather than
 * every note as well.
 */
function matchesHas(condition: QueryConditionNode, unit: QueryUnit): boolean {
  if (unit.kind !== 'task') {
    return false;
  }
  return applyNegation(condition, isTaskFieldPresent(unit, condition.value));
}

/** Whether a task has what `has:` names: a priority, an id, dependencies, steps, or a date. */
function isTaskFieldPresent(unit: QueryUnit, field: string): boolean {
  switch (field) {
    case 'priority':
      return unit.priority !== undefined;
    case 'id':
      return unit.dependencyId !== undefined;
    case 'dependsOn':
      return (unit.dependsOn?.length ?? 0) > 0;
    case 'steps':
      return (unit.stepCount ?? 0) > 0;
    default:
      return getTaskDate(unit, field) !== undefined;
  }
}

/** One of a task's dates by its field's name; undefined for any other name. */
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
  const wanted = normalizeFolder(folder).toLowerCase();
  const candidate = filePath.toLowerCase();
  if (!wanted) {
    return false;
  }
  if (isWildcard(wanted)) {
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

/**
 * Answers `file` and `path`: `~` and `!~` look for the value anywhere, case
 * aside, and `=` and `!=` match it whole as a `*` and `?` glob.
 */
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
 * Task dates answer only for tasks, so `due != today` never lists notes.
 * `none` asks whether the date is written at all. A done date looks back
 * from today, as `created` does; the others look ahead.
 */
function matchesTaskDate(
  condition: QueryConditionNode,
  unit: QueryUnit,
  field: 'due' | 'scheduled' | 'start' | 'done',
  context: QueryContext,
): boolean {
  if (unit.kind !== 'task') {
    return false;
  }
  const timestamp = getTaskDate(unit, field);
  if (condition.value === 'none') {
    return applyNegation(condition, timestamp === undefined);
  }
  return matchesDate(condition, timestamp, field === 'done' ? 'past' : 'future', context);
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
  return compareByOperator(condition.operator, actual, wanted);
}

/**
 * Compares a unit timestamp against an absolute date, a relative window such
 * as `30d`, or a named day such as `today`.
 *
 * A plain `created = 2026-09-13` means "on that day", so a bare date does not
 * require an exact millisecond match no author could reproduce. A window is
 * compared by its far end: `updated > 7d` means more recently than seven days
 * ago, and `due < 7d` means sooner than seven days from now. Today and the
 * week's first day are the context's.
 */
function matchesDate(
  condition: QueryConditionNode,
  timestamp: number | undefined,
  direction: DateDirection,
  context: QueryContext,
): boolean {
  if (timestamp === undefined) {
    return false;
  }
  const range = resolveDateRange(condition.value, context.now, direction, context.weekStart);
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
    case 'contains':
    case 'notContains':
      return false;
  }
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

