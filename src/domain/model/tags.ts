/**
 * Tags and entities: how a tag is written, what carries it across the
 * workspace, and the tags read as the people, projects, and topics the notes
 * are about.
 */

/** A tag as a note writes it: its canonical key, and the label it is shown by. */
export interface TagReference {
  key: string;
  label: string;
}

/** A tag written on a line, with the line and the columns it spans. */
export interface HeadingTagSpan extends TagReference {
  lineNumber: number;
  startColumn: number;
  endColumn: number;
}

/** One tag across the workspace: the sections, tasks, and notes that carry it. */
export interface TagInfo {
  key: string;
  label: string;
  sectionIds: string[];
  taskIds: string[];
  filePaths: string[];
  count: number;
  isFavorite: boolean;
  /** Notes whose `describes:` names this tag, by path; the first is its hub. */
  hubFilePaths?: string[];
}

/** How strongly one tag goes with another, and the evidence that says so. */
export interface TagAssociation {
  associatedTag: TagReference;
  sectionIds: string[];
  taskIds: string[];
  count: number;
  /** Total evidence score: co-occurrence is 1; heading proximity decays by depth. */
  weight: number;
  /** Prevalence- and support-normalized relevance used for Related Notes. */
  normalizedWeight: number;
  /** Distinct atomic source units containing the source tag. */
  tagSourceUnitCount: number;
  /** Distinct atomic source units containing the associated tag. */
  associatedTagSourceUnitCount: number;
  /** Total atomic source units observed while building this relationship. */
  totalSourceUnitCount: number;
  coOccurrenceCount: number;
  headingRelationshipCount: number;
}

/** The entity kinds Deckard knows without any configuration. */
export type BuiltInEntityKind =
  | 'person'
  | 'project'
  | 'topic'
  | 'organization'
  | 'meeting';

/**
 * Entity kinds include built-in types and workspace-defined namespaces.
 *
 * The open string branch lets a namespaced tag such as `#management/item`
 * become an entity without requiring a configuration entry first.
 */
export type EntityKind = BuiltInEntityKind | (string & {});

/** A tag read as something the notes are about, with what carries it. */
export interface Entity {
  key: string;
  label: string;
  kind: EntityKind;
  name: string;
  sectionIds: string[];
  taskIds: string[];
  filePaths: string[];
  count: number;
  isFavorite: boolean;
  updatedAt?: number;
}
