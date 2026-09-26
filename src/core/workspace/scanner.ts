import * as path from 'path';
import picomatch = require('picomatch');

import * as vscode from 'vscode';

import {
  extractTags,
  getEntityNamespaceAliases,
  getPersonMarker,
  MarkdownParseOptions,
  NoteBoundaries,
  parseMarkdown,
} from '../markdown/parser';
import { reportError } from '../timing';
import { ParkedRules, toParkedTagKey } from './parked';
import { ParsedFile,
  UnreadableNote,
} from '../types';

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

/** What a stat says about a note: enough to tell whether it changed. */
export interface FileStamp {
  mtime: number;
  ctime: number;
  size: number;
}

/**
 * Answers a note already parsed from the file as it stands, so a scan need
 * not read and parse it again; nothing, to have it read.
 */
export type ReuseParsedFile = (
  filePath: string,
  stamp: FileStamp,
) => ParsedFile | undefined;

/**
 * How many notes a scan reads at once. Reading one at a time left the disk
 * idle between reads: 300 ms of reading at 5,000 notes took 86 ms eight at
 * a time, and more at once gained nothing.
 */
const READS_IN_FLIGHT = 8;

/**
 * Reads only the configured Markdown surface of a workspace.
 *
 * File access is injected so path and parsing behavior can be tested without
 * requiring a live VS Code workspace, while the default adapter uses VS Code
 * storage and file APIs in production.
 */
/** The configured note boundary, falling back when the setting is stale. */
function getNoteBoundaries(value: unknown): NoteBoundaries {
  return value === 'heading' || value === 'marked' ? value : 'line';
}

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
  /**
   * The notes the last scan could not read, with why. A read that fails is
   * logged, but a log is not where a reader looks when a search comes back
   * short; this is what Stats and the setup check show instead.
   */
  public failures: UnreadableNote[] = [];

  /**
   * What the last scan saw: how many Markdown files the folders held, how
   * many the templates folder and the exclude patterns kept out, and how
   * many were read. A Dashboard that is emptier than expected is usually one
   * of these, and the setup check says which.
   */
  public lastScan = { found: 0, templates: 0, excluded: 0, read: 0 };

  public async scan(
    onProgress?: ScanProgress,
    reuse?: ReuseParsedFile,
    /** Called with each note read and parsed, between reads. */
    onParsed?: (file: ParsedFile) => void,
  ): Promise<ParsedFile[]> {
    const entries: ScanEntry[] = [];
    const failures: UnreadableNote[] = [];
    let found = 0;
    let templates = 0;
    let excluded = 0;

    for (const workspaceFolder of this.access.workspaceFolders ?? []) {
      const pattern = this.createPattern(workspaceFolder);
      const excludePatterns = this.getExcludePatterns(workspaceFolder);
      // Leaving the excluded folders out of the search itself means a code
      // repository's node_modules is never walked. An explicit exclude
      // replaces the `files.exclude` default, so it carries those patterns
      // too; one with a `when` clause is not applied, which is rare for `.md`.
      const excludeGlob = toExcludeGlob(excludePatterns);
      const uris = await this.access.findFiles(
        pattern,
        excludeGlob ? new vscode.RelativePattern(workspaceFolder, excludeGlob) : undefined,
      );
      const templatesUri = this.getTemplatesFolderUri(workspaceFolder);
      const isExcluded = createExcludeMatcherFromPatterns(excludePatterns);

      const markdown = uris.filter((uri) => isMarkdownFile(uri));
      const outsideTemplates = markdown.filter(
        (uri) => !templatesUri || !isWithinWorkspace(uri, templatesUri),
      );
      const kept = outsideTemplates.filter(
        (uri) => !isExcluded(getRelativePath(uri, workspaceFolder)),
      );
      found += markdown.length;
      templates += markdown.length - outsideTemplates.length;
      excluded += outsideTemplates.length - kept.length;
      kept.forEach((uri) => entries.push({ uri, workspaceFolder }));
    }

    onProgress?.(0, entries.length);
    let completed = 0;
    // Results keep the order findFiles gave, whichever read finishes first.
    const results: Array<ParsedFile | UnreadableNote | undefined> = new Array(entries.length);
    let next = 0;
    const readNext = async (): Promise<void> => {
      while (next < entries.length) {
        const position = next;
        next += 1;
        const entry = entries[position];
        try {
          results[position] = await this.readEntry(entry, reuse, onParsed);
        } catch (error) {
          reportError(`Could not read ${entry.uri.toString()}`, error);
          results[position] = {
            filePath: this.getFilePath(entry.uri, entry.workspaceFolder),
            reason: describeError(error),
          };
        } finally {
          completed += 1;
          onProgress?.(completed, entries.length);
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(READS_IN_FLIGHT, entries.length) }, readNext),
    );

    const files: ParsedFile[] = [];
    results.forEach((result) => {
      if (result && 'reason' in result) {
        failures.push(result);
      } else if (result) {
        files.push(result);
      }
    });
    this.failures = failures;
    this.lastScan = { found, templates, excluded, read: files.length };
    return files;
  }

  /**
   * Reads one note of a scan: its stat first, and then, unless `reuse` has
   * the note as the file stands, its text.
   */
  private async readEntry(
    entry: ScanEntry,
    reuse: ReuseParsedFile | undefined,
    onParsed: ((file: ParsedFile) => void) | undefined,
  ): Promise<ParsedFile> {
    assertMarkdownFile(entry.uri);
    const stamp = await this.readStamp(entry.uri);
    if (stamp && reuse) {
      const reused = reuse(this.getFilePath(entry.uri, entry.workspaceFolder), stamp);
      if (reused) {
        return reused;
      }
    }
    const file = await this.read(entry.uri, entry.workspaceFolder, stamp ?? null);
    onParsed?.(file);
    return file;
  }

  /**
   * Reads a saved note together with filesystem timestamps used by date sorts.
   */
  public async read(
    uri: vscode.Uri,
    workspaceFolder = this.findWorkspaceFolder(uri),
    /** A stat already read, or null when it could not be, to skip another. */
    stamp?: FileStamp | null,
  ): Promise<ParsedFile> {
    assertMarkdownFile(uri);
    const [bytes, metadata] = await Promise.all([
      this.access.readFile(uri),
      stamp === undefined
        ? this.readMetadata(uri)
        : stamp === null
          ? undefined
          : { createdAt: stamp.ctime, updatedAt: stamp.mtime },
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
   * How every workspace folder is being parsed right now, as one string.
   *
   * The full-text cache stores this beside its notes so a settings change
   * that changes parsing rebuilds it. Nothing else would catch it: the files
   * are untouched, so a scan finds every note exactly as it left it.
   */
  public getParseFingerprint(): string {
    const folders = this.access.workspaceFolders ?? [];
    const described = (folders.length > 0 ? folders : [undefined]).map(
      (folder) => {
        const options = this.getParseOptions(folder);
        return [
          folder?.uri.toString() ?? '',
          options.noteBoundaries ?? 'line',
          options.parseInlineTags === false ? 'no-inline' : 'inline',
          options.personMarker ?? '',
          JSON.stringify(options.entityNamespaceAliases ?? {}),
        ].join('\u0000');
      },
    );
    return described.join('\u0001');
  }

  /**
   * What `deckard.parked.folders` and `deckard.parked.tags` park, read now.
   * Folder patterns are relative to each workspace folder, like
   * `deckard.exclude`; tags are keyed as the index keys them, so an alias
   * such as `organization/acme` parks `#org/acme`.
   */
  public getParkedRules(): ParkedRules {
    const folders = this.access.workspaceFolders ?? [];
    const multiRoot = folders.length > 1;
    const matchers = folders.map((folder) => ({
      prefix: multiRoot ? `${folder.name}/` : '',
      isParked: createExcludeMatcher(
        this.getConfiguration(folder).get<unknown>('parked.folders', {}),
      ),
    }));
    const hasFolders = folders.some((folder) => {
      const value = this.getConfiguration(folder).get<unknown>('parked.folders', {});
      return (
        value !== null &&
        typeof value === 'object' &&
        Object.values(value).some((enabled) => enabled === true)
      );
    });
    const cache = new Map<string, boolean>();
    const options = this.getParseOptions(folders[0]);
    const written = vscode.workspace.getConfiguration('deckard').get<unknown>('parked.tags', ['parked']);
    const tags = [
      ...new Set(
        (Array.isArray(written) ? written : [])
          .filter((value): value is string => typeof value === 'string')
          .map((value) => {
            const key = toParkedTagKey(value);
            if (!key || key.startsWith('@')) {
              return key;
            }
            return (
              extractTags(key, options.entityNamespaceAliases, options.personMarker)[0]?.key.toLowerCase() ??
              key
            );
          })
          .filter((key): key is string => key !== undefined),
      ),
    ];
    return {
      hasFolders,
      tags,
      isParkedPath: (filePath) => {
        if (!hasFolders) {
          return false;
        }
        const known = cache.get(filePath);
        if (known !== undefined) {
          return known;
        }
        const matcher = matchers.find((candidate) => filePath.startsWith(candidate.prefix));
        const parked = matcher?.isParked(filePath.slice(matcher.prefix.length)) ?? false;
        cache.set(filePath, parked);
        return parked;
      },
    };
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
   * The file an index path names: the inverse of `getFilePath`. Undefined
   * when no open workspace folder holds it.
   */
  public getUri(filePath: string): vscode.Uri | undefined {
    const folders = this.access.workspaceFolders ?? [];
    if (folders.length === 1) {
      return vscode.Uri.joinPath(folders[0].uri, ...filePath.split('/'));
    }
    const [name, ...rest] = filePath.split('/');
    const folder = folders.find((candidate) => candidate.name === name);
    return folder && rest.length > 0 ? vscode.Uri.joinPath(folder.uri, ...rest) : undefined;
  }

  /**
   * Resolves the optional configured notes folder without assuming it is non-empty.
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
      .get<string>('notesFolder', '')
      .trim();
    return configuredFolder.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  }

  /**
   * The folder of note templates, which is never indexed so a template's tags
   * and tasks stay out of the notes. Undefined when the setting is empty.
   */
  public getTemplatesFolderUri(
    workspaceFolder: vscode.WorkspaceFolder,
  ): vscode.Uri | undefined {
    const folder = this.getConfiguration(workspaceFolder)
      .get<string>('templatesFolder', 'templates')
      .trim()
      .replaceAll('\\', '/')
      .replace(/^\/+|\/+$/g, '');
    return folder && folder !== '.'
      ? vscode.Uri.joinPath(workspaceFolder.uri, ...folder.split('/'))
      : undefined;
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
      noteBoundaries: getNoteBoundaries(
        this.getConfiguration(workspaceFolder).get<unknown>(
          'noteBoundaries',
          'line',
        ),
      ),
      entityNamespaceAliases: getEntityNamespaceAliases(
        this.getConfiguration(workspaceFolder).get<unknown>(
          'entityNamespaceAliases',
          {},
        ),
      ),
      personMarker: getPersonMarker(
        this.getConfiguration(workspaceFolder).get<unknown>(
          'personMarker',
          '@',
        ),
      ),
      assigneeFromPersonTag:
        this.getConfiguration(workspaceFolder).get<boolean>(
          'tasks.assigneeFromPersonTag',
          false,
        ) === true,
    };
  }

  /**
   * Checks the Markdown extension, configured-folder containment, and the
   * exclude settings, so watchers and editors agree with the full scan.
   */
  public isNotesFile(uri: vscode.Uri): boolean {
    if (!isMarkdownFile(uri)) {
      return false;
    }

    const workspaceFolder = this.findWorkspaceFolder(uri);
    if (!workspaceFolder) {
      return false;
    }
    const templatesUri = this.getTemplatesFolderUri(workspaceFolder);
    return (
      isWithinWorkspace(uri, this.getNotesFolderUri(workspaceFolder)) &&
      !(templatesUri && isWithinWorkspace(uri, templatesUri)) &&
      !this.getExcludeMatcher(workspaceFolder)(
        getRelativePath(uri, workspaceFolder),
      )
    );
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
    const stamp = await this.readStamp(uri);
    return stamp ? { createdAt: stamp.ctime, updatedAt: stamp.mtime } : undefined;
  }

  /** The note's times and size, or nothing when they cannot be read. */
  private async readStamp(uri: vscode.Uri): Promise<FileStamp | undefined> {
    if (!this.access.stat) {
      return undefined;
    }
    try {
      const stat = await this.access.stat(uri);
      return { mtime: stat.mtime, ctime: stat.ctime, size: stat.size };
    } catch {
      return undefined;
    }
  }

  /**
   * Compiles the root's exclude patterns, so a note saved in a hidden folder
   * stays out just as it does in the full scan.
   */
  private getExcludeMatcher(
    workspaceFolder: vscode.WorkspaceFolder,
  ): ExcludeMatcher {
    return createExcludeMatcherFromPatterns(
      this.getExcludePatterns(workspaceFolder),
    );
  }

  /**
   * What the root leaves out: `deckard.exclude`, `files.exclude`, and
   * `search.exclude`, less any pattern `deckard.exclude` sets to `false`.
   * A pattern with a `when` clause is skipped, because checking for its
   * sibling file would need a filesystem read on every call.
   */
  private getExcludePatterns(workspaceFolder: vscode.WorkspaceFolder): string[] {
    const read = (section: string): unknown =>
      vscode.workspace
        .getConfiguration(section, workspaceFolder.uri)
        .get<unknown>('exclude', {});
    return collectExcludePatterns(read('deckard'), read('files'), read('search'));
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
 * Tells whether a workspace-relative path, with `/` separators, is excluded.
 */
export type ExcludeMatcher = (relativePath: string) => boolean;

/**
 * Reads exclude settings the way VS Code reads `files.exclude`: each key is a
 * glob relative to the workspace folder, only keys set to `true` apply, and a
 * pattern that matches a folder also leaves out everything inside it.
 *
 * Patterns from every setting apply together, so `false` in one setting never
 * brings back what another leaves out.
 */
export function createExcludeMatcher(...settings: unknown[]): ExcludeMatcher {
  const patterns = settings.flatMap((value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value)
          .filter(([pattern, enabled]) => enabled === true && pattern.trim() !== '')
          .map(([pattern]) => pattern.trim())
      : [],
  );
  if (patterns.length === 0) {
    return () => false;
  }

  // VS Code's `*` also matches names that start with a dot.
  const isMatch = picomatch(patterns, { dot: true });
  return (relativePath) => {
    const segments = relativePath.split('/');
    return segments.some((_, index) =>
      isMatch(segments.slice(0, index + 1).join('/')),
    );
  };
}

/** The keys of an exclude setting set to `value`, trimmed. */
function readExcludeKeys(setting: unknown, value: boolean): string[] {
  return setting && typeof setting === 'object' && !Array.isArray(setting)
    ? Object.entries(setting)
        .filter(([pattern, enabled]) => enabled === value && pattern.trim() !== '')
        .map(([pattern]) => pattern.trim())
    : [];
}

/**
 * Everything the index leaves out: the `true` entries of `files.exclude`,
 * `search.exclude`, and `deckard.exclude`, less any pattern that
 * `deckard.exclude` sets to `false`. That is the way back in for a folder
 * hidden from search that holds notes.
 */
export function collectExcludePatterns(
  deckard: unknown,
  files: unknown,
  search: unknown,
): string[] {
  const keptIn = new Set(readExcludeKeys(deckard, false));
  return [
    ...new Set([
      ...readExcludeKeys(files, true),
      ...readExcludeKeys(search, true),
      ...readExcludeKeys(deckard, true),
    ]),
  ].filter((pattern) => !keptIn.has(pattern));
}

/**
 * One glob for `findFiles` that leaves out each pattern and everything
 * inside what it matches. Patterns with their own braces or commas are left
 * to the matcher, since nested braces are unreliable.
 */
export function toExcludeGlob(patterns: readonly string[]): string | undefined {
  const simple = patterns.filter((pattern) => !/[{},]/.test(pattern));
  if (simple.length === 0) {
    return undefined;
  }
  return `{${simple
    .flatMap((pattern) => {
      const trimmed = pattern.replace(/\/+$/, '');
      return [trimmed, `${trimmed}/**`];
    })
    .join(',')}}`;
}

/** A matcher over patterns already collected. */
export function createExcludeMatcherFromPatterns(
  patterns: readonly string[],
): ExcludeMatcher {
  return createExcludeMatcher(
    Object.fromEntries(patterns.map((pattern) => [pattern, true])),
  );
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

/** An error as one line a reader can act on, not a stack. */
export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0].trim() || 'unknown error';
}
