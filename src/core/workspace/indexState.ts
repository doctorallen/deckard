import { getEntityKind } from '../markdown/parser';
import {
  Entity,
  EntityKind,
  ParsedFile,
  Section,
  TagAssociation,
  TagInfo,
  TagReference,
  Task,
  WorkspaceIndex,
} from '../types';

/**
 * The workspace index as a fold over each note's own contribution.
 *
 * Everything the index holds about a tag — its entries, its count, its
 * entity, its hub notes, and what it is associated with — is the sum of what
 * each note says about it, taken in the order of the notes map. So each note's
 * part is worked out once, on its own, and the index is those parts folded
 * together in order. A full build computes every part and folds; an update
 * recomputes only the saved notes' parts and folds again, reusing everything
 * a change to those notes cannot touch. The same code does both, and
 * `index-equivalence.test.ts` holds an update to a full build, map order
 * included.
 *
 * The one thing a note's part cannot know on its own is whether another note
 * uses one of its ids: the index keys entries by id, so a repeated id makes
 * one entry replace another across notes. Ids are hashed from the path, line,
 * and text, so this takes a hash collision; when it happens, the index is
 * built the direct way, note by note over the whole workspace, as it always
 * was, until the repeat goes away.
 */

/** One tag written in a note, in the order the index meets it. */
interface TagOp {
  key: string;
  /** The spelling the tag record takes when this is its first mention. */
  label: string;
  type: 'section' | 'task' | 'file';
  /** The section id, task id, or file path the mention belongs to. */
  reference: string;
  updatedAt: number | undefined;
  /** The entity the tag names, spelled this way, if it names one. */
  entityKind: EntityKind | undefined;
}

/** What one note says about how one tag relates to another. */
interface PairPart {
  /** Heading-phase evidence weights, in order, so the sum can be replayed. */
  sectionWeights: number[];
  sectionCoOccurrences: number;
  headingRelationships: number;
  sectionIds: string[];
  /** Where in the note's heading phase the pair was first seen. */
  sectionFirst: number;
  sectionReference: TagReference | undefined;
  taskCoOccurrences: number;
  taskIds: string[];
  taskFirst: number;
  taskReference: TagReference | undefined;
  /** How many of the note's authoring units hold the pair. */
  units: number;
  /** The units themselves while the part is being counted. */
  unitIds?: Set<string>;
}

/** Everything one note adds to the index. */
export interface FileContribution {
  file: ParsedFile;
  /** Its tag mentions, in the order the index meets them. */
  ops: TagOp[];
  /** The same mentions grouped by tag, each group in mention order. */
  opsByKey: Map<string, TagOp[]>;
  /** Its tags, in first-mention order. */
  tagKeys: string[];
  /** Its tags that name an entity, in the order they first do. */
  entityKeys: string[];
  /** The tags its `describes:` names, repeats kept. */
  hubKeys: string[];
  /** Association evidence: tag -> associated tag -> this note's part. */
  pairs: Map<string, Map<string, PairPart>>;
  /** How many of its authoring units each tag appears in. */
  tagUnits: Map<string, number>;
  /** How many authoring units it has. */
  unitCount: number;
}

/** Works out one note's contribution. Pure: it reads only the note. */
export function computeContribution(file: ParsedFile): FileContribution {
  const ops: TagOp[] = [];
  const opsByKey = new Map<string, TagOp[]>();
  const tagKeys: string[] = [];
  const entityKeys: string[] = [];
  const seenEntities = new Set<string>();
  const addOp = (op: TagOp): void => {
    ops.push(op);
    const group = opsByKey.get(op.key);
    if (group) {
      group.push(op);
    } else {
      opsByKey.set(op.key, [op]);
      tagKeys.push(op.key);
    }
    if (op.entityKind && !seenEntities.has(op.key)) {
      seenEntities.add(op.key);
      entityKeys.push(op.key);
    }
  };

  file.sections.forEach((section) => {
    // A tag written on one of the section's own body lines finds the
    // section too: the tag stayed on its line, and the section is what
    // holds the line.
    const bodyTagLabels = new Map(
      (section.bodyTags ?? []).map((tag) => [tag.key, tag.label]),
    );
    const keys = [...new Set([...section.tags, ...bodyTagLabels.keys()])];
    keys.forEach((key) => {
      const label = section.tagLabels[key] ?? bodyTagLabels.get(key) ?? key;
      addOp({
        key,
        label,
        type: 'section',
        reference: section.id,
        updatedAt: section.updatedAt,
        entityKind: getEntityKind({ key, label }),
      });
    });
  });
  file.tasks.forEach((task) => {
    task.tags.forEach((key) => {
      const label = task.tagLabels[key] ?? key;
      addOp({
        key,
        label,
        type: 'task',
        reference: task.id,
        updatedAt: task.updatedAt,
        entityKind: getEntityKind({ key, label }),
      });
    });
  });
  const contentTagKeys = new Set([
    ...file.sections.flatMap((section) => section.tags),
    ...file.tasks.flatMap((task) => task.tags),
  ]);
  file.frontmatterTags.forEach((reference) => {
    if (contentTagKeys.has(reference.key)) {
      return;
    }
    addOp({
      key: reference.key,
      label: reference.label,
      type: 'file',
      reference: file.filePath,
      updatedAt: file.updatedAt,
      entityKind: getEntityKind({ key: reference.key, label: reference.label }),
    });
  });

  return {
    file,
    ops,
    opsByKey,
    tagKeys,
    entityKeys,
    hubKeys: (file.hub?.describes ?? []).map((reference) => reference.key),
    ...computeAssociationParts(file),
  };
}

/**
 * The note's association evidence, gathered exactly as the whole-workspace
 * pass gathers it — each tag group on a line, then each tagged heading
 * against the tagged headings above it, entry by entry, and the tasks' groups
 * after every entry — but kept per note.
 */
function computeAssociationParts(
  file: ParsedFile,
): Pick<FileContribution, 'pairs' | 'tagUnits' | 'unitCount'> {
  const pairs = new Map<string, Map<string, PairPart>>();
  const units = new Set<string>();
  const tagUnits = new Map<string, number>();
  const sections = new Map(file.sections.map((section) => [section.id, section]));
  let sequence = 0;

  const register = (unitId: string, tags: readonly TagReference[]): void => {
    if (units.has(unitId)) {
      return;
    }
    units.add(unitId);
    new Set(tags.map((tag) => tag.key)).forEach((key) =>
      tagUnits.set(key, (tagUnits.get(key) ?? 0) + 1),
    );
  };
  const evidence = (
    tag: TagReference,
    associatedTag: TagReference,
    source: { sectionId?: string; taskId?: string; unitId: string },
    weight: number,
    isCoOccurrence: boolean,
  ): void => {
    if (tag.key === associatedTag.key) {
      return;
    }
    let byAssociated = pairs.get(tag.key);
    if (!byAssociated) {
      byAssociated = new Map();
      pairs.set(tag.key, byAssociated);
    }
    let part = byAssociated.get(associatedTag.key);
    if (!part) {
      part = {
        sectionWeights: [],
        sectionCoOccurrences: 0,
        headingRelationships: 0,
        sectionIds: [],
        sectionFirst: -1,
        sectionReference: undefined,
        taskCoOccurrences: 0,
        taskIds: [],
        taskFirst: -1,
        taskReference: undefined,
        units: 0,
        unitIds: new Set(),
      };
      byAssociated.set(associatedTag.key, part);
    }
    if (source.taskId === undefined) {
      if (part.sectionFirst < 0) {
        part.sectionFirst = sequence;
        part.sectionReference = { ...associatedTag };
      }
      part.sectionWeights.push(weight);
      if (isCoOccurrence) {
        part.sectionCoOccurrences += 1;
      } else {
        part.headingRelationships += 1;
      }
      if (source.sectionId && !part.sectionIds.includes(source.sectionId)) {
        part.sectionIds.push(source.sectionId);
      }
    } else {
      if (part.taskFirst < 0) {
        part.taskFirst = sequence;
        part.taskReference = { ...associatedTag };
      }
      part.taskCoOccurrences += 1;
      if (!part.taskIds.includes(source.taskId)) {
        part.taskIds.push(source.taskId);
      }
    }
    part.unitIds?.add(source.unitId);
    sequence += 1;
  };
  const group = (
    tags: readonly TagReference[],
    source: { sectionId?: string; taskId?: string; unitId: string },
  ): void => {
    const uniqueTags = [...new Map(tags.map((tag) => [tag.key, tag])).values()];
    uniqueTags.forEach((tag, index) => {
      uniqueTags.slice(index + 1).forEach((associatedTag) => {
        evidence(tag, associatedTag, source, 1, true);
        evidence(associatedTag, tag, source, 1, true);
      });
    });
  };

  file.sections.forEach((section) => {
    (section.associationTagGroups ?? []).forEach((tags, index) => {
      const unitId = `section:${section.id}:group:${index}`;
      register(unitId, tags);
      group(tags, { sectionId: section.id, unitId });
    });
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
          register(unitId, [...sourceTags, ...(parent.headingTags ?? [])]);
          evidence(childTag, parentTag, { sectionId: section.id, unitId }, 0.5 / depth, false);
          evidence(parentTag, childTag, { sectionId: section.id, unitId }, 0.5 / depth, false);
        });
      });
      parentSectionId = parent.parentSectionId;
      depth += 1;
    }
  });
  file.tasks.forEach((task) => {
    (task.associationTagGroups ?? []).forEach((tags, index) => {
      const unitId = `task:${task.id}:group:${index}`;
      register(unitId, tags);
      group(tags, { taskId: task.id, unitId });
    });
  });

  pairs.forEach((byAssociated) =>
    byAssociated.forEach((part) => {
      part.units = part.unitIds?.size ?? 0;
      delete part.unitIds;
    }),
  );
  return { pairs, tagUnits, unitCount: units.size };
}

/**
 * The association evidence of a whole workspace at one moment. An update
 * makes a new one and leaves this one alone, so an index handed out earlier
 * keeps answering from the notes it was built from.
 */
interface AssociationGeneration {
  contributions: ReadonlyMap<string, FileContribution>;
  ordinals: ReadonlyMap<string, number>;
  /** Tag -> the notes with evidence about how it relates to other tags. */
  filesByTag: ReadonlyMap<string, ReadonlySet<string>>;
  tagUnits: ReadonlyMap<string, number>;
  totalUnits: number;
}

/** A finished association and where its pair was first seen. */
interface RankedAssociation {
  association: TagAssociation;
  /** Phase (headings, then tasks), note order, place in the note. */
  first: [number, number, number];
}

/**
 * A tag's associations, worked out the first time they are asked for.
 *
 * Related Notes and Home ask about a handful of tags; only the Notes Graph
 * reads them all, and it is not redrawn by a save that changes nothing it
 * draws. Each list is ranked as the whole-workspace pass ranks it, and
 * iteration visits tags in the order that pass first listed them.
 */
export class LazyTagAssociations implements ReadonlyMap<string, TagAssociation[]> {
  private readonly ranked = new Map<string, RankedAssociation[]>();
  private readonly lists = new Map<string, TagAssociation[]>();
  private everything: Map<string, TagAssociation[]> | undefined;

  public constructor(private readonly generation: AssociationGeneration) {}

  public get size(): number {
    return this.generation.filesByTag.size;
  }

  public has(key: string): boolean {
    return this.generation.filesByTag.has(key);
  }

  public get(key: string): TagAssociation[] | undefined {
    const cached = this.everything?.get(key) ?? this.lists.get(key);
    if (cached) {
      return cached;
    }
    const list = this.rank(key)?.map((entry) => entry.association);
    if (list) {
      this.lists.set(key, list);
    }
    return list;
  }

  public forEach(
    callback: (value: TagAssociation[], key: string, map: ReadonlyMap<string, TagAssociation[]>) => void,
    thisArg?: unknown,
  ): void {
    this.all().forEach((value, key) => callback.call(thisArg, value, key, this));
  }

  public entries(): MapIterator<[string, TagAssociation[]]> {
    return this.all().entries();
  }

  public keys(): MapIterator<string> {
    return this.all().keys();
  }

  public values(): MapIterator<TagAssociation[]> {
    return this.all().values();
  }

  public [Symbol.iterator](): MapIterator<[string, TagAssociation[]]> {
    return this.all().entries();
  }

  /**
   * Every tag's associations, in the order the whole-workspace pass listed
   * tags: by each tag's strongest association, as one ranking of them all.
   */
  private all(): Map<string, TagAssociation[]> {
    if (!this.everything) {
      const firsts = [...this.generation.filesByTag.keys()].map((key) => ({
        key,
        ranked: this.rank(key) ?? [],
      }));
      firsts.sort((left, right) => compareRanked(left.ranked[0], right.ranked[0]));
      this.everything = new Map(
        firsts.map(({ key, ranked }) => [key, ranked.map((entry) => entry.association)]),
      );
    }
    return this.everything;
  }

  private rank(tagKey: string): RankedAssociation[] | undefined {
    const cached = this.ranked.get(tagKey);
    if (cached) {
      return cached;
    }
    const { contributions, ordinals, filesByTag, tagUnits, totalUnits } = this.generation;
    const filePaths = filesByTag.get(tagKey);
    if (!filePaths) {
      return undefined;
    }
    const parts = [...filePaths]
      .map((filePath) => ({
        ordinal: ordinals.get(filePath) ?? 0,
        byAssociated: contributions.get(filePath)?.pairs.get(tagKey),
      }))
      .sort((left, right) => left.ordinal - right.ordinal);

    interface Accumulator {
      reference: TagReference;
      first: [number, number, number];
      weight: number;
      coOccurrenceCount: number;
      headingRelationshipCount: number;
      sectionIds: string[];
      taskIds: string[];
      units: number;
    }
    const accumulators = new Map<string, Accumulator>();
    const accumulator = (
      key: string,
      reference: TagReference | undefined,
      first: [number, number, number],
    ): Accumulator => {
      let found = accumulators.get(key);
      if (!found) {
        found = {
          reference: reference ?? { key, label: key },
          first,
          weight: 0,
          coOccurrenceCount: 0,
          headingRelationshipCount: 0,
          sectionIds: [],
          taskIds: [],
          units: 0,
        };
        accumulators.set(key, found);
      }
      return found;
    };
    // Evidence is summed in the order the workspace pass met it: every
    // note's headings first, in note order, then every note's tasks.
    parts.forEach(({ ordinal, byAssociated }) =>
      byAssociated?.forEach((part, associatedKey) => {
        if (part.sectionWeights.length === 0) {
          return;
        }
        const found = accumulator(associatedKey, part.sectionReference, [0, ordinal, part.sectionFirst]);
        part.sectionWeights.forEach((weight) => {
          found.weight += weight;
        });
        found.coOccurrenceCount += part.sectionCoOccurrences;
        found.headingRelationshipCount += part.headingRelationships;
        found.sectionIds.push(...part.sectionIds);
      }),
    );
    parts.forEach(({ ordinal, byAssociated }) =>
      byAssociated?.forEach((part, associatedKey) => {
        const found =
          part.taskCoOccurrences > 0
            ? accumulator(associatedKey, part.taskReference, [1, ordinal, part.taskFirst])
            : accumulators.get(associatedKey);
        if (!found) {
          return;
        }
        for (let count = 0; count < part.taskCoOccurrences; count += 1) {
          found.weight += 1;
        }
        found.coOccurrenceCount += part.taskCoOccurrences;
        found.taskIds.push(...part.taskIds);
        found.units += part.units;
      }),
    );

    const tagSourceUnitCount = tagUnits.get(tagKey) ?? 0;
    const ranked = [...accumulators].map(([associatedKey, found]): RankedAssociation => {
      const associatedTagSourceUnitCount = tagUnits.get(associatedKey) ?? 0;
      return {
        first: found.first,
        association: {
          associatedTag: { ...found.reference },
          sectionIds: found.sectionIds,
          taskIds: found.taskIds,
          weight: found.weight,
          coOccurrenceCount: found.coOccurrenceCount,
          headingRelationshipCount: found.headingRelationshipCount,
          count: found.units,
          normalizedWeight: getNormalizedAssociationWeight(
            found.weight,
            found.units,
            tagSourceUnitCount,
            associatedTagSourceUnitCount,
          ),
          tagSourceUnitCount,
          associatedTagSourceUnitCount,
          totalSourceUnitCount: totalUnits,
        },
      };
    });
    ranked.sort(compareRanked);
    this.ranked.set(tagKey, ranked);
    return ranked;
  }
}

/**
 * The ranking of associations: most co-occurrences, then most weight, then
 * by name — and, between two that tie on all of those, the one seen first.
 */
function compareRanked(
  left: RankedAssociation | undefined,
  right: RankedAssociation | undefined,
): number {
  if (!left || !right) {
    return left ? -1 : right ? 1 : 0;
  }
  const a = left.association;
  const b = right.association;
  return (
    b.coOccurrenceCount - a.coOccurrenceCount ||
    b.weight - a.weight ||
    a.associatedTag.label.localeCompare(b.associatedTag.label) ||
    a.associatedTag.key.localeCompare(b.associatedTag.key) ||
    left.first[0] - right.first[0] ||
    left.first[1] - right.first[1] ||
    left.first[2] - right.first[2]
  );
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

/**
 * The notes of a workspace and the index derived from them, kept together so
 * the two can never drift, and updated a note at a time.
 */
export class IndexState {
  private readonly notes = new Map<string, ParsedFile>();
  private readonly contributions = new Map<string, FileContribution>();
  /** Where each note stands in the notes map, for sorting a tag's notes. */
  private readonly ordinals = new Map<string, number>();
  private nextOrdinal = 0;
  /** Tag -> notes that mention it, and notes whose `describes:` names it. */
  private readonly filesByTag = new Map<string, Set<string>>();
  private readonly hubFilesByTag = new Map<string, Set<string>>();
  /** The association evidence, replaced rather than changed by an update. */
  private generation: AssociationGeneration;
  /** How many entries use each section and task id. */
  private readonly idUses = new Map<string, number>();
  private repeatedIds = 0;

  private constructor() {
    this.generation = {
      contributions: new Map(),
      ordinals: new Map(),
      filesByTag: new Map(),
      tagUnits: new Map(),
      totalUnits: 0,
    };
  }

  /** The state of a workspace holding these notes, in this order. */
  public static build(files: Iterable<ParsedFile>): IndexState {
    const state = new IndexState();
    const associationFiles = new Map<string, ReadonlySet<string>>();
    const tagUnits = new Map<string, number>();
    const copied = new Set<string>();
    let totalUnits = 0;
    for (const file of files) {
      const replaced = state.contributions.get(file.filePath);
      if (replaced) {
        // Two notes under one path: the later wins, in the earlier's place.
        state.forget(replaced, associationFiles, tagUnits, copied);
        totalUnits -= replaced.unitCount;
      } else {
        state.ordinals.set(file.filePath, state.nextOrdinal);
        state.nextOrdinal += 1;
      }
      const contribution = computeContribution(file);
      state.notes.set(file.filePath, file);
      state.contributions.set(file.filePath, contribution);
      state.remember(contribution, associationFiles, tagUnits, copied);
      totalUnits += contribution.unitCount;
    }
    state.generation = {
      contributions: new Map(state.contributions),
      ordinals: new Map(state.ordinals),
      filesByTag: associationFiles,
      tagUnits,
      totalUnits,
    };
    return state;
  }

  /** The notes, in index order. Read-only to callers. */
  public get files(): ReadonlyMap<string, ParsedFile> {
    return this.notes;
  }

  /**
   * The index of the notes as they stand, shared by callers until the notes
   * next change, so it is treated as read-only.
   */
  public snapshot(): WorkspaceIndex {
    const files = new Map(this.notes);
    if (this.repeatedIds > 0) {
      // A repeated id makes one entry replace another across notes, which a
      // note's own part cannot see. Built the direct way, the index is what
      // it always was.
      return buildIndexDirectly(files);
    }

    const sections = new Map<string, Section>();
    const tasks = new Map<string, Task>();
    this.contributions.forEach(({ file }) => {
      file.sections.forEach((section) => sections.set(section.id, section));
      file.tasks.forEach((task) => tasks.set(task.id, task));
    });

    const { tags, entities } = this.foldAllTags(tasks);

    const index: WorkspaceIndex = {
      files,
      sections,
      tasks,
      tags,
      entities,
      tagAssociations: new LazyTagAssociations(this.generation),
      updatedAt: Date.now(),
    };
    return index;
  }

  /** Adds a note's part to the per-tag records and the id counts. */
  private remember(
    contribution: FileContribution,
    associationFiles: Map<string, ReadonlySet<string>>,
    tagUnits: Map<string, number>,
    copied: Set<string>,
  ): void {
    const filePath = contribution.file.filePath;
    contribution.tagKeys.forEach((key) => addTo(this.filesByTag, key, filePath));
    contribution.hubKeys.forEach((key) => addTo(this.hubFilesByTag, key, filePath));
    contribution.pairs.forEach((_, key) =>
      writableSet(associationFiles, key, copied).add(filePath),
    );
    contribution.tagUnits.forEach((count, key) =>
      tagUnits.set(key, (tagUnits.get(key) ?? 0) + count),
    );
    this.countIds(contribution.file, 1);
  }

  /** Takes a note's part back out of the per-tag records and id counts. */
  private forget(
    contribution: FileContribution,
    associationFiles: Map<string, ReadonlySet<string>>,
    tagUnits: Map<string, number>,
    copied: Set<string>,
  ): void {
    const filePath = contribution.file.filePath;
    contribution.tagKeys.forEach((key) => removeFrom(this.filesByTag, key, filePath));
    contribution.hubKeys.forEach((key) => removeFrom(this.hubFilesByTag, key, filePath));
    contribution.pairs.forEach((_, key) => {
      const next = writableSet(associationFiles, key, copied);
      next.delete(filePath);
      if (next.size === 0) {
        associationFiles.delete(key);
        copied.delete(key);
      }
    });
    contribution.tagUnits.forEach((count, key) => {
      const remaining = (tagUnits.get(key) ?? 0) - count;
      if (remaining > 0) {
        tagUnits.set(key, remaining);
      } else {
        tagUnits.delete(key);
      }
    });
    this.countIds(contribution.file, -1);
  }

  private countIds(file: ParsedFile, step: 1 | -1): void {
    const count = (id: string): void => {
      const before = this.idUses.get(id) ?? 0;
      const after = before + step;
      if (after > 0) {
        this.idUses.set(id, after);
      } else {
        this.idUses.delete(id);
      }
      // Each use past the first is a repeat.
      this.repeatedIds += Math.max(0, after - 1) - Math.max(0, before - 1);
    };
    file.sections.forEach((section) => count(`s\u0000${section.id}`));
    file.tasks.forEach((task) => count(`t\u0000${task.id}`));
  }

  /** Every tag and entity, folded from every note in order. */
  private foldAllTags(tasks: ReadonlyMap<string, Task>): {
    tags: Map<string, TagInfo>;
    entities: Map<string, Entity>;
  } {
    const tags = new Map<string, TagInfo>();
    const entities = new Map<string, Entity>();
    this.contributions.forEach((contribution) =>
      contribution.ops.forEach((op) => applyTagOp(tags, entities, op)),
    );
    tags.forEach((tag) => this.finishTag(tag, tasks));
    entities.forEach((entity) => finishEntity(entity, tasks));
    return { tags, entities };
  }

  /** A tag's count and hub notes, once all its mentions are in. */
  private finishTag(tag: TagInfo, tasks: ReadonlyMap<string, Task>): void {
    // A task inside a tagged section is already represented by that section;
    // count it separately only when its tag would otherwise have no entry.
    const taggedSections = new Set(tag.sectionIds);
    const standaloneTasks = tag.taskIds.filter((taskId) => {
      const task = tasks.get(taskId);
      return !task?.sectionId || !taggedSections.has(task.sectionId);
    });
    tag.count = taggedSections.size + standaloneTasks.length + tag.filePaths.length;
    const hubFiles = this.hubFilesByTag.get(tag.key);
    if (hubFiles) {
      // The first note by path is the tag's hub; any others are shown as conflicts.
      tag.hubFilePaths = [...hubFiles]
        .sort((left, right) => (this.ordinals.get(left) ?? 0) - (this.ordinals.get(right) ?? 0))
        .flatMap((filePath) =>
          (this.contributions.get(filePath)?.hubKeys ?? [])
            .filter((key) => key === tag.key)
            .map(() => filePath),
        )
        .sort((left, right) => left.localeCompare(right));
    }
  }
}

function finishEntity(entity: Entity, tasks: ReadonlyMap<string, Task>): void {
  const entitySections = new Set(entity.sectionIds);
  const standaloneTasks = entity.taskIds.filter((taskId) => {
    const task = tasks.get(taskId);
    return !task?.sectionId || !entitySections.has(task.sectionId);
  });
  entity.count = entitySections.size + standaloneTasks.length + entity.filePaths.length;
}

/** Adds one mention of a tag to its record, and to its entity's. */
function applyTagOp(
  tags: Map<string, TagInfo>,
  entities: Map<string, Entity>,
  op: TagOp,
): void {
  let tag = tags.get(op.key);
  if (!tag) {
    tag = {
      key: op.key,
      label: op.label,
      sectionIds: [],
      taskIds: [],
      filePaths: [],
      count: 0,
      isFavorite: false,
    };
    tags.set(op.key, tag);
  }
  if (op.type === 'section') {
    tag.sectionIds.push(op.reference);
  } else if (op.type === 'task') {
    tag.taskIds.push(op.reference);
  } else if (!tag.filePaths.includes(op.reference)) {
    tag.filePaths.push(op.reference);
  }

  if (!op.entityKind) {
    return;
  }
  let entity = entities.get(op.key);
  if (!entity) {
    entity = {
      key: op.key,
      label: op.label,
      kind: op.entityKind,
      name: getEntityName(op.label),
      sectionIds: [],
      taskIds: [],
      filePaths: [],
      count: 0,
      isFavorite: false,
      updatedAt: op.updatedAt,
    };
    entities.set(op.key, entity);
  }
  const references =
    op.type === 'section'
      ? entity.sectionIds
      : op.type === 'task'
        ? entity.taskIds
        : entity.filePaths;
  references.push(op.reference);
  if (op.updatedAt !== undefined && (entity.updatedAt ?? 0) < op.updatedAt) {
    entity.updatedAt = op.updatedAt;
  }
}

function getEntityName(label: string): string {
  const name = label.slice(1).split('/').at(-1) ?? label;
  return name.replaceAll('-', ' ');
}

/**
 * The set under `key`, copied first unless this update already copied it,
 * so a set an earlier generation holds is never changed under it.
 */
function writableSet(
  map: Map<string, ReadonlySet<string>>,
  key: string,
  copied: Set<string>,
): Set<string> {
  const current = map.get(key);
  if (current && copied.has(key)) {
    return current as Set<string>;
  }
  const next = new Set(current);
  map.set(key, next);
  copied.add(key);
  return next;
}

function addTo(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key);
  if (set) {
    set.add(value);
  } else {
    map.set(key, new Set([value]));
  }
}

function removeFrom(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key);
  set?.delete(value);
  if (set?.size === 0) {
    map.delete(key);
  }
}

/**
 * The index built note by note over the whole workspace, as it was before
 * the fold. Used only while two entries share an id, when one replaces the
 * other across notes and no note's own part can say so.
 */
export function buildIndexDirectly(files: Map<string, ParsedFile>): WorkspaceIndex {
  const sections = new Map<string, Section>();
  const tasks = new Map<string, Task>();
  const tags = new Map<string, TagInfo>();
  const entities = new Map<string, Entity>();
  const hubFilePaths = new Map<string, string[]>();

  files.forEach((file) => {
    file.hub?.describes.forEach((reference) => {
      hubFilePaths.set(reference.key, [
        ...(hubFilePaths.get(reference.key) ?? []),
        file.filePath,
      ]);
    });
    file.sections.forEach((section) => sections.set(section.id, section));
    file.tasks.forEach((task) => tasks.set(task.id, task));
    computeContribution(file).ops.forEach((op) => applyTagOp(tags, entities, op));
  });

  tags.forEach((tag) => {
    const taggedSections = new Set(tag.sectionIds);
    const standaloneTasks = tag.taskIds.filter((taskId) => {
      const task = tasks.get(taskId);
      return !task?.sectionId || !taggedSections.has(task.sectionId);
    });
    tag.count = taggedSections.size + standaloneTasks.length + tag.filePaths.length;
  });
  hubFilePaths.forEach((filePaths, tagKey) => {
    const tag = tags.get(tagKey);
    if (tag) {
      tag.hubFilePaths = [...filePaths].sort((left, right) => left.localeCompare(right));
    }
  });
  entities.forEach((entity) => finishEntity(entity, tasks));

  return {
    files,
    sections,
    tasks,
    tags,
    entities,
    tagAssociations: buildAssociationsDirectly(sections, tasks),
    updatedAt: Date.now(),
  };
}

interface DirectAssociation {
  associatedTag: TagReference;
  sectionIds: string[];
  taskIds: string[];
  weight: number;
  coOccurrenceCount: number;
  headingRelationshipCount: number;
  sourceUnitIds: Set<string>;
}

/**
 * Tag associations over the whole workspace at once, through the section
 * and task maps, as the index made them before the fold.
 */
function buildAssociationsDirectly(
  sections: Map<string, Section>,
  tasks: Map<string, Task>,
): Map<string, TagAssociation[]> {
  const associations = new Map<string, DirectAssociation>();
  const sourceUnits = new Map<string, TagReference[]>();
  const register = (unitId: string, tags: TagReference[]): void => {
    if (!sourceUnits.has(unitId)) {
      sourceUnits.set(unitId, [...new Map(tags.map((tag) => [tag.key, tag])).values()]);
    }
  };
  const evidence = (
    tag: TagReference,
    associatedTag: TagReference,
    source: { sectionId?: string; taskId?: string; unitId: string },
    weight: number,
    isCoOccurrence: boolean,
  ): void => {
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
  };
  const group = (
    tags: TagReference[],
    source: { sectionId?: string; taskId?: string; unitId: string },
  ): void => {
    const uniqueTags = [...new Map(tags.map((tag) => [tag.key, tag])).values()];
    uniqueTags.forEach((tag, index) => {
      uniqueTags.slice(index + 1).forEach((associatedTag) => {
        evidence(tag, associatedTag, source, 1, true);
        evidence(associatedTag, tag, source, 1, true);
      });
    });
  };

  sections.forEach((section) => {
    (section.associationTagGroups ?? []).forEach((tags, index) => {
      const unitId = `section:${section.id}:group:${index}`;
      register(unitId, tags);
      group(tags, { sectionId: section.id, unitId });
    });
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
          register(unitId, [...sourceTags, ...(parent.headingTags ?? [])]);
          evidence(childTag, parentTag, { sectionId: section.id, unitId }, 0.5 / depth, false);
          evidence(parentTag, childTag, { sectionId: section.id, unitId }, 0.5 / depth, false);
        });
      });
      parentSectionId = parent.parentSectionId;
      depth += 1;
    }
  });
  tasks.forEach((task) => {
    (task.associationTagGroups ?? []).forEach((tags, index) => {
      const unitId = `task:${task.id}:group:${index}`;
      register(unitId, tags);
      group(tags, { taskId: task.id, unitId });
    });
  });

  const tagUnits = new Map<string, number>();
  sourceUnits.forEach((tags) =>
    tags.forEach((tag) => tagUnits.set(tag.key, (tagUnits.get(tag.key) ?? 0) + 1)),
  );
  const tagAssociations = new Map<string, TagAssociation[]>();
  [...associations.entries()]
    .map(([key, relationship]) => {
      const tagKey = key.split('\u0000')[0];
      const tagSourceUnitCount = tagUnits.get(tagKey) ?? 0;
      const associatedTagSourceUnitCount = tagUnits.get(relationship.associatedTag.key) ?? 0;
      const { sourceUnitIds, ...rest } = relationship;
      const association: TagAssociation = {
        ...rest,
        count: sourceUnitIds.size,
        normalizedWeight: getNormalizedAssociationWeight(
          relationship.weight,
          sourceUnitIds.size,
          tagSourceUnitCount,
          associatedTagSourceUnitCount,
        ),
        tagSourceUnitCount,
        associatedTagSourceUnitCount,
        totalSourceUnitCount: sourceUnits.size,
      };
      return { tagKey, association };
    })
    .sort(
      (left, right) =>
        right.association.coOccurrenceCount - left.association.coOccurrenceCount ||
        right.association.weight - left.association.weight ||
        left.association.associatedTag.label.localeCompare(right.association.associatedTag.label) ||
        left.association.associatedTag.key.localeCompare(right.association.associatedTag.key),
    )
    .forEach(({ tagKey, association }) => {
      const list = tagAssociations.get(tagKey);
      if (list) {
        list.push(association);
      } else {
        tagAssociations.set(tagKey, [association]);
      }
    });
  return tagAssociations;
}
