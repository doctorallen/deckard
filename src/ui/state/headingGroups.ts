/**
 * The hierarchy by heading: what a search found, nested the way its notes
 * nest their tagged headings. A note's front matter, its H1, its H2, and so
 * down each name a level by the first tag written on them that the search
 * does not already name, so `# Checkout v2 #project/checkout-v2` holds the
 * `## Design #phase/design` under it, and a Design under another project is
 * a group of its own there. Each note and task sits at its most specific
 * level, as in the hierarchy by tag; the levels stop at three, deeper ones
 * kept in the third.
 */
import type { ParsedFile, Section, Task, TagReference, WorkspaceIndex } from '../../domain/model';
import type { GroupedNote } from './searchGroups';

/** How deep the groups nest: a project, its parts, and theirs. */
export const HEADING_DEPTH = 3;

/** One level: the tag that names it, its own notes and tasks, and the levels inside it. */
export interface HeadingGroup<N extends GroupedNote> {
  /** The tag's key; empty for the results under no tagged heading. */
  readonly key: string;
  readonly label: string;
  readonly notes: N[];
  readonly tasks: Task[];
  readonly children: Array<HeadingGroup<N>>;
}

/** A level's name: the first tag written there that the search does not name. */
function nameOf(tags: readonly TagReference[] | undefined, searched: ReadonlySet<string>): TagReference | undefined {
  return (tags ?? []).find((tag) => !searched.has(tag.key));
}

/** The levels a section sits under, outermost first: its note's front matter, then each tagged heading down to it. */
function sectionPath(index: WorkspaceIndex, section: Section | undefined, file: ParsedFile | undefined, searched: ReadonlySet<string>): TagReference[] {
  const headings: TagReference[] = [];
  for (let at: Section | undefined = section; at; at = at.parentSectionId ? index.sections.get(at.parentSectionId) : undefined) {
    const name = nameOf(at.headingTags, searched);
    if (name) {
      headings.unshift(name);
    }
  }
  const top = nameOf(file?.frontmatterTags, searched);
  const path = top ? [top, ...headings] : headings;
  // A heading that repeats the level above it is the same level.
  return path.filter((tag, at) => at === 0 || tag.key !== path[at - 1].key).slice(0, HEADING_DEPTH);
}

/** Where a note sits: its own heading's level, under the levels above it. */
function notePath(index: WorkspaceIndex, note: GroupedNote, searched: ReadonlySet<string>): TagReference[] {
  if (note.section) {
    return sectionPath(index, note.section, index.files.get(note.section.filePath), searched);
  }
  return sectionPath(index, undefined, note.file, searched);
}

/** Where a task sits: under the heading it is written beneath. */
function taskPath(index: WorkspaceIndex, task: Task, searched: ReadonlySet<string>): TagReference[] {
  const section = task.sectionId ? index.sections.get(task.sectionId) : undefined;
  return sectionPath(index, section, index.files.get(task.filePath), searched);
}

/** A level's notes and tasks, its own and every level's inside it. */
export function countGroup<N extends GroupedNote>(group: HeadingGroup<N>): { notes: number; tasks: number; done: number } {
  return group.children.reduce(
    (sum, child) => {
      const inner = countGroup(child);
      return { notes: sum.notes + inner.notes, tasks: sum.tasks + inner.tasks, done: sum.done + inner.done };
    },
    { notes: group.notes.length, tasks: group.tasks.length, done: group.tasks.filter((task) => task.completed).length },
  );
}

/** Busiest first, as Refine lists tags, then by name. */
function sortLevels<N extends GroupedNote>(groups: Array<HeadingGroup<N>>): Array<HeadingGroup<N>> {
  const size = (group: HeadingGroup<N>): number => {
    const counted = countGroup(group);
    return counted.notes + counted.tasks;
  };
  groups.sort((left, right) => size(right) - size(left) || left.label.localeCompare(right.label));
  groups.forEach((group) => sortLevels(group.children));
  return groups;
}

/**
 * The results nested by heading, in their own order within each level, the
 * busiest levels first, then the results under no tagged heading. `searched`
 * holds the keys of the tags the search names, which name no level.
 */
export function groupByHeading<N extends GroupedNote>(
  index: WorkspaceIndex,
  searched: ReadonlySet<string>,
  notes: readonly N[],
  tasks: readonly Task[],
): Array<HeadingGroup<N>> {
  const roots: Array<HeadingGroup<N>> = [];
  const loose: HeadingGroup<N> = { key: '', label: '', notes: [], tasks: [], children: [] };
  const levelFor = (path: readonly TagReference[]): HeadingGroup<N> => {
    if (!path.length) {
      return loose;
    }
    let siblings = roots;
    let level: HeadingGroup<N> | undefined;
    for (const tag of path) {
      level = siblings.find((candidate) => candidate.key === tag.key);
      if (!level) {
        level = { key: tag.key, label: tag.label, notes: [], tasks: [], children: [] };
        siblings.push(level);
      }
      siblings = level.children;
    }
    return level as HeadingGroup<N>;
  };
  notes.forEach((note) => levelFor(notePath(index, note, searched)).notes.push(note));
  tasks.forEach((task) => levelFor(taskPath(index, task, searched)).tasks.push(task));
  const sorted = sortLevels(roots);
  return loose.notes.length || loose.tasks.length ? [...sorted, loose] : sorted;
}
