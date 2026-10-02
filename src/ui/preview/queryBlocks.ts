import type MarkdownIt from 'markdown-it';
import * as vscode from 'vscode';

import { QueryContext } from '../../domain/query/queryContext';
import { measure } from '../../shared/timing';
import { WorkspaceIndex } from '../../core/types';
import { isMarkdownFile } from '../../core/workspace/scanner';
import {
  onIndexUpdateInTurn,
  VIEW_PRIORITY,
} from '../../core/workspace/publishing';
import {
  describeQueryBlockCounts,
  findQueryBlocks,
  getQueryBlockSnapshot,
  QueryBlockSource,
} from '../state/queryBlockState';
import { addNoteEmbedRenderer } from './noteEmbeds';
import { addQueryBlockRenderer } from './queryBlockHtml';
import { readQueryContext } from '../commands/queryContext';

/** The one thing the blocks need from the indexer: its published snapshots. */
interface IndexSource {
  readonly onDidUpdate: vscode.Event<WorkspaceIndex>;
}

/**
 * Connects query blocks to VS Code: results in the Markdown preview, and a
 * summary with an **Open search page** action above each fence in the editor.
 *
 * Both surfaces read the snapshot the indexer last published rather than
 * building one per block, and both refresh when it changes, so a block keeps
 * up with edits made anywhere in the workspace, not only in its own note.
 * A block's query runs once per index update, however often the lenses and
 * the preview ask for it while its note is being edited.
 */
export class QueryBlocks implements vscode.CodeLensProvider, vscode.Disposable {
  private index: WorkspaceIndex | undefined;
  private previewReadsIndex = false;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[];

  public readonly onDidChangeCodeLenses = this.changeEmitter.event;

  /**
   * Starts listening at once: each published index is kept for the lenses
   * and, once a preview has drawn a block, refreshes the open previews.
   */
  public constructor(indexer: IndexSource) {
    this.disposables = [
      this.changeEmitter,
      indexer.onDidUpdate((index) => {
        this.index = index;
        this.changeEmitter.fire();
      }),
      // Refreshing re-renders every open preview, so it waits until a
      // preview has actually drawn a block, and for a turn of its own.
      onIndexUpdateInTurn(
        indexer,
        { name: 'query block previews', priority: () => VIEW_PRIORITY.visible },
        () => {
          if (this.previewReadsIndex) {
            void refreshMarkdownPreviews();
          }
        },
      ),
      vscode.languages.registerCodeLensProvider({ pattern: '**/*.md' }, this),
    ];
  }

  /**
   * Called by VS Code's Markdown extension for every preview engine it builds.
   */
  public extendMarkdownIt(md: MarkdownIt): MarkdownIt {
    const source = {
      getIndex: () => this.index,
      onDidRender: () => {
        this.previewReadsIndex = true;
      },
      getStatusNamespace: () =>
        vscode.workspace
          .getConfiguration('deckard')
          .get<string>('board.statusNamespace', 'status')
          .trim() || 'status',
      getQueryContext: (now: number) => readQueryContext(now),
    };
    return addNoteEmbedRenderer(addQueryBlockRenderer(md, source), source);
  }

  /**
   * The lenses above each query block in a Markdown note: its counts, or the
   * error that stops it, and the action that opens it on a search page. Any
   * other file gets none.
   */
  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!isMarkdownFile(document.uri)) {
      return [];
    }
    const queryContext = readQueryContext();
    return measure(
      'Query block lenses',
      () =>
        findQueryBlocks(document.getText()).flatMap((block) =>
          this.createCodeLenses(block, queryContext),
        ),
      (lenses) => `${lenses.length} lenses`,
    );
  }

  /** Stops listening to the indexer and unregisters the lens provider. */
  public dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  /** The lenses above one block, its query run in `queryContext`. */
  private createCodeLenses(block: QueryBlockSource, queryContext: QueryContext): vscode.CodeLens[] {
    const range = new vscode.Range(block.startLine, 0, block.startLine, 0);
    const label = (title: string): vscode.CodeLens =>
      new vscode.CodeLens(range, { title, command: '' });

    if (!this.index) {
      return [label('Deckard is indexing the workspace…')];
    }

    const snapshot = getQueryBlockSnapshot(this.index, block.query, block.options, { queryContext });
    const warnings = snapshot.messages
      .filter((message) => message.severity === 'warning')
      .map((message) => label(`Warning: ${message.text}`));

    if (snapshot.hasError) {
      const error = snapshot.messages.find(
        (message) => message.severity === 'error',
      );
      return [label(`Deckard query: ${error?.text ?? 'cannot run'}`), ...warnings];
    }

    return [
      label(describeQueryBlockCounts(snapshot)),
      new vscode.CodeLens(range, {
        title: 'Open search page',
        tooltip: 'Open this query on a search page',
        command: 'deckard.searchNotes',
        arguments: [snapshot.query],
      }),
      ...warnings,
    ];
  }
}

/**
 * Re-renders open Markdown previews.
 *
 * The command belongs to VS Code's built-in Markdown extension, so failing
 * only means that extension is disabled and there is no preview to refresh.
 */
async function refreshMarkdownPreviews(): Promise<void> {
  try {
    await vscode.commands.executeCommand('markdown.preview.refresh');
  } catch {
    // Nothing to refresh.
  }
}
