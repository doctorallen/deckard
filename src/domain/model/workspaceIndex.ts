/**
 * The workspace index: every note, entry, task, tag, and entity Deckard has
 * read, and the notes it could not read.
 */
import type { ParsedFile, Section } from './notes';
import type { Entity, TagAssociation, TagInfo } from './tags';
import type { Task } from './tasks';

/** Everything read from the workspace's notes, each kind keyed by its id. */
export interface WorkspaceIndex {
  files: Map<string, ParsedFile>;
  sections: Map<string, Section>;
  tasks: Map<string, Task>;
  tags: Map<string, TagInfo>;
  entities: Map<string, Entity>;
  /** Tag key -> weighted co-occurrence and heading-proximity associations. */
  tagAssociations?: ReadonlyMap<string, TagAssociation[]>;
  /**
   * The notes in the types folder, by path, each defining a type
   * (`ParsedFile.typeNote`). They are kept out of `files`, so no entry,
   * search, or count sees them; absent when there are none.
   */
  typeNotes?: Map<string, ParsedFile>;
  /** What `deckard.parked` parks, set by the indexer; absent means nothing. */
  parked?: ParkedState;
  updatedAt: number;
}

/**
 * What is parked in one index, worked out once per snapshot.
 *
 * A note, heading, or task is parked when it is in a parked folder, or when a
 * search for a parked tag would find it.
 */
export interface ParkedState {
  /** Notes parked whole: by their folder, or by a tag in their front matter. */
  files: Set<string>;
  sections: Set<string>;
  tasks: Set<string>;
  /** Tags every use of which is parked. */
  tags: Set<string>;
  /** Notes parked by a front-matter tag and not by their folder. */
  taggedFiles: Set<string>;
  /** How many notes their folder parks. */
  byFolder: number;
  /** How many notes a front-matter tag parks and their folder does not. */
  byTag: number;
}

/** A note Deckard could not read: it is in the workspace, but not in the index. */
export interface UnreadableNote {
  filePath: string;
  reason: string;
}
