import * as vscode from 'vscode';

import { stripTags } from '../../domain/markdown/parser';
import { Section } from '../../core/types';
import type { IndexReader } from '../../core/workspace/indexReader';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { findHeadingAtLine } from '../../domain/notes/headingLookup';
import {
  LinkNoteService,
  ReplaceOutcome,
  SectionReplacer,
} from '../../services/linkService';
import { vscodeLinkNotes } from './linkMaintenancePorts';
import { resolveSourceUri } from './navigation';
import {
  describeRejectedEdit,
  noteName,
  openNoteAction,
  reportFailure,
  reportStale,
} from './notify';
import { getExtractedNoteFileName } from '../../domain/markdown/noteNames';

export type { ReplaceOutcome } from '../../services/linkService';
export { findHeadingAtLine };
export { getExtractedNoteFileName };

/**
 * Takes the heading the cursor is in, or one chosen from every note's, out
 * into a note of its own, and leaves a link to it in its place.
 */
export async function extractHeadingCommand(
  indexer: IndexReader<vscode.Uri>,
  notes: LinkNoteService<vscode.Uri> = vscodeLinkNotes,
): Promise<vscode.Uri | undefined> {
  await indexer.ready;
  const choice = await chooseHeading(indexer);
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

  return extractAndReport(notes, {
    section: choice.section,
    sourceUri: choice.sourceUri,
    notesFolderUri: indexer.getNotesFolderUri(choice.workspaceFolder),
    name,
  });
}

/** Why a name cannot be the new note's, or undefined when it can. */
export function validateExtractedNoteName(name: string): string | undefined {
  return getExtractedNoteFileName(name)
    ? undefined
    : 'Use a name that can be a file name, without / \\ : * ? " < > or |.';
}

/**
 * Writes a heading's section into a new note named `name` and leaves a
 * link to it in its place, then opens the new note. Returns the new note's
 * URI, or undefined when nothing was extracted: a tagged line, a name that
 * cannot be a file name, a note already at the name (which is said), or a
 * source that could not be changed, in which case the new note is deleted
 * on 'unchanged' and kept on 'half'.
 */
export async function extractHeadingNote(
  section: Section,
  sourceUri: vscode.Uri,
  notesFolderUri: vscode.Uri,
  name: string,
  /** Swaps the section for its link; stood in for by tests of the failures. */
  replace: SectionReplacer<vscode.Uri> = replaceSectionWithLink,
): Promise<vscode.Uri | undefined> {
  return extractAndReport(vscodeLinkNotes, { section, sourceUri, notesFolderUri, name }, replace);
}

/**
 * Extracts through `notes` and reports: a note already at the name is said
 * with a way to open it, and an extracted note is opened. The source's own
 * failures are said by `replace`.
 */
async function extractAndReport(
  notes: LinkNoteService<vscode.Uri>,
  extraction: Parameters<LinkNoteService<vscode.Uri>['extractHeading']>[0],
  replace: SectionReplacer<vscode.Uri> = replaceSectionWithLink,
): Promise<vscode.Uri | undefined> {
  const result = await notes.extractHeading(extraction, replace);
  if (result.kind === 'exists') {
    void reportFailure({
      outcome: `${result.fileName} already exists, so Deckard did not extract the heading.`,
      fix: 'Choose another name.',
      action: openNoteAction(result.noteUri),
    });
    return undefined;
  }
  // The source's editor may hold the link while its file on disk still
  // holds the heading ('half'); the new note is then kept, so the heading is
  // in both until the reader decides.
  if (result.kind !== 'extracted') {
    return undefined;
  }
  const document = await vscode.workspace.openTextDocument(result.noteUri);
  await vscode.window.showTextDocument(document, { preview: false });
  return result.noteUri;
}

interface HeadingChoice extends vscode.QuickPickItem {
  section: Section;
  sourceUri: vscode.Uri;
  workspaceFolder: vscode.WorkspaceFolder;
}

async function chooseHeading(
  indexer: IndexReader,
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
        previous?.fileTimes,
      );
      const section = findHeadingAtLine(
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
    .filter((section) => !section.isInline)
    .sort(
      (left, right) =>
        left.filePath.localeCompare(right.filePath) ||
        left.startLine - right.startLine,
    );

  // Each note is found once, however many headings it has.
  const places = new Map<string, { uri: vscode.Uri; folder: vscode.WorkspaceFolder } | undefined>();
  for (const section of sections) {
    if (!places.has(section.filePath)) {
      const uri = await resolveSourceUri(section.filePath);
      const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
      places.set(section.filePath, uri && folder ? { uri, folder } : undefined);
    }
    const place = places.get(section.filePath);
    if (place) {
      choices.push(createHeadingChoice(section, place.uri, place.folder));
    }
  }

  if (choices.length === 0) {
    void vscode.window.showInformationMessage('There are no headings in your notes yet.');
    return undefined;
  }

  return vscode.window.showQuickPick(choices, {
    placeHolder: 'Choose a heading to extract',
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
    ...(tags.length > 0 ? { detail: `Tags: ${tags.join(' ')}` } : {}),
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

/** What went wrong while taking the heading out of its note. */
export function describeExtractFailure(
  outcome: Exclude<ReplaceOutcome, 'replaced'>,
  stage: 'save' | 'remove',
  source: string,
  created: string,
): string {
  const failed = stage === 'save' ? `could not save ${source}` : `could not remove the heading from ${source}`;
  return outcome === 'unchanged'
    ? `Deckard ${failed}, so the heading was not extracted and nothing was written.`
    : `Deckard wrote ${created} but ${failed}, so the heading is in both notes. ${source} is open with the link in its place: save it to finish, or undo the change in it and delete ${created}.`;
}

/**
 * Replaces the extracted section with a link to its new note, keeping the
 * line breaks that separated the section from whatever follows it.
 */
async function replaceSectionWithLink(
  sourceUri: vscode.Uri,
  section: Section,
  link: string,
  noteUri: vscode.Uri,
): Promise<ReplaceOutcome> {
  let sourceEditApplied = false;
  let linkRange: vscode.Range | undefined;
  let replacedText: string | undefined;

  /** Says what went wrong, and what became of the source note. */
  const fail = (restored: boolean, stage: 'save' | 'remove', error?: unknown): ReplaceOutcome => {
    const outcome = restored ? 'unchanged' : 'half';
    void reportFailure({
      outcome: describeExtractFailure(outcome, stage, noteName(sourceUri), noteName(noteUri)),
      ...(error === undefined ? {} : { error }),
      ...(outcome === 'half' ? { action: openNoteAction(sourceUri) } : {}),
    });
    return outcome;
  };

  const restoreSource = async (): Promise<boolean> => {
    if (!sourceEditApplied || !linkRange || replacedText === undefined) {
      return true;
    }

    sourceEditApplied = false;
    try {
      const rollback = new vscode.WorkspaceEdit();
      rollback.replace(sourceUri, linkRange, replacedText);
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
      void reportStale([sourceUri]);
      return 'unchanged';
    }

    const start = new vscode.Position(section.startLine - 1, 0);
    const contentEnd = new vscode.Position(
      section.endLine - 1,
      document.lineAt(section.endLine - 1).text.length,
    );
    const contentRange = new vscode.Range(start, contentEnd);
    if (
      normalizeLineEndings(document.getText(contentRange)) !==
      section.rawContent
    ) {
      void reportStale([sourceUri]);
      return 'unchanged';
    }

    const replacedRange = new vscode.Range(
      start,
      section.endLine < document.lineCount
        ? new vscode.Position(section.endLine, 0)
        : contentEnd,
    );
    replacedText = document.getText(replacedRange);
    const replacement =
      link + (replacedText.match(/(?:\r?\n)*$/)?.[0] ?? '');
    const edit = new vscode.WorkspaceEdit();
    edit.replace(sourceUri, replacedRange, replacement);
    if (!(await vscode.workspace.applyEdit(edit))) {
      void reportFailure(describeRejectedEdit(noteName(sourceUri)));
      return 'unchanged';
    }
    sourceEditApplied = true;
    linkRange = new vscode.Range(start, getEndPosition(start, replacement));

    const updatedDocument =
      vscode.workspace.textDocuments.find(
        (openDocument) => openDocument.uri.toString() === sourceUri.toString(),
      ) ?? (await vscode.workspace.openTextDocument(sourceUri));
    let saved: boolean;
    try {
      saved = await updatedDocument.save();
    } catch (error) {
      return fail(await restoreSource(), 'save', error);
    }
    if (saved) {
      return 'replaced';
    }
    return fail(await restoreSource(), 'save');
  } catch (error) {
    return fail(await restoreSource(), 'remove', error);
  }
}

function getEndPosition(start: vscode.Position, text: string): vscode.Position {
  const lines = text.split('\n');
  return lines.length === 1
    ? start.translate(0, text.length)
    : new vscode.Position(
        start.line + lines.length - 1,
        lines[lines.length - 1].length,
      );
}

function normalizeLineEndings(value: string): string {
  return value.replaceAll('\r\n', '\n');
}
