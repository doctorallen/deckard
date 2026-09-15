import MarkdownIt = require('markdown-it');
import * as vscode from 'vscode';

import { measure } from '../../core/timing';
import { WorkspaceIndex } from '../../core/types';
import { isMarkdownFile } from '../../core/workspace/scanner';
import {
  describeQueryBlockCounts,
  findQueryBlocks,
  getQueryBlockSnapshot,
  QueryBlockSource,
} from '../state/queryBlockState';
import { addQueryBlockRenderer } from './queryBlockHtml';

interface IndexSource {
  readonly onDidUpdate: vscode.Event<WorkspaceIndex>;
}

/**
 * Connects query blocks to VS Code: results in the Markdown preview, and a
 * summary with an **Open in search** action above each fence in the editor.
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

  public constructor(indexer: IndexSource) {
    this.disposables = [
      this.changeEmitter,
      indexer.onDidUpdate((index) => {
        this.index = index;
        this.changeEmitter.fire();
        // Refreshing re-renders every open preview, so it waits until a
        // preview has actually drawn a block.
        if (this.previewReadsIndex) {
          void refreshMarkdownPreviews();
        }
      }),
      vscode.languages.registerCodeLensProvider({ pattern: '**/*.md' }, this),
    ];
  }

  /**
   * Called by VS Code's Markdown extension for every preview engine it builds.
   */
  public extendMarkdownIt(md: MarkdownIt): MarkdownIt {
    return addQueryBlockRenderer(md, {
      getIndex: () => this.index,
      onDidRender: () => {
        this.previewReadsIndex = true;
      },
    });
  }

  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!isMarkdownFile(document.uri)) {
      return [];
    }
    return measure(
      'Query block lenses',
      () =>
        findQueryBlocks(document.getText()).flatMap((block) =>
          this.createCodeLenses(block),
        ),
      (lenses) => `${lenses.length} lenses`,
    );
  }

  public dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  private createCodeLenses(block: QueryBlockSource): vscode.CodeLens[] {
    const range = new vscode.Range(block.startLine, 0, block.startLine, 0);
    const label = (title: string): vscode.CodeLens =>
      new vscode.CodeLens(range, { title, command: '' });

    if (!this.index) {
      return [label('Deckard is indexing the workspace…')];
    }

    const snapshot = getQueryBlockSnapshot(
      this.index,
      block.query,
      block.options,
    );
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
        title: 'Open in search',
        tooltip: 'Open this query on the Dashboard’s Search tab',
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
