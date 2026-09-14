import * as vscode from 'vscode';

import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { chooseTargetFolder, formatLocalDate } from './dailyNote';
import { getExtractedNoteFileName } from './extractHeading';

/** A placeholder: `{ask:Question}`, or a variable such as `{date}`. */
const PLACEHOLDER = /\{(?:ask:([^{}]*)|([a-z]+))\}/g;

/**
 * The questions a template asks with `{ask:Question}`, each once, in the order
 * they first appear.
 */
export function findTemplatePrompts(template: string): string[] {
  const questions = [...template.matchAll(PLACEHOLDER)]
    .map((match) => match[1]?.trim())
    .filter((question): question is string => Boolean(question));
  return [...new Set(questions)];
}

/**
 * Fills a template's placeholders in one pass, so a value that itself holds
 * braces is written as it is. A placeholder without a value is left as written.
 */
export function fillTemplate(
  template: string,
  variables: Readonly<Record<string, string>>,
  answers: ReadonlyMap<string, string> = new Map(),
): string {
  return template.replace(
    PLACEHOLDER,
    (placeholder, question: string | undefined, name: string | undefined) => {
      if (question !== undefined) {
        return answers.get(question.trim()) ?? placeholder;
      }
      return name !== undefined && Object.hasOwn(variables, name)
        ? variables[name]
        : placeholder;
    },
  );
}

/** The variables every template can use: `{title}`, `{date}`, and `{time}`. */
export function getTemplateVariables(
  title: string,
  now: Date,
): Record<string, string> {
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return { title, date: formatLocalDate(now), time: `${hours}:${minutes}` };
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

/**
 * Creates a note from a template in the templates folder, asking for its title
 * and anything the template asks, and opens it. An existing note is never
 * overwritten.
 */
export async function newNoteFromTemplate(
  indexer: WorkspaceIndexer,
): Promise<vscode.Uri | undefined> {
  const title = 'Deckard: New Note from Template';
  const folder = await chooseTargetFolder();
  if (!folder) {
    return undefined;
  }
  const templatesUri = indexer.getTemplatesFolderUri(folder);
  if (!templatesUri) {
    void vscode.window.showInformationMessage(
      'Set deckard.templatesFolder to a folder of note templates to use them.',
    );
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
    { title, placeHolder: 'Choose a template' },
  );
  if (!picked) {
    return undefined;
  }
  const name = await vscode.window.showInputBox({
    title,
    prompt: 'The new note’s title, which is also its file name',
    validateInput: (value) =>
      getExtractedNoteFileName(value)
        ? undefined
        : 'Use a title that can be a file name, without / \\ : * ? " < > or |.',
  });
  const fileName = name === undefined ? undefined : getExtractedNoteFileName(name);
  if (!fileName) {
    return undefined;
  }

  const template = Buffer.from(
    await vscode.workspace.fs.readFile(picked.uri),
  ).toString('utf8');
  const answers = new Map<string, string>();
  for (const question of findTemplatePrompts(template)) {
    const answer = await vscode.window.showInputBox({ title, prompt: question });
    if (answer === undefined) {
      return undefined;
    }
    answers.set(question, answer);
  }

  const notesUri = indexer.getNotesFolderUri(folder);
  const noteUri = vscode.Uri.joinPath(notesUri, fileName);
  if (await exists(noteUri)) {
    const choice = await vscode.window.showWarningMessage(
      `${fileName} already exists.`,
      'Open',
    );
    if (choice === 'Open') {
      await vscode.window.showTextDocument(noteUri, { preview: false });
    }
    return undefined;
  }
  const content = fillTemplate(
    template,
    getTemplateVariables(fileName.replace(/\.md$/i, ''), new Date()),
    answers,
  );
  await vscode.workspace.fs.createDirectory(notesUri);
  await vscode.workspace.fs.writeFile(noteUri, Buffer.from(content, 'utf8'));
  await vscode.window.showTextDocument(noteUri, { preview: false });
  return noteUri;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
