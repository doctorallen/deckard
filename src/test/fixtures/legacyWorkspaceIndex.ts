/**
 * The workspace index exactly as Deckard built it before the index became a
 * fold of each note's contribution (dev at 0958f97, `buildWorkspaceIndex` in
 * `src/core/workspace/indexer.ts`), kept so the equivalence test can hold the
 * new build to the old one. Do not change what it builds: it is the
 * reference.
 */
import { getEntityKind } from '../../domain/markdown/parser';
import { fileEntryId, groupEntryParts, isEntrySection } from '../../domain/markdown/noteEntries';
import {
  Entity,
  ParsedFile,
  Section,
  TagAssociation,
  TagInfo,
  TagReference,
  Task,
  WorkspaceIndex,
} from '../../domain/model';

/** The maps the legacy build fills as it reads each note. */
interface LegacyCollections {
  sections: Map<string, Section>;
  tasks: Map<string, Task>;
  tags: Map<string, TagInfo>;
  entities: Map<string, Entity>;
  hubFilePaths: Map<string, string[]>;
}

/**
 * Builds the workspace index from parsed notes as the legacy build did: every
 * note's sections, tasks, front-matter tags, and hubs, then the tag
 * associations, each tag's and entity's count, and each tag's hubs.
 */
export function buildLegacyWorkspaceIndex(
  files: Map<string, ParsedFile>,
): WorkspaceIndex {
  const collections: LegacyCollections = {
    sections: new Map<string, Section>(),
    tasks: new Map<string, Task>(),
    tags: new Map<string, TagInfo>(),
    entities: new Map<string, Entity>(),
    hubFilePaths: new Map<string, string[]>(),
  };
  const { sections, tasks, tags, entities, hubFilePaths } = collections;

  files.forEach((file) => {
    file.hub?.describes.forEach((tagReference) => {
      hubFilePaths.set(tagReference.key, [
        ...(hubFilePaths.get(tagReference.key) ?? []),
        file.filePath,
      ]);
    });
    collectSections(file, collections);
    collectTasks(file, collections);
    collectFrontmatterTags(file, collections);
  });

  const { tagAssociations } = buildTagAssociations(sections, tasks);

  countTags(tags, tasks);
  // The first note by path is the tag's hub; any others are shown as conflicts.
  hubFilePaths.forEach((filePaths, tagKey) => {
    const tag = tags.get(tagKey);
    if (tag) {
      tag.hubFilePaths = [...filePaths].sort((left, right) =>
        left.localeCompare(right),
      );
    }
  });
  countEntities(entities, tasks);

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

/** Adds a note's sections, and the tags and entities each one carries. */
function collectSections(file: ParsedFile, { sections, tags, entities }: LegacyCollections): void {
  file.sections.forEach((section) => sections.set(section.id, section));
  // A note is an entry (noteEntries.ts): only entries are a tag's members,
  // and the body tags of every heading an entry owns count for it.
  const parts = groupEntryParts(file.sections);
  file.sections.filter(isEntrySection).forEach((section) => {
    // A tag written on one of the entry's body lines finds the entry too:
    // the tag stayed on its line, and the entry is what holds the line.
    const bodyTagLabels = new Map(
      (parts.get(section.id) ?? [section]).flatMap((part) => part.bodyTags ?? []).map((tag) => [tag.key, tag.label]),
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
        { key: tagKey, label },
        { type: 'section', id: section.id, updatedAt: section.updatedAt },
      );
    });
  });
}

/** Adds a note's tasks, and the tags and entities each one carries. */
function collectTasks(file: ParsedFile, { tasks, tags, entities }: LegacyCollections): void {
  file.tasks.forEach((task) => {
    tasks.set(task.id, task);
    task.tags.forEach((tagKey) => {
      const tag = getOrCreateTag(tags, tagKey, task.tagLabels[tagKey]);
      tag.taskIds.push(task.id);
      addEntityReference(
        entities,
        { key: tagKey, label: task.tagLabels[tagKey] ?? tagKey },
        { type: 'task', id: task.id, updatedAt: task.updatedAt },
      );
    });
  });
}

/**
 * Adds a note's front-matter tags to the note's own path, leaving out a tag
 * one of its sections or tasks already carries.
 */
function collectFrontmatterTags(file: ParsedFile, { tags, entities }: LegacyCollections): void {
  // A note tagged in its front matter that owns its preamble or an untagged
  // heading is an entry of its own, with those headings' body tags.
  const parts = groupEntryParts(file.sections);
  const fileEntry = fileEntryId(file.filePath);
  const isFileEntry = file.frontmatterTags.length > 0 && (file.sections.length === 0 || parts.has(fileEntry));
  const contentTagKeys = new Set(isFileEntry ? [] : [
    ...file.sections.flatMap((section) => section.tags),
    ...file.tasks.flatMap((task) => task.tags),
  ]);
  const seen = new Set<string>();
  [
    ...file.frontmatterTags,
    ...(parts.get(fileEntry) ?? []).flatMap((part) => part.bodyTags ?? []).map((tag) => ({ key: tag.key, label: tag.label })),
  ].forEach((tagReference) => {
    if (contentTagKeys.has(tagReference.key) || seen.has(tagReference.key)) {
      return;
    }
    seen.add(tagReference.key);
    const tag = getOrCreateTag(tags, tagReference.key, tagReference.label);
    if (!tag.filePaths.includes(file.filePath)) {
      tag.filePaths.push(file.filePath);
    }
    addEntityReference(
      entities,
      tagReference,
      { type: 'file', id: file.filePath, updatedAt: file.updatedAt },
    );
  });
}

/**
 * Counts each tag's sections, its notes, and the tasks no section it tags
 * already holds.
 */
function countTags(tags: Map<string, TagInfo>, tasks: Map<string, Task>): void {
  tags.forEach((tag) => {
    // A task inside a tagged section is already represented by that section;
    // count it separately only when its tag would otherwise have no entry.
    const taggedEntries = new Set([...tag.sectionIds, ...tag.filePaths.map(fileEntryId)]);
    const standaloneTasks = tag.taskIds.filter((taskId) => {
      const task = tasks.get(taskId);
      const owner = task?.entryId ?? task?.sectionId;
      return !owner || !taggedEntries.has(owner);
    });
    tag.count =
      tag.sectionIds.length + standaloneTasks.length + tag.filePaths.length;
  });
}

/** Counts each entity's references as countTags counts a tag's. */
function countEntities(entities: Map<string, Entity>, tasks: Map<string, Task>): void {
  entities.forEach((entity) => {
    const entityEntries = new Set([...entity.sectionIds, ...entity.filePaths.map(fileEntryId)]);
    const standaloneTasks = entity.taskIds.filter((taskId) => {
      const task = tasks.get(taskId);
      const owner = task?.entryId ?? task?.sectionId;
      return !owner || !entityEntries.has(owner);
    });
    entity.count =
      entity.sectionIds.length + standaloneTasks.length + entity.filePaths.length;
  });
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

/** Pairs every tag of a group written together with every other, both ways. */
function addAssociationGroup(
  associations: Map<string, MutableTagAssociation>,
  tags: TagReference[],
  source: { sectionId?: string; taskId?: string; unitId: string },
): void {
  const uniqueTags = [...new Map(tags.map((tag) => [tag.key, tag])).values()];
  uniqueTags.forEach((tag, index) => {
    uniqueTags.slice(index + 1).forEach((associatedTag) => {
      addAssociationEvidence(associations, [tag, associatedTag], source, { weight: 1, isCoOccurrence: true });
      addAssociationEvidence(associations, [associatedTag, tag], source, { weight: 1, isCoOccurrence: true });
    });
  });
}

/**
 * Pairs a heading's tags with the tags of every heading above it, both
 * ways, weighted down by how many levels up each one is.
 */
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
          [childTag, parentTag],
          { sectionId: section.id, unitId },
          { weight: 0.5 / depth, isCoOccurrence: false },
        );
        addAssociationEvidence(
          associations,
          [parentTag, childTag],
          { sectionId: section.id, unitId },
          { weight: 0.5 / depth, isCoOccurrence: false },
        );
      });
    });
    parentSectionId = parent.parentSectionId;
    depth += 1;
  }
}

/**
 * Adds one piece of evidence that a tag goes with another, in that
 * direction: a pair written together, or a heading tag under another.
 */
function addAssociationEvidence(
  associations: Map<string, MutableTagAssociation>,
  [tag, associatedTag]: [TagReference, TagReference],
  source: { sectionId?: string; taskId?: string; unitId: string },
  { weight, isCoOccurrence }: { weight: number; isCoOccurrence: boolean },
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

/** Records the tags of one authoring unit once, each tag once, the first time the unit is seen. */
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

/** How many authoring units each tag appears in. */
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

/** Adds an association to a tag's list, starting the list when it has none. */
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
  { key, label }: { key: string; label: string },
  reference: { type: 'section' | 'task' | 'file'; id: string; updatedAt: number | undefined },
): void {
  const { updatedAt } = reference;
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

  const references = {
    section: entity.sectionIds,
    task: entity.taskIds,
    file: entity.filePaths,
  }[reference.type];
  references.push(reference.id);
  if (updatedAt !== undefined && (entity.updatedAt ?? 0) < updatedAt) {
    entity.updatedAt = updatedAt;
  }
}

/** An entity's name: the last part of its label, without the mark, with hyphens as spaces. */
function getEntityName(label: string): string {
  const name = label.slice(1).split('/').at(-1) ?? label;
  return name.replaceAll('-', ' ');
}
