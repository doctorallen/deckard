/**
 * The workspace index exactly as Deckard built it before the index became a
 * fold of each note's contribution (dev at 0958f97, `buildWorkspaceIndex` in
 * `src/core/workspace/indexer.ts`), kept so the equivalence test can hold the
 * new build to the old one. Do not change it: it is the reference.
 */
import { getEntityKind } from '../../domain/markdown/parser';
import {
  Entity,
  ParsedFile,
  Section,
  TagAssociation,
  TagInfo,
  TagReference,
  Task,
  WorkspaceIndex,
} from '../../core/types';

export function buildLegacyWorkspaceIndex(
  files: Map<string, ParsedFile>,
): WorkspaceIndex {
  const sections = new Map<string, Section>();
  const tasks = new Map<string, Task>();
  const tags = new Map<string, TagInfo>();
  const entities = new Map<string, Entity>();
  const hubFilePaths = new Map<string, string[]>();

  files.forEach((file) => {
    file.hub?.describes.forEach((tagReference) => {
      hubFilePaths.set(tagReference.key, [
        ...(hubFilePaths.get(tagReference.key) ?? []),
        file.filePath,
      ]);
    });
    file.sections.forEach((section) => {
      sections.set(section.id, section);
      // A tag written on one of the section's own body lines finds the
      // section too: the tag stayed on its line, and the section is what
      // holds the line.
      const bodyTagLabels = new Map(
        (section.bodyTags ?? []).map((tag) => [tag.key, tag.label]),
      );
      const tagKeys = [
        ...new Set([...section.tags, ...bodyTagLabels.keys()]),
      ];
      tagKeys.forEach((tagKey) => {
        const label =
          section.tagLabels[tagKey] ?? bodyTagLabels.get(tagKey) ?? tagKey;
        const tag = getOrCreateTag(tags, tagKey, label);
        tag.sectionIds.push(section.id);
        addEntityReference(
          entities,
          tagKey,
          label,
          'section',
          section.id,
          section.updatedAt,
        );
      });
    });
    file.tasks.forEach((task) => {
      tasks.set(task.id, task);
      task.tags.forEach((tagKey) => {
        const tag = getOrCreateTag(tags, tagKey, task.tagLabels[tagKey]);
        tag.taskIds.push(task.id);
        addEntityReference(
          entities,
          tagKey,
          task.tagLabels[tagKey] ?? tagKey,
          'task',
          task.id,
          task.updatedAt,
        );
      });
    });
    const contentTagKeys = new Set([
      ...file.sections.flatMap((section) => section.tags),
      ...file.tasks.flatMap((task) => task.tags),
    ]);
    file.frontmatterTags.forEach((tagReference) => {
      if (contentTagKeys.has(tagReference.key)) {
        return;
      }
      const tag = getOrCreateTag(tags, tagReference.key, tagReference.label);
      if (!tag.filePaths.includes(file.filePath)) {
        tag.filePaths.push(file.filePath);
      }
      addEntityReference(
        entities,
        tagReference.key,
        tagReference.label,
        'file',
        file.filePath,
        file.updatedAt,
      );
    });
  });

  const { tagAssociations } = buildTagAssociations(sections, tasks);

  tags.forEach((tag) => {
    // A task inside a tagged section is already represented by that section;
    // count it separately only when its tag would otherwise have no entry.
    const taggedSections = new Set(tag.sectionIds);
    const standaloneTasks = tag.taskIds.filter((taskId) => {
      const task = tasks.get(taskId);
      return !task?.sectionId || !taggedSections.has(task.sectionId);
    });
    tag.count =
      taggedSections.size + standaloneTasks.length + tag.filePaths.length;
  });
  // The first note by path is the tag's hub; any others are shown as conflicts.
  hubFilePaths.forEach((filePaths, tagKey) => {
    const tag = tags.get(tagKey);
    if (tag) {
      tag.hubFilePaths = [...filePaths].sort((left, right) =>
        left.localeCompare(right),
      );
    }
  });
  entities.forEach((entity) => {
    const entitySections = new Set(entity.sectionIds);
    const standaloneTasks = entity.taskIds.filter((taskId) => {
      const task = tasks.get(taskId);
      return !task?.sectionId || !entitySections.has(task.sectionId);
    });
    entity.count =
      entitySections.size + standaloneTasks.length + entity.filePaths.length;
  });

  return {
    files,
    sections,
    tasks,
    tags,
    entities,
    tagAssociations,
    updatedAt: Date.now(),
  };
}

/**
 * Combines explicit same-source associations with heading proximity.
 *
 * Same-source tags are strongest because the author wrote them together. Tags
 * on ancestor headings provide weaker context that decays by outline depth.
 */
function buildTagAssociations(
  sections: Map<string, Section>,
  tasks: Map<string, Task>,
): {
  tagAssociations: Map<string, TagAssociation[]>;
} {
  const associations = new Map<string, MutableTagAssociation>();
  const sourceUnits = new Map<string, TagReference[]>();
  sections.forEach((section) => {
    (section.associationTagGroups ?? []).forEach((tags, index) => {
      const unitId = `section:${section.id}:group:${index}`;
      registerSourceUnit(sourceUnits, unitId, tags);
      addAssociationGroup(associations, tags, { sectionId: section.id, unitId });
    });
    addHeadingAssociations(associations, sourceUnits, section, sections);
  });
  tasks.forEach((task) => {
    (task.associationTagGroups ?? []).forEach((tags, index) => {
      const unitId = `task:${task.id}:group:${index}`;
      registerSourceUnit(sourceUnits, unitId, tags);
      addAssociationGroup(associations, tags, { taskId: task.id, unitId });
    });
  });

  const tagSourceUnitCounts = getTagSourceUnitCounts(sourceUnits);
  const tagAssociations = new Map<string, TagAssociation[]>();
  [...associations.entries()]
    .map(([key, relationship]) => {
      const [tagKey] = key.split('\u0000');
      const tagSourceUnitCount = tagSourceUnitCounts.get(tagKey) ?? 0;
      const associatedTagSourceUnitCount =
        tagSourceUnitCounts.get(relationship.associatedTag.key) ?? 0;
      return {
        key,
        ...relationship,
        count: relationship.sourceUnitIds.size,
        normalizedWeight: getNormalizedAssociationWeight(
          relationship.weight,
          relationship.sourceUnitIds.size,
          tagSourceUnitCount,
          associatedTagSourceUnitCount,
        ),
        tagSourceUnitCount,
        associatedTagSourceUnitCount,
        totalSourceUnitCount: sourceUnits.size,
      };
    })
    .sort(
      (left, right) =>
        right.coOccurrenceCount - left.coOccurrenceCount ||
        right.weight - left.weight ||
        left.associatedTag.label.localeCompare(right.associatedTag.label) ||
        left.associatedTag.key.localeCompare(right.associatedTag.key),
    )
    .forEach(({ key, ...relationship }) =>
      appendAssociation(tagAssociations, key.split('\u0000')[0], relationship),
    );
  return { tagAssociations };
}

interface MutableTagAssociation extends Omit<TagAssociation,
  | 'count'
  | 'normalizedWeight'
  | 'tagSourceUnitCount'
  | 'associatedTagSourceUnitCount'
  | 'totalSourceUnitCount'> {
  sourceUnitIds: Set<string>;
}

function addAssociationGroup(
  associations: Map<string, MutableTagAssociation>,
  tags: TagReference[],
  source: { sectionId?: string; taskId?: string; unitId: string },
): void {
  const uniqueTags = [...new Map(tags.map((tag) => [tag.key, tag])).values()];
  uniqueTags.forEach((tag, index) => {
    uniqueTags.slice(index + 1).forEach((associatedTag) => {
      addAssociationEvidence(associations, tag, associatedTag, source, 1, true);
      addAssociationEvidence(associations, associatedTag, tag, source, 1, true);
    });
  });
}

function addHeadingAssociations(
  associations: Map<string, MutableTagAssociation>,
  sourceUnits: Map<string, TagReference[]>,
  section: Section,
  sections: Map<string, Section>,
): void {
  const sourceTags = section.headingTags ?? [];
  if (sourceTags.length === 0) {
    return;
  }

  let parentSectionId = section.parentSectionId;
  let depth = 1;
  const visited = new Set<string>();
  while (parentSectionId && !visited.has(parentSectionId)) {
    visited.add(parentSectionId);
    const parent = sections.get(parentSectionId);
    if (!parent) {
      break;
    }
    (parent.headingTags ?? []).forEach((parentTag) => {
      sourceTags.forEach((childTag) => {
        const unitId = `heading:${section.id}:${parent.id}`;
        registerSourceUnit(sourceUnits, unitId, [...sourceTags, ...parent.headingTags ?? []]);
        addAssociationEvidence(
          associations,
          childTag,
          parentTag,
          { sectionId: section.id, unitId },
          0.5 / depth,
          false,
        );
        addAssociationEvidence(
          associations,
          parentTag,
          childTag,
          { sectionId: section.id, unitId },
          0.5 / depth,
          false,
        );
      });
    });
    parentSectionId = parent.parentSectionId;
    depth += 1;
  }
}

function addAssociationEvidence(
  associations: Map<string, MutableTagAssociation>,
  tag: TagReference,
  associatedTag: TagReference,
  source: { sectionId?: string; taskId?: string; unitId: string },
  weight: number,
  isCoOccurrence: boolean,
): void {
  if (tag.key === associatedTag.key) {
    return;
  }
  const key = `${tag.key}\u0000${associatedTag.key}`;
  const relationship = associations.get(key) ?? {
    associatedTag: { ...associatedTag },
    sectionIds: [],
    taskIds: [],
    weight: 0,
    coOccurrenceCount: 0,
    headingRelationshipCount: 0,
    sourceUnitIds: new Set<string>(),
  };
  if (source.sectionId && !relationship.sectionIds.includes(source.sectionId)) {
    relationship.sectionIds.push(source.sectionId);
  }
  if (source.taskId && !relationship.taskIds.includes(source.taskId)) {
    relationship.taskIds.push(source.taskId);
  }
  relationship.sourceUnitIds.add(source.unitId);
  relationship.weight += weight;
  if (isCoOccurrence) {
    relationship.coOccurrenceCount += 1;
  } else {
    relationship.headingRelationshipCount += 1;
  }
  associations.set(key, relationship);
}

function registerSourceUnit(
  sourceUnits: Map<string, TagReference[]>,
  unitId: string,
  tags: TagReference[],
): void {
  if (!sourceUnits.has(unitId)) {
    sourceUnits.set(
      unitId,
      [...new Map(tags.map((tag) => [tag.key, tag])).values()],
    );
  }
}

function getTagSourceUnitCounts(
  sourceUnits: ReadonlyMap<string, TagReference[]>,
): Map<string, number> {
  const counts = new Map<string, number>();
  sourceUnits.forEach((tags) => {
    tags.forEach((tag) =>
      counts.set(tag.key, (counts.get(tag.key) ?? 0) + 1),
    );
  });
  return counts;
}

/**
 * Downweights a raw edge when either tag occurs in many authoring units while
 * retaining a useful score for a one-off, intentional pairing.
 */
function getNormalizedAssociationWeight(
  rawWeight: number,
  support: number,
  tagSourceUnitCount: number,
  associatedTagSourceUnitCount: number,
): number {
  if (rawWeight <= 0 || support <= 0) {
    return 0;
  }
  const prevalence = support / Math.max(
    1,
    tagSourceUnitCount,
    associatedTagSourceUnitCount,
  );
  const supportConfidence = support / (support + 1);
  return rawWeight * prevalence * (0.5 + supportConfidence / 2);
}

function appendAssociation(
  associations: Map<string, TagAssociation[]>,
  tagKey: string,
  association: TagAssociation,
): void {
  const existing = associations.get(tagKey);
  if (existing) {
    existing.push(association);
  } else {
    associations.set(tagKey, [association]);
  }
}

/**
 * Shares one tag record across section and task references by canonical key.
 */
function getOrCreateTag(
  tags: Map<string, TagInfo>,
  key: string,
  label = key,
): TagInfo {
  const existing = tags.get(key);
  if (existing) {
    return existing;
  }

  const tag: TagInfo = {
    key,
    label,
    sectionIds: [],
    taskIds: [],
    filePaths: [],
    count: 0,
    isFavorite: false,
  };
  tags.set(key, tag);
  return tag;
}

/**
 * Builds entity hubs directly from canonical tags without requiring a separate
 * source of truth beyond the Markdown note that carries the tag.
 */
function addEntityReference(
  entities: Map<string, Entity>,
  key: string,
  label: string,
  referenceType: 'section' | 'task' | 'file',
  referenceId: string,
  updatedAt: number | undefined,
): void {
  const kind = getEntityKind({ key, label });
  if (!kind) {
    return;
  }

  let entity = entities.get(key);
  if (!entity) {
    entity = {
      key,
      label,
      kind,
      name: getEntityName(label),
      sectionIds: [],
      taskIds: [],
      filePaths: [],
      count: 0,
      isFavorite: false,
      updatedAt,
    };
    entities.set(key, entity);
  }

  const references =
    referenceType === 'section'
      ? entity.sectionIds
      : referenceType === 'task'
        ? entity.taskIds
        : entity.filePaths;
  references.push(referenceId);
  if (updatedAt !== undefined && (entity.updatedAt ?? 0) < updatedAt) {
    entity.updatedAt = updatedAt;
  }
}

function getEntityName(label: string): string {
  const name = label.slice(1).split('/').at(-1) ?? label;
  return name.replaceAll('-', ' ');
}
