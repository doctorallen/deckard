/**
 * The lines Deckard writes for a question: the question itself, from words
 * Find found nothing for, and its answer, under it
 * (docs/implementation/38-questions.md).
 */
import { stripTrailingTags } from '../ranking/entryLabels';

/**
 * Words as a question: the first letter upper case, and a `?` at the end
 * unless one is there. `who approves uat access` becomes `Who approves uat
 * access?`.
 */
export function wordQuestion(words: string): string {
  const trimmed = words.trim().replace(/\s+/g, ' ').replace(/[.!]+$/, '');
  if (!trimmed) {
    return '';
  }
  const capitalized = trimmed.charAt(0).toLocaleUpperCase() + trimmed.slice(1);
  return capitalized.endsWith('?') ? capitalized : `${capitalized}?`;
}

/** A question's line, as a note's top-level list writes one: `- [?] Who approves access?`. */
export function formatQuestionLine(words: string, symbol = '?'): string {
  return `- [${symbol}] ${wordQuestion(words)}`;
}

/** What an answer says, and where it came from. */
export interface AnswerText {
  /** The answer's words, as typed or as the line that gave them says them. */
  text: string;
  /** A `[[link]]` to the line or note the answer came from. */
  link?: string;
  /** The day it was answered, `YYYY-MM-DD`, which the line ends with. */
  date?: string;
}

/**
 * An answer's line under its question, indented as the note nests its
 * lists: `  - Answer: Priya, via RATES-UAT [[2026-10-14#Access]] (2026-10-14)`.
 * The tags written after the words are left out, so the answer is not an
 * entry of its own.
 */
export function formatAnswerLine(answer: AnswerText, indent: string, marker: '-' | '*' | '+' = '-'): string {
  const words = stripTrailingTags(answer.text.replace(/\s+/g, ' ').trim()) || answer.text.trim();
  return `${indent}${marker} Answer: ${[words, answer.link, answer.date ? `(${answer.date})` : ''].filter(Boolean).join(' ')}`;
}
