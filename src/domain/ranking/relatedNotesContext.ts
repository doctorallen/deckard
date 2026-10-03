/**
 * What a Related Notes ranking reads for every entry it scores: its
 * settings, the note it ranks against, and each qualifying entry as the
 * scorer receives it.
 */
import { ParsedFile, Section, TagReference, TagTitleDisplayMode, WorkspaceIndex } from '../model';
import { ActiveNote, LinkNames } from './linkEvidence';
import { TagAssociationMatches } from './tagAssociations';
import { LexicalModel } from './wordSimilarity';

/** The settings Related Notes ranks by, as the extension's settings give them. */
export interface RelatedNotesRankingOptions {
  /**
   * One preserves intentional one-off associations; higher values suppress
   * low-support learned edges without discarding their index evidence.
   */
  associationMinimumSupport?: number;
  /** Disabled at zero; a positive value is the recency decay half-life. */
  recencyHalfLifeDays?: number;
  /** Leaves out daily, weekly, and monthly notes. */
  hidePeriodicNotes?: boolean;
  /** Namespaces never suggested as a tag, such as the board's status. */
  excludedTagNamespaces?: string[];
}

/** A ranking's settings, with the moment a note's age is counted to. */
export type RelatedNotesRankingAt = RelatedNotesRankingOptions & {
  /** Now, in milliseconds since the epoch, for the recency weight. */
  now: number;
};

/** What one ranking reads for every entry it scores, worked out once. */
export interface RankingContext {
  index: WorkspaceIndex;
  active: ActiveNote;
  activeTags: TagReference[];
  activeKeys: Set<string>;
  weights: ReadonlyMap<string, number>;
  /** The active tags' weights summed: what a full direct match scores. */
  totalActiveWeight: number;
  matchAssociations: (candidateTags: readonly TagReference[]) => TagAssociationMatches;
  linkNames: LinkNames;
  lexicalModel: LexicalModel | undefined;
  tagTitleDisplayMode: TagTitleDisplayMode;
  /** Parked entries are ranked only beside a parked note, after the rest. */
  keepParked: boolean;
  options: RelatedNotesRankingAt;
}

/** One entry of a note that qualified, as it is scored and listed. */
export interface EntryReference {
  sectionId?: string;
  title: string;
  sourceLine: number;
  titleTags: TagReference[];
  updatedAt?: number;
  tags: TagReference[];
  /** What its tags' associations with the active tags say. */
  associations: TagAssociationMatches;
  rawContent: string;
  links: string[];
  headingPath: string[];
  dailyDate?: string;
  parked?: boolean;
  section?: Section;
}

/** The note an entry is in, and its sections that qualified. */
export interface FileScope {
  file: ParsedFile;
  filePath: string;
  sectionsById: ReadonlyMap<string, Section>;
  matchingSections: Section[];
}
