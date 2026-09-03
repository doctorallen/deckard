import * as vscode from 'vscode';

import { ParsedFile, Section, Task, TagInfo, WorkspaceIndex } from '../types';
import { ScanProgress, WorkspaceScanner } from './scanner';

/**
 * Owns the live note cache and turns scanner output into lookup maps for the UI.
 *
 * Files are cached separately from the derived index so rapid editor and file
 * watcher events can be coalesced before one consistent snapshot is published.
 */
export class WorkspaceIndexer implements vscode.Disposable {
  private readonly updateEmitter = new vscode.EventEmitter<WorkspaceIndex>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly watcherDisposables: vscode.Disposable[] = [];
  private readonly files = new Map<string, ParsedFile>();
  private readonly pending = new Map<string, PendingUpdate>();
  private flushHandle: ReturnType<typeof setTimeout> | undefined;
  private readyPromise: Promise<void> = Promise.resolve();
  private disposed = false;

  public constructor(private readonly scanner = new WorkspaceScanner()) {
    this.disposables.push(this.updateEmitter);
  }

  public readonly onDidUpdate = this.updateEmitter.event;

  /**
   * Installs change listeners before the first refresh so edits during startup
   * are queued rather than lost.
   */
  public start(): Promise<void> {
    this.registerWatchers();
    this.readyPromise = this.refresh();
    return this.readyPromise;
  }

  /**
   * Exposes the initial scan as a barrier for commands that need complete data.
   */
  public get ready(): Promise<void> {
    return this.readyPromise;
  }

  /**
   * Rebuilds a detached index so consumers cannot mutate the cache indirectly.
   */
  public getSnapshot(): WorkspaceIndex {
    return buildWorkspaceIndex(new Map(this.files));
  }

  /**
   * Looks up a task from the latest derived index for source-safe actions.
   */
  public getTask(taskId: string): Task | undefined {
    return this.getSnapshot().tasks.get(taskId);
  }

  /**
   * Looks up a section from the latest derived index for navigation actions.
   */
  public getSection(sectionId: string): Section | undefined {
    return this.getSnapshot().sections.get(sectionId);
  }

  /**
   * Keeps path formatting owned by the scanner so all callers use one key shape.
   */
  public getFilePath(uri: vscode.Uri): string {
    return this.scanner.getFilePath(uri);
  }

  /**
   * Parses editor content through the scanner's workspace-specific settings.
   */
  public parse(
    uri: vscode.Uri,
    content: string,
    metadata?: Pick<ParsedFile, 'createdAt' | 'updatedAt'>,
  ): ParsedFile {
    return this.scanner.parse(uri, content, metadata);
  }

  /**
   * Delegates notes-folder containment to the scanner's path boundary checks.
   */
  public isNotesFile(uri: vscode.Uri): boolean {
    return this.scanner.isNotesFile(uri);
  }

  public getNotesFolderUri(
    workspaceFolder: vscode.WorkspaceFolder,
  ): vscode.Uri {
    return this.scanner.getNotesFolderUri(workspaceFolder);
  }

  /**
   * Performs a full replacement refresh while reporting progress in VS Code.
   */
  public async refresh(): Promise<void> {
    if (this.disposed) {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: 'Deckard: Indexing workspace',
        cancellable: false,
      },
      async (progress) => {
        const parsedFiles = await this.scanner.scan(
          (completed, total): void => {
            progress.report({
              message:
                total > 0
                  ? `${completed}/${total} Markdown files`
                  : 'No Markdown files',
              increment: total > 0 ? 100 / total : 0,
            });
          },
        );
        if (this.disposed) {
          return;
        }

        this.files.clear();
        parsedFiles.forEach((file) => this.files.set(file.filePath, file));
        this.emitUpdate();
      },
    );
  }

  /**
   * Stops timers, watchers, and events so late callbacks cannot repopulate state.
   */
  public dispose(): void {
    this.disposed = true;
    if (this.flushHandle) {
      clearTimeout(this.flushHandle);
    }
    this.watcherDisposables
      .splice(0)
      .forEach((disposable) => disposable.dispose());
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /**
   * Connects configuration, workspace, editor, and filesystem changes to one
   * queued update path so every source of change produces the same index shape.
   */
  private registerWatchers(): void {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        const notesFolderChanged = event.affectsConfiguration(
          'deckard.notesFolder',
        );
        const inlineTagsChanged = event.affectsConfiguration(
          'deckard.parseInlineTags',
        );
        if (notesFolderChanged || inlineTagsChanged) {
          if (notesFolderChanged) {
            this.replaceWatchers();
          }
          this.readyPromise = this.refresh();
        }
      }),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.replaceWatchers();
        this.readyPromise = this.refresh();
      }),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (this.scanner.isNotesFile(event.document.uri)) {
          this.queueUpsert(event.document.uri, event.document.getText());
        }
      }),
    );
    this.replaceWatchers();
  }

  /**
   * Recreates globs when the configured notes boundary changes.
   */
  private replaceWatchers(): void {
    this.watcherDisposables
      .splice(0)
      .forEach((disposable) => disposable.dispose());

    for (const pattern of this.scanner.getPatterns()) {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      this.watcherDisposables.push(watcher);
      this.watcherDisposables.push(
        watcher.onDidCreate((uri) => this.queueUpsert(uri)),
      );
      this.watcherDisposables.push(
        watcher.onDidChange((uri) => this.queueUpsert(uri)),
      );
      this.watcherDisposables.push(
        watcher.onDidDelete((uri) => this.queueDelete(uri)),
      );
    }
  }

  /**
   * Replaces pending work for a URI because only its newest content matters.
   */
  private queueUpsert(uri: vscode.Uri, content?: string): void {
    this.pending.set(uri.toString(), { uri, content, deleted: false });
    this.scheduleFlush();
  }

  /**
   * Coalesces deletion with other URI changes before rebuilding the index.
   */
  private queueDelete(uri: vscode.Uri): void {
    this.pending.set(uri.toString(), { uri, deleted: true });
    this.scheduleFlush();
  }

  /**
   * Debounces bursts from typing and filesystem watchers into one refresh event.
   */
  private scheduleFlush(): void {
    if (this.flushHandle) {
      return;
    }

    this.flushHandle = setTimeout(() => {
      this.flushHandle = undefined;
      void this.flushPending();
    }, 200);
  }

  /**
   * Applies all queued changes together so observers never see half a batch.
   *
   * Saved-file reads refresh timestamps; in-memory parses reuse prior metadata
   * because unsaved editor content cannot provide a trustworthy file stat.
   */
  private async flushPending(): Promise<void> {
    const updates = [...this.pending.values()];
    this.pending.clear();

    for (const update of updates) {
      const filePath = this.scanner.getFilePath(update.uri);
      if (update.deleted) {
        this.files.delete(filePath);
        continue;
      }

      try {
        const previous = this.files.get(filePath);
        const parsedFile =
          update.content === undefined
            ? await this.scanner.read(update.uri)
            : this.scanner.parse(update.uri, update.content, previous);
        this.files.set(filePath, parsedFile);
      } catch (error) {
        console.error(`Deckard could not update ${filePath}`, error);
      }
    }

    this.emitUpdate();
  }

  /**
   * Publishes a newly derived snapshot after the cache is internally consistent.
   */
  private emitUpdate(): void {
    this.updateEmitter.fire(this.getSnapshot());
  }
}

interface PendingUpdate {
  uri: vscode.Uri;
  content?: string;
  deleted: boolean;
}

/**
 * Aggregates per-file parse results into stable section, task, and tag lookups.
 *
 * The source files remain the canonical cache; these maps make cross-note
 * queries cheap without duplicating parsing logic in each UI surface.
 */
export function buildWorkspaceIndex(
  files: Map<string, ParsedFile>,
): WorkspaceIndex {
  const sections = new Map<string, Section>();
  const tasks = new Map<string, Task>();
  const tags = new Map<string, TagInfo>();

  files.forEach((file) => {
    file.sections.forEach((section) => {
      sections.set(section.id, section);
      section.tags.forEach((tagKey) => {
        const tag = getOrCreateTag(tags, tagKey, section.tagLabels[tagKey]);
        tag.sectionIds.push(section.id);
      });
    });
    file.tasks.forEach((task) => {
      tasks.set(task.id, task);
      task.tags.forEach((tagKey) => {
        const tag = getOrCreateTag(tags, tagKey, task.tagLabels[tagKey]);
        tag.taskIds.push(task.id);
      });
    });
  });

  tags.forEach((tag) => {
    // A task inside a tagged section is already represented by that section;
    // count it separately only when its tag would otherwise have no entry.
    const taggedSections = new Set(tag.sectionIds);
    const standaloneTasks = tag.taskIds.filter((taskId) => {
      const task = tasks.get(taskId);
      return !task?.sectionId || !taggedSections.has(task.sectionId);
    });
    tag.count = taggedSections.size + standaloneTasks.length;
  });

  return {
    files,
    sections,
    tasks,
    tags,
    updatedAt: Date.now(),
  };
}

/**
 * Shares one tag record across section and task references by canonical key.
 */
function getOrCreateTag(
  tags: Map<string, TagInfo>,
  key: string,
  label = `#${key}`,
): TagInfo {
  const existing = tags.get(key);
  if (existing) {
    return existing;
  }

  const tag: TagInfo = {
    key,
    label,
    sectionIds: [],
    taskIds: [],
    count: 0,
    isFavorite: false,
  };
  tags.set(key, tag);
  return tag;
}
