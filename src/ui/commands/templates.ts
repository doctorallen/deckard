import * as vscode from 'vscode';

import type { NoteFiles } from '../../core/workspace/indexReader';
import { findTemplatePrompts } from '../../domain/notes/templates';
import { TemplateNoteResult, TemplateService } from '../../services/templateService';
import { chooseTargetFolder } from './dailyNote';
import { openNoteAction, openSettingAction, reportFailure, settingLabel } from './notify';
import { getExtractedNoteFileName } from '../../domain/markdown/noteNames';

/**
 * New Note from Template: the prompts, and what they came to. Filling the
 * template and making the note, never over one already there, is
 * TemplateService's.
 */

/**
 * Asks each question a template holds, once. Undefined when one is dismissed.
 */
export async function askTemplateQuestions(
  template: string,
  title: string,
): Promise<Map<string, string> | undefined> {
  const answers = new Map<string, string>();
  for (const question of findTemplatePrompts(template)) {
    const answer = await vscode.window.showInputBox({ title, prompt: question });
    if (answer === undefined) {
      return undefined;
    }
    answers.set(question, answer);
  }
  return answers;
}

/** The Markdown files in a templates folder, by path. */
export async function listTemplates(
  templatesUri: vscode.Uri,
): Promise<vscode.Uri[]> {
  const uris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(templatesUri, '**/*.md'),
  );
  return uris.sort((left, right) => left.path.localeCompare(right.path));
}

const TITLE = 'Deckard: New Note from Template';

/**
 * Creates a note from a template in the templates folder, asking for its title
 * and anything the template asks, and opens it. An existing note is never
 * overwritten.
 *
 * From the Explorer, `targetFolder` is the folder that was right-clicked: the
 * note is written there rather than in the notes folder, and a folder Deckard
 * does not index is said so once the note is made.
 */
export async function newNoteFromTemplate(
  indexer: NoteFiles<vscode.Uri>,
  templates: TemplateService<vscode.Uri>,
  targetFolder?: vscode.Uri,
): Promise<vscode.Uri | undefined> {
  const folder = await chooseFolder(targetFolder);
  if (!folder) {
    return undefined;
  }
  const chosen = await chooseTemplate(indexer, folder);
  if (!chosen) {
    return undefined;
  }
  const fileName = await askFileName();
  if (!fileName) {
    return undefined;
  }
  const template = Buffer.from(
    await vscode.workspace.fs.readFile(chosen),
  ).toString('utf8');
  const answers = await askTemplateQuestions(template, TITLE);
  if (!answers) {
    return undefined;
  }

  const result = await templates.createNote({
    template,
    fileName,
    answers,
    folder: noteFolderFor(indexer.getNotesFolderUri(folder), targetFolder),
  });
  return reportNote(result, fileName, targetFolder);
}

/**
 * The workspace folder the note goes in: the right-clicked folder's, or the
 * one the reader is in or picks. A folder outside the workspace is said so.
 */
async function chooseFolder(targetFolder?: vscode.Uri): Promise<vscode.WorkspaceFolder | undefined> {
  if (!targetFolder) {
    return chooseTargetFolder();
  }
  const folder = vscode.workspace.getWorkspaceFolder(targetFolder);
  if (!folder) {
    void vscode.window.showInformationMessage(
      'Deckard writes notes inside a workspace folder. Choose a folder in the workspace.',
    );
  }
  return folder;
}

/**
 * The template the reader picks from the templates folder. Says why, and
 * returns undefined, when there is no templates folder or nothing in it.
 */
async function chooseTemplate(
  indexer: NoteFiles<vscode.Uri>,
  folder: vscode.WorkspaceFolder,
): Promise<vscode.Uri | undefined> {
  const templatesUri = indexer.getTemplatesFolderUri(folder);
  if (!templatesUri) {
    const open = openSettingAction('templatesFolder');
    void vscode.window
      .showInformationMessage(
        `Deckard has no templates folder. Choose one in the "${settingLabel('templatesFolder')}" setting to create notes from templates.`,
        open.title,
      )
      .then((choice) => (choice === open.title ? open.run() : undefined));
    return undefined;
  }
  const templates = await listTemplates(templatesUri);
  if (templates.length === 0) {
    void vscode.window.showInformationMessage(
      `Add Markdown files to ${vscode.workspace.asRelativePath(templatesUri)} to use them as templates.`,
    );
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    templates.map((uri) => ({
      label: uri.path
        .slice(templatesUri.path.length + 1)
        .replace(/\.md$/i, ''),
      uri,
    })),
    { title: TITLE, placeHolder: 'Choose a template' },
  );
  return picked?.uri;
}

/** The new note's file name, from the title the reader types; undefined when dismissed. */
async function askFileName(): Promise<string | undefined> {
  const name = await vscode.window.showInputBox({
    title: TITLE,
    prompt: 'The new note’s title, which is also its file name',
    validateInput: (value) =>
      getExtractedNoteFileName(value)
        ? undefined
        : 'Use a title that can be a file name, without / \\ : * ? " < > or |.',
  });
  return name === undefined ? undefined : getExtractedNoteFileName(name);
}

/**
 * Opens the note made, saying when it went where Deckard does not look, or
 * says why none was made. Returns the note, or undefined when none was.
 */
async function reportNote(
  result: TemplateNoteResult<vscode.Uri>,
  fileName: string,
  targetFolder?: vscode.Uri,
): Promise<vscode.Uri | undefined> {
  if (result.kind === 'exists') {
    void reportFailure({
      outcome: `${fileName} already exists, so Deckard did not create it.`,
      fix: 'Choose another title.',
      action: openNoteAction(result.uri),
    });
    return undefined;
  }
  await vscode.window.showTextDocument(result.uri, { preview: false });
  if (targetFolder && !result.indexed) {
    void vscode.window.showInformationMessage(
      `Deckard does not index ${vscode.workspace.asRelativePath(targetFolder, false)}, so it will not list this note.`,
    );
  }
  return result.uri;
}

/** Where a new note is written: the folder chosen, else the notes folder. */
export function noteFolderFor(notesUri: vscode.Uri, targetFolder?: vscode.Uri): vscode.Uri {
  return targetFolder ?? notesUri;
}
