import { ParsedFile, Section, Task, TagAssociation, WorkspaceIndex } from '../../domain/model';

/**
 * Whether an entry carries a tag the way a multi-tag overview counts it, and
 * the tags associated with every one of several tags. Refine and Stats both
 * count by these, so a number in one is the number in the other.
 */

/**
 * Keeps tags independently associated with every active overview tag. The
 * lowest relationship strength expresses the limiting side of that context.
 */
export function getSharedTagAssociations(
  index: WorkspaceIndex,
  activeTagKeys: string[],
): TagAssociation[] {
  const associationsByTagKey = new Map<string, TagAssociation[]>();
  activeTagKeys.forEach((activeTagKey) => {
    (index.tagAssociations?.get(activeTagKey) ?? []).forEach(
      (association) => {
        const associatedTagKey = association.associatedTag.key;
        if (activeTagKeys.includes(associatedTagKey)) {
          return;
        }
        const matches = associationsByTagKey.get(associatedTagKey) ?? [];
        matches.push(association);
        associationsByTagKey.set(associatedTagKey, matches);
      },
    );
  });

  return [...associationsByTagKey.values()]
    .filter((associations) => associations.length === activeTagKeys.length)
    .map((associations) => {
      const [first, ...rest] = associations;
      const minimum = (
        value: (association: TagAssociation) => number,
      ): number => Math.min(...associations.map(value));
      return {
        ...first,
        associatedTag: { ...first.associatedTag },
        sectionIds: first.sectionIds.filter((sectionId) =>
          rest.every((association) => association.sectionIds.includes(sectionId)),
        ),
        taskIds: first.taskIds.filter((taskId) =>
          rest.every((association) => association.taskIds.includes(taskId)),
        ),
        count: minimum((association) => association.count),
        weight: minimum((association) => association.weight),
        normalizedWeight: minimum(
          (association) => association.normalizedWeight,
        ),
        tagSourceUnitCount: minimum(
          (association) => association.tagSourceUnitCount,
        ),
        associatedTagSourceUnitCount: minimum(
          (association) => association.associatedTagSourceUnitCount,
        ),
        totalSourceUnitCount: minimum(
          (association) => association.totalSourceUnitCount,
        ),
        coOccurrenceCount: minimum(
          (association) => association.coOccurrenceCount,
        ),
        headingRelationshipCount: minimum(
          (association) => association.headingRelationshipCount,
        ),
      };
    })
    .filter((association) =>
      hasAllTagOverviewEntries(
        index,
        [...activeTagKeys, association.associatedTag.key],
      ),
    );
}

/**
 * Offers only association filters that can produce an entry under the same
 * structural all-tag matching rules used by a multi-tag overview.
 */
function hasAllTagOverviewEntries(
  index: WorkspaceIndex,
  tagKeys: string[],
): boolean {
  return (
    [...index.sections.values()].some((section) =>
      tagKeys.every((tagKey) => sectionIncludesTag(index, section, tagKey)),
    ) ||
    [...index.tasks.values()].some((task) =>
      tagKeys.every((tagKey) => taskIncludesTag(index, task, tagKey)),
    )
  );
}

/** Whether a section carries a tag itself or under a heading above it. */
export function sectionIncludesTag(
  index: WorkspaceIndex,
  section: Section,
  tagKey: string,
): boolean {
  if (section.tags.includes(tagKey)) {
    return true;
  }

  let parentSectionId = section.parentSectionId;
  while (parentSectionId) {
    const parent = index.sections.get(parentSectionId);
    if (!parent) {
      break;
    }
    if (parent.headingTags?.some((tag) => tag.key === tagKey)) {
      return true;
    }
    parentSectionId = parent.parentSectionId;
  }
  return false;
}

/** Whether a task carries a tag on its line or under the headings it sits beneath. */
export function taskIncludesTag(
  index: WorkspaceIndex,
  task: Task,
  tagKey: string,
): boolean {
  if (task.tags.includes(tagKey)) {
    return true;
  }
  const section = task.sectionId
    ? index.sections.get(task.sectionId)
    : undefined;
  return section ? sectionIncludesTag(index, section, tagKey) : false;
}

/** Whether a note carries a tag in its front matter, or any of its sections or tasks does. */
export function fileIncludesTag(
  index: WorkspaceIndex,
  file: ParsedFile,
  tagKey: string,
): boolean {
  return (
    file.frontmatterTags.some((tag) => tag.key === tagKey) ||
    file.sections.some((section) => sectionIncludesTag(index, section, tagKey)) ||
    file.tasks.some((task) => taskIncludesTag(index, task, tagKey))
  );
}
