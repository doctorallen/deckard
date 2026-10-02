import * as vscode from 'vscode';

import {
  EntityNamespaceAliases,
  extractTags,
  getEntityNamespaceAliases,
  getPersonMarker,
} from '../../domain/markdown/parser';
import { PreferenceServices } from '../../core/storage/preferences';
import { pluralize } from '../../shared/text';
import type { IndexControl, IndexReader } from '../../core/workspace/indexReader';
import { TagMergeSummary } from '../../domain/index/tagMerge';
import { resolveIndexedTagKey } from '../../domain/index/tagNavigation';
import { RenameTagOptions } from '../../domain/markdown/tagRename';
import {
  TagFileEdits,
  TagNotes,
  TagRewriteOutcome,
  TagService,
  TagWriteDescription,
  TagWriteOutcome,
} from '../../services/tagService';
import { resolveSourceUri, sourceScopeUri } from './navigation';
import { describeMissingTag, describeRejectedEdit, noteName, reindexAction, reportFailure, reportStale } from './notify';
import { WorkspaceWriteHistory, WriteHandle } from './workspaceWrites';
import { TagInfo, TagReference, WorkspaceIndex } from '../../domain/model';

/**
 * What a rename or merge writes through besides the notes: the history that
 * keeps it as the write Undo takes back, and the preferences whose
 * favorites, ranking, and saved views follow the tag, when there are any.
 *
 * `tags` is the TagService the extension made when it started. The pages
 * that rename a tag still hand over only the history and the preferences,
 * and get a service made from them for the one rewrite.
 */
export interface TagWrites {
  history: WorkspaceWriteHistory;
  preferences?: Pick<PreferenceServices, 'tagRenames'>;
  tags?: TagService;
}

/**
 * Prompts for an indexed tag when no source key is supplied, then applies a
 * source-safe rename to every parsed occurrence, including occurrences
 * represented by note-level front matter. Renaming into a tag that already
 * exists is a merge, and is confirmed first.
 */
export async function renameIndexedTag(
  indexer: IndexReader & IndexControl,
  requestedTagKey: string | undefined,
  writes: TagWrites,
): Promise<TagReference | undefined> {
  try {
    await indexer.ready;
    const index = indexer.getSnapshot();
    const sourceTag = await chooseIndexedTag(index, requestedTagKey, 'rename');
    if (!sourceTag) {
      return undefined;
    }

    const parseOptions = getParseOptions(
      vscode.window.activeTextEditor?.document.uri ??
        vscode.workspace.workspaceFolders?.[0]?.uri,
    );
    const replacement = await chooseReplacementTag(index, sourceTag, parseOptions);
    if (!replacement) {
      return undefined;
    }

    return await rewriteTag(indexer, { index, sourceTag, replacement }, writes);
  } catch (error) {
    void reportFailure({
      outcome: 'Deckard could not rename the tag, so nothing was written.',
      error,
    });
    return undefined;
  }
}

/**
 * Merges one indexed tag into another, chosen from the tags that exist.
 *
 * A caller that already knows both ends, such as the pair of tags Stats says
 * look alike, names them and goes straight to the confirmation.
 */
export async function mergeIndexedTag(
  indexer: IndexReader & IndexControl,
  requestedTagKey: string | undefined,
  writes: TagWrites,
  requestedTargetKey?: string,
): Promise<TagReference | undefined> {
  try {
    await indexer.ready;
    const index = indexer.getSnapshot();
    const sourceTag = await chooseIndexedTag(index, requestedTagKey, 'merge');
    if (!sourceTag) {
      return undefined;
    }

    const namedTarget = requestedTargetKey
      ? index.tags.get(
          resolveIndexedTagKey(index.tags, requestedTargetKey) ?? '',
        )
      : undefined;
    const targetTag =
      namedTarget ?? (await chooseMergeTarget(index, sourceTag));
    if (!targetTag || targetTag.key === sourceTag.key) {
      return undefined;
    }

    return await rewriteTag(
      indexer,
      { index, sourceTag, replacement: { key: targetTag.key, label: targetTag.label } },
      writes,
    );
  } catch (error) {
    void reportFailure({
      outcome: 'Deckard could not merge the tags, so nothing was written.',
      error,
    });
    return undefined;
  }
}

/**
 * Parses a complete replacement tag or infers the selected tag's marker and
 * namespace when the user enters only a new name.
 */
export function parseRenameTag(
  value: string,
  sourceTag: TagReference,
  entityNamespaceAliases?: EntityNamespaceAliases,
  personMarker?: string,
): TagReference | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const candidate = hasTagMarker(trimmed, personMarker)
    ? trimmed
    : inferBareTag(trimmed, sourceTag);
  if (!candidate) {
    return undefined;
  }

  const matches = extractTags(
    candidate,
    entityNamespaceAliases,
    personMarker,
  );
  return matches.length === 1 && matches[0].label === candidate
    ? matches[0]
    : undefined;
}


/** The tag a rename starts from and what it becomes, in the index the reader chose from. */
interface TagChoice {
  index: WorkspaceIndex;
  sourceTag: TagInfo;
  replacement: TagReference;
}

/**
 * Renames or merges one tag, as TagService decides, and says what came of
 * it. A merge is confirmed first, because renaming back afterwards cannot
 * separate the two tags again.
 */
async function rewriteTag(
  indexer: IndexReader & IndexControl,
  choice: TagChoice,
  writes: TagWrites,
): Promise<TagReference | undefined> {
  const tags = writes.tags ?? new TagService({ index: indexer, preferences: writes.preferences?.tagRenames });
  const notes = new TagNoteDocuments(writes.history);
  const result = await tags.rewrite({
    index: choice.index,
    source: choice.sourceTag,
    replacement: choice.replacement,
    notes,
  });
  if (result.kind !== 'confirm-merge') {
    return reportRewrite(result, choice, notes);
  }
  if (!(await confirmMerge(result.summary))) {
    return undefined;
  }
  return reportRewrite(await result.merge(), choice, notes);
}

/**
 * Says what a rename or merge came to. Returns the tag the notes carry now,
 * or undefined when nothing was written.
 */
function reportRewrite(
  result: TagRewriteOutcome<WriteHandle>,
  { sourceTag, replacement }: TagChoice,
  notes: TagNoteDocuments,
): TagReference | undefined {
  switch (result.kind) {
    case 'refused':
      void vscode.window.showInformationMessage(
        `${sourceTag.label} is already written that way.`,
      );
      return undefined;
    case 'stale':
      void reportStale([notes.uriOf(result.filePath)]);
      return undefined;
    case 'not-found':
      void reportFailure({
        outcome: `Deckard could not find ${sourceTag.label} in any note as the notes are now, so nothing was written.`,
      });
      return undefined;
    case 'unopened':
      void reportFailure({
        outcome: `Deckard could not open ${result.filePath}, so nothing was written.`,
        error: result.error,
      });
      return undefined;
    case 'rejected':
      void reportFailure({
        outcome: `VS Code did not accept the change to ${result.filePaths.length === 1 ? noteName(notes.uriOf(result.filePaths[0])) : `${result.filePaths.length} notes`}, so nothing was written.`,
        fix: describeRejectedEdit('').fix,
      });
      return undefined;
    case 'unchanged':
      void vscode.window.showInformationMessage(
        `Deckard left ${sourceTag.label} as it was.`,
      );
      return undefined;
    case 'written':
      reportWritten(result, sourceTag, replacement);
      return replacement;
  }
}

/**
 * Says the notes now carry the new tag, warning first when the index could
 * not read them again, and offers the Undo.
 */
function reportWritten(
  result: Extract<TagRewriteOutcome<WriteHandle>, { kind: 'written' }>,
  sourceTag: TagInfo,
  replacement: TagReference,
): void {
  const done = result.merge ? 'Merged' : 'Renamed';
  const joiner = result.merge ? 'into' : 'to';
  if (result.refreshFailure) {
    void reportFailure({
      outcome: `${done} ${sourceTag.label} ${joiner} ${replacement.label}, but Deckard could not read the notes again, so search may show the old tag until the next save.`,
      severity: 'warning',
      action: reindexAction(),
      error: result.refreshFailure.error,
    });
  }
  // Undo is offered where it was done: a Try next merge, or one from a
  // tag's menu, is not something a reader thinks to find in the palette.
  result.handle.offerUndo(
    `${done} ${sourceTag.label} ${joiner} ${replacement.label} in ${pluralize(
      result.notes,
      'note',
      'notes',
    )}.`,
    {
      guard: 'latest',
      done: (undone) =>
        `Put back ${sourceTag.label} in ${pluralize(undone?.restored ?? 0, 'note', 'notes')}.`,
    },
  );
}

/**
 * The notes one rename reads and writes, through VS Code. Only a note the
 * rename changes has its file found, once, and its document opened, once,
 * and the write is made on those same documents, so the offsets planned
 * against their text land where they were planned.
 */
class TagNoteDocuments implements TagNotes<WriteHandle> {
  private readonly uris = new Map<string, vscode.Uri>();
  private readonly documents = new Map<string, vscode.TextDocument>();

  public constructor(private readonly history: WorkspaceWriteHistory) {}

  /**
   * The note's parse options, as the settings of its folder say. The folder
   * is read from the note's path without finding its file, since every
   * indexed note is asked and most are not changed.
   */
  public optionsFor(filePath: string): Promise<Required<RenameTagOptions>> {
    return Promise.resolve(getParseOptions(sourceScopeUri(filePath)));
  }

  /** The note's text as its document holds it now; rejects when its file cannot be found or opened. */
  public async contentOf(filePath: string): Promise<string> {
    const uri = await resolveSourceUri(filePath);
    if (!uri) {
      throw new Error(`Deckard could not resolve source file: ${filePath}`);
    }
    this.uris.set(filePath, uri);
    const document = await vscode.workspace.openTextDocument(uri);
    this.documents.set(filePath, document);
    return document.getText();
  }

  /** The note's URI, as found when its text was read. */
  public uriOf(filePath: string): vscode.Uri {
    const uri = this.uris.get(filePath);
    if (!uri) {
      throw new Error(`Deckard did not look up ${filePath} for this rename.`);
    }
    return uri;
  }

  /** Writes the edits through the history, shown first when they reach more than one note. */
  public async write(
    files: readonly TagFileEdits[],
    description: TagWriteDescription,
  ): Promise<TagWriteOutcome<WriteHandle>> {
    const edit = new vscode.WorkspaceEdit();
    files.forEach((file) => {
      const document = this.documentOf(file.filePath);
      file.edits.forEach((replacementEdit) => {
        edit.replace(
          document.uri,
          new vscode.Range(
            document.positionAt(replacementEdit.start),
            document.positionAt(replacementEdit.end),
          ),
          replacementEdit.text,
        );
      });
    });

    const verb = description.merge ? 'merge' : 'rename';
    const joiner = description.merge ? 'into' : 'to';
    const written = await this.history.write(edit, {
      label: `the ${verb} of ${description.sourceLabel} ${joiner} ${description.replacementLabel}`,
      description: `${description.merge ? 'Merge' : 'Rename'} ${description.sourceLabel} ${joiner} ${description.replacementLabel}`,
      restore: description.restore,
    });
    return written.applied
      ? { applied: true, notes: written.notes.length, handle: written.handle }
      : { applied: false };
  }

  /** The document opened for the note when its text was read. */
  private documentOf(filePath: string): vscode.TextDocument {
    const document = this.documents.get(filePath);
    if (!document) {
      throw new Error(`Deckard did not read ${filePath} for this rename.`);
    }
    return document;
  }
}


/**
 * Asks, in a modal, whether to merge one tag into another, saying what the
 * kept tag will hold. True only when the reader chooses Merge.
 */
async function confirmMerge(summary: TagMergeSummary): Promise<boolean> {
  const { source, target } = summary;
  const shared = describeShared(summary.sharedCount);
  const hubFilePaths = [
    ...(target.hubFilePaths ?? []),
    ...(source.hubFilePaths ?? []),
  ].sort((left, right) => left.localeCompare(right));
  const detail = [
    `${source.label} has ${formatEntries(source.count)} and ${target.label} has ${formatEntries(target.count)}. ${shared}, so ${target.label} will have ${formatEntries(summary.mergedCount)}.`,
    `Every ${source.label} in your notes becomes ${target.label}, and renaming it back later cannot separate them.`,
    ...(source.hubFilePaths?.length && target.hubFilePaths?.length
      ? [
          `Both tags have a hub note. ${hubFilePaths[0]} will lead the overview, and the others will be listed beside it.`,
        ]
      : []),
  ].join('\n\n');

  const choice = await vscode.window.showWarningMessage(
    `Merge ${source.label} into ${target.label}?`,
    { modal: true, detail },
    'Merge',
  );
  return choice === 'Merge';
}

/** How many entries already carry both tags, as the merge prompt says it. */
function describeShared(sharedCount: number): string {
  if (sharedCount === 0) {
    return 'None carry both';
  }
  return sharedCount === 1 ? '1 carries both' : `${sharedCount} carry both`;
}

/**
 * The tag to rename or merge: the one a caller named, resolved through its
 * aliases, or one picked from every indexed tag. A named tag the index does
 * not have is reported; undefined then, with no tags, or on Escape.
 */
async function chooseIndexedTag(
  index: WorkspaceIndex,
  requestedTagKey: string | undefined,
  action: 'rename' | 'merge',
): Promise<TagInfo | undefined> {
  if (requestedTagKey !== undefined) {
    const canonicalTagKey = resolveIndexedTagKey(index.tags, requestedTagKey);
    const requestedTag = canonicalTagKey
      ? index.tags.get(canonicalTagKey)
      : undefined;
    if (requestedTag) {
      return requestedTag;
    }
    void reportFailure({ outcome: describeMissingTag(requestedTagKey) });
    return undefined;
  }

  const tags = sortTags([...index.tags.values()]);
  if (tags.length === 0) {
    void vscode.window.showInformationMessage(
      `Deckard has no indexed tags to ${action}.`,
    );
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    tags.map((tag) => ({
      label: tag.label,
      description: pluralize(tag.count, 'indexed entry', 'indexed entries'),
      detail: tag.key === tag.label ? undefined : `Canonical key: ${tag.key}`,
      tag,
    })),
    {
      matchOnDescription: true,
      placeHolder:
        action === 'merge'
          ? 'Search for the tag to merge into another'
          : 'Search for a tag to rename',
    },
  );
  return picked?.tag;
}

/** The tag to merge into, picked from every other indexed tag; undefined when there is none or on Escape. */
async function chooseMergeTarget(
  index: WorkspaceIndex,
  sourceTag: TagInfo,
): Promise<TagInfo | undefined> {
  const tags = sortTags(
    [...index.tags.values()].filter((tag) => tag.key !== sourceTag.key),
  );
  if (tags.length === 0) {
    void vscode.window.showInformationMessage(
      `Deckard has no other tag to merge ${sourceTag.label} into.`,
    );
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    tags.map((tag) => ({
      label: tag.label,
      description: pluralize(tag.count, 'indexed entry', 'indexed entries'),
      tag,
    })),
    {
      matchOnDescription: true,
      placeHolder: `Merge ${sourceTag.label} into…`,
    },
  );
  return picked?.tag;
}

/** What the Rename box says of what is typed, and how firmly. */
export interface RenameTargetDescription {
  message: string;
  severity: 'error' | 'warning' | 'info';
}

const RENAME_TAG_ERROR =
  'Write one tag, such as #project/new-name, or a new name in the same namespace.';

/**
 * Says, as a new name is typed, what renaming to it will do: nothing, a
 * merge into a tag that exists, or a new tag. A bare name with a `/` in it
 * keeps the old tag's namespace, which is rarely meant, so that one warns.
 */
export function describeRenameTarget(
  index: Pick<WorkspaceIndex, 'tags'>,
  sourceTag: TagReference,
  value: string,
  options: RenameTagOptions = {},
): RenameTargetDescription {
  const replacement = parseRenameTag(
    value,
    sourceTag,
    options.entityNamespaceAliases,
    options.personMarker,
  );
  if (!replacement) {
    return { message: RENAME_TAG_ERROR, severity: 'error' };
  }
  const existingKey = resolveIndexedTagKey(index.tags, replacement.key);
  if (existingKey === sourceTag.key || replacement.key === sourceTag.key) {
    return {
      message: `This is ${sourceTag.label} already; nothing will change.`,
      severity: 'info',
    };
  }
  const existing = existingKey ? index.tags.get(existingKey) : undefined;
  if (existing) {
    return {
      message: `Merges into ${existing.label} (${formatEntries(existing.count)}).`,
      severity: 'info',
    };
  }
  const trimmed = value.trim();
  const sourceName = sourceTag.label.slice(1);
  const namespace =
    sourceTag.key.startsWith('#') && sourceName.includes('/')
      ? sourceName.slice(0, sourceName.indexOf('/'))
      : '';
  if (!hasTagMarker(trimmed, options.personMarker) && trimmed.includes('/') && namespace) {
    return {
      message: `Becomes a new tag ${replacement.label}. Start with # to leave out ${namespace}/.`,
      severity: 'warning',
    };
  }
  return { message: `Becomes a new tag ${replacement.label}.`, severity: 'info' };
}

/**
 * The part of a tag's label a rename most likely changes, selected in the
 * box: the name after its namespace, or after its marker.
 */
export function nameSelection(label: string): [number, number] {
  const slash = label.indexOf('/');
  return [slash >= 0 ? slash + 1 : 1, label.length];
}

/**
 * The Rename box: the tag's label with its name selected, judged as it is
 * typed. An error refuses Enter; a warning or a note only informs. Undefined
 * on Escape.
 */
async function chooseReplacementTag(
  index: WorkspaceIndex,
  sourceTag: TagInfo,
  options: Required<RenameTagOptions>,
): Promise<TagReference | undefined> {
  const severities = {
    info: vscode.InputBoxValidationSeverity.Info,
    warning: vscode.InputBoxValidationSeverity.Warning,
  };
  return vscode.window.showInputBox({
    title: `Rename ${sourceTag.label}`,
    value: sourceTag.label,
    valueSelection: nameSelection(sourceTag.label),
    prompt: 'Type a new name to keep the namespace, or a whole tag starting with # or @.',
    validateInput: (value) => {
      const described = describeRenameTarget(index, sourceTag, value, options);
      // An error stays a plain string, so the box refuses Enter.
      return described.severity === 'error'
        ? described.message
        : { message: described.message, severity: severities[described.severity] };
    },
  }).then((value) =>
    value === undefined
      ? undefined
      : parseRenameTag(
          value,
          sourceTag,
          options.entityNamespaceAliases,
          options.personMarker,
        ),
  );
}

/** The tag settings for a note's folder, or the workspace's when none is given. */
function getParseOptions(uri?: vscode.Uri): Required<RenameTagOptions> {
  const configuration = vscode.workspace.getConfiguration('deckard', uri);
  return {
    entityNamespaceAliases: getEntityNamespaceAliases(
      configuration.get<unknown>('entityNamespaceAliases', {}),
    ),
    personMarker: getPersonMarker(
      configuration.get<unknown>('personMarker', '@'),
    ),
  };
}

/** Whether typed text starts with a tag marker: #, @, or the person marker set. */
function hasTagMarker(value: string, personMarker?: string): boolean {
  const activePersonMarker = getPersonMarker(personMarker);
  return (
    value.startsWith('#') ||
    value.startsWith('@') ||
    value.startsWith(activePersonMarker)
  );
}

/**
 * A name typed without a marker, as a tag in the source tag's namespace: a
 * person keeps its marker, and a #tag its namespace. Undefined for a source
 * tag that is neither.
 */
function inferBareTag(
  value: string,
  sourceTag: TagReference,
): string | undefined {
  if (sourceTag.key.startsWith('@')) {
    const marker = sourceTag.label[0] ?? '@';
    return `${marker}${value}`;
  }

  if (!sourceTag.key.startsWith('#')) {
    return undefined;
  }

  const sourceName = sourceTag.label.slice(1);
  const separator = sourceName.indexOf('/');
  const namespace =
    separator >= 0 ? sourceName.slice(0, separator) : undefined;
  return namespace ? `#${namespace}/${value}` : `#${value}`;
}

/** Sorts in place, by label then key, so a pick lists tags alphabetically. */
function sortTags(tags: TagInfo[]): TagInfo[] {
  return tags.sort(
    (left, right) =>
      left.label.localeCompare(right.label) ||
      left.key.localeCompare(right.key),
  );
}

/** "1 entry" or "N entries". */
function formatEntries(count: number): string {
  return pluralize(count, 'entry', 'entries');
}
