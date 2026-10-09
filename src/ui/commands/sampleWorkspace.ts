import * as vscode from 'vscode';

import { fileExists } from './fs';
import { reportFailure } from './notify';
import { resolveSampleTokens, sampleFileName } from '../../domain/notes/sampleNotes';
import { TYPES_FOLDER } from '../../domain/types/typeNotes';

/**
 * Somewhere to start.
 *
 * The walkthrough says what a tag and a hub note are; it cannot show one
 * being found. The Work Sample is a week of a team lead's notes, with a
 * README that says what to try. It is written into Deckard's own storage,
 * dated from the day it is made so its tasks are overdue, due today, and
 * due later as the notes say, and opened, with the README shown once the
 * window has reloaded. It is the one sample: the Story Tour, a note for
 * every part of Deckard, competed with it for a first look, and went.
 */

/** The work sample's folder, inside Deckard's global storage. */
export const WORK_SAMPLE_FOLDER_NAME = 'deckard-work-sample';

/** The sample's shipped folder, inside resources/. */
const SAMPLE_SOURCE = 'sample-work';
/** What the sample is called where Deckard asks about it. */
const SAMPLE_NAME = 'work sample';

/** The sample's folder, which the first index does not summarize: its README takes that moment. */
export const SAMPLE_FOLDER_NAMES: readonly string[] = [WORK_SAMPLE_FOLDER_NAME];
/** The sample to show the README of, once it opens after the reload. */
export const SAMPLE_README_KEY = 'deckard.openSampleReadme';

/** The sample's folder is already there, and was not to be replaced. */
export class SampleFolderExistsError extends Error {
  /** Names the folder that is there, so the message says where. */
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
  return vscode.Uri.joinPath(extensionUri, 'resources', SAMPLE_SOURCE);
}

/** The templates folder, which Deckard does not index, so its files are not notes. */
const SAMPLE_TEMPLATES_FOLDER = 'templates';

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
 * Writes the sample into `storageUri/deckard-work-sample`, dated from `today`.
 * Refuses, rather than merging, when it is already there, unless told to
 * replace it. Returns where it went and how many notes it holds: every
 * Markdown file but the README, the templates, and the type notes.
 */
export async function installSample({
  extensionUri,
  storageUri,
  today,
  fs = vscode.workspace.fs,
  replace,
}: InstallSampleOptions): Promise<{ target: vscode.Uri; notes: number }> {
  const target = vscode.Uri.joinPath(storageUri, WORK_SAMPLE_FOLDER_NAME);
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
    !relativePath.startsWith(`${SAMPLE_TEMPLATES_FOLDER}/`) &&
    !relativePath.startsWith(`${TYPES_FOLDER}/`)
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

/**
 * Deckard: Create a Work Sample. Writes the sample into Deckard's storage,
 * asking first when one is there already, then opens it, asking where when
 * this window has a folder open. Cancelling any question stops there; a
 * sample that cannot be written is reported, and nothing opens.
 */
export async function createWorkSample(context: vscode.ExtensionContext): Promise<void> {
  const storage = getSampleStorageUri(context.globalStorageUri);
  const target = vscode.Uri.joinPath(storage, WORK_SAMPLE_FOLDER_NAME);
  const replace = await askToReplace(target);
  if (replace === undefined) {
    return;
  }
  const installed = await installIfNeeded({ context, storage, target, replace });
  if (!installed) {
    return;
  }
  const forceNewWindow = await askWhereToOpen(installed.notes, SAMPLE_NAME);
  if (forceNewWindow === undefined) {
    return;
  }
  await context.globalState.update(SAMPLE_README_KEY, target.toString());
  await vscode.commands.executeCommand('vscode.openFolder', target, { forceNewWindow });
}

/**
 * Whether to write a fresh copy over the sample: false when there is none
 * yet or the reader would open it as it is, undefined when they cancel.
 */
async function askToReplace(target: vscode.Uri): Promise<boolean | undefined> {
  if (!(await fileExists(target))) {
    return false;
  }
  const choice = await vscode.window.showWarningMessage(
    'Replace the sample with a fresh copy? Anything changed in it is lost.',
    { modal: true, detail: 'A sample that is open in a window shows its notes as deleted until it reloads.' },
    'Replace',
    'Open As It Is',
  );
  if (choice === undefined) {
    return undefined;
  }
  return choice === 'Replace';
}

/** Where the sample goes, and whether to write over the copy there. */
interface InstallRequest {
  context: vscode.ExtensionContext;
  storage: vscode.Uri;
  target: vscode.Uri;
  replace: boolean;
}

/**
 * Writes the sample when it is to be replaced or is not there, and says how
 * many notes it wrote; `notes` is undefined when the copy there is kept.
 * Undefined when writing failed, which it reports.
 */
async function installIfNeeded({
  context,
  storage,
  target,
  replace,
}: InstallRequest): Promise<{ notes: number | undefined } | undefined> {
  // Looked at again rather than reusing askToReplace's answer: when the
  // folder was not there, nothing was asked, and it is checked as it is now.
  if (!replace && (await fileExists(target))) {
    return { notes: undefined };
  }
  try {
    const { notes } = await installSample({
      extensionUri: context.extensionUri,
      storageUri: storage,
      today: new Date(),
      fs: vscode.workspace.fs,
      replace,
    });
    return { notes };
  } catch (error) {
    void reportFailure({
      outcome: `Deckard could not create the sample notes in ${target.fsPath}.`,
      fix: 'Try again; a sample left half written is replaced.',
      error,
    });
    return undefined;
  }
}

/**
 * Whether to open the sample in a new window. An empty window opens it at
 * once, here; a window with work in it asks where, and undefined means the
 * reader dismissed the question.
 */
async function askWhereToOpen(notes: number | undefined, name: string): Promise<boolean | undefined> {
  if ((vscode.workspace.workspaceFolders ?? []).length === 0) {
    return false;
  }
  const choice = await vscode.window.showInformationMessage(
    notes === undefined
      ? `Open the ${name} in a new window, or in this one?`
      : `Created the ${name}, ${notes} notes. Open it in a new window, or in this one?`,
    'Open in New Window',
    'Open Here',
  );
  if (!choice) {
    return undefined;
  }
  return choice === 'Open in New Window';
}
