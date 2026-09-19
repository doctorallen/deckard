import * as vscode from 'vscode';

import {
  EntityNamespaceAliases,
  extractTagSpans,
  extractTags,
  getEntityKind,
  getEntityNamespaceAliases,
  getPersonMarker,
} from '../../core/markdown/parser';
import { PreferencesStore } from '../../core/storage/preferences';
import {
  HeadingTagSpan,
  TagInfo,
  TagReference,
  WorkspaceIndex,
} from '../../core/types';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { resolveIndexedTagKey } from '../../core/workspace/tagNavigation';
import { resolveSourceUri } from './navigation';
import { applyWorkspaceWrite } from './workspaceWrites';

interface RenameTagOptions {
  entityNamespaceAliases?: EntityNamespaceAliases;
  personMarker?: string;
}

interface ContentReplacement {
  start: number;
  end: number;
  text: string;
}

interface FileRenamePlan {
  document: vscode.TextDocument;
  replacements: ContentReplacement[];
}

interface RenamePlan {
  files: FileRenamePlan[];
  occurrenceCount: number;
  staleFilePath?: string;
}

/**
 * What merging one tag into another does to the index.
 */
export interface TagMergeSummary {
  source: TagInfo;
  target: TagInfo;
  /** Entries the kept tag will have, counted the way the index counts them. */
  mergedCount: number;
  /** Entries that already carry both tags. */
  sharedCount: number;
}

/**
 * Prompts for an indexed tag when no source key is supplied, then applies a
 * source-safe rename to every parsed occurrence, including occurrences
 * represented by note-level front matter. Renaming into a tag that already
 * exists is a merge, and is confirmed first.
 */
export async function renameIndexedTag(
  indexer: WorkspaceIndexer,
  requestedTagKey?: string,
  preferences?: PreferencesStore,
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
    const replacement = await chooseReplacementTag(sourceTag, parseOptions);
    if (!replacement) {
      return undefined;
    }

    return await rewriteTag(indexer, index, sourceTag, replacement, preferences);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Deckard could not rename a tag: ${String(error)}`,
    );
    return undefined;
  }
}

/**
 * Merges one indexed tag into another, chosen from the tags that exist.
 */
export async function mergeIndexedTag(
  indexer: WorkspaceIndexer,
  requestedTagKey?: string,
  preferences?: PreferencesStore,
): Promise<TagReference | undefined> {
  try {
    await indexer.ready;
    const index = indexer.getSnapshot();
    const sourceTag = await chooseIndexedTag(index, requestedTagKey, 'merge');
    if (!sourceTag) {
      return undefined;
    }

    const targetTag = await chooseMergeTarget(index, sourceTag);
    if (!targetTag) {
      return undefined;
    }

    return await rewriteTag(
      indexer,
      index,
      sourceTag,
      { key: targetTag.key, label: targetTag.label },
      preferences,
    );
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Deckard could not merge a tag: ${String(error)}`,
    );
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

/**
 * Replaces only parser-recognized spans whose canonical key matches the
 * selected tag. Ranges are applied from right to left so offsets stay stable.
 */
export function replaceIndexedTag(
  content: string,
  sourceKey: string,
  replacement: TagReference,
  options: RenameTagOptions = {},
): { content: string; occurrenceCount: number } {
  const { edits, occurrenceCount } = planTagEdits(
    content,
    sourceKey,
    replacement,
    options,
  );

  let updatedContent = content;
  [...edits]
    .sort((left, right) => right.start - left.start)
    .forEach((edit) => {
      updatedContent =
        updatedContent.slice(0, edit.start) +
        edit.text +
        updatedContent.slice(edit.end);
    });

  return { content: updatedContent, occurrenceCount };
}

/**
 * Plans the edits that turn every parser-recognized occurrence of one tag
 * into another.
 *
 * Where the new tag already sits in the same run of tags on a line, or in the
 * same front-matter list, the old occurrence is removed instead, so a merge
 * never leaves `#atlas #atlas` behind. A tag inside a sentence is always
 * replaced, because removing it would change the sentence.
 */
export function planTagEdits(
  content: string,
  sourceKey: string,
  replacement: TagReference,
  options: RenameTagOptions = {},
): { edits: ContentReplacement[]; occurrenceCount: number } {
  const spans = extractTagSpans(
    content,
    true,
    options.entityNamespaceAliases,
    options.personMarker,
  );
  const sourceSpans = spans
    .filter((span) => span.key === sourceKey)
    .sort(
      (left, right) =>
        left.lineNumber - right.lineNumber ||
        left.startColumn - right.startColumn,
    );
  if (sourceSpans.length === 0) {
    return { edits: [], occurrenceCount: 0 };
  }

  const lines = content.split(/\r?\n/);
  const lineStarts = getLineStarts(content);
  // A tag's container is its front-matter field, or otherwise its line.
  const containerOf = (span: HeadingTagSpan): string => {
    const field = getFrontmatterField(content, span.lineNumber);
    return field ? `field:${field}` : `line:${span.lineNumber}`;
  };
  // Only a copy of the new tag that was already written counts, so a plain
  // rename still replaces every occurrence and keeps its source's shape.
  const holdsReplacement = new Set(
    spans.filter((span) => span.key === replacement.key).map(containerOf),
  );
  const removed = new Set<HeadingTagSpan>();

  const edits = sourceSpans.map((span): ContentReplacement => {
    const lineStart = lineStarts[span.lineNumber - 1];
    if (lineStart === undefined) {
      throw new Error(`Invalid tag line ${span.lineNumber}.`);
    }
    const removal = holdsReplacement.has(containerOf(span))
      ? getRemovalRange(
          lines[span.lineNumber - 1] ?? '',
          lineStart,
          lineStarts[span.lineNumber],
          span,
          spans,
          removed,
          getFrontmatterField(content, span.lineNumber) !== undefined,
        )
      : undefined;
    if (removal) {
      removed.add(span);
      return { ...removal, text: '' };
    }
    return {
      start: lineStart + span.startColumn,
      end: lineStart + span.endColumn,
      text: getReplacementText(content, span, replacement, options),
    };
  });

  return {
    edits: joinTouchingEdits(edits),
    occurrenceCount: sourceSpans.length,
  };
}

/**
 * Counts what merging one tag into another leaves the kept tag with.
 */
export function summarizeTagMerge(
  index: WorkspaceIndex,
  sourceKey: string,
  targetKey: string,
): TagMergeSummary | undefined {
  const source = index.tags.get(sourceKey);
  const target = index.tags.get(targetKey);
  if (!source || !target || source.key === target.key) {
    return undefined;
  }

  const sectionIds = new Set([...source.sectionIds, ...target.sectionIds]);
  const taskIds = new Set([...source.taskIds, ...target.taskIds]);
  const filePaths = new Set([...source.filePaths, ...target.filePaths]);
  // A task inside a tagged section is already counted by its section.
  const standaloneTasks = [...taskIds].filter((taskId) => {
    const task = index.tasks.get(taskId);
    return !task?.sectionId || !sectionIds.has(task.sectionId);
  });
  const mergedCount =
    sectionIds.size + standaloneTasks.length + filePaths.size;

  return {
    source,
    target,
    mergedCount,
    sharedCount: Math.max(0, source.count + target.count - mergedCount),
  };
}

/**
 * Rewrites every source occurrence of one tag as another. When the other tag
 * already exists this is a merge, which is confirmed first because renaming
 * back afterwards cannot separate the two tags again.
 */
async function rewriteTag(
  indexer: WorkspaceIndexer,
  index: WorkspaceIndex,
  sourceTag: TagInfo,
  replacement: TagReference,
  preferences?: PreferencesStore,
): Promise<TagReference | undefined> {
  const targetKey = resolveIndexedTagKey(index.tags, replacement.key);
  if (replacement.key === sourceTag.key || targetKey === sourceTag.key) {
    void vscode.window.showInformationMessage(
      `${sourceTag.label} already uses that tag identity.`,
    );
    return undefined;
  }

  const merge = targetKey
    ? summarizeTagMerge(index, sourceTag.key, targetKey)
    : undefined;
  if (merge && !(await confirmMerge(merge))) {
    return undefined;
  }
  const verb = merge ? 'merge' : 'rename';
  const done = merge ? 'Merged' : 'Renamed';
  const joiner = merge ? 'into' : 'to';

  const plan = await createRenamePlan(index, sourceTag.key, replacement);
  if (plan.staleFilePath) {
    void vscode.window.showWarningMessage(
      `Deckard could not ${verb} ${sourceTag.label} because ${plan.staleFilePath} changed after indexing.`,
    );
    return undefined;
  }
  if (plan.occurrenceCount === 0) {
    void vscode.window.showWarningMessage(
      `Deckard could not find any current source occurrences of ${sourceTag.label}.`,
    );
    return undefined;
  }

  const edit = new vscode.WorkspaceEdit();
  plan.files.forEach((file) => {
    file.replacements.forEach((replacementEdit) => {
      edit.replace(
        file.document.uri,
        new vscode.Range(
          file.document.positionAt(replacementEdit.start),
          file.document.positionAt(replacementEdit.end),
        ),
        replacementEdit.text,
      );
    });
  });

  // The write is shown first when it reaches more than one note, and kept
  // afterwards, so `Deckard: Undo Last Change` can take the whole of it back.
  const written = await applyWorkspaceWrite(edit, {
    label: `the ${verb} of ${sourceTag.label} ${joiner} ${replacement.label}`,
    description: `${verb === 'merge' ? 'Merge' : 'Rename'} ${sourceTag.label} ${joiner} ${replacement.label}`,
    restore: async () => {
      await preferences?.replaceTagKey(
        targetKey ?? replacement.key,
        sourceTag.key,
      );
      await indexer.refresh();
    },
  });
  if (!written.applied) {
    void vscode.window.showErrorMessage(
      `Deckard could not ${verb} ${sourceTag.label}. VS Code rejected the source edit.`,
    );
    return undefined;
  }
  if (written.notes.length === 0) {
    void vscode.window.showInformationMessage(
      `Deckard left ${sourceTag.label} as it was.`,
    );
    return undefined;
  }

  // Favorites, ranking, and saved views follow the tag. This runs before the
  // refresh so nothing prunes them while they still name the old key.
  await preferences?.replaceTagKey(sourceTag.key, targetKey ?? replacement.key);

  try {
    await indexer.refresh();
  } catch (error) {
    void vscode.window.showWarningMessage(
      `${done} ${sourceTag.label} ${joiner} ${replacement.label}, but Deckard could not refresh its index: ${String(error)}`,
    );
  }
  void vscode.window.showInformationMessage(
    `${done} ${sourceTag.label} ${joiner} ${replacement.label} in ${formatCount(
      written.notes.length,
      'note',
      'notes',
    )}.`,
  );
  return replacement;
}

async function confirmMerge(summary: TagMergeSummary): Promise<boolean> {
  const { source, target } = summary;
  const shared =
    summary.sharedCount === 0
      ? 'None carry both'
      : summary.sharedCount === 1
        ? '1 carries both'
        : `${summary.sharedCount} carry both`;
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
    void vscode.window.showWarningMessage(
      `Deckard could not find the tag: ${requestedTagKey}`,
    );
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
      description: formatCount(tag.count, 'indexed entry', 'indexed entries'),
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
      description: formatCount(tag.count, 'indexed entry', 'indexed entries'),
      tag,
    })),
    {
      matchOnDescription: true,
      placeHolder: `Merge ${sourceTag.label} into…`,
    },
  );
  return picked?.tag;
}

async function chooseReplacementTag(
  sourceTag: TagInfo,
  options: Required<RenameTagOptions>,
): Promise<TagReference | undefined> {
  return vscode.window.showInputBox({
    prompt: `Rename ${sourceTag.label} to`,
    placeHolder:
      'Enter a complete tag or a new name in the same namespace. An existing tag merges into it.',
    validateInput: (value) =>
      parseRenameTag(
        value,
        sourceTag,
        options.entityNamespaceAliases,
        options.personMarker,
      )
        ? undefined
        : 'Enter exactly one valid tag, such as #project/new-name or a bare new name.',
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

async function createRenamePlan(
  index: WorkspaceIndex,
  sourceKey: string,
  replacement: TagReference,
): Promise<RenamePlan> {
  const files: FileRenamePlan[] = [];
  let occurrenceCount = 0;

  for (const [filePath, file] of index.files) {
    const uri = await resolveSourceUri(filePath);
    if (!uri) {
      throw new Error(`Deckard could not resolve source file: ${filePath}`);
    }

    const planned = planTagEdits(
      file.content,
      sourceKey,
      replacement,
      getParseOptions(uri),
    );
    if (planned.edits.length === 0) {
      continue;
    }

    const document = await vscode.workspace.openTextDocument(uri);
    if (document.getText() !== file.content) {
      return { files: [], occurrenceCount: 0, staleFilePath: filePath };
    }

    occurrenceCount += planned.occurrenceCount;
    files.push({ document, replacements: planned.edits });
  }

  return { files, occurrenceCount };
}

/**
 * The range to delete when an occurrence repeats the tag it becomes, or
 * undefined when deleting it would damage the text around it.
 */
function getRemovalRange(
  line: string,
  lineStart: number,
  nextLineStart: number | undefined,
  span: HeadingTagSpan,
  spans: readonly HeadingTagSpan[],
  removed: ReadonlySet<HeadingTagSpan>,
  inFrontmatter: boolean,
): Pick<ContentReplacement, 'start' | 'end'> | undefined {
  if (inFrontmatter) {
    // A block list item goes with its whole line.
    if (/^\s*-\s/.test(line)) {
      return { start: lineStart, end: nextLineStart ?? lineStart + line.length };
    }
    // An inline list item goes with its quotes and one comma.
    let start = span.startColumn;
    let end = span.endColumn;
    const quote = line[start - 1];
    if ((quote === '"' || quote === "'") && line[end] === quote) {
      start -= 1;
      end += 1;
    }
    const commaBefore = line.slice(0, start).match(/,\s*$/);
    if (commaBefore) {
      return { start: lineStart + start - commaBefore[0].length, end: lineStart + end };
    }
    const commaAfter = line.slice(end).match(/^\s*,\s*/);
    return commaAfter
      ? { start: lineStart + start, end: lineStart + end + commaAfter[0].length }
      : undefined;
  }

  // An inline tag goes only from a run of tags, with the space on one side.
  const lineSpans = spans.filter(
    (other) => other.lineNumber === span.lineNumber && other !== span,
  );
  const previous = lineSpans
    .filter((other) => other.endColumn <= span.startColumn)
    .sort((left, right) => right.endColumn - left.endColumn)[0];
  const next = lineSpans
    .filter((other) => other.startColumn >= span.endColumn)
    .sort((left, right) => left.startColumn - right.startColumn)[0];
  const joinsPrevious =
    previous !== undefined &&
    /^[ \t]+$/.test(line.slice(previous.endColumn, span.startColumn));
  const joinsNext =
    next !== undefined &&
    /^[ \t]+$/.test(line.slice(span.endColumn, next.startColumn));
  // Prefer the space before, unless that tag is itself being removed.
  if (joinsPrevious && !removed.has(previous)) {
    return {
      start: lineStart + previous.endColumn,
      end: lineStart + span.endColumn,
    };
  }
  if (joinsNext) {
    return {
      start: lineStart + span.startColumn,
      end: lineStart + next.startColumn,
    };
  }
  return joinsPrevious
    ? { start: lineStart + previous.endColumn, end: lineStart + span.endColumn }
    : undefined;
}

/** Joins edits that touch or overlap, which VS Code would otherwise reject. */
function joinTouchingEdits(edits: ContentReplacement[]): ContentReplacement[] {
  return [...edits]
    .sort((left, right) => left.start - right.start)
    .reduce<ContentReplacement[]>((joined, edit) => {
      const last = joined[joined.length - 1];
      if (last && edit.start <= last.end) {
        joined[joined.length - 1] = {
          start: last.start,
          end: Math.max(last.end, edit.end),
          text: last.text + edit.text,
        };
      } else {
        joined.push(edit);
      }
      return joined;
    }, []);
}

function getReplacementText(
  content: string,
  span: HeadingTagSpan,
  replacement: TagReference,
  options: RenameTagOptions,
): string {
  const line = content.split(/\r?\n/)[span.lineNumber - 1] ?? '';
  const sourceText = line.slice(span.startColumn, span.endColumn);
  const activePersonMarker = getPersonMarker(options.personMarker);
  if (
    sourceText.startsWith('#') ||
    sourceText.startsWith('@') ||
    sourceText.startsWith(activePersonMarker)
  ) {
    return replacement.label;
  }

  const field = getFrontmatterField(content, span.lineNumber);
  if (!field) {
    return replacement.label;
  }

  return getFrontmatterReplacement(field, replacement, options);
}

function getFrontmatterReplacement(
  field: string,
  replacement: TagReference,
  options: RenameTagOptions,
): string {
  const normalizedField = field.toLowerCase();
  if (
    normalizedField === 'tag' ||
    normalizedField === 'tags' ||
    normalizedField === 'describes'
  ) {
    return replacement.key.startsWith('#')
      ? replacement.label.slice(1)
      : replacement.label;
  }

  const expectedKind = getFrontmatterKind(normalizedField);
  if (
    expectedKind === 'person' &&
    getEntityKind(replacement, options.entityNamespaceAliases) === 'person'
  ) {
    return replacement.label.slice(1);
  }
  if (
    expectedKind &&
    getEntityKind(replacement, options.entityNamespaceAliases) === expectedKind
  ) {
    return getTagName(replacement.label);
  }

  return replacement.label;
}

function getFrontmatterKind(field: string): string | undefined {
  if (field === 'person' || field === 'people') {
    return 'person';
  }
  if (field === 'project' || field === 'projects') {
    return 'project';
  }
  if (field === 'topic' || field === 'topics') {
    return 'topic';
  }
  if (field === 'organization' || field === 'organizations') {
    return 'organization';
  }
  if (field === 'meeting' || field === 'meetings') {
    return 'meeting';
  }
  return undefined;
}

function getTagName(label: string): string {
  const withoutMarker = label.slice(1);
  const separator = withoutMarker.indexOf('/');
  return separator >= 0
    ? withoutMarker.slice(separator + 1)
    : withoutMarker;
}

function getFrontmatterField(
  content: string,
  lineNumber: number,
): string | undefined {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return undefined;
  }

  let currentField: string | undefined;
  for (let lineIndex = 1; lineIndex < lineNumber; lineIndex += 1) {
    if (lines[lineIndex]?.trim() === '---') {
      return undefined;
    }
    const property = lines[lineIndex]?.match(
      /^\s*([A-Za-z][A-Za-z0-9_-]*):/,
    );
    if (property) {
      currentField = property[1].toLowerCase();
    }
  }
  return currentField;
}

function getLineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') {
      starts.push(index + 1);
    }
  }
  return starts;
}

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

function hasTagMarker(value: string, personMarker?: string): boolean {
  const activePersonMarker = getPersonMarker(personMarker);
  return (
    value.startsWith('#') ||
    value.startsWith('@') ||
    value.startsWith(activePersonMarker)
  );
}

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

function sortTags(tags: TagInfo[]): TagInfo[] {
  return tags.sort(
    (left, right) =>
      left.label.localeCompare(right.label) ||
      left.key.localeCompare(right.key),
  );
}

function formatEntries(count: number): string {
  return formatCount(count, 'entry', 'entries');
}

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
