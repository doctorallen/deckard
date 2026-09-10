import * as vscode from 'vscode';

import { PreferencesStore } from '../../core/storage/preferences';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { resolveIndexedTagKey } from '../../core/workspace/tagNavigation';
import { isMarkdownFile } from '../../core/workspace/scanner';
import {
  ParsedFile,
  SidebarMessage,
  TagTitleDisplayMode,
} from '../../core/types';
import {
  createSidebarSnapshot,
  createTagOverviewSidebarSnapshot,
  createTagOverviewSnapshot,
  normalizeTagTitleDisplayMode,
} from '../state/dashboardState';
import { openSourceAt } from '../commands/navigation';
import { renameIndexedTag } from '../commands/renameTag';
import { getSidebarNotesHtml } from './sidebarNotesHtml';
import { parseSidebarMessage } from './messages';

/**
 * Provides active-note context or active-tag-overview context in the sidebar.
 *
 * It presents saved-note relationships from the workspace index so sidebar
 * context matches the persistent local search data.
 */
export class SidebarNotesView
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private readonly disposables: vscode.Disposable[] = [];
  private readonly output = vscode.window.createOutputChannel('Deckard');
  private view: vscode.WebviewView | undefined;
  private viewDisposables: vscode.Disposable[] = [];
  private entryContext: EntryContext | undefined;
  private suppressAutomaticEntrySelection = false;

  public constructor(
    private readonly indexer: WorkspaceIndexer,
    private readonly preferences: PreferencesStore,
    private readonly tagOverview: ActiveTagOverview,
    private readonly onOpenTag: (
      tagKey: string,
      filterTagKey?: string,
    ) => void | Promise<void>,
    private readonly extensionVersion: string,
  ) {
    this.disposables.push(this.output);
    this.disposables.push(indexer.onDidUpdate(() => this.refresh()));
    this.disposables.push(tagOverview.onDidChange(() => this.refresh()));
    this.disposables.push(preferences.onDidChange(() => this.refresh()));
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.suppressAutomaticEntrySelection = false;
        this.updateEntryContextFromActiveEditor(true);
        this.refresh();
      }),
    );
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) {
          this.suppressAutomaticEntrySelection = false;
          this.updateEntryContextFromActiveEditor(true);
          this.refresh();
        }
      }),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard.enableKeywordLinks')) {
          this.refresh();
        }
        if (event.affectsConfiguration('deckard.tagTitleDisplayMode')) {
          this.refresh();
        }
        if (
          event.affectsConfiguration(
            'deckard.enableHeadingTagRelationships',
          )
        ) {
          this.refresh();
        }
        if (event.affectsConfiguration('deckard.theme')) {
          this.renderHtml();
          this.refresh();
        }
        if (event.affectsConfiguration('deckard.autoSelectNoteSections')) {
          this.updateEntryContextFromActiveEditor();
          this.refresh();
        }
      }),
    );
  }

  /**
   * Binds a VS Code webview view and waits for indexed data before first render.
   */
  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.log('Resolving Related Notes webview.');
    this.disposeViewListeners();
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    this.viewDisposables = [
      webviewView.onDidDispose(() => {
        this.log('Related Notes webview disposed.');
        this.view = undefined;
        this.disposeViewListeners();
      }),
      webviewView.onDidChangeVisibility(() => {
        this.log(
          `Related Notes visibility changed: ${webviewView.visible}.`,
        );
        if (webviewView.visible) {
          this.refresh();
        }
      }),
      webviewView.webview.onDidReceiveMessage((message) => {
        this.log(`Received Related Notes webview message: ${describeMessage(message)}.`);
        void this.handleMessage(message);
      }),
    ];
    this.renderHtml();
    this.refresh();
    void this.indexer.ready.then(() => this.refresh());
  }

  /**
   * Releases view listeners and shared subscriptions.
   */
  public dispose(): void {
    this.disposeViewListeners();
    this.view = undefined;
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /**
   * Narrows the sidebar to one tagged entry selected from a Markdown hover.
   */
  public async showRelatedNotesForEntry(
    documentUri: vscode.Uri,
    sourceLine: number,
  ): Promise<void> {
    await this.indexer.ready;
    const index = this.indexer.getSnapshot();
    const filePath = this.indexer.getFilePath(documentUri);
    const file = index.files.get(filePath);
    const entry = file && findTaggedEntry(file, sourceLine);
    if (!file || !entry) {
      void vscode.window.showWarningMessage(
        'Deckard could not find that tagged note entry. Save the file and try again.',
      );
      return;
    }

    this.entryContext = { filePath, sourceLine, source: 'manual' };
    this.suppressAutomaticEntrySelection = false;
    await vscode.commands.executeCommand('workbench.view.extension.deckard');
    this.view?.show(true);
    this.refresh();
  }

  /**
   * Removes listeners tied to the current view instance before replacement.
   */
  private disposeViewListeners(): void {
    this.viewDisposables
      .splice(0)
      .forEach((disposable) => disposable.dispose());
  }

  private renderHtml(): void {
    if (this.view) {
      this.log('Rendering Related Notes webview HTML.');
      this.view.webview.html = getSidebarNotesHtml(
        this.view.webview,
        this.extensionVersion,
      );
    }
  }

  /**
   * Sends the current sidebar projection only when the view is attached.
   */
  private refresh(): void {
    if (!this.view) {
      this.log('Skipped Related Notes refresh because no webview is attached.');
      return;
    }

    const snapshot = this.createSnapshot();
    this.log(
      `Sending Related Notes state: ${snapshot.state}${snapshot.tagOverview ? ` (tag overview ${snapshot.tagOverview.key})` : snapshot.activeFileName ? ` (Markdown ${snapshot.activeFileName})` : ''}, ${snapshot.notes.length} note entries.`,
    );
    void this.view.webview
      .postMessage({ type: 'state', data: snapshot })
      .then(
        (delivered) =>
          this.log(
            `Related Notes state delivery ${delivered ? 'succeeded' : 'was skipped because the webview is not live'}.`,
          ),
        (error: unknown) =>
          this.log(
            `Related Notes state delivery failed: ${formatError(error)}.`,
          ),
      );
  }

  /**
   * Uses the tag-overview projection only while that panel is the active tab.
   */
  private createSnapshot() {
    const index = this.indexer.getSnapshot();
    const activeTagKey = this.tagOverview.getActiveTagKey();
    const activeTagFilterKey = this.tagOverview.getActiveTagFilterKey();
    if (activeTagKey) {
      const overview = createTagOverviewSnapshot(
        index,
        this.preferences.value,
        activeTagKey,
        'active',
        this.getTagTitleDisplayMode(),
        this.areHeadingTagRelationshipsEnabled(),
        activeTagFilterKey,
      );
      if (overview) {
        return createTagOverviewSidebarSnapshot(overview);
      }
    }

    this.updateEntryContextFromActiveEditor();
    const active = this.getActiveFile();
    const activeEntry = active && this.entryContext?.filePath === active.filePath
      ? createEntryFile(active.file, this.entryContext.sourceLine)
      : undefined;
    return createSidebarSnapshot(
      index,
      active?.filePath,
      activeEntry ?? active?.file,
      this.areKeywordLinksEnabled(),
      this.preferences.value.relatedNotesSortMode,
      this.preferences.value.sectionAccessCounts,
      this.getTagTitleDisplayMode(),
      activeEntry ? getEntryTitle(activeEntry) : undefined,
    );
  }

  private getTagTitleDisplayMode(): TagTitleDisplayMode {
    return normalizeTagTitleDisplayMode(
      vscode.workspace
        .getConfiguration('deckard')
        .get<unknown>('tagTitleDisplayMode', 'inline'),
    );
  }

  /**
   * Reads the active note from the saved workspace index.
   */
  private getActiveFile(): ActiveFile | undefined {
    const document = vscode.window.activeTextEditor?.document;
    if (!document || !isMarkdownDocument(document)) {
      return undefined;
    }

    const filePath = this.indexer.getFilePath(document.uri);
    const file = this.indexer.getSnapshot().files.get(filePath);
    if (!file) {
      return undefined;
    }
    return {
      filePath,
      file,
    };
  }

  /**
   * Keeps the sidebar focused on the smallest tagged entry containing the cursor.
   */
  private updateEntryContextFromActiveEditor(fromSelection = false): void {
    const editor = vscode.window.activeTextEditor;
    const active = this.getActiveFile();
    if (!editor || !active) {
      this.entryContext = undefined;
      return;
    }
    if (
      !fromSelection &&
      (this.suppressAutomaticEntrySelection ||
        this.entryContext?.source === 'manual')
    ) {
      return;
    }
    if (!this.shouldAutoSelectNoteSections(editor.document)) {
      if (this.entryContext?.source === 'cursor') {
        this.entryContext = undefined;
      }
      return;
    }
    const entry = findTaggedEntry(active.file, editor.selection.active.line + 1);
    this.entryContext = entry
      ? {
          filePath: active.filePath,
          sourceLine: getEntryStartLine(entry),
          source: 'cursor',
        }
      : undefined;
  }

  private shouldAutoSelectNoteSections(document: vscode.TextDocument): boolean {
    return vscode.workspace
      .getConfiguration('deckard', document.uri)
      .get<boolean>('autoSelectNoteSections', true);
  }

  /**
   * Reads the active note's workspace setting for related-note ranking.
   */
  private areKeywordLinksEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('deckard', vscode.window.activeTextEditor?.document.uri)
      .get<boolean>('enableKeywordLinks', true);
  }

  private areHeadingTagRelationshipsEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('deckard')
      .get<boolean>('enableHeadingTagRelationships', true);
  }

  /**
   * Rejects malformed sidebar messages before invoking navigation or commands.
   */
  private async handleMessage(value: unknown): Promise<void> {
    const message = parseSidebarMessage(value);
    if (!message) {
      return;
    }

    await this.handleValidMessage(message);
  }

  /**
   * Revalidates navigation targets against the current sidebar projection.
   */
  private async handleValidMessage(message: SidebarMessage): Promise<void> {
    const index = this.indexer.getSnapshot();
    if (message.type === 'ready') {
      this.log('Related Notes webview is ready; refreshing state.');
      this.refresh();
      return;
    }
    if (message.type === 'clearEntryRelatedNotes') {
      this.entryContext = undefined;
      this.suppressAutomaticEntrySelection = true;
      this.refresh();
      return;
    }
    if (message.type === 'openDashboard') {
      await vscode.commands.executeCommand('deckard.showDashboard');
      return;
    }
    if (message.type === 'createDailyNote') {
      await vscode.commands.executeCommand('deckard.createDailyNote');
      return;
    }
    if (message.type === 'openHelp') {
      await vscode.commands.executeCommand('deckard.showHelp');
      return;
    }
    if (message.type === 'setRelatedNotesSort') {
      await this.preferences.setRelatedNotesSortMode(message.mode);
      return;
    }
    if (message.type === 'openTag') {
      const tagKey = resolveIndexedTagKey(index.tags, message.tagKey);
      if (tagKey) {
        await this.onOpenTag(tagKey, message.filterTagKey);
      }
      return;
    }
    if (message.type === 'renameTag') {
      const replacement = await renameIndexedTag(
        this.indexer,
        message.tagKey,
      );
      if (replacement) {
        await this.onOpenTag(replacement.key);
      }
      return;
    }

    if (message.type !== 'openSource') {
      return;
    }
    const active = this.getActiveFile();
    const snapshot = this.createSnapshot();
    const note = snapshot.notes.find(
      (candidate) =>
        candidate.filePath === message.filePath &&
        candidate.sourceLine === message.line,
    );
    if (note) {
      if (note.sectionId) {
        await this.preferences.recordSectionAccess(note.sectionId);
      }
      await openSourceAt(note.filePath, note.sourceLine);
    }
  }

  private log(message: string): void {
    this.output.appendLine(`[Related Notes] ${message}`);
  }
}

/**
 * Minimal contract needed to switch the sidebar between editor and overview.
 */
interface ActiveTagOverview {
  readonly onDidChange: vscode.Event<void>;
  getActiveTagKey(): string | undefined;
  getActiveTagFilterKey(): string | undefined;
}

/**
 * Pairs the canonical path with content parsed using current editor text.
 */
interface ActiveFile {
  filePath: string;
  file: ParsedFile;
}

interface EntryContext {
  filePath: string;
  sourceLine: number;
  source: 'cursor' | 'manual';
}

function findTaggedEntry(file: ParsedFile, sourceLine: number) {
  const task = file.tasks.find(
    (candidate) =>
      candidate.lineNumber === sourceLine &&
      (candidate.associationTagGroups?.length ?? 0) > 0,
  );
  if (task) {
    return task;
  }
  return file.sections
    .filter(
      (section) =>
        section.startLine <= sourceLine &&
        section.endLine >= sourceLine &&
        ((section.headingTags?.length ?? 0) > 0 ||
          (section.isInline &&
            (section.associationTagGroups?.length ?? 0) > 0)),
    )
    .sort(
      (left, right) =>
        left.endLine - left.startLine - (right.endLine - right.startLine) ||
        right.startLine - left.startLine,
    )[0];
}

function getEntryStartLine(
  entry: NonNullable<ReturnType<typeof findTaggedEntry>>,
): number {
  return 'heading' in entry ? entry.startLine : entry.lineNumber;
}

function createEntryFile(
  file: ParsedFile,
  sourceLine: number,
): ParsedFile | undefined {
  const entry = findTaggedEntry(file, sourceLine);
  if (!entry) {
    return undefined;
  }

  if ('heading' in entry) {
    return {
      ...file,
      content: entry.rawContent,
      sections: [entry],
      tasks: file.tasks.filter((task) => task.sectionId === entry.id),
      frontmatterTags: [],
      links: entry.links,
    };
  }
  return {
    ...file,
    content: entry.sourceLineText,
    sections: [],
    tasks: [entry],
    frontmatterTags: [],
    links: [],
  };
}

function getEntryTitle(file: ParsedFile): string | undefined {
  return file.sections[0]?.heading ?? file.tasks[0]?.title;
}

/**
 * Uses the URI extension so manual language-mode changes do not hide Markdown.
 */
function isMarkdownDocument(document: vscode.TextDocument): boolean {
  return isMarkdownFile(document.uri);
}

function describeMessage(message: unknown): string {
  if (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    typeof message.type === 'string'
  ) {
    return message.type;
  }
  return 'invalid payload';
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
