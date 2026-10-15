import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { findQuestionSymbol, readTaskStatusSettings } from '../../../domain/tasks/taskStatuses';
import { QuestionsTreeProvider, type QuestionsNode } from '../../views/questionsTree';
import { answerQuestion, dropQuestion, rejectOffer, useOffer, type QuestionArgument } from '../questionActions';
import { settingLabel } from '../notify';
import { registerCommand } from '../runCommand';

/** The search Open as search runs: the questions still open. */
export const OPEN_QUESTIONS_QUERY = 'is:unanswered';

/**
 * Questions: the Questions view in the sidebar and its title bar's Show
 * answered and Open as search; Answer… and Drop, from the view, the editor's
 * lens, and Home; and Use as answer and Not it on an offered line
 * (docs/implementation/38-questions.md).
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer } = services;
  const writes = services.writes.questions;
  const provider = new QuestionsTreeProvider(indexer, writes.memory);
  const view = vscode.window.createTreeView('deckard.questions', { treeDataProvider: provider });
  provider.attach(view);
  context.subscriptions.push(
    provider,
    view,
    registerCommand('deckard.questions.answer', (argument?: QuestionArgument) => answerQuestion(indexer, writes, argument)),
    registerCommand('deckard.questions.drop', (argument?: QuestionArgument) => dropQuestion(indexer, writes, argument)),
    registerCommand('deckard.questions.useOffer', (node?: QuestionsNode) => useOffer(indexer, writes, offerOf(node))),
    registerCommand('deckard.questions.notIt', (node?: QuestionsNode) => rejectOffer(indexer, writes, offerOf(node))),
    registerCommand('deckard.questions.showAnswered', () => provider.setShowAnswered(true)),
    registerCommand('deckard.questions.hideAnswered', () => provider.setShowAnswered(false)),
    registerCommand('deckard.questions.openAsSearch', () => vscode.commands.executeCommand('deckard.searchNotes', OPEN_QUESTIONS_QUERY)),
  );
  void indexer.ready.then(() => logQuestionsOff(services.log));
}

/** What an offer command is given: a view's offer row, or a question, whose offer it means. */
function offerOf(node: QuestionsNode | QuestionArgument): Parameters<typeof useOffer>[2] {
  if (node && typeof node === 'object' && 'kind' in node) {
    return node.kind === 'offer' ? { questionId: node.questionId, offer: node.offer } : node.id;
  }
  return node;
}

/**
 * Says once, in Deckard's log, when questions are off: when the reader's
 * own statuses give `?` to a status of their own and name no question.
 */
function logQuestionsOff(log: { info(message: string): void }): void {
  const statuses = readTaskStatusSettings(vscode.workspace.getConfiguration('deckard'));
  if (findQuestionSymbol(statuses) !== undefined) {
    return;
  }
  const status = statuses.find((each) => each.symbol === '?');
  log.info(`Questions are off: the "${settingLabel('tasks.statuses')}" setting gives [?] to ${status?.name ?? 'a status of its own'}, so - [?] lines are read as that status. Give a status the question type to write questions with its character.`);
}
