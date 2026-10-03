/**
 * The tags learned to go with the note being read, as Related Notes counts
 * them for a candidate entry: which of the entry's tags the note's tags are
 * associated with, how strongly, and each association behind that.
 */
import { RankedNote, TagAssociation, TagReference, WorkspaceIndex } from '../model';

/** The association of one tag with another, when the index learned one. */
export function findTagAssociation(
  index: WorkspaceIndex,
  tagKey: string,
  associatedTagKey: string,
): TagAssociation | undefined {
  return index.tagAssociations?.get(tagKey)?.find(
    (relationship) => relationship.associatedTag.key === associatedTagKey,
  );
}

/** One active tag's association with one of a candidate's tags. */
export type AssociationMatch = NonNullable<RankedNote['associationMatches']>[number];

/** A candidate's tag that the active tags are associated with, and how strongly. */
export interface AssociatedTag {
  tag: TagReference;
  /** The normalized weights, each scaled by its active tag's weight. */
  weight: number;
  /** The raw weights, each scaled by its active tag's weight. */
  rawWeight: number;
}

/** What the active tags' associations say about one candidate's tags. */
export interface TagAssociationMatches {
  /** The candidate's associated tags, in the candidate's order. */
  associated: AssociatedTag[];
  /** Every association behind them, by candidate tag, then by active tag. */
  details: AssociationMatch[];
}

/** The active tags an entry is ranked against, and what each counts. */
export interface AssociationSubject {
  activeTags: readonly TagReference[];
  /** How much each active tag counts; 1 for a tag not in it. */
  weights: ReadonlyMap<string, number>;
  /** The fewest source units an association needs to count. */
  minimumSupport: number;
}

/**
 * Matches a candidate's tags against the active tags' associations, looking
 * each pair up once.
 *
 * The details keep every association not below the minimum support, and a
 * tag's weights sum those that reach it, in the same order, so the two agree
 * for every support a setting can give. They are two tests rather than one
 * because a support that is not a number (a setting written as text) fails
 * both, which keeps the details and drops the tag, as the ranking always has.
 */
export function createAssociationMatcher(
  index: WorkspaceIndex,
  subject: AssociationSubject,
): (candidateTags: readonly TagReference[]) => TagAssociationMatches {
  const { activeTags, weights, minimumSupport } = subject;
  return (candidateTags) => {
    const associated: AssociatedTag[] = [];
    const details: AssociationMatch[] = [];
    candidateTags.forEach((candidateTag) => {
      const matches = activeTags.flatMap((selectedTag) => {
        const association = findTagAssociation(index, selectedTag.key, candidateTag.key);
        if (!association || association.count < minimumSupport) {
          return [];
        }
        return [describeMatch(selectedTag, candidateTag, association, weights.get(selectedTag.key) ?? 1)];
      });
      details.push(...matches);
      const supported = matches.filter((match) => match.sourceUnitCount >= minimumSupport);
      const weight = supported.reduce((total, match) => total + match.contribution, 0);
      const rawWeight = supported.reduce(
        (total, match) => total + match.associationWeight * match.selectedWeight,
        0,
      );
      if (weight > 0) {
        associated.push({ tag: candidateTag, weight, rawWeight });
      }
    });
    return { associated, details };
  };
}

/** One association as Related Notes' evidence lists it. */
function describeMatch(
  selectedTag: TagReference,
  candidateTag: TagReference,
  association: TagAssociation,
  selectedWeight: number,
): AssociationMatch {
  return {
    selectedTag,
    candidateTag,
    associationWeight: association.weight,
    normalizedAssociationWeight: association.normalizedWeight,
    sourceUnitCount: association.count,
    selectedTagSourceUnitCount: association.tagSourceUnitCount,
    candidateTagSourceUnitCount: association.associatedTagSourceUnitCount,
    totalSourceUnitCount: association.totalSourceUnitCount,
    selectedWeight,
    contribution: association.normalizedWeight * selectedWeight,
  };
}
