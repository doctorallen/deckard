import * as vscode from 'vscode';

import { stripTags } from '../../domain/markdown/parser';
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
import { getLinkableNoteFileName } from '../../domain/markdown/noteNames';
import { Section } from '../../domain/model';

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
  return getLinkableNoteFileName(name)
    ? undefined
    : 'Use a name a link can open, without / \\ : * ? " < > | # ^ [ or ], and not ending in a dot.';
}

/** The heading to extract, where it is, and the note it becomes. */
export interface ExtractHeadingNoteOptions {
  section: Section;
  sourceUri: vscode.Uri;
  notesFolderUri: vscode.Uri;
  name: string;
  /** Swaps the section for its link; stood in for by tests of the failures. */
  replace?: SectionReplacer<vscode.Uri>;
}

/**
 * Writes a heading's section into a new note named `name` and leaves a
 * link to it in its place, then opens the new note. Returns the new note's
 * URI, or undefined when nothing was extracted: a tagged line, a name that
 * cannot be a file name, a note already at the name (which is said), or a
 * source that could not be changed, in which case the new note is deleted
 * on 'unchanged' and kept on 'half'.
 */
export async function extractHeadingNote({
  section,
  sourceUri,
  notesFolderUri,
  name,
  replace = replaceSectionWithLink,
}: ExtractHeadingNoteOptions): Promise<vscode.Uri | undefined> {
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

/** A heading in the picker, with the note and folder it is in. */
interface HeadingChoice extends vscode.QuickPickItem {
  section: Section;
  sourceUri: vscode.Uri;
  workspaceFolder: vscode.WorkspaceFolder;
}

/**
 * The heading the cursor is in, when the active editor is a note; otherwise
 * one chosen from every note's headings, or undefined when there are none or
 * the picker is dismissed.
 */
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

/** A picker row for a heading: its text, where it is, and its tags. */
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

/**
 * The heading without its tags, or the characters a file name or a link to
 * it cannot hold, as the new note's name.
 */
export function getSuggestedNoteName(heading: string): string {
  const suggestion = stripTags(heading)
    .replace(/[/\\<>:"|?*#^[\]]/g, ' ')
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

/** The source note and the note extracted from it, as a failure names them. */
interface ExtractedNotes {
  sourceUri: vscode.Uri;
  noteUri: vscode.Uri;
}

/**
 * Replaces the extracted section with a link to its new note, keeping the
 * line breaks that separated the section from whatever follows it.
 *
 * The edit is applied with `vscode.workspace.applyEdit` rather than through
 * Deckard's write history, so it is not offered by Undo Last Change; when
 * the note then cannot be saved, the edit is taken back by hand.
 */
async function replaceSectionWithLink(
  sourceUri: vscode.Uri,
  section: Section,
  link: string,
  noteUri: vscode.Uri,
): Promise<ReplaceOutcome> {
  const rollback = new SourceRollback(sourceUri);
  const notes = { sourceUri, noteUri };
  try {
    const document = await vscode.workspace.openTextDocument(sourceUri);
    const plan = planSectionReplacement(document, section, link);
    if (!plan) {
      void reportStale([sourceUri]);
      return 'unchanged';
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(sourceUri, plan.replacedRange, plan.replacement);
    if (!(await vscode.workspace.applyEdit(edit))) {
      void reportFailure(describeRejectedEdit(noteName(sourceUri)));
      return 'unchanged';
    }
    rollback.record(plan.linkRange, plan.replacedText);
    return await saveSource(notes, rollback);
  } catch (error) {
    return failExtraction(notes, await rollback.restore(), 'remove', error);
  }
}

/** Where the section's text is replaced, by what, and where the link then sits. */
interface SectionReplacement {
  replacedRange: vscode.Range;
  replacedText: string;
  replacement: string;
  linkRange: vscode.Range;
}

/**
 * How the section is swapped for its link in `document`, or undefined when
 * the note no longer holds the section the index recorded there.
 */
function planSectionReplacement(
  document: vscode.TextDocument,
  section: Section,
  link: string,
): SectionReplacement | undefined {
  if (
    section.startLine < 1 ||
    section.endLine < section.startLine ||
    section.endLine > document.lineCount
  ) {
    return undefined;
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
    return undefined;
  }

  const replacedRange = new vscode.Range(
    start,
    section.endLine < document.lineCount
      ? new vscode.Position(section.endLine, 0)
      : contentEnd,
  );
  const replacedText = document.getText(replacedRange);
  const replacement =
    link + (replacedText.match(/(?:\r?\n)*$/)?.[0] ?? '');
  return {
    replacedRange,
    replacedText,
    replacement,
    linkRange: new vscode.Range(start, getEndPosition(start, replacement)),
  };
}

/**
 * Saves the source note with its link in place. A note that cannot be saved
 * has the link taken back out, and the failure is said.
 */
async function saveSource(
  notes: ExtractedNotes,
  rollback: SourceRollback,
): Promise<ReplaceOutcome> {
  const { sourceUri } = notes;
  const updatedDocument =
    vscode.workspace.textDocuments.find(
      (openDocument) => openDocument.uri.toString() === sourceUri.toString(),
    ) ?? (await vscode.workspace.openTextDocument(sourceUri));
  let saved: boolean;
  try {
    saved = await updatedDocument.save();
  } catch (error) {
    return failExtraction(notes, await rollback.restore(), 'save', error);
  }
  if (saved) {
    return 'replaced';
  }
  return failExtraction(notes, await rollback.restore(), 'save');
}

/**
 * The link put into the source note, kept so it can be swapped back for the
 * section once, when the note cannot be saved.
 */
class SourceRollback {
  private applied: { range: vscode.Range; text: string } | undefined;

  /** A rollback for edits to the note at `sourceUri`; nothing to undo yet. */
  public constructor(private readonly sourceUri: vscode.Uri) {}

  /** Records the applied edit: the link's range and the text it replaced. */
  public record(range: vscode.Range, text: string): void {
    this.applied = { range, text };
  }

  /**
   * Puts the replaced text back over the link, once. True when the note is
   * as it was: restored, or never changed; false when the rollback failed.
   */
  public async restore(): Promise<boolean> {
    if (!this.applied) {
      return true;
    }
    const { range, text } = this.applied;
    this.applied = undefined;
    try {
      const rollback = new vscode.WorkspaceEdit();
      rollback.replace(this.sourceUri, range, text);
      return await vscode.workspace.applyEdit(rollback);
    } catch {
      return false;
    }
  }
}

/** Says what went wrong, and what became of the source note. */
function failExtraction(
  notes: ExtractedNotes,
  restored: boolean,
  stage: 'save' | 'remove',
  error?: unknown,
): ReplaceOutcome {
  const { sourceUri, noteUri } = notes;
  const outcome = restored ? 'unchanged' : 'half';
  void reportFailure({
    outcome: describeExtractFailure(outcome, stage, noteName(sourceUri), noteName(noteUri)),
    ...(error === undefined ? {} : { error }),
    ...(outcome === 'half' ? { action: openNoteAction(sourceUri) } : {}),
  });
  return outcome;
}

/** Where `text` ends when written from `start`, across the lines it spans. */
function getEndPosition(start: vscode.Position, text: string): vscode.Position {
  const lines = text.split('\n');
  return lines.length === 1
    ? start.translate(0, text.length)
    : new vscode.Position(
        start.line + lines.length - 1,
        lines[lines.length - 1].length,
      );
}

/** The text with CRLF line endings as LF, as the index records a section's content. */
function normalizeLineEndings(value: string): string {
  return value.replaceAll('\r\n', '\n');
}
