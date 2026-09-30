/**
 * What Related Notes ranks: an entry in another note, with the evidence that
 * put it where it is, and a tag offered to a note that has none.
 */
import type { TagReference } from './tags';

/** One entry Related Notes lists, with why it ranked where it did. */
export interface RankedNote {
  /** Parked: listed only beside a parked note, after the rest. */
  parked?: true;
  /**
   * The first lines of what a section says, up to 240 characters, from where
   * it shares a word with the note being read. Not on a task or an inline
   * tagged line, whose title is its whole text.
   */
  excerpt?: string;
  /** Listed for its wording alone, under a note with no tags: never strong. */
  kind?: 'wording';
  sectionId?: string;
  filePath: string;
  title: string;
  fileName: string;
  sourceLine: number;
  /** Outline context, including the entry title, for disambiguating daily notes. */
  headingPath: string[];
  /** Date inferred from a daily-note filename or date heading, when present. */
  dailyDate?: string;
  titleTags: TagReference[];
  updatedAt?: number;
  matchedTags: TagReference[];
  matchCount: number;
  totalTagCount: number;
  overlap: number;
  relevanceScore: number;
  associationWeight?: number;
  associationMatches?: Array<{
    selectedTag: TagReference;
    candidateTag: TagReference;
    associationWeight: number;
    normalizedAssociationWeight: number;
    sourceUnitCount: number;
    selectedTagSourceUnitCount: number;
    candidateTagSourceUnitCount: number;
    totalSourceUnitCount: number;
    selectedWeight: number;
    contribution: number;
  }>;
  relevanceEvidence?: {
    directTagWeight: number;
    associationWeight: number;
    normalizedAssociationWeight: number;
    appliedAssociationWeight: number;
    entryLinkWeight: number;
    fileLinkWeight: number;
    lexicalWeight: number;
    recencyWeight: number;
    specificityPenalty: number;
    lexicalTerms: Array<{ term: string; contribution: number }>;
  };
  reasons?: string[];
}

/** A tag the entries worded like an untagged note use, offered to add. */
export interface SuggestedTag {
  key: string;
  label: string;
  /** How many of the similar entries carry it. */
  entryCount: number;
}
