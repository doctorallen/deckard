import { QueryNode } from '../query/queryTypes';
import { ParkedState, ParsedFile, Section, Task, WorkspaceIndex } from '../types';

export type { ParkedState };

/**
 * What parks a note, a heading, or a task: `deckard.parked.folders` and
 * `deckard.parked.tags`, read once per change to either setting.
 */
export interface ParkedRules {
  /** Whether a note's index path is in a parked folder. */
  isParkedPath(filePath: string): boolean;
  /** Whether any folder pattern is set, so the notes need checking at all. */
  hasFolders: boolean;
  /** The parked tags as index keys: `#parked`, `#project/old`, `@ren`. */
  tags: readonly string[];
}

/** Nothing parked: what an index without settings, or a test, reads. */
export const NO_PARKED_RULES: ParkedRules = {
  isParkedPath: () => false,
  hasFolders: false,
  tags: [],
};

export function emptyParkedState(): ParkedState {
  return {
    files: new Set(),
    sections: new Set(),
    tasks: new Set(),
    tags: new Set(),
    taggedFiles: new Set(),
    byFolder: 0,
    byTag: 0,
  };
}

/**
 * A parked tag written in a setting, as the index keys it: `project/old`,
 * `#Project/Old`, and `#project/old` are one tag; `@ren` stays a person.
 */
export function toParkedTagKey(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === '#' || trimmed === '@') {
    return undefined;
  }
  return trimmed.startsWith('#') || trimmed.startsWith('@') ? trimmed : `#${trimmed}`;
}

/** Whether a tag key is a parked tag or one of its sub-tags. */
export function isUnderParkedTag(key: string, parkedTags: readonly string[]): boolean {
  const lower = key.toLowerCase();
  return parkedTags.some((tag) => lower === tag || lower.startsWith(`${tag}/`));
}

/**
 * Works out what is parked, with exactly the inheritance a search uses:
 * front-matter tags, heading tags down the heading tree, a task's own tags,
 * and a body-line tag answering for the entry that holds it.
 *
 * Only the notes a parked tag appears in are walked, so an index with nothing
 * parked costs one pass over its tag keys.
 */
export function computeParked(
  index: WorkspaceIndex,
  rules: ParkedRules,
): ParkedState {
  const state = emptyParkedState();
  const parkedKeys = new Set<string>();
  if (rules.tags.length > 0) {
    index.tags.forEach((_, key) => {
      if (isUnderParkedTag(key, rules.tags)) {
        parkedKeys.add(key);
      }
    });
  }
  if (!rules.hasFolders && parkedKeys.size === 0) {
    return state;
  }

  const parkWhole = (file: ParsedFile): void => {
    state.files.add(file.filePath);
    file.sections.forEach((section) => state.sections.add(section.id));
    file.tasks.forEach((task) => state.tasks.add(task.id));
  };
  if (rules.hasFolders) {
    index.files.forEach((file, filePath) => {
      if (rules.isParkedPath(filePath)) {
        state.byFolder += 1;
        parkWhole(file);
      }
    });
  }

  // The notes a parked tag appears in, and nothing else, can hold a parked
  // heading or task.
  const candidates = new Set<string>();
  parkedKeys.forEach((key) => {
    const tag = index.tags.get(key);
    tag?.filePaths.forEach((filePath) => candidates.add(filePath));
    tag?.sectionIds.forEach((id) => {
      const section = index.sections.get(id);
      if (section) {
        candidates.add(section.filePath);
      }
    });
    tag?.taskIds.forEach((id) => {
      const task = index.tasks.get(id);
      if (task) {
        candidates.add(task.filePath);
      }
    });
  });
  const parked = (key: string): boolean => parkedKeys.has(key);
  candidates.forEach((filePath) => {
    const file = index.files.get(filePath);
    if (!file || state.files.has(filePath)) {
      return;
    }
    if (file.frontmatterTags.some((tag) => parked(tag.key))) {
      state.byTag += 1;
      state.taggedFiles.add(filePath);
      parkWhole(file);
      return;
    }
    file.sections.forEach((section) => {
      if (sectionCarries(index, section, parked)) {
        state.sections.add(section.id);
      }
    });
    file.tasks.forEach((task) => {
      if (taskCarries(index, task, parked)) {
        state.tasks.add(task.id);
      }
    });
  });

  // A tag is parked-only when every entry, task, and note it is on is parked.
  const seen = new Set<string>();
  const consider = (key: string): void => {
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    const tag = index.tags.get(key);
    if (
      tag &&
      tag.sectionIds.every((id) => state.sections.has(id)) &&
      tag.taskIds.every((id) => state.tasks.has(id)) &&
      tag.filePaths.every((filePath) => state.files.has(filePath))
    ) {
      state.tags.add(key);
    }
  };
  state.sections.forEach((id) => {
    const section = index.sections.get(id);
    section?.tags.forEach(consider);
    section?.bodyTags?.forEach((tag) => consider(tag.key));
  });
  state.tasks.forEach((id) => index.tasks.get(id)?.tags.forEach(consider));
  state.files.forEach((filePath) =>
    index.files.get(filePath)?.frontmatterTags.forEach((tag) => consider(tag.key)),
  );
  return state;
}

/** Whether a heading above the section carries a tag that `test` accepts. */
function inheritsTag(
  index: WorkspaceIndex,
  section: Section,
  test: (key: string) => boolean,
): boolean {
  let parentSectionId = section.parentSectionId;
  const visited = new Set<string>();
  while (parentSectionId && !visited.has(parentSectionId)) {
    visited.add(parentSectionId);
    const parent = index.sections.get(parentSectionId);
    if (!parent) {
      return false;
    }
    if (parent.headingTags?.some((tag) => test(tag.key))) {
      return true;
    }
    parentSectionId = parent.parentSectionId;
  }
  return false;
}

function sectionCarries(
  index: WorkspaceIndex,
  section: Section,
  test: (key: string) => boolean,
): boolean {
  return (
    section.tags.some(test) ||
    (section.bodyTags?.some((tag) => test(tag.key)) ?? false) ||
    inheritsTag(index, section, test)
  );
}

function taskCarries(
  index: WorkspaceIndex,
  task: Task,
  test: (key: string) => boolean,
): boolean {
  if (task.tags.some(test)) {
    return true;
  }
  const section = task.sectionId ? index.sections.get(task.sectionId) : undefined;
  return section !== undefined && (section.tags.some(test) || inheritsTag(index, section, test));
}

export function isParkedTask(index: WorkspaceIndex, taskId: string): boolean {
  return index.parked?.tasks.has(taskId) ?? false;
}

export function isParkedSection(index: WorkspaceIndex, sectionId: string): boolean {
  return index.parked?.sections.has(sectionId) ?? false;
}

export function isParkedFile(index: WorkspaceIndex, filePath: string): boolean {
  return index.parked?.files.has(filePath) ?? false;
}

export function isParkedOnlyTag(index: WorkspaceIndex, tagKey: string): boolean {
  return index.parked?.tags.has(tagKey) ?? false;
}

/** Whether anything in the index is parked. */
export function hasParked(index: WorkspaceIndex): boolean {
  const parked = index.parked;
  return parked !== undefined && (parked.sections.size > 0 || parked.tasks.size > 0 || parked.files.size > 0);
}

/** The tasks that are not parked, in the order given. */
export function withoutParked<T extends { id: string }>(
  tasks: readonly T[],
  index: WorkspaceIndex,
): T[] {
  const parked = index.parked?.tasks;
  return parked && parked.size > 0
    ? tasks.filter((task) => !parked.has(task.id))
    : [...tasks];
}

/** The items with the parked ones moved after the rest, each part in order. */
export function parkedLast<T>(items: readonly T[], isParked: (item: T) => boolean): T[] {
  const kept: T[] = [];
  const parked: T[] = [];
  items.forEach((item) => (isParked(item) ? parked : kept).push(item));
  return parked.length === 0 ? kept : [...kept, ...parked];
}

/**
 * Whether a search says `is:parked`, for or against: a list of things to do
 * leaves parked tasks out unless its own search mentions them.
 */
export function mentionsParked(node: QueryNode | undefined): boolean {
  if (!node) {
    return false;
  }
  switch (node.type) {
    case 'condition':
      return node.field === 'is' && node.value === 'parked';
    case 'not':
      return mentionsParked(node.child);
    default:
      return node.children.some(mentionsParked);
  }
}

/**
 * The tags `deckard.parked.tags` lists, as a page's tag menu offers to
 * unpark them. An indexer without parking, as in a test, lists none.
 */
export function listedParkedTags(indexer: { getParkedRules?(): ParkedRules }): string[] {
  return typeof indexer.getParkedRules === 'function' ? [...indexer.getParkedRules().tags] : [];
}
