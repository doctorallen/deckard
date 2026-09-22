import * as vscode from 'vscode';

import {
  Entity,
  ParsedFile,
  Section,
  TagAssociation,
  TagInfo,
  TagReference,
  Task,
  WorkspaceIndex,
  UnreadableNote,
} from '../types';
import { getEntityKind } from '../markdown/parser';
import {
  EntrySearchOptions,
  EntrySearchResult,
  SearchStore,
} from '../storage/searchStore';
import { measure, measureAsync, reportError } from '../timing';
import { ScanProgress, WorkspaceScanner, describeError } from './scanner';

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
  /** The derived index, kept until the notes next change. */
  private snapshot: WorkspaceIndex | undefined;
  /** Notes in the workspace that are not in the index, and why. */
  private readonly unreadable = new Map<string, string>();

  public constructor(
    private readonly scanner = new WorkspaceScanner(),
    private readonly searchStore?: SearchStore,
  ) {
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
   * The notes the workspace has that the index does not, because they could
   * not be read, with why. Sorted by path so two reports of the same state
   * read the same.
   */
  public getUnreadable(): UnreadableNote[] {
    return [...this.unreadable]
      .map(([filePath, reason]) => ({ filePath, reason }))
      .sort((a, b) => a.filePath.localeCompare(b.filePath));
  }

  /** What the last full scan found, kept out, and read. */
  public getLastScan(): { found: number; templates: number; excluded: number; read: number } {
    return { ...this.scanner.lastScan };
  }

  /**
   * Exposes the initial scan as a barrier for commands that need complete data.
   */
  public get ready(): Promise<void> {
    return this.readyPromise;
  }

  /**
   * Returns the derived index, built once per change to the notes and shared
   * by every caller until the next one, so callers treat it as read-only.
   *
   * Building it walks every note, and editor features ask for it on every
   * keystroke and cursor move, so rebuilding per call was the main cost of
   * typing in a large workspace.
   */
  public getSnapshot(): WorkspaceIndex {
    this.snapshot ??= measure(
      'Build index',
      () => buildWorkspaceIndex(new Map(this.files)),
      (index) => `${index.files.size} notes, ${index.sections.size} entries`,
    );
    return this.snapshot;
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
   * Searches the local full-text cache for note entries and tasks, best
   * first. The ids it returns are the live index's, so a caller can open or
   * filter by them directly.
   */
  public searchEntries(
    query: string,
    options?: EntrySearchOptions,
  ): EntrySearchResult {
    return (
      this.searchStore?.searchEntries(query, options) ?? {
        matches: [],
        partial: false,
      }
    );
  }

  /**
   * Answers the closest word the notes contain for each word they do not,
   * so a surface that searches the index itself can correct a misspelling
   * the same way the full-text cache does.
   */
  public suggestWords(terms: readonly string[]): ReadonlyMap<string, string> {
    return this.searchStore?.suggestWords(terms) ?? new Map();
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

  public getTemplatesFolderUri(
    workspaceFolder: vscode.WorkspaceFolder,
  ): vscode.Uri | undefined {
    return this.scanner.getTemplatesFolderUri(workspaceFolder);
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
        const parsedFiles = await measureAsync(
          'Scan workspace',
          () =>
            this.scanner.scan((completed, total): void => {
              progress.report({
                message:
                  total > 0
                    ? `${completed}/${total} Markdown files`
                    : 'No Markdown files',
                increment: total > 0 ? 100 / total : 0,
              });
            }),
          (files) => `${files.length} notes`,
        );
        if (this.disposed) {
          return;
        }

        this.files.clear();
        parsedFiles.forEach((file) => this.files.set(file.filePath, file));
        this.unreadable.clear();
        this.scanner.failures.forEach((failure) =>
          this.unreadable.set(failure.filePath, failure.reason),
        );
        this.snapshot = undefined;
        measure(
          'Rebuild search index',
          () =>
            this.searchStore?.replace(
              this.files.values(),
              this.scanner.getParseFingerprint(),
            ),
          () => `${this.files.size} notes`,
        );
        // What the store handed to its worker is still being written. The
        // log says when it lands, because until then a search finds a note
        // by its title and tags but not yet by the words inside it.
        this.reportSearchIndexWritten();
        this.emitUpdate();
      },
    );
  }

  /** Times the part of a rebuild that finished after the host moved on. */
  private reportSearchIndexWritten(): void {
    const store = this.searchStore;
    if (store) {
      void measureAsync('Write search index off the extension host', () =>
        store.whenIdle(),
      );
    }
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
    this.searchStore?.dispose();
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
        const inlineTagsChanged =
          event.affectsConfiguration('deckard.parseInlineTags') ||
          event.affectsConfiguration('deckard.noteBoundaries');
        const entityNamespaceAliasesChanged = event.affectsConfiguration(
          'deckard.entityNamespaceAliases',
        );
        const personMarkerChanged = event.affectsConfiguration(
          'deckard.personMarker',
        );
        const templatesFolderChanged = event.affectsConfiguration(
          'deckard.templatesFolder',
        );
        const excludeChanged =
          event.affectsConfiguration('deckard.exclude') ||
          event.affectsConfiguration('files.exclude');
        if (
          notesFolderChanged ||
          inlineTagsChanged ||
          entityNamespaceAliasesChanged ||
          personMarkerChanged ||
          templatesFolderChanged ||
          excludeChanged
        ) {
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
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (this.scanner.isNotesFile(document.uri)) {
          this.queueUpsert(document.uri);
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
      // The glob can take in files that are not notes, such as templates.
      const upsertNote = (uri: vscode.Uri) => {
        if (this.scanner.isNotesFile(uri)) {
          this.queueUpsert(uri);
        }
      };
      this.watcherDisposables.push(watcher.onDidCreate(upsertNote));
      this.watcherDisposables.push(watcher.onDidChange(upsertNote));
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
    await measureAsync(
      'Read changed notes',
      () => this.applyUpdates(updates),
      () => `${updates.length} ${updates.length === 1 ? 'note' : 'notes'}`,
    );
    this.snapshot = undefined;
    this.emitUpdate();
  }

  private async applyUpdates(updates: PendingUpdate[]): Promise<void> {
    for (const update of updates) {
      const filePath = this.scanner.getFilePath(update.uri);
      if (update.deleted) {
        this.files.delete(filePath);
        this.unreadable.delete(filePath);
        this.searchStore?.remove(filePath);
        continue;
      }

      try {
        const previous = this.files.get(filePath);
        const parsedFile =
          update.content === undefined
            ? await this.scanner.read(update.uri)
            : this.scanner.parse(update.uri, update.content, previous?.fileTimes);
        this.files.set(filePath, parsedFile);
        this.unreadable.delete(filePath);
        this.searchStore?.upsert(parsedFile);
      } catch (error) {
        reportError(`Could not update ${filePath}`, error);
        this.unreadable.set(filePath, describeError(error));
      }
    }
  }

  /**
   * Publishes a newly derived snapshot after the cache is internally consistent.
   * The measurement covers every listener, so it is what one save costs.
   */
  private emitUpdate(): void {
    measure('Refresh views after an index update', () =>
      this.updateEmitter.fire(this.getSnapshot()),
    );
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
  const entities = new Map<string, Entity>();
  const hubFilePaths = new Map<string, string[]>();

  files.forEach((file) => {
    file.hub?.describes.forEach((tagReference) => {
      hubFilePaths.set(tagReference.key, [
        ...(hubFilePaths.get(tagReference.key) ?? []),
        file.filePath,
      ]);
    });
    file.sections.forEach((section) => {
      sections.set(section.id, section);
      // A tag written on one of the section's own body lines finds the
      // section too: the tag stayed on its line, and the section is what
      // holds the line.
      const bodyTagLabels = new Map(
        (section.bodyTags ?? []).map((tag) => [tag.key, tag.label]),
      );
      const tagKeys = [
        ...new Set([...section.tags, ...bodyTagLabels.keys()]),
      ];
      tagKeys.forEach((tagKey) => {
        const label =
          section.tagLabels[tagKey] ?? bodyTagLabels.get(tagKey) ?? tagKey;
        const tag = getOrCreateTag(tags, tagKey, label);
        tag.sectionIds.push(section.id);
        addEntityReference(
          entities,
          tagKey,
          label,
          'section',
          section.id,
          section.updatedAt,
        );
      });
    });
    file.tasks.forEach((task) => {
      tasks.set(task.id, task);
      task.tags.forEach((tagKey) => {
        const tag = getOrCreateTag(tags, tagKey, task.tagLabels[tagKey]);
        tag.taskIds.push(task.id);
        addEntityReference(
          entities,
          tagKey,
          task.tagLabels[tagKey] ?? tagKey,
          'task',
          task.id,
          task.updatedAt,
        );
      });
    });
    const contentTagKeys = new Set([
      ...file.sections.flatMap((section) => section.tags),
      ...file.tasks.flatMap((task) => task.tags),
    ]);
    file.frontmatterTags.forEach((tagReference) => {
      if (contentTagKeys.has(tagReference.key)) {
        return;
      }
      const tag = getOrCreateTag(tags, tagReference.key, tagReference.label);
      if (!tag.filePaths.includes(file.filePath)) {
        tag.filePaths.push(file.filePath);
      }
      addEntityReference(
        entities,
        tagReference.key,
        tagReference.label,
        'file',
        file.filePath,
        file.updatedAt,
      );
    });
  });

  const { tagAssociations } = buildTagAssociations(sections, tasks);

  tags.forEach((tag) => {
    // A task inside a tagged section is already represented by that section;
    // count it separately only when its tag would otherwise have no entry.
    const taggedSections = new Set(tag.sectionIds);
    const standaloneTasks = tag.taskIds.filter((taskId) => {
      const task = tasks.get(taskId);
      return !task?.sectionId || !taggedSections.has(task.sectionId);
    });
    tag.count =
      taggedSections.size + standaloneTasks.length + tag.filePaths.length;
  });
  // The first note by path is the tag's hub; any others are shown as conflicts.
  hubFilePaths.forEach((filePaths, tagKey) => {
    const tag = tags.get(tagKey);
    if (tag) {
      tag.hubFilePaths = [...filePaths].sort((left, right) =>
        left.localeCompare(right),
      );
    }
  });
  entities.forEach((entity) => {
    const entitySections = new Set(entity.sectionIds);
    const standaloneTasks = entity.taskIds.filter((taskId) => {
      const task = tasks.get(taskId);
      return !task?.sectionId || !entitySections.has(task.sectionId);
    });
    entity.count =
      entitySections.size + standaloneTasks.length + entity.filePaths.length;
  });

  return {
    files,
    sections,
    tasks,
    tags,
    entities,
    tagAssociations,
    updatedAt: Date.now(),
  };
}

/**
 * Combines explicit same-source associations with heading proximity.
 *
 * Same-source tags are strongest because the author wrote them together. Tags
 * on ancestor headings provide weaker context that decays by outline depth.
 */
function buildTagAssociations(
  sections: Map<string, Section>,
  tasks: Map<string, Task>,
): {
  tagAssociations: Map<string, TagAssociation[]>;
} {
  const associations = new Map<string, MutableTagAssociation>();
  const sourceUnits = new Map<string, TagReference[]>();
  sections.forEach((section) => {
    (section.associationTagGroups ?? []).forEach((tags, index) => {
      const unitId = `section:${section.id}:group:${index}`;
      registerSourceUnit(sourceUnits, unitId, tags);
      addAssociationGroup(associations, tags, { sectionId: section.id, unitId });
    });
    addHeadingAssociations(associations, sourceUnits, section, sections);
  });
  tasks.forEach((task) => {
    (task.associationTagGroups ?? []).forEach((tags, index) => {
      const unitId = `task:${task.id}:group:${index}`;
      registerSourceUnit(sourceUnits, unitId, tags);
      addAssociationGroup(associations, tags, { taskId: task.id, unitId });
    });
  });

  const tagSourceUnitCounts = getTagSourceUnitCounts(sourceUnits);
  const tagAssociations = new Map<string, TagAssociation[]>();
  [...associations.entries()]
    .map(([key, relationship]) => {
      const [tagKey] = key.split('\u0000');
      const tagSourceUnitCount = tagSourceUnitCounts.get(tagKey) ?? 0;
      const associatedTagSourceUnitCount =
        tagSourceUnitCounts.get(relationship.associatedTag.key) ?? 0;
      return {
        key,
        ...relationship,
        count: relationship.sourceUnitIds.size,
        normalizedWeight: getNormalizedAssociationWeight(
          relationship.weight,
          relationship.sourceUnitIds.size,
          tagSourceUnitCount,
          associatedTagSourceUnitCount,
        ),
        tagSourceUnitCount,
        associatedTagSourceUnitCount,
        totalSourceUnitCount: sourceUnits.size,
      };
    })
    .sort(
      (left, right) =>
        right.coOccurrenceCount - left.coOccurrenceCount ||
        right.weight - left.weight ||
        left.associatedTag.label.localeCompare(right.associatedTag.label) ||
        left.associatedTag.key.localeCompare(right.associatedTag.key),
    )
    .forEach(({ key, ...relationship }) =>
      appendAssociation(tagAssociations, key.split('\u0000')[0], relationship),
    );
  return { tagAssociations };
}

interface MutableTagAssociation extends Omit<TagAssociation,
  | 'count'
  | 'normalizedWeight'
  | 'tagSourceUnitCount'
  | 'associatedTagSourceUnitCount'
  | 'totalSourceUnitCount'> {
  sourceUnitIds: Set<string>;
}

function addAssociationGroup(
  associations: Map<string, MutableTagAssociation>,
  tags: TagReference[],
  source: { sectionId?: string; taskId?: string; unitId: string },
): void {
  const uniqueTags = [...new Map(tags.map((tag) => [tag.key, tag])).values()];
  uniqueTags.forEach((tag, index) => {
    uniqueTags.slice(index + 1).forEach((associatedTag) => {
      addAssociationEvidence(associations, tag, associatedTag, source, 1, true);
      addAssociationEvidence(associations, associatedTag, tag, source, 1, true);
    });
  });
}

function addHeadingAssociations(
  associations: Map<string, MutableTagAssociation>,
  sourceUnits: Map<string, TagReference[]>,
  section: Section,
  sections: Map<string, Section>,
): void {
  const sourceTags = section.headingTags ?? [];
  if (sourceTags.length === 0) {
    return;
  }

  let parentSectionId = section.parentSectionId;
  let depth = 1;
  const visited = new Set<string>();
  while (parentSectionId && !visited.has(parentSectionId)) {
    visited.add(parentSectionId);
    const parent = sections.get(parentSectionId);
    if (!parent) {
      break;
    }
    (parent.headingTags ?? []).forEach((parentTag) => {
      sourceTags.forEach((childTag) => {
        const unitId = `heading:${section.id}:${parent.id}`;
        registerSourceUnit(sourceUnits, unitId, [...sourceTags, ...parent.headingTags ?? []]);
        addAssociationEvidence(
          associations,
          childTag,
          parentTag,
          { sectionId: section.id, unitId },
          0.5 / depth,
          false,
        );
        addAssociationEvidence(
          associations,
          parentTag,
          childTag,
          { sectionId: section.id, unitId },
          0.5 / depth,
          false,
        );
      });
    });
    parentSectionId = parent.parentSectionId;
    depth += 1;
  }
}

function addAssociationEvidence(
  associations: Map<string, MutableTagAssociation>,
  tag: TagReference,
  associatedTag: TagReference,
  source: { sectionId?: string; taskId?: string; unitId: string },
  weight: number,
  isCoOccurrence: boolean,
): void {
  if (tag.key === associatedTag.key) {
    return;
  }
  const key = `${tag.key}\u0000${associatedTag.key}`;
  const relationship = associations.get(key) ?? {
    associatedTag: { ...associatedTag },
    sectionIds: [],
    taskIds: [],
    weight: 0,
    coOccurrenceCount: 0,
    headingRelationshipCount: 0,
    sourceUnitIds: new Set<string>(),
  };
  if (source.sectionId && !relationship.sectionIds.includes(source.sectionId)) {
    relationship.sectionIds.push(source.sectionId);
  }
  if (source.taskId && !relationship.taskIds.includes(source.taskId)) {
    relationship.taskIds.push(source.taskId);
  }
  relationship.sourceUnitIds.add(source.unitId);
  relationship.weight += weight;
  if (isCoOccurrence) {
    relationship.coOccurrenceCount += 1;
  } else {
    relationship.headingRelationshipCount += 1;
  }
  associations.set(key, relationship);
}

function registerSourceUnit(
  sourceUnits: Map<string, TagReference[]>,
  unitId: string,
  tags: TagReference[],
): void {
  if (!sourceUnits.has(unitId)) {
    sourceUnits.set(
      unitId,
      [...new Map(tags.map((tag) => [tag.key, tag])).values()],
    );
  }
}

function getTagSourceUnitCounts(
  sourceUnits: ReadonlyMap<string, TagReference[]>,
): Map<string, number> {
  const counts = new Map<string, number>();
  sourceUnits.forEach((tags) => {
    tags.forEach((tag) =>
      counts.set(tag.key, (counts.get(tag.key) ?? 0) + 1),
    );
  });
  return counts;
}

/**
 * Downweights a raw edge when either tag occurs in many authoring units while
 * retaining a useful score for a one-off, intentional pairing.
 */
function getNormalizedAssociationWeight(
  rawWeight: number,
  support: number,
  tagSourceUnitCount: number,
  associatedTagSourceUnitCount: number,
): number {
  if (rawWeight <= 0 || support <= 0) {
    return 0;
  }
  const prevalence = support / Math.max(
    1,
    tagSourceUnitCount,
    associatedTagSourceUnitCount,
  );
  const supportConfidence = support / (support + 1);
  return rawWeight * prevalence * (0.5 + supportConfidence / 2);
}

function appendAssociation(
  associations: Map<string, TagAssociation[]>,
  tagKey: string,
  association: TagAssociation,
): void {
  const existing = associations.get(tagKey);
  if (existing) {
    existing.push(association);
  } else {
    associations.set(tagKey, [association]);
  }
}

/**
 * Shares one tag record across section and task references by canonical key.
 */
function getOrCreateTag(
  tags: Map<string, TagInfo>,
  key: string,
  label = key,
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
    filePaths: [],
    count: 0,
    isFavorite: false,
  };
  tags.set(key, tag);
  return tag;
}

/**
 * Builds entity hubs directly from canonical tags without requiring a separate
 * source of truth beyond the Markdown note that carries the tag.
 */
function addEntityReference(
  entities: Map<string, Entity>,
  key: string,
  label: string,
  referenceType: 'section' | 'task' | 'file',
  referenceId: string,
  updatedAt: number | undefined,
): void {
  const kind = getEntityKind({ key, label });
  if (!kind) {
    return;
  }

  let entity = entities.get(key);
  if (!entity) {
    entity = {
      key,
      label,
      kind,
      name: getEntityName(label),
      sectionIds: [],
      taskIds: [],
      filePaths: [],
      count: 0,
      isFavorite: false,
      updatedAt,
    };
    entities.set(key, entity);
  }

  const references =
    referenceType === 'section'
      ? entity.sectionIds
      : referenceType === 'task'
        ? entity.taskIds
        : entity.filePaths;
  references.push(referenceId);
  if (updatedAt !== undefined && (entity.updatedAt ?? 0) < updatedAt) {
    entity.updatedAt = updatedAt;
  }
}

function getEntityName(label: string): string {
  const name = label.slice(1).split('/').at(-1) ?? label;
  return name.replaceAll('-', ' ');
}
