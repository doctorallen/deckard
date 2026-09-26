import * as vscode from 'vscode';

import { formatLocalDate } from './dailyNote';
import { reportFailure } from './notify';

/**
 * Somewhere to start.
 *
 * The walkthrough says what a tag and a hub note are; it cannot show one
 * being found. Nine small notes, written the way Deckard reads them, can.
 * They are written into Deckard's own storage, dated from the day they are
 * made so one task is overdue, two are due today, and one is due this week,
 * and opened, with the README shown once the window has reloaded.
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

/** Where the shipped sample lives, inside the installed extension. */
export function getSampleSourceUri(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, 'resources', 'sample');
}

/** A day `offset` days from `today`, as the sample writes dates. */
function sampleDate(today: Date, offset: number): string {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  return formatLocalDate(day);
}

/** `{{date}}`, `{{date-9}}`, and `{{date+3}}` as the days they name. */
export function resolveSampleTokens(text: string, today: Date): string {
  return text.replace(/\{\{date(?:([+-])(\d+))?\}\}/g, (_whole, sign?: string, days?: string) =>
    sampleDate(today, sign ? (sign === '-' ? -1 : 1) * Number(days) : 0),
  );
}

/** A shipped name as installed: `day-9.md` is that day's daily note, `dot-vscode` is `.vscode`. */
export function sampleFileName(name: string, today: Date): string {
  const day = /^day-(\d+)\.md$/.exec(name);
  if (day) {
    return `${sampleDate(today, -Number(day[1]))}.md`;
  }
  return name === 'dot-vscode' ? '.vscode' : name;
}

/**
 * Writes the sample into `storageUri/deckard-sample`, dated from `today`.
 * Refuses, rather than merging, when it is already there, unless told to
 * replace it. Returns where it went and how many notes it holds.
 */
export async function installSample(
  extensionUri: vscode.Uri,
  storageUri: vscode.Uri,
  today: Date,
  fs: SampleFileAccess = vscode.workspace.fs,
  options: { replace?: boolean } = {},
): Promise<{ target: vscode.Uri; notes: number }> {
  const target = vscode.Uri.joinPath(storageUri, SAMPLE_FOLDER_NAME);
  if (await exists(fs, target)) {
    if (!options.replace) {
      throw new SampleFolderExistsError(target);
    }
    await fs.delete(target, { recursive: true, useTrash: false });
  }
  let notes = 0;
  const copy = async (from: vscode.Uri, to: vscode.Uri, top: boolean): Promise<void> => {
    await fs.createDirectory(to);
    for (const [name, type] of await fs.readDirectory(from)) {
      const source = vscode.Uri.joinPath(from, name);
      const written = vscode.Uri.joinPath(to, sampleFileName(name, today));
      if (type === vscode.FileType.Directory) {
        await copy(source, written, false);
      } else if (type === vscode.FileType.File) {
        const text = Buffer.from(await fs.readFile(source)).toString('utf8');
        await fs.writeFile(written, Buffer.from(resolveSampleTokens(text, today), 'utf8'));
        if (top && name.endsWith('.md') && name !== 'README.md') {
          notes += 1;
        }
      }
    }
  };
  await copy(getSampleSourceUri(extensionUri), target, true);
  return { target, notes };
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
  const target = vscode.Uri.joinPath(context.globalStorageUri, SAMPLE_FOLDER_NAME);
  let replace = false;
  if (await exists(vscode.workspace.fs, target)) {
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
  if (replace || !(await exists(vscode.workspace.fs, target))) {
    try {
      notes = (
        await installSample(context.extensionUri, context.globalStorageUri, new Date(), vscode.workspace.fs, {
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

async function exists(fs: Pick<SampleFileAccess, 'stat'>, uri: vscode.Uri): Promise<boolean> {
  try {
    await fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
