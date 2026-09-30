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

  const tagLabels = new Map<string, string>();
  const tagWeights = new Map<string, number>();
  const tagSources = new Map<string, EntryTagSource>();
  const addTag = (
    key: string,
    label: string,
    weight: number,
    source: string,
    context: EntryTagContext,
  ): void => {
    const currentWeight = tagWeights.get(key);
    if (currentWeight === undefined || weight > currentWeight) {
      tagLabels.set(key, label);
      tagWeights.set(key, weight);
      tagSources.set(key, { context, source });
    }
  };
  const explicitEntryTags =
    entry.associationTagGroups?.flat() ??
    ('headingTags' in entry ? (entry.headingTags ?? []) : []);
  explicitEntryTags.forEach((tag) =>
    addTag(
      tag.key,
      tag.label,
      1,
      'Written on the selected entry',
      'selected',
    ),
  );

  const sections = new Map(file.sections.map((section) => [section.id, section]));
  let parentSectionId =
    'heading' in entry ? entry.parentSectionId : entry.sectionId;
  let depth = 1;
  while (parentSectionId) {
    const parent = sections.get(parentSectionId);
    if (!parent) {
      break;
    }
    parent.headingTags?.forEach((tag) =>
      addTag(
        tag.key,
        tag.label,
        0.5 / depth,
        `Parent ancestry: ${depth === 1 ? 'one level up' : `${depth} levels up`} (0.5 / ${depth})`,
        'parent',
      ),
    );
    parentSectionId = parent.parentSectionId;
    depth += 1;
  }

  if ('heading' in entry) {
    const childrenByParent = new Map<string, Section[]>();
    const childItemsByParent = new Map<string, Section[]>();
    file.sections.forEach((section) => {
      if (!section.parentSectionId) {
        return;
      }
      if (section.isInline) {
        const childItems = childItemsByParent.get(section.parentSectionId) ?? [];
        childItems.push(section);
        childItemsByParent.set(section.parentSectionId, childItems);
        return;
      }
      const children = childrenByParent.get(section.parentSectionId) ?? [];
      children.push(section);
      childrenByParent.set(section.parentSectionId, children);
    });
    const childTasksByParent = new Map<string, typeof file.tasks>();
    file.tasks.forEach((task) => {
      if (!task.sectionId) {
        return;
      }
      const childTasks = childTasksByParent.get(task.sectionId) ?? [];
      childTasks.push(task);
      childTasksByParent.set(task.sectionId, childTasks);
    });
    const visitedChildren = new Set<string>();
    const visitedChildItems = new Set<string>();
    const addChildItemTags = (
      tags: TagReference[],
      itemDepth: number,
    ): void => {
      const distance =
        itemDepth === 1
          ? 'one level down'
          : `${itemDepth} levels down`;
      tags.forEach((tag) =>
        addTag(
          tag.key,
          tag.label,
          0.5 / itemDepth,
          `Child item: ${distance} (0.5 / ${itemDepth})`,
          'childItem',
        ),
      );
    };
    const addChildItemContext = (
      parentId: string,
      itemDepth: number,
    ): void => {
      (childItemsByParent.get(parentId) ?? []).forEach((child) => {
        if (visitedChildItems.has(child.id)) {
          return;
        }
        visitedChildItems.add(child.id);
        addChildItemTags((child.associationTagGroups ?? []).flat(), itemDepth);
      });
      (childTasksByParent.get(parentId) ?? []).forEach((child) => {
        if (visitedChildItems.has(child.id)) {
          return;
        }
        visitedChildItems.add(child.id);
        addChildItemTags((child.associationTagGroups ?? []).flat(), itemDepth);
      });
    };
    const addChildContext = (parentId: string, childDepth: number): void => {
      addChildItemContext(parentId, childDepth + 1);
      (childrenByParent.get(parentId) ?? []).forEach((child) => {
        if (visitedChildren.has(child.id)) {
          return;
        }
        visitedChildren.add(child.id);
        (child.headingTags ?? []).forEach((tag) =>
          addTag(
            tag.key,
            tag.label,
            0.5 / childDepth,
            `Child heading: ${childDepth === 1 ? 'one level down' : `${childDepth} levels down`} (0.5 / ${childDepth})`,
            'child',
          ),
        );
        addChildContext(child.id, childDepth + 1);
      });
    };
    addChildContext(entry.id, 1);

    const section = {
      ...entry,
      tags: [...tagLabels.keys()],
      tagLabels: Object.fromEntries(tagLabels),
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
      tagWeights,
      tagSources,
    };
  }
  const task = {
    ...entry,
    tags: [...tagLabels.keys()],
    tagLabels: Object.fromEntries(tagLabels),
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
    tagWeights,
    tagSources,
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
