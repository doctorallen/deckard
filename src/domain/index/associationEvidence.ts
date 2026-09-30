import type { Section, TagReference, Task } from '../model';

/**
 * How the index finds evidence that two tags are related, walked once for
 * both ways the index is built.
 *
 * The fold works out each note's evidence on its own; the direct build,
 * used while two entries share an id, works it out over the whole workspace
 * at once. The two must find the same evidence in the same order, or the
 * fallback stops being equal to the fold. So both walk with this one
 * function and differ only in what they keep: each passes its own sink.
 */

/** Where one piece of association evidence was found, and what it weighs. */
export interface EvidenceSource {
  /** The section that holds it; absent for a task's. */
  readonly sectionId?: string;
  /** The task that holds it; absent for a section's. */
  readonly taskId?: string;
  /** The authoring unit it came from: one tag group, or one heading under one of its ancestors. */
  readonly unitId: string;
  /** 1 for tags on one line; 0.5 over the depth for a heading's tags under an ancestor's. */
  readonly weight: number;
  /** Whether the tags share a line, rather than a heading and its ancestor. */
  readonly isCoOccurrence: boolean;
}

/** What a walk tells as it goes: each authoring unit, then the evidence it holds. */
export interface AssociationSink {
  /**
   * An authoring unit and the tags in it. A unit can be told more than
   * once; the first telling is the one that counts.
   */
  register(unitId: string, tags: readonly TagReference[]): void;
  /** Evidence that `tag` is related to `associatedTag`, which is never the same tag. */
  evidence(tag: TagReference, associatedTag: TagReference, source: EvidenceSource): void;
}

/**
 * Walks the sections, then the tasks, telling `sink` of every authoring unit
 * and every piece of evidence in the order the index has always met them:
 * for each section, each of its tag groups, then its heading's tags against
 * each tagged heading above it, nearest first; then each task's tag groups.
 * Each pair of tags is told both ways, `a` to `b` and then `b` to `a`.
 *
 * `sectionById` finds a section's parent. The fold passes the note's own
 * sections; the direct build, every section in the workspace.
 */
export function collectAssociationEvidence(
  sections: Iterable<Section>,
  tasks: Iterable<Task>,
  sink: AssociationSink,
  sectionById: ReadonlyMap<string, Section>,
): void {
  for (const section of sections) {
    (section.associationTagGroups ?? []).forEach((tags, index) => {
      const unitId = `section:${section.id}:group:${index}`;
      sink.register(unitId, tags);
      collectGroup(tags, { sectionId: section.id, unitId, weight: 1, isCoOccurrence: true }, sink);
    });
    collectAncestorEvidence(section, sectionById, sink);
  }
  for (const task of tasks) {
    (task.associationTagGroups ?? []).forEach((tags, index) => {
      const unitId = `task:${task.id}:group:${index}`;
      sink.register(unitId, tags);
      collectGroup(tags, { taskId: task.id, unitId, weight: 1, isCoOccurrence: true }, sink);
    });
  }
}

/**
 * A section's heading tags against the heading tags of each ancestor, the
 * nearest first, weighing each ancestor less the further up it is. A loop
 * in the parents, or a parent the map does not hold, ends the walk.
 */
function collectAncestorEvidence(
  section: Section,
  sectionById: ReadonlyMap<string, Section>,
  sink: AssociationSink,
): void {
  if ((section.headingTags ?? []).length === 0) {
    return;
  }
  let parentSectionId = section.parentSectionId;
  let depth = 1;
  const visited = new Set<string>();
  while (parentSectionId && !visited.has(parentSectionId)) {
    visited.add(parentSectionId);
    const parent = sectionById.get(parentSectionId);
    if (!parent) {
      break;
    }
    collectHeadingPairs(section, parent, depth, sink);
    parentSectionId = parent.parentSectionId;
    depth += 1;
  }
}

/** Each of a heading's tags against each of one ancestor's, as one authoring unit. */
function collectHeadingPairs(
  section: Section,
  parent: Section,
  depth: number,
  sink: AssociationSink,
): void {
  const childTags = section.headingTags ?? [];
  const parentTags = parent.headingTags ?? [];
  const unitId = `heading:${section.id}:${parent.id}`;
  const source: EvidenceSource = {
    sectionId: section.id,
    unitId,
    weight: 0.5 / depth,
    isCoOccurrence: false,
  };
  for (const parentTag of parentTags) {
    for (const childTag of childTags) {
      sink.register(unitId, [...childTags, ...parentTags]);
      offer(childTag, parentTag, source, sink);
      offer(parentTag, childTag, source, sink);
    }
  }
}

/**
 * Every pair among one group's tags, each tag taken once: in the place it
 * is first written, with the spelling it is last written with.
 */
function collectGroup(
  tags: readonly TagReference[],
  source: EvidenceSource,
  sink: AssociationSink,
): void {
  const uniqueTags = [...new Map(tags.map((tag) => [tag.key, tag])).values()];
  uniqueTags.forEach((tag, index) => {
    uniqueTags.slice(index + 1).forEach((associatedTag) => {
      offer(tag, associatedTag, source, sink);
      offer(associatedTag, tag, source, sink);
    });
  });
}

/** Tells the sink of one piece of evidence, unless it relates a tag to itself. */
function offer(
  tag: TagReference,
  associatedTag: TagReference,
  source: EvidenceSource,
  sink: AssociationSink,
): void {
  if (tag.key !== associatedTag.key) {
    sink.evidence(tag, associatedTag, source);
  }
}
