/**
 * The Hierarchy layout's groups: the results under each tag Refine offers.
 *
 * A result is shown where it is most specific: under the tags written on it,
 * or, when none of those is one of Refine's, under those on the nearest
 * heading above it that has one, then its note's front matter. So a heading
 * with tags of its own sits under its own tag rather than beside its parent
 * under a tag it inherits, and its parent's card leaves its text out, as an
 * entry's always does. A result with two of the tags at the same level is in
 * both groups; those under none of them follow, so nothing the search found
 * is left off the page.
 */
import { getEntryParts } from '../../domain/index/noteEntryIndex';
import { fileEntryId } from '../../domain/markdown/noteEntries';
import type { ParsedFile, QueryFacet, QueryFacetValue, Section, Task, WorkspaceIndex } from '../../domain/model';

/**
 * How many notes, and how many tasks, a group draws. The rest are a click
 * away, as the search narrowed to the group's tag, so thirty tags of thirty
 * results each are not a thousand cards on one page.
 */
export const GROUP_ITEM_LIMIT = 10;

/** A note as the search lists it: an entry, or a note tagged only in its front matter. */
export interface GroupedNote {
  readonly section?: Section;
  readonly file?: ParsedFile;
}

/** One group: the Refine value it is for, or none, and all its results. */
export interface ResultGroup<N extends GroupedNote> {
  readonly value?: QueryFacetValue;
  readonly facetId?: 'related' | 'tags';
  readonly notes: readonly N[];
  readonly tasks: readonly Task[];
}

/** Refine's tags: the tags related to the search's own, or else those its results carry. */
export function findTagFacet(facets: readonly QueryFacet[]): (QueryFacet & { id: 'related' | 'tags' }) | undefined {
  return facets.find((facet): facet is QueryFacet & { id: 'related' | 'tags' } => facet.id === 'related' || facet.id === 'tags');
}

/** The tags written on a heading itself, and on the lines of the text its entry owns. */
function ownSectionTags(index: WorkspaceIndex, section: Section): string[] {
  const parts = getEntryParts(index).get(section.id) ?? [section];
  return [
    ...(section.headingTags ?? []).map((tag) => tag.key),
    ...parts.flatMap((part) => (part.bodyTags ?? []).map((tag) => tag.key)),
  ];
}

/** The tags on each heading above a section, nearest first, then its note's front matter. */
function enclosingTags(index: WorkspaceIndex, section: Section | undefined, filePath: string): string[][] {
  const levels: string[][] = [];
  let parentId = section?.parentSectionId;
  while (parentId) {
    const parent = index.sections.get(parentId);
    if (!parent) {
      break;
    }
    levels.push((parent.headingTags ?? []).map((tag) => tag.key));
    parentId = parent.parentSectionId;
  }
  levels.push((index.files.get(filePath)?.frontmatterTags ?? []).map((tag) => tag.key));
  return levels;
}

/** A note's tags from the most specific out: its own, each heading's above it, its front matter's. */
function noteTagLevels(index: WorkspaceIndex, note: GroupedNote): string[][] {
  if (note.section) {
    return [ownSectionTags(index, note.section), ...enclosingTags(index, note.section, note.section.filePath)];
  }
  const file = note.file as ParsedFile;
  const parts = getEntryParts(index).get(fileEntryId(file.filePath)) ?? [];
  return [[
    ...file.frontmatterTags.map((tag) => tag.key),
    ...parts.flatMap((part) => (part.bodyTags ?? []).map((tag) => tag.key)),
  ]];
}

/** A task's tags from the most specific out: its line's, its heading's, each above, its front matter's. */
function taskTagLevels(index: WorkspaceIndex, task: Task): string[][] {
  const section = task.sectionId ? index.sections.get(task.sectionId) : undefined;
  const inherited = new Set(section ? section.tags : (index.files.get(task.filePath)?.frontmatterTags ?? []).map((tag) => tag.key));
  const own = task.tags.filter((tag) => !inherited.has(tag));
  return section
    ? [own, ownSectionTags(index, section), ...enclosingTags(index, section, task.filePath)]
    : [own, ...enclosingTags(index, undefined, task.filePath)];
}

/** The group tags at the first level, most specific first, that has any. */
function mostSpecific(levels: readonly string[][], groupKeys: ReadonlySet<string>): string[] {
  for (const level of levels) {
    const found = level.filter((tag) => groupKeys.has(tag));
    if (found.length) {
      return found;
    }
  }
  return [];
}

/**
 * The results, in their order, under each of Refine's tags in its order,
 * then those under none of them. With no tags to offer, everything is one
 * group without a tag.
 */
export function groupResults<N extends GroupedNote>(
  index: WorkspaceIndex,
  facet: (QueryFacet & { id: 'related' | 'tags' }) | undefined,
  notes: readonly N[],
  tasks: readonly Task[],
): Array<ResultGroup<N>> {
  const groups: Array<ResultGroup<N>> = [];
  const groupedNotes = new Set<N>();
  const groupedTasks = new Set<Task>();
  if (facet) {
    const groupKeys = new Set(facet.values.map((value) => value.clause));
    const noteTags = new Map(notes.map((note) => [note, new Set(mostSpecific(noteTagLevels(index, note), groupKeys))]));
    const taskTags = new Map(tasks.map((task) => [task, new Set(mostSpecific(taskTagLevels(index, task), groupKeys))]));
    facet.values.forEach((value) => {
      const group = {
        value,
        facetId: facet.id,
        notes: notes.filter((note) => noteTags.get(note)?.has(value.clause)),
        tasks: tasks.filter((task) => taskTags.get(task)?.has(value.clause)),
      };
      group.notes.forEach((note) => groupedNotes.add(note));
      group.tasks.forEach((task) => groupedTasks.add(task));
      // A tag only the hub note carries has nothing to list: the hub is drawn above the results.
      if (group.notes.length || group.tasks.length) {
        groups.push(group);
      }
    });
  }
  const rest = {
    notes: notes.filter((note) => !groupedNotes.has(note)),
    tasks: tasks.filter((task) => !groupedTasks.has(task)),
  };
  if (rest.notes.length || rest.tasks.length) {
    groups.push(rest);
  }
  return groups;
}
