import * as vscode from 'vscode';

import type { QuestionMemory } from '../../core/storage/questionMemory';
import { getQuestions, questionText } from '../../domain/index/questions';
import type { Question, WorkspaceIndex } from '../../domain/model';
import { notItKey } from '../../domain/ranking/answerOffers';
import type { QuestionService, QuestionTarget, QuestionWrite } from '../../services/questionService';
import { getAnswerOffers, toQuestionRow, type QuestionOfferRow } from '../state/questionsState';
import { readDateFormats } from './datePrompt';
import { createWikiLink } from './insertLink';
import { describeRejectedEdit, noteName, reportFailure, reportStale } from './notify';
import type { WriteHandle } from './workspaceWrites';

/**
 * What Questions' commands do: Answer…, which writes an answer under a
 * question, typed or taken from the line offered; Use as answer and Not
 * it, on an offered line; and Drop (docs/implementation/38-questions.md).
 */

/** What answering, dropping, and setting aside offers write through. */
export interface QuestionWrites {
  questions: QuestionService<vscode.Uri, WriteHandle>;
  /** The offered answers set aside with Not it, and Find's missed searches. */
  memory: QuestionMemory;
}

/** What a question command reads: the index, as the indexer has it now. */
export interface QuestionIndexSource {
  readonly ready: Promise<void>;
  getSnapshot(): WorkspaceIndex;
}

/**
 * What a question command is given: a question's id, from a lens, a page,
 * or the assistant; a Questions view row; or a question parsed from a note
 * open in the editor, whose line the write checks.
 */
export type QuestionArgument = string | { id: string } | { question: QuestionTarget & { id: string } } | undefined;

/** The question an argument names, read again from the index when it is there. */
export function resolveQuestion(index: WorkspaceIndex, argument: QuestionArgument): (QuestionTarget & Pick<Question, 'id'>) | undefined {
  if (!argument) {
    return undefined;
  }
  if (typeof argument === 'string') {
    return getQuestions(index).get(argument);
  }
  if ('question' in argument) {
    return getQuestions(index).get(argument.question.id) ?? argument.question;
  }
  return getQuestions(index).get(argument.id);
}

/** An offered answer an argument names: a view's offer row, or the one offered for a question. */
export function resolveOffer(
  index: WorkspaceIndex,
  memory: Pick<QuestionMemory, 'rejected'>,
  argument: QuestionArgument | { questionId: string; offer: QuestionOfferRow },
): { question: Question; offer: QuestionOfferRow } | undefined {
  if (argument && typeof argument === 'object' && 'offer' in argument) {
    const question = getQuestions(index).get(argument.questionId);
    return question ? { question, offer: argument.offer } : undefined;
  }
  const question = resolveQuestion(index, argument as QuestionArgument);
  const found = question ? getQuestions(index).get(question.id) : undefined;
  if (!found) {
    return undefined;
  }
  const offer = getAnswerOffers(index, memory.rejected()).get(found.id);
  const row = offer ? toQuestionRow(index, found, offer, { now: Date.now(), dateFormats: readDateFormats() }).offer : undefined;
  return row ? { question: found, offer: row } : undefined;
}

/** An answer picked in Answer…: words typed, or the offered line. */
interface AnswerPick extends vscode.QuickPickItem {
  answer: { text: string; link?: string };
}

/**
 * Answer…: asks for the answer, typed, or the line offered for it, picked,
 * which writes its words and a link to it, and writes it under the question.
 */
export async function answerQuestion(source: QuestionIndexSource, writes: QuestionWrites, argument: QuestionArgument): Promise<boolean> {
  await source.ready;
  const index = source.getSnapshot();
  const question = resolveQuestion(index, argument) ?? (await pickQuestion(index));
  if (!question) {
    return false;
  }
  const offered = resolveOffer(index, writes.memory, question.id);
  const picked = await askForAnswer(question, offered ? toAnswerPick(index, offered.offer) : undefined);
  return picked ? writeAnswer(writes, question, picked) : false;
}

/** Use as answer: writes the offered line's words, and a link to it, under its question. */
export async function useOffer(
  source: QuestionIndexSource,
  writes: QuestionWrites,
  argument: QuestionArgument | { questionId: string; offer: QuestionOfferRow },
): Promise<boolean> {
  await source.ready;
  const index = source.getSnapshot();
  const offered = resolveOffer(index, writes.memory, argument);
  if (!offered) {
    void vscode.window.showInformationMessage('That question has no answer to offer now.');
    return false;
  }
  return writeAnswer(writes, offered.question, toAnswerPick(index, offered.offer).answer);
}

/** Not it: sets the offered line aside for its question, for good. */
export async function rejectOffer(
  source: QuestionIndexSource,
  writes: QuestionWrites,
  argument: QuestionArgument | { questionId: string; offer: QuestionOfferRow },
): Promise<void> {
  await source.ready;
  const offered = resolveOffer(source.getSnapshot(), writes.memory, argument);
  if (offered) {
    await writes.memory.reject(notItKey(offered.question.id, offered.offer.key));
  }
}

/** Drop: writes the question's box as the cancelled status's, `[?]` becoming `[-]`. */
export async function dropQuestion(source: QuestionIndexSource, writes: QuestionWrites, argument: QuestionArgument): Promise<boolean> {
  await source.ready;
  const question = resolveQuestion(source.getSnapshot(), argument);
  if (!question) {
    return false;
  }
  const result = await writes.questions.drop(question);
  return sayWritten(result, question, {
    done: `Dropped ${quote(question)}.`,
    undone: `Put ${quote(question)} back.`,
  });
}

/** Writes an answer under a question, and says what became of it. */
async function writeAnswer(writes: QuestionWrites, question: QuestionTarget, answer: AnswerPick['answer']): Promise<boolean> {
  const result = await writes.questions.answer(question, answer);
  return sayWritten(result, question, {
    done: `Answered ${quote(question)}.`,
    undone: `Took the answer back out.`,
  });
}

/** Says what a write to a question did: with an Undo when it was written, else why not. */
function sayWritten(
  result: QuestionWrite<vscode.Uri, WriteHandle>,
  question: QuestionTarget,
  words: { done: string; undone: string },
): boolean {
  switch (result.kind) {
    case 'written':
      result.handle.offerUndo(words.done, { guard: 'latest', done: words.undone });
      return true;
    case 'missing':
      void reportFailure({
        outcome: `Deckard could not find ${question.filePath}, so nothing was written.`,
        fix: 'It may have been moved or deleted since Deckard last read it.',
      });
      return false;
    case 'stale':
      void reportStale([result.uri]);
      return false;
    case 'rejected':
      void reportFailure(describeRejectedEdit(noteName(result.uri)));
      return false;
    case 'failed':
      void reportFailure({ outcome: `Deckard could not write to ${noteName(result.uri)}, so nothing was written.`, error: result.error });
      return false;
  }
}

/** A question in quotes, cut to fit a message. */
function quote(question: Pick<Question, 'title'>): string {
  const words = questionText(question);
  return `“${words.length > 60 ? `${words.slice(0, 59)}…` : words}”`;
}

/** An offered answer as Answer… lists it, and what writing it writes: its words and a link to where it is. */
function toAnswerPick(index: WorkspaceIndex, offer: QuestionOfferRow): AnswerPick {
  const link = createWikiLink(index, offer.filePath, offer.kind === 'line' ? sectionAt(index, offer) : undefined).text;
  return {
    label: `$(quote) ${offer.text}`,
    description: offer.where,
    detail: offer.kind === 'field' ? 'Write this value, with a link to the note that holds it' : 'Write this line\'s words, with a link to it',
    alwaysShow: true,
    answer: { text: offer.text, link },
  };
}

/** The entry an offered line is written in, which its link names the heading of. */
function sectionAt(index: WorkspaceIndex, offer: Pick<QuestionOfferRow, 'filePath' | 'line'>): string | undefined {
  const file = index.files.get(offer.filePath);
  const containing = file?.sections.filter((section) => section.startLine <= offer.line && section.endLine >= offer.line) ?? [];
  return containing.sort((left, right) => right.startLine - left.startLine)[0]?.id;
}

/**
 * Asks for an answer: the words typed, offered first as the reader types,
 * or the line offered for the question, when there is one.
 */
function askForAnswer(question: QuestionTarget, offered: AnswerPick | undefined): Promise<AnswerPick['answer'] | undefined> {
  const pick = vscode.window.createQuickPick<AnswerPick>();
  pick.title = `Answer: ${questionText(question)}`;
  pick.placeholder = offered ? 'Type the answer, or pick the line that may answer it' : 'Type the answer';
  pick.matchOnDescription = false;
  pick.items = offered ? [offered] : [];
  pick.onDidChangeValue((value) => {
    const typed: AnswerPick[] = value.trim()
      ? [{ label: `$(edit) ${value.trim()}`, description: 'Write this answer', alwaysShow: true, answer: { text: value.trim() } }]
      : [];
    pick.items = [...typed, ...(offered ? [offered] : [])];
  });
  return new Promise((resolve) => {
    let chosen: AnswerPick['answer'] | undefined;
    pick.onDidAccept(() => {
      chosen = pick.selectedItems[0]?.answer;
      pick.hide();
    });
    pick.onDidHide(() => {
      pick.dispose();
      resolve(chosen);
    });
    pick.show();
  });
}

/** Asks which open question to answer, when Answer… is run with none. */
async function pickQuestion(index: WorkspaceIndex): Promise<Question | undefined> {
  const now = Date.now();
  const items = [...getQuestions(index).values()]
    .filter((question) => question.answer === undefined)
    .map((question) => {
      const row = toQuestionRow(index, question, undefined, { now, dateFormats: readDateFormats() });
      return { label: row.text, description: [row.age, row.tag].filter(Boolean).join(' · '), question };
    });
  if (items.length === 0) {
    void vscode.window.showInformationMessage('There are no open questions. Write one as - [?] Who approves access?');
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(items, { title: 'Answer a Question', placeHolder: 'Choose the question to answer' });
  return picked?.question;
}
