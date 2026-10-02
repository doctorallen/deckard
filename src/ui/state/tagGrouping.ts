import { stripTags } from '../../domain/markdown/parser';
import { readTaskTagKeys } from '../../domain/query/queryEvaluator';
import { Task, WorkspaceIndex } from '../../core/types';
import { withoutParked } from '../../domain/index/parked';

/**
 * Grouping tasks by the tags of one namespace: `#project/…`, `#context/…`,
 * `#area/…`. A task's tags here are every tag a `tag:` search finds it by, so
 * the Atlas group and the search `tag:#project/atlas` hold the same tasks.
 */

/** Namespaces that another grouping already covers, or that are Deckard's own. */
const RESERVED_NAMESPACES = ['person', 'tag-at'];

/** A name that can be a tag namespace: `project`, `context`, `q3-work`. */
export function isNamespaceName(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value);
}

/** One of a task's tags in a namespace. */
export interface NamespaceValue {
  /** What follows `#ns/`, as the key holds it: `phone`, `deckard/ui`. */
  value: string;
  key: string;
  /** As written: on the task's line when it is written there. */
  label: string;
  /** Written on the task's own line. */
  written: boolean;
  /** Given by a heading above the task or its note's front matter. */
  inherited: boolean;
}

function namespacePrefix(namespace: string): string {
  return `#${namespace.toLowerCase()}/`;
}

/** The task's tags in a namespace, written or inherited, in the order found. */
export function readNamespaceValues(
  index: WorkspaceIndex | undefined,
  task: Task,
  namespace: string,
): NamespaceValue[] {
  const prefix = namespacePrefix(namespace);
  const onLine = new Map(
    (task.associationTagGroups?.[0] ?? []).map((tag) => [tag.key.toLowerCase(), tag.label]),
  );
  // Without the index (a line being captured), the task's own tags stand in.
  const keys = index ? readTaskTagKeys(index, task) : new Set(task.tags);
  const values: NamespaceValue[] = [];
  keys.forEach((key) => {
    const lower = key.toLowerCase();
    if (!lower.startsWith(prefix) || lower.length === prefix.length) {
      return;
    }
    const written = onLine.has(lower);
    values.push({
      value: lower.slice(prefix.length),
      key: lower,
      label: onLine.get(lower) ?? index?.tags.get(key)?.label ?? task.tagLabels[key] ?? key,
      written,
      inherited: index ? isInherited(index, task, key) : false,
    });
  });
  return values;
}

/** Whether a heading above the task, or its note's front matter, gives it a tag. */
function isInherited(index: WorkspaceIndex, task: Task, key: string): boolean {
  const file = index.files.get(task.filePath);
  if (file?.frontmatterTags.some((tag) => tag.key === key)) {
    return true;
  }
  return findHeadingWithTag(index, task, key) !== undefined;
}

/** The nearest heading above the task that carries a tag, by its words. */
function findHeadingWithTag(index: WorkspaceIndex, task: Task, key: string): string | undefined {
  const visited = new Set<string>();
  let sectionId = task.sectionId;
  while (sectionId && !visited.has(sectionId)) {
    visited.add(sectionId);
    const section = index.sections.get(sectionId);
    if (!section) {
      return undefined;
    }
    if (section.headingTags?.some((tag) => tag.key === key)) {
      return stripTags(section.heading).trim() || section.heading;
    }
    sectionId = section.parentSectionId;
  }
  return undefined;
}

/** Where a task's inherited tag comes from: the nearest heading, else front matter. */
export function findTagSource(
  index: WorkspaceIndex,
  task: Task,
  key: string,
): { kind: 'heading'; heading: string } | { kind: 'frontmatter' } {
  const heading = findHeadingWithTag(index, task, key);
  return heading === undefined ? { kind: 'frontmatter' } : { kind: 'heading', heading };
}

/** A namespace open tasks use, with how many and its busiest values. */
export interface TaskNamespace {
  name: string;
  openTasks: number;
  /** Values by use, busiest first. */
  values: string[];
}

/**
 * The namespaces the open, unparked tasks carry, directly or inherited,
 * busiest first. The status namespace and people are left out: Status and
 * Person already group by them.
 */
export function listTaskNamespaces(
  index: WorkspaceIndex,
  exclude: readonly string[] = [],
): TaskNamespace[] {
  const skip = new Set([...RESERVED_NAMESPACES, ...exclude].map((name) => name.toLowerCase()));
  const tasks = new Map<string, number>();
  const values = new Map<string, Map<string, number>>();
  withoutParked([...index.tasks.values()], index).forEach((task) => {
    if (task.completed) {
      return;
    }
    const seen = new Set<string>();
    readTaskTagKeys(index, task).forEach((key) => {
      const lower = key.toLowerCase();
      const slash = lower.indexOf('/');
      if (!lower.startsWith('#') || slash < 2 || slash === lower.length - 1) {
        return;
      }
      const name = lower.slice(1, slash);
      if (skip.has(name) || !isNamespaceName(name)) {
        return;
      }
      if (!seen.has(name)) {
        seen.add(name);
        tasks.set(name, (tasks.get(name) ?? 0) + 1);
      }
      const byValue = values.get(name) ?? new Map<string, number>();
      const value = lower.slice(slash + 1);
      byValue.set(value, (byValue.get(value) ?? 0) + 1);
      values.set(name, byValue);
    });
  });
  return [...tasks.entries()]
    .map(([name, openTasks]) => ({
      name,
      openTasks,
      values: [...(values.get(name) ?? new Map<string, number>()).entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([value]) => value),
    }))
    .sort((left, right) => right.openTasks - left.openTasks || left.name.localeCompare(right.name));
}

/**
 * A group's name for a value: a value written all in lower case reads as a
 * status does, `q3-launch` as **Q3 launch**; one with any capital stays as
 * written, `iOS`. A nested value keeps its slash, **Deckard/ui**.
 */
export function formatNamespaceValue(value: string): string {
  if (value !== value.toLowerCase()) {
    return value;
  }
  const words = value.replace(/[-_]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The value of a tag as its label writes it, after `#ns/`. */
export function labelValue(label: string): string {
  const slash = label.indexOf('/');
  return slash < 0 ? label : label.slice(slash + 1);
}

/** The group for tasks without a tag in the namespace: No project. */
export function noValueLabel(namespace: string): string {
  return `No ${namespace.toLowerCase()}`;
}

/** `phone, computer, errands, and 2 more`, for a namespace's detail. */
export function describeNamespaceValues(values: readonly string[]): string {
  const shown = values.slice(0, 3);
  const more = values.length - shown.length;
  return more > 0 ? `${shown.join(', ')}, and ${more} more` : shown.join(', ');
}

/** A task's title, quoted and short enough for a notification. */
export function quoteTask(task: Task): string {
  const title = task.title.trim();
  return `"${title.length > 60 ? `${title.slice(0, 57)}…` : title}"`;
}
