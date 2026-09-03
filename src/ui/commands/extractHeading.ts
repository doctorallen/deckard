import * as vscode from 'vscode';

import { stripTags } from '../../core/markdown/parser';
import { Section } from '../../core/types';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { resolveSourceUri } from './navigation';

export async function extractHeadingCommand(
  indexer: WorkspaceIndexer,
): Promise<vscode.Uri | undefined> {
  await indexer.ready;
  const choice = await chooseTaggedHeading(indexer);
  if (!choice) {
    return undefined;
  }

  const name = await vscode.window.showInputBox({
    prompt: `Name the new note for "${choice.section.heading}"`,
    value: getSuggestedNoteName(choice.section.heading),
    validateInput: validateExtractedNoteName,
  });
  if (name === undefined) {
    return undefined;
  }

  return extractHeadingNote(
    choice.section,
    choice.sourceUri,
    indexer.getNotesFolderUri(choice.workspaceFolder),
    name,
  );
}

export function findTaggedHeadingAtLine(
  sections: readonly Section[],
  line: number,
): Section | undefined {
  return sections
    .filter(
      (section) =>
        !section.isInline &&
        section.tags.length > 0 &&
        section.startLine <= line &&
        section.endLine >= line,
    )
    .sort(
      (left, right) =>
        right.startLine - left.startLine ||
        right.headingLevel - left.headingLevel,
    )[0];
}

export function getExtractedNoteFileName(name: string): string | undefined {
  const trimmedName = name.trim();
  const baseName = trimmedName.replace(/\.md$/i, '').trim();

  if (
    !baseName ||
    baseName === '.' ||
    baseName === '..' ||
    /[/\\\u0000-\u001f\u007f<>:"|?*]/.test(baseName) ||
    /[. ]$/.test(baseName)
  ) {
    return undefined;
  }

  return `${baseName}.md`;
}

export function validateExtractedNoteName(name: string): string | undefined {
  return getExtractedNoteFileName(name)
    ? undefined
    : 'Enter one note name without a path or special filename characters.';
}

export async function extractHeadingNote(
  section: Section,
  sourceUri: vscode.Uri,
  notesFolderUri: vscode.Uri,
  name: string,
): Promise<vscode.Uri | undefined> {
  if (section.isInline || section.tags.length === 0) {
    return undefined;
  }

  const fileName = getExtractedNoteFileName(name);
  if (!fileName) {
    return undefined;
  }

  const noteUri = vscode.Uri.joinPath(notesFolderUri, fileName);
  await vscode.workspace.fs.createDirectory(notesFolderUri);

  try {
    await vscode.workspace.fs.stat(noteUri);
    void vscode.window.showWarningMessage(
      `Deckard did not extract the heading because ${fileName} already exists.`,
    );
    return undefined;
  } catch {
    await vscode.workspace.fs.writeFile(
      noteUri,
      Buffer.from(section.rawContent, 'utf8'),
    );
  }

  if (!(await removeSectionFromSource(sourceUri, section))) {
    try {
      await vscode.workspace.fs.delete(noteUri, { useTrash: false });
    } catch {}
    return undefined;
  }

  const document = await vscode.workspace.openTextDocument(noteUri);
  await vscode.window.showTextDocument(document, { preview: false });
  return noteUri;
}

interface HeadingChoice extends vscode.QuickPickItem {
  section: Section;
  sourceUri: vscode.Uri;
  workspaceFolder: vscode.WorkspaceFolder;
}

async function chooseTaggedHeading(
  indexer: WorkspaceIndexer,
): Promise<HeadingChoice | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (editor && isMarkdownFile(editor.document.uri)) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(
      editor.document.uri,
    );
    if (workspaceFolder && indexer.isNotesFile(editor.document.uri)) {
      const filePath = indexer.getFilePath(editor.document.uri);
      const previous = indexer.getSnapshot().files.get(filePath);
      const parsed = indexer.parse(
        editor.document.uri,
        editor.document.getText(),
        previous,
      );
      const section = findTaggedHeadingAtLine(
        parsed.sections,
        editor.selection.active.line + 1,
      );
      if (section) {
        return createHeadingChoice(
          section,
          editor.document.uri,
          workspaceFolder,
        );
      }
    }
  }

  const choices: HeadingChoice[] = [];
  const sections = [...indexer.getSnapshot().sections.values()]
    .filter((section) => !section.isInline && section.tags.length > 0)
    .sort(
      (left, right) =>
        left.filePath.localeCompare(right.filePath) ||
        left.startLine - right.startLine,
    );

  for (const section of sections) {
    const sourceUri = await resolveSourceUri(section.filePath);
    const workspaceFolder = sourceUri
      ? vscode.workspace.getWorkspaceFolder(sourceUri)
      : undefined;
    if (workspaceFolder) {
      choices.push(createHeadingChoice(section, sourceUri!, workspaceFolder));
    }
  }

  if (choices.length === 0) {
    void vscode.window.showInformationMessage(
      'Deckard could not find any tagged headings to extract.',
    );
    return undefined;
  }

  return vscode.window.showQuickPick(choices, {
    placeHolder: 'Choose a tagged heading to extract',
  });
}

function createHeadingChoice(
  section: Section,
  sourceUri: vscode.Uri,
  workspaceFolder: vscode.WorkspaceFolder,
): HeadingChoice {
  const tags = section.tags.map(
    (tagKey) => section.tagLabels[tagKey] ?? `#${tagKey}`,
  );
  return {
    label: stripTags(section.heading) || section.heading,
    description: `${section.filePath}:${section.startLine}`,
    detail: `Tags: ${tags.join(' ')}`,
    section,
    sourceUri,
    workspaceFolder,
  };
}

function getSuggestedNoteName(heading: string): string {
  const suggestion = stripTags(heading)
    .replace(/[/\\<>:"|?*]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim();
  return suggestion || 'extracted-note';
}

async function removeSectionFromSource(
  sourceUri: vscode.Uri,
  section: Section,
): Promise<boolean> {
  let sourceEditApplied = false;
  let sourceStart: vscode.Position | undefined;
  let originalSourceContent: string | undefined;

  const restoreSource = async (): Promise<boolean> => {
    if (
      !sourceEditApplied ||
      !sourceStart ||
      originalSourceContent === undefined
    ) {
      return true;
    }

    sourceEditApplied = false;
    try {
      const rollback = new vscode.WorkspaceEdit();
      rollback.insert(sourceUri, sourceStart, originalSourceContent);
      return await vscode.workspace.applyEdit(rollback);
    } catch {
      return false;
    }
  };

  try {
    const document = await vscode.workspace.openTextDocument(sourceUri);
    if (
      section.startLine < 1 ||
      section.endLine < section.startLine ||
      section.endLine > document.lineCount
    ) {
      return false;
    }

    const start = new vscode.Position(section.startLine - 1, 0);
    sourceStart = start;
    const contentEnd = new vscode.Position(
      section.endLine - 1,
      document.lineAt(section.endLine - 1).text.length,
    );
    const contentRange = new vscode.Range(start, contentEnd);
    originalSourceContent = document.getText(contentRange);
    if (normalizeLineEndings(originalSourceContent) !== section.rawContent) {
      void vscode.window.showWarningMessage(
        'Deckard could not extract this heading because the source section changed.',
      );
      return false;
    }

    const deletionEnd =
      section.endLine < document.lineCount
        ? new vscode.Position(section.endLine, 0)
        : contentEnd;
    const edit = new vscode.WorkspaceEdit();
    edit.delete(sourceUri, new vscode.Range(start, deletionEnd));
    if (!(await vscode.workspace.applyEdit(edit))) {
      return false;
    }
    sourceEditApplied = true;

    const updatedDocument =
      vscode.workspace.textDocuments.find(
        (openDocument) => openDocument.uri.toString() === sourceUri.toString(),
      ) ?? (await vscode.workspace.openTextDocument(sourceUri));
    let saved: boolean;
    try {
      saved = await updatedDocument.save();
    } catch (error) {
      const restored = await restoreSource();
      void vscode.window.showErrorMessage(
        restored
          ? `Deckard could not save the source note after extracting the heading: ${String(error)}`
          : `Deckard could not save the source note after extracting the heading: ${String(error)} The source edit could not be rolled back.`,
      );
      return false;
    }
    if (saved) {
      return true;
    }

    const restored = await restoreSource();
    void vscode.window.showErrorMessage(
      restored
        ? 'Deckard could not save the source note after extracting the heading.'
        : 'Deckard could not save the source note after extracting the heading. The source edit could not be rolled back.',
    );
    return false;
  } catch (error) {
    const restored = await restoreSource();
    void vscode.window.showErrorMessage(
      restored
        ? `Deckard could not remove the extracted heading: ${String(error)}`
        : `Deckard could not remove the extracted heading: ${String(error)} The source edit could not be rolled back.`,
    );
    return false;
  }
}

function normalizeLineEndings(value: string): string {
  return value.replaceAll('\r\n', '\n');
}
