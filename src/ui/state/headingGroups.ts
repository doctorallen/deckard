/**
 * The hierarchy by heading: what a search found, nested the way its notes
 * nest their tagged headings. A note's front matter, its H1, its H2, and so
 * down each name a level by the first tag written on them, unless that tag
 * is one the search names: that heading is the page's own subject, such as a
 * project on its own page, and makes no level, so its parts come first. So
 * `# Checkout v2 #project/checkout-v2` holds the
 * `## Design #phase/design` under it, and a Design under another project is
 * a group of its own there. Each note and task sits at its most specific
 * level, as in the hierarchy by tag; the levels stop at three, deeper ones
 * kept in the third.
 */
import type { ParsedFile, Section, Task, TagReference, WorkspaceIndex } from '../../domain/model';
import type { GroupedNote } from './searchGroups';
import { countTaskProgress } from '../../domain/tasks/taskStatuses';

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
  /** Where its heading is first written, which orders it among its siblings as the notes do. */
  at: Place;
}

/** A heading's place: its note and line, a note's front matter at line 0. */
interface Place {
  readonly filePath: string;
  readonly line: number;
}

/** One level of a path: its tag and where its heading is written. */
interface Step {
  readonly tag: TagReference;
  readonly at: Place;
}

/** Whether one place comes before another, by note and then by line. */
function isBefore(left: Place, right: Place): boolean {
  return left.filePath < right.filePath || (left.filePath === right.filePath && left.line < right.line);
}

/** A level's name: the first tag written there, unless the search names it. */
function nameOf(tags: readonly TagReference[] | undefined, searched: ReadonlySet<string>): TagReference | undefined {
  const first = tags?.[0];
  return first && !searched.has(first.key) ? first : undefined;
}

/** The levels a section sits under, outermost first: its note's front matter, then each tagged heading down to it. */
function sectionPath(index: WorkspaceIndex, section: Section | undefined, file: ParsedFile | undefined, searched: ReadonlySet<string>): Step[] {
  const headings: Step[] = [];
  for (let at: Section | undefined = section; at; at = at.parentSectionId ? index.sections.get(at.parentSectionId) : undefined) {
    const name = nameOf(at.headingTags, searched);
    if (name) {
      headings.unshift({ tag: name, at: { filePath: at.filePath, line: at.startLine } });
    }
  }
  const top = file ? nameOf(file.frontmatterTags, searched) : undefined;
  const path = top && file ? [{ tag: top, at: { filePath: file.filePath, line: 0 } }, ...headings] : headings;
  // A heading that repeats the level above it is the same level.
  return path.filter((step, at) => at === 0 || step.tag.key !== path[at - 1].tag.key).slice(0, HEADING_DEPTH);
}

/** Where a note sits: its own heading's level, under the levels above it. */
function notePath(index: WorkspaceIndex, note: GroupedNote, searched: ReadonlySet<string>): Step[] {
  if (note.section) {
    return sectionPath(index, note.section, index.files.get(note.section.filePath), searched);
  }
  return sectionPath(index, undefined, note.file, searched);
}

/** Where a task sits: under the heading it is written beneath. */
function taskPath(index: WorkspaceIndex, task: Task, searched: ReadonlySet<string>): Step[] {
  const section = task.sectionId ? index.sections.get(task.sectionId) : undefined;
  return sectionPath(index, section, index.files.get(task.filePath), searched);
}

/**
 * A level's notes and tasks, its own and every level's inside it, and how
 * far along the tasks are: how many are done of those that count, all but
 * the cancelled ones.
 */
export function countGroup<N extends GroupedNote>(group: HeadingGroup<N>): { notes: number; tasks: number; done: number; counted: number } {
  const own = countTaskProgress(group.tasks);
  return group.children.reduce(
    (sum, child) => {
      const inner = countGroup(child);
      return { notes: sum.notes + inner.notes, tasks: sum.tasks + inner.tasks, done: sum.done + inner.done, counted: sum.counted + inner.counted };
    },
    { notes: group.notes.length, tasks: group.tasks.length, done: own.done, counted: own.total },
  );
}

/** In the order the notes first write each level's heading. */
function sortLevels<N extends GroupedNote>(groups: Array<HeadingGroup<N>>): Array<HeadingGroup<N>> {
  groups.sort((left, right) => left.at.filePath.localeCompare(right.at.filePath) || left.at.line - right.at.line);
  groups.forEach((group) => sortLevels(group.children));
  return groups;
}

/**
 * The results nested by heading, in their own order within each level, the
 * levels in the order the notes write them, then the results under no
 * tagged heading. `searched` holds the keys of the tags the search names,
 * which name no level.
 */
export function groupByHeading<N extends GroupedNote>(
  index: WorkspaceIndex,
  searched: ReadonlySet<string>,
  notes: readonly N[],
  tasks: readonly Task[],
): Array<HeadingGroup<N>> {
  const roots: Array<HeadingGroup<N>> = [];
  const loose: HeadingGroup<N> = { key: '', label: '', notes: [], tasks: [], children: [], at: { filePath: '', line: 0 } };
  const levelFor = (path: readonly Step[]): HeadingGroup<N> => {
    if (!path.length) {
      return loose;
    }
    let siblings = roots;
    let level: HeadingGroup<N> | undefined;
    for (const step of path) {
      level = siblings.find((candidate) => candidate.key === step.tag.key);
      if (!level) {
        level = { key: step.tag.key, label: step.tag.label, notes: [], tasks: [], children: [], at: step.at };
        siblings.push(level);
      } else if (isBefore(step.at, level.at)) {
        level.at = step.at;
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
