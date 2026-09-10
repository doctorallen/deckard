import * as vscode from 'vscode';

import {
  Entity,
  ParsedFile,
  SearchResult,
  Section,
  TagAssociation,
  TagInfo,
  TagReference,
  Task,
  WorkspaceIndex,
} from '../types';
import { getEntityKind } from '../markdown/parser';
import { SearchStore } from '../storage/searchStore';
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
   * Returns source-backed search results using the local full-text cache to
   * narrow candidates and the live parser index for exact navigation targets.
   */
  public search(query: string): SearchResult[] {
    const index = this.getSnapshot();
    const matchingPaths = new Set(
      this.searchStore?.search(query).map((result) => result.filePath) ?? [],
    );
    if (matchingPaths.size === 0) {
      return [];
    }

    const terms = getMeaningfulTerms(query);
    const taskQuery = /\b(task|tasks|todo|todos|owe|open|outstanding|completed)\b/i.test(
      query,
    );
    const completedOnly = /\b(completed|done)\b/i.test(query);
    const activeOnly = /\b(open|outstanding|owe)\b/i.test(query);
    const since = /\blast week\b/i.test(query)
      ? Date.now() - 7 * 24 * 60 * 60 * 1000
      : undefined;
    const results: SearchResult[] = [];

    index.files.forEach((file, filePath) => {
      if (!matchingPaths.has(filePath)) {
        return;
      }

      if (!taskQuery) {
        file.sections.forEach((section) => {
          const result = createSectionSearchResult(section, index, terms);
          if (result && (since === undefined || (result.updatedAt ?? 0) >= since)) {
            results.push(result);
          }
        });
      }

      file.tasks.forEach((task) => {
        if (
          (completedOnly && !task.completed) ||
          (activeOnly && task.completed)
        ) {
          return;
        }
        const result = createTaskSearchResult(task, index, terms);
        if (result && (since === undefined || (result.updatedAt ?? 0) >= since)) {
          results.push(result);
        }
      });
    });

    return results
      .sort(
        (left, right) =>
          right.score - left.score ||
          (right.updatedAt ?? 0) - (left.updatedAt ?? 0) ||
          left.filePath.localeCompare(right.filePath) ||
          left.line - right.line,
      )
      .slice(0, 50);
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
        this.searchStore?.replace(this.files.values());
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
        const inlineTagsChanged = event.affectsConfiguration(
          'deckard.parseInlineTags',
        );
        const entityNamespaceAliasesChanged = event.affectsConfiguration(
          'deckard.entityNamespaceAliases',
        );
        const personMarkerChanged = event.affectsConfiguration(
          'deckard.personMarker',
        );
        if (
          notesFolderChanged ||
          inlineTagsChanged ||
          entityNamespaceAliasesChanged ||
          personMarkerChanged
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
        this.searchStore?.remove(filePath);
        continue;
      }

      try {
        const previous = this.files.get(filePath);
        const parsedFile =
          update.content === undefined
            ? await this.scanner.read(update.uri)
            : this.scanner.parse(update.uri, update.content, previous);
        this.files.set(filePath, parsedFile);
        this.searchStore?.upsert(parsedFile);
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

function getMeaningfulTerms(query: string): string[] {
  const stopWords = new Set([
    'what',
    'did',
    'with',
    'about',
    'the',
    'are',
    'latest',
    'and',
    'for',
    'have',
    'learned',
    'written',
    'happened',
    'last',
    'week',
    'before',
    'this',
    'meeting',
  ]);
  return [
    ...new Set(
      query
        .toLowerCase()
        .match(/[a-z0-9][a-z0-9_-]*/g)
        ?.filter((term) => term.length > 1 && !stopWords.has(term)) ?? [],
    ),
  ];
}

function createSectionSearchResult(
  section: Section,
  index: WorkspaceIndex,
  terms: string[],
): SearchResult | undefined {
  const text = `${section.heading}\n${section.rawContent}`.toLowerCase();
  const matchedEntities = getMatchedEntities(section.tags, index, terms);
  const matchedTerms = terms.filter((term) => text.includes(term));
  if (matchedEntities.length === 0 && matchedTerms.length === 0) {
    return undefined;
  }

  return {
    type: 'section',
    id: section.id,
    filePath: section.filePath,
    line: section.startLine,
    title: section.heading,
    excerpt: getExcerpt(section.rawContent, matchedTerms),
    matchedEntities,
    updatedAt: section.updatedAt,
    score: matchedEntities.length * 10 + matchedTerms.length,
  };
}

function createTaskSearchResult(
  task: Task,
  index: WorkspaceIndex,
  terms: string[],
): SearchResult | undefined {
  const text = task.title.toLowerCase();
  const matchedEntities = getMatchedEntities(task.tags, index, terms);
  const matchedTerms = terms.filter((term) => text.includes(term));
  if (matchedEntities.length === 0 && matchedTerms.length === 0) {
    return undefined;
  }

  return {
    type: 'task',
    id: task.id,
    filePath: task.filePath,
    line: task.lineNumber,
    title: task.title,
    excerpt: task.title,
    matchedEntities,
    updatedAt: task.updatedAt,
    score: matchedEntities.length * 10 + matchedTerms.length,
  };
}

function getMatchedEntities(
  tagKeys: string[],
  index: WorkspaceIndex,
  terms: string[],
): TagReference[] {
  return tagKeys.flatMap((key) => {
    const entity = index.entities.get(key);
    if (!entity) {
      return [];
    }
    const names = entity.name.toLowerCase().split(/[\s/-]+/);
    return names.some((name) => terms.includes(name))
      ? [{ key: entity.key, label: entity.label }]
      : [];
  });
}

function getExcerpt(content: string, terms: string[]): string {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const matchingLine =
    lines.find((line) => terms.some((term) => line.toLowerCase().includes(term))) ??
    lines[1] ??
    lines[0] ??
    '';
  return matchingLine.trim();
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

  files.forEach((file) => {
    file.sections.forEach((section) => {
      sections.set(section.id, section);
      section.tags.forEach((tagKey) => {
        const tag = getOrCreateTag(tags, tagKey, section.tagLabels[tagKey]);
        tag.sectionIds.push(section.id);
        addEntityReference(
          entities,
          tagKey,
          section.tagLabels[tagKey] ?? tagKey,
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
