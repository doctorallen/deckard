/**
 * Questions: the `- [?]` lines of a note. A question is not a task: it is
 * never on the board or in a task count. It is open until an indented
 * line under it starts with `Answer:` (docs/implementation/38-questions.md).
 */
import type { TagReference } from './tags';

/** A question's answer: the `Answer:` line written under it. */
export interface QuestionAnswer {
  /** The answer's words, after `Answer:`. */
  text: string;
  lineNumber: number;
  /** The day written on the answer's line, when it has one. */
  answeredAt?: number;
}

/** A `- [?]` line in a note, with its tags, the people it names, and its answer. */
export interface Question {
  id: string;
  filePath: string;
  /** The entry the question is written in, as a task's `sectionId` is. */
  sectionId?: string;
  /** The question's words, after its box. */
  title: string;
  /** Its own tags and those of the heading or front matter it is under. */
  tags: string[];
  tagLabels: Record<string, string>;
  /** The tags written on its own line. */
  associationTagGroups?: TagReference[][];
  lineNumber: number;
  checkboxColumn: number;
  /** The character in its box, `?` unless a vault names another. */
  symbol: string;
  sourceLineText: string;
  answer?: QuestionAnswer;
  /** Its own ➕ date when it has one, else its note's: the day it was asked. */
  createdAt?: number;
  updatedAt?: number;
}
