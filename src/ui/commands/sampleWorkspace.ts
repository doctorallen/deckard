import * as vscode from 'vscode';

import { formatLocalDate } from './dailyNote';
import { fileExists } from './fs';
import { reportFailure } from './notify';

/**
 * Somewhere to start.
 *
 * The walkthrough says what a tag and a hub note are; it cannot show one
 * being found. The sample is a tour you read and do: a README that says the
 * order, then a note per topic that explains what it holds, holds it, and
 * says what to try. It is written into Deckard's own storage, dated from the
 * day it is made so its tasks are overdue, due today, and due later as the
 * notes say, and opened, with the README shown once the window has reloaded.
 */

export const SAMPLE_FOLDER_NAME = 'deckard-sample';
/** The sample to show the README of, once it opens after the reload. */
export const SAMPLE_README_KEY = 'deckard.openSampleReadme';

/** The sample's folder is already there, and was not to be replaced. */
export class SampleFolderExistsError extends Error {
  constructor(target: vscode.Uri) {
    super(`There is already a sample in ${target.fsPath}.`);
    this.name = 'SampleFolderExistsError';
  }
}

interface SampleFileAccess {
  stat(uri: vscode.Uri): Thenable<vscode.FileStat>;
  readDirectory(uri: vscode.Uri): Thenable<[string, vscode.FileType][]>;
  readFile(uri: vscode.Uri): Thenable<Uint8Array>;
  writeFile(uri: vscode.Uri, content: Uint8Array): Thenable<void>;
  createDirectory(uri: vscode.Uri): Thenable<void>;
  delete(uri: vscode.Uri, options?: { recursive?: boolean; useTrash?: boolean }): Thenable<void>;
}

/**
 * Where the sample is written and opened: Deckard's global storage, as a
 * `file:` folder. Desktop VS Code hands that storage out as
 * `vscode-userdata:`, and a folder opened under that scheme has no file
 * search, so the first scan's `findFiles` never returned and the window
 * said it was indexing forever.
 */
export function getSampleStorageUri(globalStorageUri: vscode.Uri): vscode.Uri {
  return globalStorageUri.scheme === 'vscode-userdata'
    ? vscode.Uri.file(globalStorageUri.fsPath)
    : globalStorageUri;
}

/** Where the shipped sample lives, inside the installed extension. */
export function getSampleSourceUri(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, 'resources', 'sample');
}

/** A day `offset` days from `today`, as the sample writes dates. */
function sampleDate(today: Date, offset: number): string {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  return formatLocalDate(day);
}

/**
 * `{{date}}`, `{{date-9}}`, and `{{date+3}}` as the days they name, and
 * `{{month+1}}` or `{{month-1}}` as the 15th of that month, for a task due
 * next month or a note written last month whatever day it is made.
 */
export function resolveSampleTokens(text: string, today: Date): string {
  return text
    .replace(/\{\{date(?:([+-])(\d+))?\}\}/g, (_whole, sign?: string, days?: string) =>
      sampleDate(today, sign ? (sign === '-' ? -1 : 1) * Number(days) : 0),
    )
    .replace(/\{\{month([+-])(\d+)\}\}/g, (_whole, sign: string, months: string) =>
      formatLocalDate(
        new Date(today.getFullYear(), today.getMonth() + (sign === '-' ? -1 : 1) * Number(months), 15),
      ),
    );
}

/** The templates folder, which Deckard does not index, so its files are not notes. */
const SAMPLE_TEMPLATES_FOLDER = 'templates';

/** A shipped name as installed: `day-9.md` is that day's daily note, `dot-vscode` is `.vscode`. */
export function sampleFileName(name: string, today: Date): string {
  const day = /^day-(\d+)\.md$/.exec(name);
  if (day) {
    return `${sampleDate(today, -Number(day[1]))}.md`;
  }
  return name === 'dot-vscode' ? '.vscode' : name;
}

/** Where the sample comes from and goes, the day it is dated from, and whether it may replace one. */
export interface InstallSampleOptions {
  extensionUri: vscode.Uri;
  storageUri: vscode.Uri;
  today: Date;
  /** The file system it is copied through; VS Code's by default. */
  fs?: SampleFileAccess;
  /** Replace a sample already there rather than refuse. */
  replace?: boolean;
}

/**
 * Writes the sample into `storageUri/deckard-sample`, dated from `today`.
 * Refuses, rather than merging, when it is already there, unless told to
 * replace it. Returns where it went and how many notes it holds: every
 * Markdown file but the README and the templates.
 */
export async function installSample({
  extensionUri,
  storageUri,
  today,
  fs = vscode.workspace.fs,
  replace,
}: InstallSampleOptions): Promise<{ target: vscode.Uri; notes: number }> {
  const target = vscode.Uri.joinPath(storageUri, SAMPLE_FOLDER_NAME);
  if (await fileExists(target, fs)) {
    if (!replace) {
      throw new SampleFolderExistsError(target);
    }
    await fs.delete(target, { recursive: true, useTrash: false });
  }
  let notes = 0;
  const copy = async (from: vscode.Uri, to: vscode.Uri, folder: string): Promise<void> => {
    await fs.createDirectory(to);
    for (const [name, type] of await fs.readDirectory(from)) {
      const source = vscode.Uri.joinPath(from, name);
      const written = vscode.Uri.joinPath(to, sampleFileName(name, today));
      if (type === vscode.FileType.Directory) {
        await copy(source, written, folder ? `${folder}/${name}` : name);
      } else if (type === vscode.FileType.File) {
        const text = Buffer.from(await fs.readFile(source)).toString('utf8');
        await fs.writeFile(written, Buffer.from(resolveSampleTokens(text, today), 'utf8'));
        if (isSampleNote(folder ? `${folder}/${name}` : name)) {
          notes += 1;
        }
      }
    }
  };
  await copy(getSampleSourceUri(extensionUri), target, '');
  return { target, notes };
}

/** Whether a shipped file, by its path in the sample, is one of its notes. */
export function isSampleNote(relativePath: string): boolean {
  return (
    relativePath.endsWith('.md') &&
    relativePath !== 'README.md' &&
    !relativePath.startsWith(`${SAMPLE_TEMPLATES_FOLDER}/`)
  );
}

/**
 * The sample's README to show, when the folder that just opened is the
 * sample Deckard was asked to open; undefined otherwise.
 */
export function takeSampleReadme(
  stored: string | undefined,
  folders: readonly { uri: vscode.Uri }[],
): vscode.Uri | undefined {
  const folder = stored ? folders.find((candidate) => candidate.uri.toString() === stored) : undefined;
  return folder ? vscode.Uri.joinPath(folder.uri, 'README.md') : undefined;
}

/** On activation: shows the sample's README once, after the reload that opened it. */
export async function showSampleReadmeOnce(context: vscode.ExtensionContext): Promise<void> {
  const readme = takeSampleReadme(
    context.globalState.get<string>(SAMPLE_README_KEY),
    vscode.workspace.workspaceFolders ?? [],
  );
  if (!readme) {
    return;
  }
  // Cleared first, so a README that fails to open is not tried forever.
  await context.globalState.update(SAMPLE_README_KEY, undefined);
  await vscode.commands.executeCommand('markdown.showPreview', readme);
}

export async function createSampleWorkspace(context: vscode.ExtensionContext): Promise<void> {
  const storage = getSampleStorageUri(context.globalStorageUri);
  const target = vscode.Uri.joinPath(storage, SAMPLE_FOLDER_NAME);
  let replace = false;
  if (await fileExists(target)) {
    const choice = await vscode.window.showWarningMessage(
      'Replace the sample with a fresh copy? Anything changed in it is lost.',
      { modal: true, detail: 'A sample that is open in a window shows its notes as deleted until it reloads.' },
      'Replace',
      'Open As It Is',
    );
    if (choice === undefined) {
      return;
    }
    replace = choice === 'Replace';
  }
  let notes: number | undefined;
  if (replace || !(await fileExists(target))) {
    try {
      notes = (
        await installSample({
          extensionUri: context.extensionUri,
          storageUri: storage,
          today: new Date(),
          fs: vscode.workspace.fs,
          replace,
        })
      ).notes;
    } catch (error) {
      void reportFailure({
        outcome: `Deckard could not create the sample notes in ${target.fsPath}.`,
        fix: 'Try again; a sample left half written is replaced.',
        error,
      });
      return;
    }
  }
  // An empty window opens it at once; a window with work in it asks where.
  let forceNewWindow = false;
  if ((vscode.workspace.workspaceFolders ?? []).length > 0) {
    const choice = await vscode.window.showInformationMessage(
      notes === undefined
        ? 'Open the sample workspace in a new window, or in this one?'
        : `Created a sample workspace of ${notes} notes. Open it in a new window, or in this one?`,
      'Open in New Window',
      'Open Here',
    );
    if (!choice) {
      return;
    }
    forceNewWindow = choice === 'Open in New Window';
  }
  await context.globalState.update(SAMPLE_README_KEY, target.toString());
  await vscode.commands.executeCommand('vscode.openFolder', target, { forceNewWindow });
}
