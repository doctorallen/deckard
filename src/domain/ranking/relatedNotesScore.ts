/**
 * The score of one qualifying entry: its direct tags, the tags associated
 * with them, its links, its wording, and its note's recency, over what a
 * full direct match would score, less a little when a more specific entry
 * under it matches as well.
 */
import { ParsedFile, RankedNote, Section, TagReference } from '../model';
import { getFileName } from '../../shared/paths';
import { createSectionExcerpt } from './entryExcerpt';
import { getLinkEvidence, LinkEvidence } from './linkEvidence';
import { getRecencyWeight, getRelevantDate } from './recency';
import { EntryReference, FileScope, RankingContext } from './relatedNotesContext';
import { AssociatedTag } from './tagAssociations';
import { getCachedLexicalTerms, getLexicalWeight, LexicalEvidence } from './wordSimilarity';

/** Every measure behind an entry's score, before it is shaped for the list. */
interface ReferenceEvidence {
  matchedTags: TagReference[];
  associatedMatches: AssociatedTag[];
  associationWeight: number;
  normalizedAssociationWeight: number;
  unionSize: number;
  directTagWeight: number;
  appliedAssociationWeight: number;
  linkEvidence: LinkEvidence;
  lexicalEvidence: LexicalEvidence;
  recencyWeight: number;
  specificityPenalty: number;
  referenceRelevanceScore: number;
}

/** One entry scored and shaped as Related Notes lists it, with its reasons. */
export function scoreReference(
  context: RankingContext,
  scope: FileScope,
  reference: EntryReference,
): RankedNote {
  const { file, filePath } = scope;
  const evidence = measureReference(context, scope, reference);
  const { matchedTags, linkEvidence, lexicalEvidence, referenceRelevanceScore } = evidence;
  const excerpt = reference.section
    ? createSectionExcerpt(
        reference.section,
        file.sections,
        reference.title,
        lexicalEvidence.terms.slice(0, 3).map((term) => term.term),
      )
    : undefined;
  return {
    ...(reference.parked ? { parked: true as const } : {}),
    ...(excerpt ? { excerpt } : {}),
    sectionId: reference.sectionId,
    filePath,
    title: reference.title,
    fileName: getFileName(filePath) ?? filePath,
    sourceLine: reference.sourceLine,
    headingPath: reference.headingPath,
    dailyDate: reference.dailyDate,
    titleTags: reference.titleTags,
    createdAt: reference.createdAt,
    updatedAt: reference.updatedAt,
    matchedTags,
    matchCount: matchedTags.reduce(
      (total, tag) => total + (context.weights.get(tag.key) ?? 1),
      0,
    ),
    totalTagCount: context.activeTags.length,
    overlap:
      evidence.unionSize > 0 ? referenceRelevanceScore / 100 : 0,
    relevanceScore: referenceRelevanceScore,
    associationWeight: evidence.associationWeight,
    associationMatches: reference.associations.details,
    relevanceEvidence: {
      directTagWeight: evidence.directTagWeight,
      associationWeight: evidence.associationWeight,
      normalizedAssociationWeight: evidence.normalizedAssociationWeight,
      appliedAssociationWeight: evidence.appliedAssociationWeight,
      entryLinkWeight: linkEvidence.entryWeight,
      fileLinkWeight: linkEvidence.fileWeight,
      lexicalWeight: lexicalEvidence.weight,
      recencyWeight: evidence.recencyWeight,
      specificityPenalty: evidence.specificityPenalty,
      lexicalTerms: lexicalEvidence.terms,
    },
    reasons: describeReasons(file, evidence),
  };
}

/** Each measure of an entry's relevance, and the score they add up to. */
function measureReference(
  context: RankingContext,
  scope: FileScope,
  reference: EntryReference,
): ReferenceEvidence {
  const { file } = scope;
  const { index, activeTags, activeKeys, weights, totalActiveWeight, lexicalModel } = context;
  const matchedTags = activeTags.filter((tag) =>
    reference.tags.some((candidateTag) => candidateTag.key === tag.key),
  );
  const associations = measureAssociations(reference, totalActiveWeight);
  const unionSize = new Set([
    ...activeKeys,
    ...reference.tags.map((tag) => tag.key),
  ]).size;
  const directTagWeight = matchedTags.reduce(
    (total, tag) => total + 2 * (weights.get(tag.key) ?? 1),
    0,
  );
  const { appliedAssociationWeight } = associations;
  const linkEvidence = getLinkEvidence(context.linkNames, context.active, {
    file,
    links: reference.links,
    title: reference.title,
  });
  const lexicalEvidence = getLexicalWeight(
    lexicalModel,
    reference.title,
    reference.rawContent,
    lexicalModel &&
      getCachedLexicalTerms(index, reference.title, reference.rawContent),
  );
  const recencyWeight = getRecencyWeight(
    getRelevantDate(file),
    context.options.recencyHalfLifeDays,
    context.options.now,
  );
  const relevanceScore = Math.round(
    Math.min(
      1,
      (directTagWeight +
        appliedAssociationWeight +
        linkEvidence.entryWeight +
        linkEvidence.fileWeight +
        lexicalEvidence.weight +
        recencyWeight) /
        Math.max(1, totalActiveWeight * 2),
    ) * 100,
  );
  const specificityPenalty = getSpecificityPenalty(scope, reference, matchedTags);
  const referenceRelevanceScore = Math.max(
    0,
    relevanceScore - Math.round(specificityPenalty * 100),
  );
  return {
    matchedTags,
    ...associations,
    unionSize,
    directTagWeight,
    linkEvidence,
    lexicalEvidence,
    recencyWeight,
    specificityPenalty,
    referenceRelevanceScore,
  };
}

/** What the active tags' associations add to an entry, before and after they diminish. */
function measureAssociations(
  reference: EntryReference,
  totalActiveWeight: number,
): Pick<ReferenceEvidence, 'associatedMatches' | 'associationWeight' | 'normalizedAssociationWeight' | 'appliedAssociationWeight'> {
  const associatedMatches = reference.associations.associated;
  const associationWeight = associatedMatches.reduce(
    (total, match) => total + match.rawWeight,
    0,
  );
  const normalizedAssociationWeight = reference.associations.details.reduce(
    (total, match) => total + match.normalizedAssociationWeight,
    0,
  );
  const appliedAssociationWeight = getDiminishingAssociationWeight(
    normalizedAssociationWeight,
    totalActiveWeight,
  );
  return { associatedMatches, associationWeight, normalizedAssociationWeight, appliedAssociationWeight };
}

/**
 * A twentieth off an entry whose tags a more specific entry nested under it
 * also matches, so the narrower one leads.
 */
function getSpecificityPenalty(
  { sectionsById, matchingSections }: FileScope,
  reference: EntryReference,
  matchedTags: TagReference[],
): number {
  return reference.sectionId &&
    matchedTags.length > 0 &&
    hasMoreSpecificMatchingDescendant(
      reference.sectionId,
      matchingSections,
      matchedTags,
      sectionsById,
    )
    ? 0.05
    : 0;
}

/** Why an entry is listed, one line for each kind of evidence it has. */
function describeReasons(file: ParsedFile, evidence: ReferenceEvidence): string[] {
  const { matchedTags, associatedMatches, linkEvidence, lexicalEvidence } = evidence;
  return [
    ...(matchedTags.length > 0
      ? [
          `Shared: ${matchedTags.map((tag) => tag.label).join(', ')}`,
        ]
      : []),
    ...(associatedMatches.length > 0
      ? [
          `Associated: ${associatedMatches
            .map((match) => match.tag.label)
            .join(', ')}`,
        ]
      : []),
    ...(linkEvidence.entryWeight > 0 ? ['Direct entry link'] : []),
    ...(linkEvidence.fileWeight > 0 ? ['Linked note'] : []),
    ...(lexicalEvidence.terms.length > 0
      ? [
          `Similar terms: ${lexicalEvidence.terms
            .slice(0, 3)
            .map((term) => term.term)
            .join(', ')}`,
        ]
      : []),
    ...(evidence.recencyWeight > 0
      ? [`Recent ${getRelevantDate(file)?.source ?? 'note'}`]
      : []),
    ...(evidence.specificityPenalty > 0
      ? ['Broader match contains a more specific entry']
      : []),
  ];
}

/**
 * Lets stronger association evidence keep improving relevance without allowing
 * repeated indirect evidence to overwhelm a complete direct-tag match.
 */
function getDiminishingAssociationWeight(
  rawAssociationWeight: number,
  totalActiveWeight: number,
): number {
  if (rawAssociationWeight <= 0 || totalActiveWeight <= 0) {
    return 0;
  }
  return (
    totalActiveWeight *
    (rawAssociationWeight / (rawAssociationWeight + totalActiveWeight))
  );
}

/**
 * Whether a matching section nested under this one carries every tag this
 * one matched, so the narrower entry is the better answer.
 */
function hasMoreSpecificMatchingDescendant(
  sectionId: string,
  matchingSections: Section[],
  matchedTags: TagReference[],
  sectionsById: ReadonlyMap<string, Section>,
): boolean {
  return matchingSections.some((candidate) => {
    if (
      candidate.id === sectionId ||
      !matchedTags.every((tag) => candidate.tags.includes(tag.key))
    ) {
      return false;
    }

    let parentId = candidate.parentSectionId;
    while (parentId) {
      if (parentId === sectionId) {
        return true;
      }
      parentId = sectionsById.get(parentId)?.parentSectionId;
    }
    return false;
  });
}
