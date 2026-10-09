import { QueryNode } from '../query/queryTypes';
import { ParkedState, ParsedFile, Section, Task, WorkspaceIndex } from '../model';
import { someHeadingAncestor } from './associationEvidence';

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

/** A state with nothing parked, whose sets the caller fills. */
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
  const parkedKeys = findParkedKeys(index, rules);
  if (!rules.hasFolders && parkedKeys.size === 0) {
    return state;
  }
  if (rules.hasFolders) {
    parkFolders(index, rules, state);
  }
  parkTagged(index, parkedKeys, state);
  markParkedOnlyTags(index, state);
  return state;
}

/** The index's tags that are a parked tag or one of its sub-tags. */
function findParkedKeys(index: WorkspaceIndex, rules: ParkedRules): Set<string> {
  const parkedKeys = new Set<string>();
  if (rules.tags.length === 0) {
    return parkedKeys;
  }
  index.tags.forEach((_, key) => {
    if (isUnderParkedTag(key, rules.tags)) {
      parkedKeys.add(key);
    }
  });
  return parkedKeys;
}

/** Parks a note and every heading and task in it. */
function parkWhole(state: ParkedState, file: ParsedFile): void {
  state.files.add(file.filePath);
  file.sections.forEach((section) => state.sections.add(section.id));
  file.tasks.forEach((task) => state.tasks.add(task.id));
}

/** Parks every note in a parked folder, counting each. */
function parkFolders(index: WorkspaceIndex, rules: ParkedRules, state: ParkedState): void {
  index.files.forEach((file, filePath) => {
    if (!rules.isParkedPath(filePath)) {
      return;
    }
    state.byFolder += 1;
    parkWhole(state, file);
  });
}

/**
 * The notes a parked tag appears in. Nothing else can hold a parked
 * heading or task, so only these are walked.
 */
function findCandidateNotes(index: WorkspaceIndex, parkedKeys: ReadonlySet<string>): Set<string> {
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
  return candidates;
}

/**
 * Parks what a parked tag reaches in the notes not already parked whole: a
 * note whose front matter carries one, counted, and otherwise each heading
 * and task that carries or inherits one.
 */
function parkTagged(index: WorkspaceIndex, parkedKeys: ReadonlySet<string>, state: ParkedState): void {
  const parked = (key: string): boolean => parkedKeys.has(key);
  findCandidateNotes(index, parkedKeys).forEach((filePath) => {
    const file = index.files.get(filePath);
    if (!file || state.files.has(filePath)) {
      return;
    }
    if (file.frontmatterTags.some((tag) => parked(tag.key))) {
      state.byTag += 1;
      state.taggedFiles.add(filePath);
      parkWhole(state, file);
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
}

/**
 * Marks as parked-only each tag whose every entry, task, and note is
 * parked, looking only at tags on something parked.
 */
function markParkedOnlyTags(index: WorkspaceIndex, state: ParkedState): void {
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
}

/** Whether a heading above the section carries a tag that `test` accepts. */
function inheritsTag(
  index: WorkspaceIndex,
  section: Section,
  test: (key: string) => boolean,
): boolean {
  return someHeadingAncestor(
    section,
    index.sections,
    (parent) => parent.headingTags?.some((tag) => test(tag.key)) ?? false,
  );
}

/** Whether a section carries a tag `test` accepts: on its heading, a body line, or a heading above. */
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

/**
 * Whether a task carries a tag `test` accepts: its own, its section's, or
 * a heading's above that. A body-line tag of the section does not reach it.
 */
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

/** Whether a task is parked; false for an index parking was never worked out for. */
export function isParkedTask(index: WorkspaceIndex, taskId: string): boolean {
  return index.parked?.tasks.has(taskId) ?? false;
}

/** Whether a heading's entry is parked; false for an index parking was never worked out for. */
export function isParkedSection(index: WorkspaceIndex, sectionId: string): boolean {
  return index.parked?.sections.has(sectionId) ?? false;
}

/** Whether a whole note is parked; false for an index parking was never worked out for. */
export function isParkedFile(index: WorkspaceIndex, filePath: string): boolean {
  return index.parked?.files.has(filePath) ?? false;
}

/**
 * Whether everything a tag is on is parked, so lists of tags can leave it
 * out; false for an index parking was never worked out for.
 */
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
    case 'field':
      return false;
    case 'not':
      return mentionsParked(node.child);
    case 'and':
    case 'or':
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
