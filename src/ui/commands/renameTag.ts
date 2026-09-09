import * as vscode from 'vscode';

import {
  EntityNamespaceAliases,
  extractTagSpans,
  extractTags,
  getEntityKind,
  getEntityNamespaceAliases,
  getPersonMarker,
} from '../../core/markdown/parser';
import {
  HeadingTagSpan,
  TagInfo,
  TagReference,
  WorkspaceIndex,
} from '../../core/types';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { resolveSourceUri } from './navigation';

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
 * Prompts for an indexed tag and applies a source-safe rename to every parsed
 * occurrence, including occurrences represented by note-level front matter.
 */
export async function renameIndexedTag(
  indexer: WorkspaceIndexer,
): Promise<boolean> {
  try {
    await indexer.ready;
    const index = indexer.getSnapshot();
    const sourceTag = await chooseIndexedTag(index);
    if (!sourceTag) {
      return false;
    }

    const parseOptions = getParseOptions(
      vscode.window.activeTextEditor?.document.uri ??
        vscode.workspace.workspaceFolders?.[0]?.uri,
    );
    const replacement = await chooseReplacementTag(sourceTag, parseOptions);
    if (!replacement) {
      return false;
    }

    if (replacement.key === sourceTag.key) {
      void vscode.window.showInformationMessage(
        `${sourceTag.label} already uses that tag identity.`,
      );
      return false;
    }

    const plan = await createRenamePlan(index, sourceTag.key, replacement);
    if (plan.staleFilePath) {
      void vscode.window.showWarningMessage(
        `Deckard could not rename ${sourceTag.label} because ${plan.staleFilePath} changed after indexing.`,
      );
      return false;
    }
    if (plan.occurrenceCount === 0) {
      void vscode.window.showWarningMessage(
        `Deckard could not find any current source occurrences of ${sourceTag.label}.`,
      );
      return false;
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

    if (!(await vscode.workspace.applyEdit(edit))) {
      void vscode.window.showErrorMessage(
        `Deckard could not rename ${sourceTag.label}. VS Code rejected the source edit.`,
      );
      return false;
    }

    for (const file of plan.files) {
      if (!(await file.document.save())) {
        void vscode.window.showErrorMessage(
          `Deckard renamed ${sourceTag.label} in memory but could not save ${file.document.uri.fsPath}.`,
        );
        return false;
      }
    }

    void vscode.window.showInformationMessage(
      `Renamed ${sourceTag.label} to ${replacement.label} in ${formatCount(
        plan.occurrenceCount,
        'occurrence',
        'occurrences',
      )}.`,
    );
    return true;
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Deckard could not rename a tag: ${String(error)}`,
    );
    return false;
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
  const spans = getMatchingSpans(content, sourceKey, options);
  if (spans.length === 0) {
    return { content, occurrenceCount: 0 };
  }

  const replacements = spans
    .map((span) => {
      const range = getContentRange(content, span);
      return {
        ...range,
        text: getReplacementText(content, span, replacement, options),
      };
    })
    .sort((left, right) => right.start - left.start);

  let updatedContent = content;
  replacements.forEach((replacementEdit) => {
    updatedContent =
      updatedContent.slice(0, replacementEdit.start) +
      replacementEdit.text +
      updatedContent.slice(replacementEdit.end);
  });

  return {
    content: updatedContent,
    occurrenceCount: replacements.length,
  };
}

async function chooseIndexedTag(
  index: WorkspaceIndex,
): Promise<TagInfo | undefined> {
  const tags = [...index.tags.values()].sort(
    (left, right) =>
      left.label.localeCompare(right.label) ||
      left.key.localeCompare(right.key),
  );
  if (tags.length === 0) {
    void vscode.window.showInformationMessage(
      'Deckard has no indexed tags to rename.',
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
      placeHolder: 'Search for a tag to rename',
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
    placeHolder: 'Enter a complete tag or a new name in the same namespace',
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

    const options = getParseOptions(uri);
    const spans = getMatchingSpans(file.content, sourceKey, options);
    if (spans.length === 0) {
      continue;
    }

    const document = await vscode.workspace.openTextDocument(uri);
    if (document.getText() !== file.content) {
      return { files: [], occurrenceCount: 0, staleFilePath: filePath };
    }

    const replacements = spans.map((span) => {
      const range = getContentRange(file.content, span);
      return {
        ...range,
        text: getReplacementText(file.content, span, replacement, options),
      };
    });
    occurrenceCount += replacements.length;
    files.push({ document, replacements });
  }

  return { files, occurrenceCount };
}

function getMatchingSpans(
  content: string,
  sourceKey: string,
  options: RenameTagOptions,
): HeadingTagSpan[] {
  return extractTagSpans(
    content,
    true,
    options.entityNamespaceAliases,
    options.personMarker,
  ).filter((span) => span.key === sourceKey);
}

function getContentRange(
  content: string,
  span: HeadingTagSpan,
): Pick<ContentReplacement, 'start' | 'end'> {
  const lineStarts = getLineStarts(content);
  const lineStart = lineStarts[span.lineNumber - 1];
  if (lineStart === undefined) {
    throw new Error(`Invalid tag line ${span.lineNumber}.`);
  }

  return {
    start: lineStart + span.startColumn,
    end: lineStart + span.endColumn,
  };
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
  if (normalizedField === 'tag' || normalizedField === 'tags') {
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

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
