import * as path from 'path';
import picomatch = require('picomatch');

import type { Configuration, ConfigurationSection } from '../../ports/configuration';
import type { FileStat, FileSystem } from '../../ports/fileSystem';
import type { ResourceUri, WorkspaceFolder } from '../../ports/uri';
import type { FolderPattern, WorkspaceFiles } from '../../ports/workspace';
import type { NoteFiles } from './indexReader';
import {
  extractTags,
  getEntityNamespaceAliases,
  getPersonMarker,
  MarkdownParseOptions,
  NoteBoundaries,
  parseMarkdown,
  PARSE_FORMAT,
} from '../../domain/markdown/parser';
import { reportError } from '../../shared/timing';
import { ParkedRules, toParkedTagKey } from '../../domain/index/parked';
import { ParsedFile,
  UnreadableNote,
} from '../types';

/**
 * What the scanner reads the workspace through: its folders, finding and
 * naming files in them, the settings, joining paths, and reading files.
 *
 * Every part is a port, so the extension passes the VS Code workspace
 * (`platform/vscodeWorkspace.ts`) and a test passes plain objects. `U` is
 * the URI type both work in; the scanner hands back URIs of that type.
 */
export interface WorkspaceFileAccess<U extends ResourceUri = ResourceUri>
  extends WorkspaceFiles<U>,
    Configuration<U>,
    Pick<FileSystem<U>, 'joinPath' | 'readFile'> {
  /**
   * A note's stat. Optional: without it, notes carry no file times, and a
   * scan cannot tell an unchanged note from a changed one.
   */
  stat?(uri: U): PromiseLike<FileStat>;
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

/** The configured note boundary, falling back when the setting is stale. */
function getNoteBoundaries(value: unknown): NoteBoundaries {
  return value === 'heading' || value === 'marked' ? value : 'line';
}

/**
 * Reads only the configured Markdown surface of a workspace.
 *
 * File access is injected so path and parsing behavior can be tested without
 * requiring a live VS Code workspace, while extension.ts passes the VS Code
 * workspace from platform/vscodeWorkspace.ts in production.
 */
export class WorkspaceScanner<U extends ResourceUri = ResourceUri> implements NoteFiles<U> {
  /** Reads, finds, and configures through `access` alone, so a test can pass plain objects. */
  public constructor(
    private readonly access: WorkspaceFileAccess<U>,
  ) {}

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

  /**
   * Scans each workspace folder and skips unreadable files individually.
   *
   * One bad note should not make the rest of the workspace disappear from the
   * index, so read failures are reported and scanning continues.
   */
  public async scan(
    onProgress?: ScanProgress,
    reuse?: ReuseParsedFile,
    /** Called with each note read and parsed, between reads. */
    onParsed?: (file: ParsedFile) => void,
  ): Promise<ParsedFile[]> {
    const listing = await this.listNoteEntries();
    const entries = listing.entries;
    onProgress?.(0, entries.length);
    let completed = 0;
    const results = await mapWithConcurrency(entries, READS_IN_FLIGHT, async (entry) => {
      try {
        return await this.readEntry(entry, reuse, onParsed);
      } catch (error) {
        reportError(`Could not read ${entry.uri.toString()}`, error);
        const unreadable: UnreadableNote = {
          filePath: this.getFilePath(entry.uri, entry.workspaceFolder),
          reason: describeError(error),
        };
        return unreadable;
      } finally {
        completed += 1;
        onProgress?.(completed, entries.length);
      }
    });
    const { files, failures } = partitionReads(results);
    this.failures = failures;
    this.lastScan = {
      found: listing.found,
      templates: listing.templates,
      excluded: listing.excluded,
      read: files.length,
    };
    return files;
  }

  /**
   * The notes a scan reads, in the order findFiles gave them, with how many
   * Markdown files each folder held and how many the templates folder and the
   * exclude patterns kept out.
   */
  private async listNoteEntries(): Promise<NoteListing<U>> {
    const listing: NoteListing<U> = { entries: [], found: 0, templates: 0, excluded: 0 };
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
        excludeGlob ? { folder: workspaceFolder, pattern: excludeGlob } : undefined,
      );
      const templatesUri = this.getTemplatesFolderUri(workspaceFolder);
      const isExcluded = createExcludeMatcherFromPatterns(excludePatterns);

      const markdown = uris.filter((uri) => isMarkdownFile(uri));
      const outsideTemplates = markdown.filter(
        (uri) => !templatesUri || !isWithinWorkspace(uri, templatesUri),
      );
      const kept = outsideTemplates.filter(
        (uri) => !isExcluded(getRelativePath(uri, workspaceFolder, this.access)),
      );
      listing.found += markdown.length;
      listing.templates += markdown.length - outsideTemplates.length;
      listing.excluded += outsideTemplates.length - kept.length;
      kept.forEach((uri) => listing.entries.push({ uri, workspaceFolder }));
    }
    return listing;
  }

  /**
   * Reads one note of a scan: its stat first, and then, unless `reuse` has
   * the note as the file stands, its text.
   */
  private async readEntry(
    entry: ScanEntry<U>,
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
    uri: U,
    workspaceFolder = this.findWorkspaceFolder(uri),
    /** A stat already read, or null when it could not be, to skip another. */
    stamp?: FileStamp | null,
  ): Promise<ParsedFile> {
    assertMarkdownFile(uri);
    const [bytes, metadata] = await Promise.all([
      this.access.readFile(uri),
      this.metadataFor(uri, stamp),
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
   * The times read() parses a note with: from a stat already read, none when
   * that stat failed (null), or a fresh stat when there was none (undefined).
   */
  private metadataFor(
    uri: U,
    stamp: FileStamp | null | undefined,
  ): Promise<NoteTimes | undefined> | NoteTimes | undefined {
    if (stamp === undefined) {
      return this.readMetadata(uri);
    }
    if (stamp === null) {
      return undefined;
    }
    return timesOf(stamp);
  }

  /**
   * Parses editor content directly so unsaved Markdown can drive the sidebar.
   *
   * Callers may pass prior metadata because an in-memory edit has no reliable
   * filesystem stat to replace the file's creation and update timestamps.
   */
  public parse(
    uri: U,
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
          PARSE_FORMAT,
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
    const folderSettings = folders.map((folder) =>
      this.getConfiguration(folder).get<unknown>('parked.folders', {}),
    );
    const matchers = folders.map((folder, index) => ({
      prefix: multiRoot ? `${folder.name}/` : '',
      isParked: createExcludeMatcher(folderSettings[index]),
    }));
    const hasFolders = folderSettings.some(
      (value) =>
        value !== null &&
        typeof value === 'object' &&
        Object.values(value).some((enabled) => enabled === true),
    );
    const cache = new Map<string, boolean>();
    const options = this.getParseOptions(folders[0]);
    const written = this.access.getConfiguration('deckard').get<unknown>('parked.tags', ['parked']);
    const tags = [
      ...new Set(
        (Array.isArray(written) ? written : [])
          .filter((value): value is string => typeof value === 'string')
          .map((value) => parkedTagKey(value, options))
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
  public getPatterns(): Array<FolderPattern<U>> {
    return (this.access.workspaceFolders ?? []).map((workspaceFolder) =>
      this.createPattern(workspaceFolder),
    );
  }

  /**
   * Produces a stable index key and prefixes multi-root paths to avoid clashes.
   */
  public getFilePath(
    uri: U,
    workspaceFolder?: WorkspaceFolder<U>,
  ): string {
    const folder = workspaceFolder ?? this.findWorkspaceFolder(uri);
    if (!folder) {
      return uri.fsPath.replaceAll('\\', '/');
    }

    const relativePath = getRelativePath(uri, folder, this.access);
    if ((this.access.workspaceFolders?.length ?? 0) <= 1) {
      return relativePath.replaceAll('\\', '/');
    }

    return `${folder.name}/${relativePath.replaceAll('\\', '/')}`;
  }

  /**
   * The file an index path names: the inverse of `getFilePath`. Undefined
   * when no open workspace folder holds it.
   */
  public getUri(filePath: string): U | undefined {
    const folders = this.access.workspaceFolders ?? [];
    if (folders.length === 1) {
      return this.access.joinPath(folders[0].uri, ...filePath.split('/'));
    }
    const [name, ...rest] = filePath.split('/');
    const folder = folders.find((candidate) => candidate.name === name);
    return folder && rest.length > 0 ? this.access.joinPath(folder.uri, ...rest) : undefined;
  }

  /**
   * Resolves the optional configured notes folder without assuming it is non-empty.
   */
  public getNotesFolderUri(
    workspaceFolder: WorkspaceFolder<U>,
  ): U {
    const notesFolder = this.getNotesFolder(workspaceFolder);
    if (!notesFolder) {
      return workspaceFolder.uri;
    }

    return this.access.joinPath(workspaceFolder.uri, ...notesFolder.split('/'));
  }

  /**
   * Normalizes user configuration before it is used in VS Code glob/path APIs.
   */
  public getNotesFolder(workspaceFolder?: WorkspaceFolder<U>): string {
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
    workspaceFolder: WorkspaceFolder<U>,
  ): U | undefined {
    const folder = this.getConfiguration(workspaceFolder)
      .get<string>('templatesFolder', 'templates')
      .trim()
      .replaceAll('\\', '/')
      .replace(/^\/+|\/+$/g, '');
    return folder && folder !== '.'
      ? this.access.joinPath(workspaceFolder.uri, ...folder.split('/'))
      : undefined;
  }

  /**
   * Supplies parser options from the same workspace scope as the note.
   */
  public getParseOptions(
    workspaceFolder?: WorkspaceFolder<U>,
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
  public isNotesFile(uri: U): boolean {
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
        getRelativePath(uri, workspaceFolder, this.access),
      )
    );
  }

  /**
   * Builds the narrowest watcher glob so unrelated Markdown is not indexed.
   */
  private createPattern(
    workspaceFolder: WorkspaceFolder<U>,
  ): FolderPattern<U> {
    const notesFolder = this.getNotesFolder(workspaceFolder);
    const pattern = notesFolder ? `${notesFolder}/**/*.md` : '**/*.md';
    return { folder: workspaceFolder, pattern };
  }

  /**
   * Finds the owning root before resolving root-scoped settings and paths.
   */
  private findWorkspaceFolder(
    uri: U,
  ): WorkspaceFolder<U> | undefined {
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
    uri: U,
  ): Promise<NoteTimes | undefined> {
    const stamp = await this.readStamp(uri);
    return stamp ? timesOf(stamp) : undefined;
  }

  /** The note's times and size, or nothing when they cannot be read. */
  private async readStamp(uri: U): Promise<FileStamp | undefined> {
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
    workspaceFolder: WorkspaceFolder<U>,
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
  private getExcludePatterns(workspaceFolder: WorkspaceFolder<U>): string[] {
    const read = (section: string): unknown =>
      this.access
        .getConfiguration(section, workspaceFolder.uri)
        .get<unknown>('exclude', {});
    return collectExcludePatterns(read('deckard'), read('files'), read('search'));
  }

  /**
   * Reads configuration at the correct root for single- and multi-root workspaces.
   */
  private getConfiguration(
    workspaceFolder?: WorkspaceFolder<U>,
  ): ConfigurationSection {
    return workspaceFolder
      ? this.access.getConfiguration('deckard', workspaceFolder.uri)
      : this.access.getConfiguration('deckard');
  }
}

/** One note a scan will read, with the workspace folder its path is relative to. */
interface ScanEntry<U extends ResourceUri> {
  uri: U;
  workspaceFolder: WorkspaceFolder<U>;
}

/** The notes a scan will read, and the counts lastScan reports about how they were chosen. */
interface NoteListing<U extends ResourceUri> {
  entries: Array<ScanEntry<U>>;
  found: number;
  templates: number;
  excluded: number;
}

/** The dates a note carries from its file: created from ctime, updated from mtime. */
type NoteTimes = Pick<ParsedFile, 'createdAt' | 'updatedAt'>;

/**
 * A `deckard.parked.tags` entry keyed as the index keys tags, so an alias
 * parks the tag it stands for; a person key is kept as written, and an entry
 * that names no tag gives undefined.
 */
function parkedTagKey(value: string, options: MarkdownParseOptions): string | undefined {
  const key = toParkedTagKey(value);
  if (!key || key.startsWith('@')) {
    return key;
  }
  return (
    extractTags(key, options.entityNamespaceAliases, options.personMarker)[0]?.key.toLowerCase() ??
    key
  );
}

/** A stat's times as the dates a parsed note carries. */
function timesOf(stamp: FileStamp): NoteTimes {
  return { createdAt: stamp.ctime, updatedAt: stamp.mtime };
}

/**
 * Runs `read` over every item, `limit` at a time. Results keep the items'
 * order, whichever read finishes first.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  read: (item: T) => Promise<R>,
): Promise<Array<R | undefined>> {
  const results: Array<R | undefined> = new Array(items.length);
  let next = 0;
  const readNext = async (): Promise<void> => {
    while (next < items.length) {
      const position = next;
      next += 1;
      results[position] = await read(items[position]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, readNext));
  return results;
}

/** Splits a scan's reads into the notes parsed and the notes that could not be read, keeping order. */
function partitionReads(
  results: ReadonlyArray<ParsedFile | UnreadableNote | undefined>,
): { files: ParsedFile[]; failures: UnreadableNote[] } {
  const files: ParsedFile[] = [];
  const failures: UnreadableNote[] = [];
  results.forEach((result) => {
    if (result && 'reason' in result) {
      failures.push(result);
    } else if (result) {
      files.push(result);
    }
  });
  return { files, failures };
}

/**
 * Uses the URI path rather than language mode because extension behavior must
 * also cover unsaved or manually associated Markdown documents.
 */
export function isMarkdownFile(uri: Pick<ResourceUri, 'path'>): boolean {
  return uri.path.toLowerCase().endsWith('.md');
}

/**
 * Fails fast at parser boundaries so non-Markdown files cannot enter the index.
 */
function assertMarkdownFile(uri: ResourceUri): void {
  if (!isMarkdownFile(uri)) {
    throw new Error(`Deckard only parses Markdown files: ${uri.toString()}`);
  }
}

/**
 * Uses native filesystem paths for file URIs and VS Code's resolver otherwise.
 */
function getRelativePath<U extends ResourceUri>(
  uri: U,
  workspaceFolder: WorkspaceFolder<U>,
  workspace: Pick<WorkspaceFiles<U>, 'asRelativePath'>,
): string {
  if (uri.scheme === 'file' && workspaceFolder.uri.scheme === 'file') {
    return path
      .relative(workspaceFolder.uri.fsPath, uri.fsPath)
      .replaceAll(path.sep, '/');
  }

  return workspace.asRelativePath(uri, false);
}

/**
 * Performs boundary-aware containment checks instead of trusting a string
 * prefix, which would incorrectly treat sibling paths as children.
 */
function isWithinWorkspace(uri: ResourceUri, workspaceUri: ResourceUri): boolean {
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

/** An error as one line a reader can act on, not a stack. */
export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0].trim() || 'unknown error';
}
