import * as path from 'path';

import * as vscode from 'vscode';

import { MarkdownParseOptions, parseMarkdown } from '../markdown/parser';
import { ParsedFile } from '../types';

export interface WorkspaceFileAccess {
  readonly workspaceFolders?: readonly vscode.WorkspaceFolder[];
  findFiles(
    include: vscode.GlobPattern,
    exclude?: vscode.GlobPattern,
    maxResults?: number,
  ): Thenable<vscode.Uri[]>;
  readFile(uri: vscode.Uri): Thenable<Uint8Array>;
  stat?(uri: vscode.Uri): Thenable<vscode.FileStat>;
}

/**
 * Reports scan progress without coupling the scanner to a particular UI.
 */
export type ScanProgress = (completed: number, total: number) => void;

/**
 * Reads only the configured Markdown surface of a workspace.
 *
 * File access is injected so path and parsing behavior can be tested without
 * requiring a live VS Code workspace, while the default adapter uses VS Code
 * storage and file APIs in production.
 */
export class WorkspaceScanner {
  public constructor(
    private readonly access: WorkspaceFileAccess = createDefaultAccess(),
  ) {}

  /**
   * Scans each workspace folder and skips unreadable files individually.
   *
   * One bad note should not make the rest of the workspace disappear from the
   * index, so read failures are reported and scanning continues.
   */
  public async scan(onProgress?: ScanProgress): Promise<ParsedFile[]> {
    const files: ParsedFile[] = [];
    const entries: ScanEntry[] = [];

    for (const workspaceFolder of this.access.workspaceFolders ?? []) {
      const pattern = this.createPattern(workspaceFolder);
      const uris = await this.access.findFiles(pattern);

      uris
        .filter((uri) => isMarkdownFile(uri))
        .forEach((uri) => entries.push({ uri, workspaceFolder }));
    }

    onProgress?.(0, entries.length);
    let completed = 0;

    for (const entry of entries) {
      try {
        files.push(await this.read(entry.uri, entry.workspaceFolder));
      } catch (error) {
        console.error(`Deckard could not read ${entry.uri.toString()}`, error);
      } finally {
        completed += 1;
        onProgress?.(completed, entries.length);
      }
    }

    return files;
  }

  /**
   * Reads a saved note together with filesystem timestamps used by date sorts.
   */
  public async read(
    uri: vscode.Uri,
    workspaceFolder = this.findWorkspaceFolder(uri),
  ): Promise<ParsedFile> {
    assertMarkdownFile(uri);
    const [bytes, metadata] = await Promise.all([
      this.access.readFile(uri),
      this.readMetadata(uri),
    ]);
    const content = Buffer.from(bytes).toString('utf8');
    return parseMarkdown(
      this.getFilePath(uri, workspaceFolder),
      content,
      metadata,
      this.getParseOptions(workspaceFolder),
    );
  }

  /**
   * Parses editor content directly so unsaved Markdown can drive the sidebar.
   *
   * Callers may pass prior metadata because an in-memory edit has no reliable
   * filesystem stat to replace the file's creation and update timestamps.
   */
  public parse(
    uri: vscode.Uri,
    content: string,
    metadata?: Pick<ParsedFile, 'createdAt' | 'updatedAt'>,
  ): ParsedFile {
    assertMarkdownFile(uri);
    const workspaceFolder = this.findWorkspaceFolder(uri);
    return parseMarkdown(
      this.getFilePath(uri, workspaceFolder),
      content,
      metadata,
      this.getParseOptions(workspaceFolder),
    );
  }

  /**
   * Returns the watcher patterns for all roots using their current settings.
   */
  public getPatterns(): vscode.RelativePattern[] {
    return (this.access.workspaceFolders ?? []).map((workspaceFolder) =>
      this.createPattern(workspaceFolder),
    );
  }

  /**
   * Produces a stable index key and prefixes multi-root paths to avoid clashes.
   */
  public getFilePath(
    uri: vscode.Uri,
    workspaceFolder?: vscode.WorkspaceFolder,
  ): string {
    const folder = workspaceFolder ?? this.findWorkspaceFolder(uri);
    if (!folder) {
      return uri.fsPath.replaceAll('\\', '/');
    }

    const relativePath = getRelativePath(uri, folder);
    if ((this.access.workspaceFolders?.length ?? 0) <= 1) {
      return relativePath.replaceAll('\\', '/');
    }

    return `${folder.name}/${relativePath.replaceAll('\\', '/')}`;
  }

  /**
   * Resolves the configured notes folder without assuming it is non-empty.
   */
  public getNotesFolderUri(
    workspaceFolder: vscode.WorkspaceFolder,
  ): vscode.Uri {
    const notesFolder = this.getNotesFolder(workspaceFolder);
    if (!notesFolder) {
      return workspaceFolder.uri;
    }

    return vscode.Uri.joinPath(workspaceFolder.uri, ...notesFolder.split('/'));
  }

  /**
   * Normalizes user configuration before it is used in VS Code glob/path APIs.
   */
  public getNotesFolder(workspaceFolder?: vscode.WorkspaceFolder): string {
    const configuration = this.getConfiguration(workspaceFolder);
    const configuredFolder = configuration
      .get<string>('notesFolder', 'notes')
      .trim();
    return configuredFolder.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  }

  /**
   * Supplies parser options from the same workspace scope as the note.
   */
  public getParseOptions(
    workspaceFolder?: vscode.WorkspaceFolder,
  ): MarkdownParseOptions {
    return {
      parseInlineTags: this.getConfiguration(workspaceFolder).get<boolean>(
        'parseInlineTags',
        true,
      ),
    };
  }

  /**
   * Checks both the Markdown extension and configured-folder containment.
   */
  public isNotesFile(uri: vscode.Uri): boolean {
    if (!isMarkdownFile(uri)) {
      return false;
    }

    const workspaceFolder = this.findWorkspaceFolder(uri);
    return workspaceFolder
      ? isWithinWorkspace(uri, this.getNotesFolderUri(workspaceFolder))
      : false;
  }

  /**
   * Builds the narrowest watcher glob so unrelated Markdown is not indexed.
   */
  private createPattern(
    workspaceFolder: vscode.WorkspaceFolder,
  ): vscode.RelativePattern {
    const notesFolder = this.getNotesFolder(workspaceFolder);
    const pattern = notesFolder ? `${notesFolder}/**/*.md` : '**/*.md';
    return new vscode.RelativePattern(workspaceFolder, pattern);
  }

  /**
   * Finds the owning root before resolving root-scoped settings and paths.
   */
  private findWorkspaceFolder(
    uri: vscode.Uri,
  ): vscode.WorkspaceFolder | undefined {
    return this.access.workspaceFolders?.find((folder) =>
      isWithinWorkspace(uri, folder.uri),
    );
  }

  /**
   * Treats missing stat support or transient stat failures as absent metadata.
   *
   * Content indexing remains useful when timestamps cannot be read, and the
   * state layer already handles undefined dates deterministically.
   */
  private async readMetadata(
    uri: vscode.Uri,
  ): Promise<Pick<ParsedFile, 'createdAt' | 'updatedAt'> | undefined> {
    if (!this.access.stat) {
      return undefined;
    }

    try {
      const stat = await this.access.stat(uri);
      return { createdAt: stat.ctime, updatedAt: stat.mtime };
    } catch {
      return undefined;
    }
  }

  /**
   * Reads configuration at the correct root for single- and multi-root workspaces.
   */
  private getConfiguration(
    workspaceFolder?: vscode.WorkspaceFolder,
  ): vscode.WorkspaceConfiguration {
    return workspaceFolder
      ? vscode.workspace.getConfiguration('deckard', workspaceFolder.uri)
      : vscode.workspace.getConfiguration('deckard');
  }
}

interface ScanEntry {
  uri: vscode.Uri;
  workspaceFolder: vscode.WorkspaceFolder;
}

/**
 * Uses the URI path rather than language mode because extension behavior must
 * also cover unsaved or manually associated Markdown documents.
 */
export function isMarkdownFile(uri: vscode.Uri): boolean {
  return uri.path.toLowerCase().endsWith('.md');
}

/**
 * Fails fast at parser boundaries so non-Markdown files cannot enter the index.
 */
function assertMarkdownFile(uri: vscode.Uri): void {
  if (!isMarkdownFile(uri)) {
    throw new Error(`Deckard only parses Markdown files: ${uri.toString()}`);
  }
}

/**
 * Uses native filesystem paths for file URIs and VS Code's resolver otherwise.
 */
function getRelativePath(
  uri: vscode.Uri,
  workspaceFolder: vscode.WorkspaceFolder,
): string {
  if (uri.scheme === 'file' && workspaceFolder.uri.scheme === 'file') {
    return path
      .relative(workspaceFolder.uri.fsPath, uri.fsPath)
      .replaceAll(path.sep, '/');
  }

  return vscode.workspace.asRelativePath(uri, false);
}

/**
 * Performs boundary-aware containment checks instead of trusting a string
 * prefix, which would incorrectly treat sibling paths as children.
 */
function isWithinWorkspace(uri: vscode.Uri, workspaceUri: vscode.Uri): boolean {
  if (uri.scheme !== workspaceUri.scheme) {
    return false;
  }

  if (uri.scheme === 'file') {
    const relativePath = path.relative(workspaceUri.fsPath, uri.fsPath);
    return (
      relativePath === '' ||
      (relativePath !== '..' &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath))
    );
  }

  const uriPath = uri.path.replace(/\/+$/, '');
  const workspacePath = workspaceUri.path.replace(/\/+$/, '');
  return uriPath === workspacePath || uriPath.startsWith(`${workspacePath}/`);
}

/**
 * Adapts the real VS Code workspace APIs to the scanner's testable interface.
 */
function createDefaultAccess(): WorkspaceFileAccess {
  return {
    get workspaceFolders() {
      return vscode.workspace.workspaceFolders;
    },
    findFiles: (include, exclude, maxResults) =>
      vscode.workspace.findFiles(include, exclude, maxResults),
    readFile: (uri) => vscode.workspace.fs.readFile(uri),
    stat: (uri) => vscode.workspace.fs.stat(uri),
  };
}
