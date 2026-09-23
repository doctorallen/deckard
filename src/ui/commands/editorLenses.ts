import * as vscode from 'vscode';

import { measure } from '../../core/timing';
import { ParsedFile, Task, WorkspaceIndex } from '../../core/types';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { findTaskDependencies } from '../state/editorLensState';
import { resolveSourceUri } from './navigation';

interface LensIndexSource {
  readonly ready: Promise<void>;
  readonly onDidUpdate: vscode.Event<WorkspaceIndex>;
  getSnapshot(): WorkspaceIndex;
  getFilePath(uri: vscode.Uri): string;
  parse(uri: vscode.Uri, content: string): ParsedFile;
}

/**
 * A lens whose command, and whatever work finding its locations takes, is
 * built only when VS Code resolves it, so lenses out of view cost nothing.
 */
class ActionLens extends vscode.CodeLens {
  public constructor(
    range: vscode.Range,
    public readonly createCommand: () =>
      vscode.Command | Promise<vscode.Command>,
  ) {
    super(range);
  }
}

/** What each group of lenses reads: the note as it is in the editor. */
interface LensContext {
  document: vscode.TextDocument;
  file: ParsedFile;
  index: WorkspaceIndex;
}

/** One group of lenses, and the `deckard.editor.*` setting that shows it. */
interface LensGroup {
  setting: 'taskDependencies';
  provide(context: LensContext): ActionLens[];
}

/**
 * Lenses that act, beside the counts `EditorReferences` draws: each shows only
 * when there is something to see, so a note with nothing to act on carries
 * none. See docs/editor-lenses.md.
 */
export class EditorLenses
  implements vscode.CodeLensProvider<ActionLens>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[];
  private readonly groups: readonly LensGroup[] = [
    { setting: 'taskDependencies', provide: provideTaskDependencyLenses },
  ];
  /** Before the first scan every other note looks empty. */
  private isReady = false;

  public readonly onDidChangeCodeLenses = this.changeEmitter.event;

  public constructor(private readonly indexer: LensIndexSource) {
    this.disposables = [
      this.changeEmitter,
      indexer.onDidUpdate(() => this.changeEmitter.fire()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard')) {
          this.changeEmitter.fire();
        }
      }),
      vscode.languages.registerCodeLensProvider({ pattern: '**/*.md' }, this),
    ];
    void indexer.ready.then(() => {
      this.isReady = true;
      this.changeEmitter.fire();
    });
  }

  public dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  public provideCodeLenses(document: vscode.TextDocument): ActionLens[] {
    if (!this.isReady || !isMarkdownFile(document.uri)) {
      return [];
    }
    const configuration = vscode.workspace.getConfiguration(
      'deckard.editor',
      document.uri,
    );
    const groups = this.groups.filter((group) =>
      configuration.get<boolean>(group.setting, true),
    );
    if (groups.length === 0) {
      return [];
    }
    return measure(
      'Action lenses',
      () => {
        const context: LensContext = {
          document,
          file: this.indexer.parse(document.uri, document.getText()),
          index: this.indexer.getSnapshot(),
        };
        return groups.flatMap((group) => group.provide(context));
      },
      (lenses) => `${lenses.length} lenses, ${document.lineCount} lines`,
    );
  }

  public async resolveCodeLens(lens: ActionLens): Promise<ActionLens> {
    lens.command = await lens.createCommand();
    return lens;
  }
}

/**
 * Above a task that waits on an open task, or holds one up: how many, listed
 * in the references peek. A `⛔` name no task carries is said outright.
 */
function provideTaskDependencyLenses({
  document,
  file,
  index,
}: LensContext): ActionLens[] {
  return findTaskDependencies(file, index).flatMap((task) => {
    const range = new vscode.Range(task.line, 0, task.line, 0);
    const lenses: ActionLens[] = [];
    if (task.waitingOn.length > 0) {
      lenses.push(
        createTasksLens(
          document.uri,
          range,
          `Waiting on ${pluralize(task.waitingOn.length, 'open task')}`,
          task.waitingOn,
        ),
      );
    }
    if (task.blocking.length > 0) {
      lenses.push(
        createTasksLens(
          document.uri,
          range,
          `Blocks ${pluralize(task.blocking.length, 'open task')}`,
          task.blocking,
        ),
      );
    }
    if (task.missingIds.length > 0) {
      lenses.push(
        new ActionLens(range, () => ({
          title: `No task has 🆔 ${task.missingIds.join(', ')}`,
          tooltip:
            'This task waits on a name no task in the workspace carries: a typo, or a task since deleted',
          command: '',
        })),
      );
    }
    return lenses;
  });
}

/** A count that lists tasks in VS Code's references peek. */
function createTasksLens(
  documentUri: vscode.Uri,
  range: vscode.Range,
  title: string,
  tasks: readonly Task[],
): ActionLens {
  return new ActionLens(range, async () => ({
    title,
    tooltip: 'Show them in the references view',
    command: 'editor.action.showReferences',
    arguments: [documentUri, range.start, await locateTasks(tasks)],
  }));
}

async function locateTasks(tasks: readonly Task[]): Promise<vscode.Location[]> {
  const uris = new Map<string, vscode.Uri | undefined>();
  for (const task of tasks) {
    if (!uris.has(task.filePath)) {
      uris.set(task.filePath, await resolveSourceUri(task.filePath));
    }
  }
  return tasks.flatMap((task) => {
    const uri = uris.get(task.filePath);
    return uri
      ? [
          new vscode.Location(
            uri,
            new vscode.Position(
              task.lineNumber - 1,
              Math.max(task.checkboxColumn - 1, 0),
            ),
          ),
        ]
      : [];
  });
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
