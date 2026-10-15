/**
 * Questions as the Questions view, Home's Open questions widget, and the
 * editor's lens draw them: each open question with its age, its first tag,
 * and the best answer offered for it, and, when asked for, the answered
 * ones (docs/implementation/38-questions.md § Where questions show).
 */
import { firstQuestionTag, isAnswered, listAllQuestions, listOpenQuestions, questionText } from '../../domain/index/questions';
import { DAY_MS, startOfDay } from '../../domain/markdown/calendar';
import { type DateFormats, DEFAULT_DATE_FORMATS, formatDisplayDate } from '../../domain/markdown/dateFormat';
import { stripTags } from '../../domain/markdown/parser';
import type { Question, WorkspaceIndex } from '../../domain/model';
import { type AnswerOffer, findAnswerOffers } from '../../domain/ranking/answerOffers';
import { pluralize } from '../../shared/text';
import { measure } from '../../shared/timing';
import type { SearchPageQuestion } from '../protocol/searchPage';

/** An answer offered for a question, as a row under it draws it. */
export interface QuestionOfferRow {
  kind: AnswerOffer['kind'];
  /** The line's words, or the field's value. */
  text: string;
  /** Where it is from, `14 Oct · Access`, or what a field is, `lead of Rates`. */
  where: string;
  filePath: string;
  line: number;
  /** What Not it sets it aside by. */
  key: string;
}

/** One question as a row: its words, how long it has been open, its first tag, and an answer offered. */
export interface QuestionRow {
  id: string;
  text: string;
  filePath: string;
  line: number;
  /** `open 12 days`, `asked today`, or, once answered, `answered 9 Oct`. */
  age: string;
  /** The first tag it carries, as written, when it carries one. */
  tag?: string;
  answered: boolean;
  /** Its answer's words, once it has one. */
  answer?: string;
  offer?: QuestionOfferRow;
}

/** What the rows are built with besides the index. */
export interface QuestionRowOptions {
  /** The offered answers set aside with Not it. */
  rejected: ReadonlySet<string>;
  now: number;
  dateFormats?: DateFormats;
  /** Answered questions too, after the open ones. */
  showAnswered?: boolean;
}

/** The offers last worked out, by index, with the pairs set aside they leave out. */
const offersByIndex = new WeakMap<WorkspaceIndex, { rejected: ReadonlySet<string>; offers: Map<string, AnswerOffer> }>();

/**
 * The best answer offered for each open question, by question id, worked
 * out once per index and set of pairs set aside, which the view, the
 * widget, and the lens all ask for after one save.
 */
export function getAnswerOffers(index: WorkspaceIndex, rejected: ReadonlySet<string>): Map<string, AnswerOffer> {
  const cached = offersByIndex.get(index);
  if (cached && cached.rejected === rejected) {
    return cached.offers;
  }
  const offers = measure('Answer offers', () => findAnswerOffers(index, { rejected }), (found) => `${found.size} offers`);
  offersByIndex.set(index, { rejected, offers });
  return offers;
}

/**
 * The questions as rows: the open ones, oldest first, each with the best
 * answer offered for it; then, with `showAnswered`, the answered ones, the
 * most recently answered first.
 */
export function buildQuestionRows(index: WorkspaceIndex, options: QuestionRowOptions): QuestionRow[] {
  const offers = getAnswerOffers(index, options.rejected);
  const questions = options.showAnswered ? listAllQuestions(index) : listOpenQuestions(index);
  return questions.map((question) => toQuestionRow(index, question, offers.get(question.id), options));
}

/** One question as a row. */
export function toQuestionRow(
  index: WorkspaceIndex,
  question: Question,
  offer: AnswerOffer | undefined,
  options: Pick<QuestionRowOptions, 'now' | 'dateFormats'>,
): QuestionRow {
  const tag = firstQuestionTag(question);
  return {
    id: question.id,
    text: questionText(question),
    filePath: question.filePath,
    line: question.lineNumber,
    age: describeQuestionAge(question, options.now, options.dateFormats),
    ...(tag ? { tag } : {}),
    answered: isAnswered(question),
    ...(question.answer ? { answer: question.answer.text } : {}),
    ...(offer ? { offer: toOfferRow(index, offer, options) } : {}),
  };
}

/** An offer as the row under its question draws it. */
function toOfferRow(index: WorkspaceIndex, offer: AnswerOffer, options: Pick<QuestionRowOptions, 'now' | 'dateFormats'>): QuestionOfferRow {
  return {
    kind: offer.kind,
    text: offer.text,
    where: offer.source ?? describeOfferPlace(index, offer, options),
    filePath: offer.filePath,
    line: offer.line,
    key: offer.key,
  };
}

/** Where an offered line is: its note's day and the heading it is under, `Wed, Oct 14 · Access`. */
function describeOfferPlace(index: WorkspaceIndex, offer: AnswerOffer, options: Pick<QuestionRowOptions, 'now' | 'dateFormats'>): string {
  const section = offer.sectionId ? index.sections.get(offer.sectionId) : undefined;
  const heading = section ? headingOf(index, section.id) : undefined;
  const day = offer.at === undefined ? undefined : formatDisplayDate(offer.at, options.dateFormats ?? DEFAULT_DATE_FORMATS, 'short', options.now);
  return [day, heading].filter(Boolean).join(' · ') || offer.filePath;
}

/** The heading an entry is under, its own for a heading, without its tags. */
function headingOf(index: WorkspaceIndex, sectionId: string): string | undefined {
  let section = index.sections.get(sectionId);
  const visited = new Set<string>();
  while (section?.isInline && section.parentSectionId && !visited.has(section.id)) {
    visited.add(section.id);
    section = index.sections.get(section.parentSectionId);
  }
  const heading = section && !section.isInline ? stripTags(section.heading).trim() : '';
  return heading || undefined;
}

/**
 * How long a question has been open, `open 12 days`, or `asked today`;
 * once answered, when, `answered Fri, Oct 9`, or just `answered`.
 */
export function describeQuestionAge(
  question: Pick<Question, 'createdAt' | 'answer'>,
  now: number,
  formats: DateFormats = DEFAULT_DATE_FORMATS,
): string {
  if (question.answer) {
    const at = question.answer.answeredAt;
    return at === undefined ? 'answered' : `answered ${formatDisplayDate(at, formats, 'short', now)}`;
  }
  if (question.createdAt === undefined) {
    return 'open';
  }
  const days = Math.max(0, Math.round((startOfDay(now) - startOfDay(question.createdAt)) / DAY_MS));
  return days === 0 ? 'asked today' : `open ${pluralize(days, 'day')}`;
}

/** One lens above a question: what it says, and what selecting it does. */
export interface QuestionLens {
  title: string;
  tooltip: string;
  /** Opens the Questions view, opens the offered line, answers, or drops. */
  action: 'view' | 'offer' | 'answer' | 'drop';
}

/**
 * The lenses above a question: `Question · open 12 days`, then, when a line
 * may answer it, `1 line may answer it: Wed, Oct 14 · Access`, then Answer…
 * and Drop. An answered one has its first lens alone, `Question · answered
 * Fri, Oct 9`. Under Zen the lens keeps the count and the age, and leaves
 * the two actions out.
 */
export function describeQuestionLenses(row: QuestionRow, options: { zen: boolean }): QuestionLens[] {
  const lenses: QuestionLens[] = [{ title: `Question · ${row.age}`, tooltip: 'Open the Questions view', action: 'view' }];
  if (row.answered) {
    return lenses;
  }
  if (row.offer) {
    lenses.push({
      title: row.offer.kind === 'field' ? `The ${row.offer.where} may answer it: ${row.offer.text}` : `1 line may answer it: ${row.offer.where}`,
      tooltip: row.offer.kind === 'field' ? `Open the note that holds the ${row.offer.where}` : `Open the line: ${row.offer.text}`,
      action: 'offer',
    });
  }
  if (!options.zen) {
    lenses.push(
      { title: 'Answer…', tooltip: 'Write the answer under the question, typed or taken from a line', action: 'answer' },
      { title: 'Drop', tooltip: 'Drop the question: its box becomes [-]', action: 'drop' },
    );
  }
  return lenses;
}

/** A row's description: its age, then its first tag, `open 12 days · #team/rates`. */
export function describeQuestionRow(row: Pick<QuestionRow, 'age' | 'tag'>): string {
  return [row.age, row.tag].filter(Boolean).join(' · ');
}

/**
 * One question as a search page draws it, on its Questions tab or a
 * person's Between you card: its words, its line, its age and first tag,
 * and its answer once it has one. No answer is offered there.
 */
export function toSearchPageQuestion(
  index: WorkspaceIndex,
  question: Question,
  options: Pick<QuestionRowOptions, 'now' | 'dateFormats'>,
): SearchPageQuestion {
  const row = toQuestionRow(index, question, undefined, options);
  return {
    id: row.id,
    text: row.text,
    filePath: row.filePath,
    line: row.line,
    detail: describeQuestionRow(row),
    answered: row.answered,
    ...(row.answer ? { answer: row.answer } : {}),
  };
}
