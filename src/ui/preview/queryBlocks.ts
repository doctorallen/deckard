import type MarkdownIt from 'markdown-it';
import { isCancelledTask } from '../../domain/tasks/taskStatuses';
import * as vscode from 'vscode';

import { QueryContext } from '../../domain/query/queryContext';
import { measure } from '../../shared/timing';
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
import { WorkspaceIndex } from '../../domain/model';
import { clickTask, TaskWrites } from '../commands/taskActions';
import {
  createSessionToken,
  createTaskToggleHref,
  readTaskToggleLink,
} from './previewTaskLinks';

/**
 * What the blocks need from the indexer: its published snapshots, and the
 * index's path for a note, which `this` in a block's query names.
 */
interface IndexSource {
  readonly onDidUpdate: vscode.Event<WorkspaceIndex>;
  getFilePath?(uri: vscode.Uri): string;
}

/**
 * What lets a block's checkboxes act: the address of Deckard's URI handler,
 * such as `vscode://esperinnovations.deckard-notes`, and the writes that
 * complete a task.
 */
export interface QueryBlockActions {
  readonly base: string;
  readonly writes: TaskWrites;
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
  /** Known only to the previews this session draws, so no other page's link can tick a box. */
  private readonly token = createSessionToken();
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[];

  public readonly onDidChangeCodeLenses = this.changeEmitter.event;

  /**
   * Starts listening at once: each published index is kept for the lenses
   * and, once a preview has drawn a block, refreshes the open previews.
   */
  public constructor(private readonly indexer: IndexSource, private readonly actions?: QueryBlockActions) {
    this.disposables = [
      ...(actions ? [vscode.window.registerUriHandler({ handleUri: (uri) => this.handleUri(uri) })] : []),
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
      getQueryContext: (now: number) => readQueryContext(now),
      // VS Code's preview hands each render the document it draws.
      getNotePath: (env: unknown) => {
        const uri = readEnvDocument(env);
        return uri ? this.notePathOf(uri) : undefined;
      },
      ...(this.actions
        ? {
            getTaskHref: (item: { id: string; completed?: boolean; cancelled?: boolean }) =>
              createTaskToggleHref(this.actions?.base ?? '', {
                taskId: item.id,
                // A cancelled task's box is closed, so it reopens.
                completed: item.completed !== true && item.cancelled !== true,
                token: this.token,
              }),
          }
        : {}),
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
    const notePath = this.notePathOf(document.uri);
    return measure(
      'Query block lenses',
      () =>
        findQueryBlocks(document.getText()).flatMap((block) =>
          this.createCodeLenses(block, queryContext, notePath),
        ),
      (lenses) => `${lenses.length} lenses`,
    );
  }

  /**
   * A checkbox's link, opened from a preview: completes or reopens the task
   * it was drawn for, as its box on any page does. A link from an earlier
   * session, or for a task since changed or gone, writes nothing and draws
   * the previews again, so the next box selected is a current one.
   */
  public async handleUri(uri: vscode.Uri): Promise<void> {
    const actions = this.actions;
    // VS Code hands the query over decoded, and writes it out again with
    // every = and & escaped, so it is read as given rather than from
    // toString().
    const link = readTaskToggleLink(uri.path, uri.query, this.token);
    if (!actions || link.kind === 'other') {
      return;
    }
    if (link.kind === 'stale') {
      void vscode.window.showInformationMessage(
        'This preview was drawn before Deckard last started, so its checkbox changed nothing. It is drawn again now: select the box once more.',
      );
      await refreshMarkdownPreviews();
      return;
    }
    const task = this.index?.tasks.get(link.request.taskId);
    if (!task || (task.completed || isCancelledTask(task)) === link.request.completed) {
      if (!task) {
        void vscode.window.showInformationMessage(
          'That task has changed since the preview was drawn, so nothing was written. The preview is drawn again now.',
        );
      }
      await refreshMarkdownPreviews();
      return;
    }
    await clickTask(actions.writes, task, link.request.completed);
  }

  /** Stops listening to the indexer and unregisters the lens provider. */
  public dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  /** The index's path for a note, which `this` in its blocks names; undefined for an indexer that cannot say. */
  private notePathOf(uri: vscode.Uri): string | undefined {
    return this.indexer.getFilePath?.(uri);
  }

  /** The lenses above one block, its query run in `queryContext`, `this` the note at `notePath`. */
  private createCodeLenses(block: QueryBlockSource, queryContext: QueryContext, notePath: string | undefined): vscode.CodeLens[] {
    const range = new vscode.Range(block.startLine, 0, block.startLine, 0);
    const label = (title: string): vscode.CodeLens =>
      new vscode.CodeLens(range, { title, command: '' });

    if (!this.index) {
      return [label('Deckard is indexing the workspace…')];
    }

    const snapshot = getQueryBlockSnapshot(this.index, block.query, block.options, { queryContext, ...(notePath ? { notePath } : {}) });
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
 * The document a preview render draws, from markdown-it's `env`, where VS
 * Code's Markdown extension puts it as `currentDocument`; undefined from a
 * render that does not say.
 */
function readEnvDocument(env: unknown): vscode.Uri | undefined {
  const document = (env as { currentDocument?: unknown } | undefined)?.currentDocument;
  if (document instanceof vscode.Uri) {
    return document;
  }
  // A URI from another extension's copy of the API reads the same written out.
  const scheme = (document as { scheme?: unknown } | undefined)?.scheme;
  return typeof scheme === 'string' ? vscode.Uri.parse(String(document)) : undefined;
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
