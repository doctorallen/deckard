import * as vscode from 'vscode';

import { onIndexUpdateInTurn, VIEW_PRIORITY, ViewUpdateSource } from '../../core/workspace/publishing';
import { listOpenQuestions } from '../../domain/index/questions';
import { measure } from '../../shared/timing';
import { escapeMarkdown, pluralize } from '../../shared/text';
import type { WorkspaceIndex } from '../../domain/model';
import { buildQuestionRows, describeQuestionRow, type QuestionOfferRow, type QuestionRow } from '../state/questionsState';
import { onDidBuildLineIndex } from '../state/lineIndexBuild';
import { DATE_FORMAT_SETTINGS, readDateFormats } from '../commands/datePrompt';
import { speakRow } from './spokenRow';

/** What the view reads from the indexer: its snapshots, when they change, and where each note is. */
export interface QuestionsTreeIndexSource extends ViewUpdateSource {
  getSnapshot(): WorkspaceIndex;
  getUri(filePath: string): vscode.Uri | undefined;
}

/** What the view reads beside the index: the offered answers set aside with Not it, and when that changes. */
export interface QuestionsTreeMemory {
  rejected(): ReadonlySet<string>;
  readonly onDidChange: vscode.Event<void>;
}

/** A row of the Questions view: a question, or the answer offered for it under it. */
export type QuestionsNode =
  | { kind: 'question'; id: string; row: QuestionRow }
  | { kind: 'offer'; questionId: string; offer: QuestionOfferRow };

/** The context key that says the view lists answered questions too, which its title bar's toggle reads. */
export const SHOW_ANSWERED_CONTEXT = 'deckard.questionsShowAnswered';

/**
 * The Questions view in the Deckard sidebar: each open question, oldest
 * first, with its age and first tag, and under one an answer may be
 * offered for, that answer, with Use as answer and Not it beside it.
 * Selecting a question opens its line. Its badge is the open count.
 * Show answered lists the answered ones after them
 * (docs/implementation/38-questions.md § Where questions show).
 */
export class QuestionsTreeProvider implements vscode.TreeDataProvider<QuestionsNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<QuestionsNode | undefined>();
  public readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [this.changeEmitter];
  private view: vscode.TreeView<QuestionsNode> | undefined;
  private showAnswered = false;

  /** Redraws after each index update, in a turn of its own, when an offer is set aside, and when a day may have turned. */
  public constructor(
    private readonly indexer: QuestionsTreeIndexSource,
    private readonly memory: QuestionsTreeMemory,
  ) {
    this.disposables.push(
      onIndexUpdateInTurn(
        indexer,
        { name: 'Questions', priority: () => (this.view?.visible ? VIEW_PRIORITY.visible : VIEW_PRIORITY.hidden) },
        () => this.refresh(),
      ),
      memory.onDidChange(() => this.refresh()),
      // The offers are left out while the line index is first built.
      onDidBuildLineIndex(() => this.refresh()),
      // What counts as today moves at midnight, and with it each question's age.
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.refresh();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (Object.values(DATE_FORMAT_SETTINGS).some((key) => event.affectsConfiguration(`deckard.${key}`))) {
          this.refresh();
        }
      }),
    );
    void vscode.commands.executeCommand('setContext', SHOW_ANSWERED_CONTEXT, false);
  }

  /** The view this provider fills, which says whether it is on screen and carries the badge. */
  public attach(view: vscode.TreeView<QuestionsNode>): void {
    this.view = view;
    this.refresh();
  }

  /** Lists the answered questions after the open ones, or stops. */
  public setShowAnswered(show: boolean): void {
    this.showAnswered = show;
    void vscode.commands.executeCommand('setContext', SHOW_ANSWERED_CONTEXT, show);
    this.refresh();
  }

  /** Redraws the rows and the badge. */
  public refresh(): void {
    this.changeEmitter.fire(undefined);
    this.updateBadge();
  }

  /** The questions at the top, or the offer under one. */
  public getChildren(node?: QuestionsNode): QuestionsNode[] {
    if (node) {
      return node.kind === 'question' && node.row.offer ? [{ kind: 'offer', questionId: node.id, offer: node.row.offer }] : [];
    }
    const rows = measure(
      'Questions',
      () =>
        buildQuestionRows(this.indexer.getSnapshot(), {
          rejected: this.memory.rejected(),
          now: Date.now(),
          dateFormats: readDateFormats(),
          showAnswered: this.showAnswered,
        }),
      (built) => `${built.length} questions`,
    );
    return rows.map((row) => ({ kind: 'question', id: row.id, row }));
  }

  /** A row: a question, which opens its line, or the answer offered for one, which opens where it is. */
  public getTreeItem(node: QuestionsNode): vscode.TreeItem {
    return node.kind === 'question' ? this.createQuestionItem(node.row) : this.createOfferItem(node.questionId, node.offer);
  }

  /** The badge: how many questions are open. */
  private updateBadge(): void {
    if (!this.view) {
      return;
    }
    const open = listOpenQuestions(this.indexer.getSnapshot()).length;
    this.view.badge = open > 0 ? { value: open, tooltip: `${pluralize(open, 'open question')}` } : undefined;
  }

  /** A question's row: its words, its age and first tag, and its icon, open or answered. */
  private createQuestionItem(row: QuestionRow): vscode.TreeItem {
    const item = new vscode.TreeItem(
      row.text,
      row.offer ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    );
    item.id = `question:${row.id}`;
    item.description = describeQuestionRow(row);
    const spoken = speakRow(row.text, item.description);
    if (spoken) {
      item.accessibilityInformation = spoken;
    }
    item.iconPath = new vscode.ThemeIcon(row.answered ? 'pass' : 'question');
    item.contextValue = row.answered ? 'deckardAnsweredQuestion' : 'deckardQuestion';
    const tooltip = new vscode.MarkdownString(
      [`**${escapeMarkdown(row.text)}**`, '', `${escapeMarkdown(describeQuestionRow(row))} · ${escapeMarkdown(row.filePath)}`, ...(row.answer ? ['', `Answer: ${escapeMarkdown(row.answer)}`] : [])].join('\n'),
    );
    item.tooltip = tooltip;
    item.command = this.openCommand(row.filePath, row.line, 'Open Question');
    return item;
  }

  /** The row of the answer offered for a question: where it is, and its words. */
  private createOfferItem(questionId: string, offer: QuestionOfferRow): vscode.TreeItem {
    const item = new vscode.TreeItem(`May answer: ${offer.where}`, vscode.TreeItemCollapsibleState.None);
    item.id = `question:${questionId}:offer:${offer.key}`;
    item.description = offer.text;
    item.iconPath = new vscode.ThemeIcon(offer.kind === 'field' ? 'symbol-field' : 'quote');
    item.contextValue = 'deckardQuestionOffer';
    item.tooltip = new vscode.MarkdownString(
      `${escapeMarkdown(offer.text)}\n\n${offer.kind === 'field' ? `The ${escapeMarkdown(offer.where)}` : `Written ${escapeMarkdown(offer.where)}`}, in ${escapeMarkdown(offer.filePath)}. **Use as answer** writes it under the question; **Not it** sets it aside.`,
    );
    item.command = this.openCommand(offer.filePath, offer.line, 'Open the Line');
    return item;
  }

  /** Opens a note at a line, in the editor. */
  private openCommand(filePath: string, line: number, title: string): vscode.Command | undefined {
    const uri = this.indexer.getUri(filePath);
    if (!uri) {
      return undefined;
    }
    const position = new vscode.Position(Math.max(line - 1, 0), 0);
    return { command: 'vscode.open', title, arguments: [uri, { selection: new vscode.Range(position, position), preview: false }] };
  }

  /** Stops listening. */
  public dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
  }
}
