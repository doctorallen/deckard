/**
 * Notes as the parser reads them: each file, the sections (entries) it is
 * made of, and the front matter a hub note carries.
 */
import type { TagReference } from './tags';
import type { Task } from './tasks';

/** A line in a note, by the note's path and the line's number. */
export interface SourceLocation {
  filePath: string;
  line: number;
}

/**
 * One entry of a note: a heading and what is written under it, or a tagged
 * line that stands as an entry of its own.
 */
export interface Section {
  id: string;
  filePath: string;
  heading: string;
  headingLevel: number;
  isInline?: boolean;
  /** Tags written on this heading, excluding inherited front-matter tags. */
  headingTags?: TagReference[];
  /** Explicit tag groups written on individual source lines. */
  associationTagGroups?: TagReference[][];
  /** Structural heading parent, including untagged intermediate headings. */
  parentSectionId?: string;
  tags: string[];
  tagLabels: Record<string, string>;
  links: string[];
  /** The section and everything nested inside it, which is what Extract moves. */
  rawContent: string;
  /**
   * The section's own text: its heading and the lines under it, stopping at
   * the next heading of any level. A parent's own body does not contain its
   * children's, so a line belongs to the text of exactly one entry.
   */
  bodyContent: string;
  startLine: number;
  /** The last line of the section and everything nested inside it. */
  endLine: number;
  /** The last line of the section's own body, before any nested heading. */
  bodyEndLine: number;
  /**
   * Tags written on the section's own body lines, each with the line that
   * carries it.
   *
   * The tag stays where its author wrote it. A heading matches a search for
   * one of these because it contains the line, not because the tag was moved
   * onto the heading — so `tags` remains what was written on the heading
   * itself, and a match can say which line answered it.
   */
  bodyTags?: SectionBodyTag[];
  createdAt?: number;
  updatedAt?: number;
}

/** A tag written on a section's own body, with the line that carries it. */
export interface SectionBodyTag extends TagReference {
  /** One-based line the tag is written on. */
  line: number;
}

/** One note as the parser reads it: its sections, tasks, tags, and links. */
export interface ParsedFile {
  filePath: string;
  content: string;
  sections: Section[];
  tasks: Task[];
  frontmatterTags: TagReference[];
  links: string[];
  /** Other names `[[links]]` can use for the note, from `aliases:` front matter. */
  aliases?: string[];
  /**
   * The `^block-id` markers the note carries, each with the one-based line it
   * marks, so a `[[Note#^id]]` link can be opened at the line it names.
   */
  blockIds?: Record<string, number>;
  /** Present when the note's `describes:` front matter names tags. */
  hub?: NoteHub;
  /**
   * How many checkbox lines hold a mark that is not a task's, such as
   * `- [/]` or `- [-]`; absent when none do. They are text, not tasks, so
   * Stats and a one-time notice say how many were left out.
   */
  otherCheckboxes?: number;
  /**
   * When the note was created and last updated. A date the note states about
   * itself, in front matter or as a daily note's day, comes before its file's.
   */
  createdAt?: number;
  updatedAt?: number;
  /**
   * The file's own created and modified times, which tell whether the file
   * changed since it was last read.
   */
  fileTimes?: { createdAt?: number; updatedAt?: number };
}

/**
 * A note that describes tags, so it can lead their overviews.
 */
export interface NoteHub {
  describes: TagReference[];
  /** The rest of the note's front matter, in source order. */
  properties: FrontmatterProperty[];
}

/** One front-matter property of a hub note, with its values in source order. */
export interface FrontmatterProperty {
  name: string;
  values: FrontmatterValue[];
}

/** One value of a front-matter property, and the tag it names, if any. */
export interface FrontmatterValue {
  text: string;
  /** Set when the value names a tag, such as `owner: "@dana"`. */
  tag?: TagReference;
}
