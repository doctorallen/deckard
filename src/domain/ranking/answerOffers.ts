/**
 * Offering an answer to an open question: a line written since it was
 * asked that shares enough of its uncommon words, or, for a question that
 * names a typed row and one of its fields, the field's value
 * (docs/implementation/38-questions.md § Offering an answer).
 */
import { noteTitle } from '../index/backlinks';
import { listOpenQuestions, readQuestionTagKeys } from '../index/questions';
import { startOfDay } from '../markdown/calendar';
import type { Question, WorkspaceIndex } from '../model';
import { answerQuestion } from '../types/typeAnswers';
import { getTypeIndex, type TypeIndex } from '../types/typeIndex';
import { findLinesLike, getLineIndex, hashLine, type IndexedLine, lineWords } from './lineIndex';
import { getLineTerms } from './wordSimilarity';

/** How many of a question's uncommon words a line must share to be offered. */
export const ANSWER_MIN_SHARED = 3;

/** What may answer a question: a line written since, or a typed row's field. */
export interface AnswerOffer {
  questionId: string;
  kind: 'line' | 'field';
  /** Where it is written: the line, or, for a field, the line of the note that holds it. */
  filePath: string;
  line: number;
  /** The line's words, or the field's value. */
  text: string;
  /** The entry the line is in, a field's row, or nothing. */
  sectionId?: string;
  /** For a field: what it is, `lead of Rates`. */
  source?: string;
  /** The day it was written, as near as its note says. */
  at?: number;
  /** What Not it keeps it by, with the question's id: a hash of its words. */
  key: string;
  score: number;
  /** The uncommon words it shares with the question, the weightiest first. */
  shared: readonly string[];
}

/** What offering answers reads besides the index. */
export interface AnswerOfferOptions {
  /** The pairs set aside with Not it, each `notItKey(question id, offer key)`. */
  rejected: ReadonlySet<string>;
}

/** The key a question and an offer set aside with Not it are kept by. */
export function notItKey(questionId: string, offerKey: string): string {
  return `${questionId}\u0000${offerKey}`;
}

/**
 * The best offer for each open question that has one, by question id: its
 * field's value when it names a typed row and a field, else the line that
 * scores best among those that share at least three of its uncommon words,
 * and a tag or person when it carries one. A pair set aside with Not it is
 * never offered again.
 */
export function findAnswerOffers(index: WorkspaceIndex, options: AnswerOfferOptions): Map<string, AnswerOffer> {
  const offers = new Map<string, AnswerOffer>();
  const types = getTypeIndex(index);
  listOpenQuestions(index).forEach((question) => {
    const offer = [...offerField(types, question), ...offerLines(index, question)].find(
      (candidate) => !options.rejected.has(notItKey(question.id, candidate.key)),
    );
    if (offer) {
      offers.set(question.id, offer);
    }
  });
  return offers;
}

/**
 * The answer Find's answer tier gives a question that names a typed row
 * and one of its fields, `who leads #team/fx`: the field's value, with the
 * line of the note that holds it as its source.
 */
function offerField(types: TypeIndex, question: Question): AnswerOffer[] {
  if (types.isEmpty) {
    return [];
  }
  const [answer] = answerQuestion(types, lineWords(question.title));
  const filePath = answer?.value.filePath ?? answer?.holder.filePath;
  if (!answer || !filePath) {
    return [];
  }
  const { value } = answer;
  const row = value.rowId ? types.row(value.rowId) : undefined;
  const text = row?.title ?? (value.notePath ? noteTitle(value.notePath) : value.text);
  return [
    {
      questionId: question.id,
      kind: 'field',
      filePath,
      line: value.line ?? 1,
      text,
      source: `${answer.field.name} of ${answer.holder.title}`,
      key: hashLine(`${answer.field.name}: ${text}`),
      score: Number.POSITIVE_INFINITY,
      shared: [],
    },
  ];
}

/**
 * The lines that may answer a question, best first: written since the day
 * it was asked, neither a heading nor a question, not the question's own
 * line or one under it, sharing three of its uncommon words, and one of its
 * tags or people when it carries any.
 */
function offerLines(index: WorkspaceIndex, question: Question): AnswerOffer[] {
  const lines = getLineIndex(index);
  const asked = question.createdAt === undefined ? undefined : startOfDay(question.createdAt);
  const tags = [...readQuestionTagKeys(index, question)].map((tag) => tag.toLowerCase());
  const own = new Set(underQuestion(lines.linesOf(question.filePath), question));
  return findLinesLike(lines, getLineTerms(question.title), {
    minShared: ANSWER_MIN_SHARED,
    accept: (line) =>
      line.kind !== 'question' &&
      !(line.filePath === question.filePath && own.has(line.line)) &&
      (asked === undefined || line.at === undefined || line.at >= asked) &&
      (tags.length === 0 || line.tags.some((tag) => tags.includes(tag))),
  }).map((match) => ({
    questionId: question.id,
    kind: 'line' as const,
    filePath: match.line.filePath,
    line: match.line.line,
    text: lineWords(match.line.text),
    ...(match.line.sectionId ? { sectionId: match.line.sectionId } : {}),
    ...(match.line.at === undefined ? {} : { at: match.line.at }),
    key: hashLine(match.line.text),
    score: match.score,
    shared: match.shared,
  }));
}

/** The question's own line and the lines indented under it, which never answer it. */
function underQuestion(lines: readonly IndexedLine[], question: Question): number[] {
  const indent = (text: string): number => text.match(/^\s*/)?.[0].length ?? 0;
  const own = indent(question.sourceLineText);
  const under = [question.lineNumber];
  for (const line of lines) {
    if (line.line <= question.lineNumber) {
      continue;
    }
    if (indent(line.text) <= own) {
      break;
    }
    under.push(line.line);
  }
  return under;
}
