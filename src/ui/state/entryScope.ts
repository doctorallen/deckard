import { ParsedFile, Section, TagReference } from '../../core/types';

/**
 * The tagged entry a line belongs to: a task on that line with tags of its
 * own, or else the smallest tagged heading or inline section holding it.
 */
export function findTaggedEntry(file: ParsedFile, sourceLine: number) {
  const task = file.tasks.find(
    (candidate) =>
      candidate.lineNumber === sourceLine &&
      (candidate.associationTagGroups?.length ?? 0) > 0,
  );
  if (task) {
    return task;
  }
  return file.sections
    .filter(
      (section) =>
        section.startLine <= sourceLine &&
        section.endLine >= sourceLine &&
        ((section.headingTags?.length ?? 0) > 0 ||
          (section.isInline &&
            (section.associationTagGroups?.length ?? 0) > 0)),
    )
    .sort(
      (left, right) =>
        left.endLine - left.startLine - (right.endLine - right.startLine) ||
        right.startLine - left.startLine,
    )[0];
}

/**
 * The entry at a line as a note of its own, for ranking the notes related to
 * it: its text and the tags it carries, each weighted by where it came from
 * (the entry, a parent heading, a child heading, or a child item). Undefined
 * when no tagged entry holds the line.
 */
export function createEntryScope(
  file: ParsedFile,
  sourceLine: number,
): EntryScope | undefined {
  const entry = findTaggedEntry(file, sourceLine);
  if (!entry) {
    return undefined;
  }
  const tags = new EntryTags();
  const explicitEntryTags =
    entry.associationTagGroups?.flat() ??
    ('headingTags' in entry ? (entry.headingTags ?? []) : []);
  explicitEntryTags.forEach((tag) =>
    tags.add(tag, 1, 'Written on the selected entry', 'selected'),
  );
  addParentTags(tags, file, 'heading' in entry ? entry.parentSectionId : entry.sectionId);
  if ('heading' in entry) {
    addChildTags(tags, file, entry.id);
    return scopeOfSection(file, entry, tags);
  }
  return scopeOfTask(file, entry, tags);
}

/** The tagged entry a line belongs to, as findTaggedEntry finds it. */
type TaggedEntry = NonNullable<ReturnType<typeof findTaggedEntry>>;

/**
 * An entry's tags as they are gathered. A tag met again keeps the label,
 * weight, and source of its heaviest sighting; on a tie, the first.
 */
class EntryTags {
  public readonly labels = new Map<string, string>();
  public readonly weights = new Map<string, number>();
  public readonly sources = new Map<string, EntryTagSource>();

  /** Records a tag at a weight, unless it is already held at that weight or more. */
  public add(
    tag: Pick<TagReference, 'key' | 'label'>,
    weight: number,
    source: string,
    context: EntryTagContext,
  ): void {
    const currentWeight = this.weights.get(tag.key);
    if (currentWeight !== undefined && weight <= currentWeight) {
      return;
    }
    this.labels.set(tag.key, tag.label);
    this.weights.set(tag.key, weight);
    this.sources.set(tag.key, { context, source });
  }
}

/** The tags on each heading above the entry, weighted 0.5 / depth, nearest first. */
function addParentTags(
  tags: EntryTags,
  file: ParsedFile,
  firstParentId: string | undefined,
): void {
  const sections = new Map(file.sections.map((section) => [section.id, section]));
  let parentSectionId = firstParentId;
  let depth = 1;
  while (parentSectionId) {
    const parent = sections.get(parentSectionId);
    if (!parent) {
      break;
    }
    parent.headingTags?.forEach((tag) =>
      tags.add(
        tag,
        0.5 / depth,
        `Parent ancestry: ${depth === 1 ? 'one level up' : `${depth} levels up`} (0.5 / ${depth})`,
        'parent',
      ),
    );
    parentSectionId = parent.parentSectionId;
    depth += 1;
  }
}

/** A heading's children by kind: sub-headings, inline sections, and tasks, by parent id. */
interface ChildIndex {
  children: Map<string, Section[]>;
  childItems: Map<string, Section[]>;
  childTasks: Map<string, ParsedFile['tasks']>;
}

/** Indexes a note's sub-headings, inline sections, and tasks by the section that holds them. */
function indexChildren(file: ParsedFile): ChildIndex {
  const index: ChildIndex = { children: new Map(), childItems: new Map(), childTasks: new Map() };
  file.sections.forEach((section) => {
    if (!section.parentSectionId) {
      return;
    }
    const byParent = section.isInline ? index.childItems : index.children;
    const held = byParent.get(section.parentSectionId) ?? [];
    held.push(section);
    byParent.set(section.parentSectionId, held);
  });
  file.tasks.forEach((task) => {
    if (!task.sectionId) {
      return;
    }
    const childTasks = index.childTasks.get(task.sectionId) ?? [];
    childTasks.push(task);
    index.childTasks.set(task.sectionId, childTasks);
  });
  return index;
}

/**
 * The tags below a heading entry: each sub-heading's at 0.5 / depth, and
 * each inline item's and task's at 0.5 / depth one level further down,
 * walked depth first, every child once.
 */
function addChildTags(tags: EntryTags, file: ParsedFile, entryId: string): void {
  const { children, childItems, childTasks } = indexChildren(file);
  const visitedChildren = new Set<string>();
  const visitedChildItems = new Set<string>();
  const addItemTags = (
    items: ReadonlyArray<{ id: string; associationTagGroups?: TagReference[][] }>,
    itemDepth: number,
  ): void => {
    items.forEach((child) => {
      if (visitedChildItems.has(child.id)) {
        return;
      }
      visitedChildItems.add(child.id);
      const distance = itemDepth === 1 ? 'one level down' : `${itemDepth} levels down`;
      (child.associationTagGroups ?? []).flat().forEach((tag) =>
        tags.add(tag, 0.5 / itemDepth, `Child item: ${distance} (0.5 / ${itemDepth})`, 'childItem'),
      );
    });
  };
  const addChildContext = (parentId: string, childDepth: number): void => {
    addItemTags(childItems.get(parentId) ?? [], childDepth + 1);
    addItemTags(childTasks.get(parentId) ?? [], childDepth + 1);
    (children.get(parentId) ?? []).forEach((child) => {
      if (visitedChildren.has(child.id)) {
        return;
      }
      visitedChildren.add(child.id);
      (child.headingTags ?? []).forEach((tag) =>
        tags.add(
          tag,
          0.5 / childDepth,
          `Child heading: ${childDepth === 1 ? 'one level down' : `${childDepth} levels down`} (0.5 / ${childDepth})`,
          'child',
        ),
      );
      addChildContext(child.id, childDepth + 1);
    });
  };
  addChildContext(entryId, 1);
}

/** A heading entry as a note of its own: the section, carrying every gathered tag, and its tasks. */
function scopeOfSection(file: ParsedFile, entry: Section, tags: EntryTags): EntryScope {
  const section = {
    ...entry,
    tags: [...tags.labels.keys()],
    tagLabels: Object.fromEntries(tags.labels),
  };
  return {
    file: {
      ...file,
      content: entry.rawContent,
      sections: [section],
      tasks: file.tasks.filter((task) => task.sectionId === entry.id),
      frontmatterTags: [],
      links: entry.links,
    },
    tagWeights: tags.weights,
    tagSources: tags.sources,
  };
}

/** A task entry as a note of its own: the one task, carrying every gathered tag. */
function scopeOfTask(
  file: ParsedFile,
  entry: Exclude<TaggedEntry, Section>,
  tags: EntryTags,
): EntryScope {
  const task = {
    ...entry,
    tags: [...tags.labels.keys()],
    tagLabels: Object.fromEntries(tags.labels),
  };
  return {
    file: {
      ...file,
      content: entry.sourceLineText,
      sections: [],
      tasks: [task],
      frontmatterTags: [],
      links: [],
    },
    tagWeights: tags.weights,
    tagSources: tags.sources,
  };
}

/** An entry cut out of its note, with the weight and origin of each of its tags. */
export interface EntryScope {
  file: ParsedFile;
  tagWeights: ReadonlyMap<string, number>;
  tagSources: ReadonlyMap<string, EntryTagSource>;
}

/** Where an entry's tag was written, relative to the entry. */
export type EntryTagContext =
  | 'selected'
  | 'parent'
  | 'child'
  | 'childItem';

/** Where one of an entry's tags came from, and the sentence that says so. */
export interface EntryTagSource {
  context: EntryTagContext;
  source: string;
}
