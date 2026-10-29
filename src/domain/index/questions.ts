/**
 * The questions across the workspace: every note's `- [?]` lines, which
 * are not tasks, read once per index (docs/implementation/38-questions.md).
 */
import type { Question, WorkspaceIndex } from '../model';
import { isPersonTag } from '../markdown/parser';

/**
 * Every question by id, in index order, worked out once per index: an
 * index is replaced, never changed, when a note changes.
 */
const questionsByIndex = new WeakMap<WorkspaceIndex, ReadonlyMap<string, Question>>();

/** Every question in the workspace, by id, in index order. */
export function getQuestions(index: WorkspaceIndex): ReadonlyMap<string, Question> {
  const cached = questionsByIndex.get(index);
  if (cached) {
    return cached;
  }
  const questions = new Map<string, Question>();
  index.files.forEach((file) => file.questions?.forEach((question) => questions.set(question.id, question)));
  questionsByIndex.set(index, questions);
  return questions;
}

/** Whether a question has its answer: an `Answer:` line under it. */
export function isAnswered(question: Pick<Question, 'answer'>): boolean {
  return question.answer !== undefined;
}

/**
 * The questions still open, oldest first: by the day each was asked, then
 * by note and line, so a note's questions keep their order.
 */
export function listOpenQuestions(index: WorkspaceIndex): Question[] {
  return [...getQuestions(index).values()].filter((question) => !isAnswered(question)).sort(compareByAge);
}

/** Every question, the open ones first and oldest first, then the answered ones, most recently answered first. */
export function listAllQuestions(index: WorkspaceIndex): Question[] {
  const all = [...getQuestions(index).values()];
  const answered = all.filter(isAnswered).sort(
    (left, right) => (right.answer?.answeredAt ?? right.updatedAt ?? 0) - (left.answer?.answeredAt ?? left.updatedAt ?? 0) || compareByAge(left, right),
  );
  return [...listOpenQuestions(index), ...answered];
}

/** Older first: by the day asked, a question with none last, then by note and line. */
function compareByAge(left: Question, right: Question): number {
  return (
    (left.createdAt ?? Number.MAX_SAFE_INTEGER) - (right.createdAt ?? Number.MAX_SAFE_INTEGER) ||
    left.filePath.localeCompare(right.filePath) ||
    left.lineNumber - right.lineNumber
  );
}

/**
 * The open questions that name a person on their own line, oldest first:
 * what a person's card lists under To ask (plan 36). `person` is the
 * person's tag key, `@sam` or `#person/sam`.
 */
export function listQuestionsMentioning(index: WorkspaceIndex, person: string): Question[] {
  if (!isPersonTag(person)) {
    return [];
  }
  const wanted = person.toLowerCase();
  return listOpenQuestions(index).filter((question) =>
    (question.associationTagGroups ?? []).some((group) => group.some((tag) => tag.key.toLowerCase() === wanted)),
  );
}

/**
 * Every tag a `tag:` search finds a question by: its own line, the heading
 * it is under and every heading above that, and its note's front matter,
 * as a task is found.
 */
export function readQuestionTagKeys(index: WorkspaceIndex, question: Question): Set<string> {
  const tagKeys = new Set(question.tags);
  let sectionId = question.sectionId;
  const visited = new Set<string>();
  while (sectionId && !visited.has(sectionId)) {
    visited.add(sectionId);
    const section = index.sections.get(sectionId);
    if (!section) {
      break;
    }
    section.tags.forEach((tagKey) => tagKeys.add(tagKey));
    section.headingTags?.forEach((tag) => tagKeys.add(tag.key));
    sectionId = section.parentSectionId;
  }
  return tagKeys;
}

/**
 * A question's words as a list shows them: as written, the tags at the end
 * included, as a task's title is shown.
 */
export function questionText(question: Pick<Question, 'title'>): string {
  return question.title;
}

/**
 * The first tag a question is under that its own line does not write, which
 * a row shows beside its age: the tags it writes are in its words already,
 * as a card's are in its title.
 */
export function firstQuestionTag(question: Pick<Question, 'associationTagGroups' | 'tags' | 'tagLabels'>): string | undefined {
  const own = new Set((question.associationTagGroups?.[0] ?? []).map((tag) => tag.key.toLowerCase()));
  const inherited = question.tags.find((key) => !own.has(key.toLowerCase()));
  return inherited === undefined ? undefined : question.tagLabels[inherited] ?? inherited;
}
