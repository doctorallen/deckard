import * as path from 'path';

import * as vscode from 'vscode';

import { settingLabel } from './notify';
import { writeSetting } from './settings';

/**
 * Leaving a folder out of Deckard, or bringing it back, from the Explorer.
 *
 * Both write the one exact key `deckard.exclude` holds for that folder, so
 * what the Explorer did can be read, and undone, in the settings editor.
 */

/** Characters a glob reads as more than themselves. */
const GLOB_CHARACTERS = /[[\]*?{}]/g;

/** Where a folder sits, as the exclude setting names it. */
export interface FolderPlace {
  /** POSIX paths, as `Uri.path` writes them. */
  folder: string;
  workspaceFolder: string;
  notesFolder: string;
  templatesFolder?: string;
}

/**
 * The `deckard.exclude` key for a folder: its path from its workspace folder,
 * with glob characters escaped so `[draft]` means that name. Undefined for the
 * workspace folder itself, which is not a key.
 */
export function relativeExcludeKey(folder: string, workspaceFolder: string): string | undefined {
  const relative = path.posix.relative(workspaceFolder, folder);
  if (relative === '' || relative.startsWith('..')) {
    return undefined;
  }
  return relative.replace(GLOB_CHARACTERS, (character) => `\\${character}`);
}

/** A key written by `relativeExcludeKey`, read back as the path it names. */
export function readExcludeKey(key: string): string {
  return key.replace(/\\([[\]*?{}])/g, '$1');
}

/**
 * The folders a set of exclude settings names by an exact `true` key, as
 * full paths: the folders Include in Deckard can bring back. A pattern such
 * as `**\/drafts` names no one folder, so it is left out.
 */
export function listExcludedFolders(
  folders: readonly { root: string; exclude: unknown }[],
  join: (root: string, relative: string) => string,
): string[] {
  const listed: string[] = [];
  for (const { root, exclude } of folders) {
    if (!exclude || typeof exclude !== 'object' || Array.isArray(exclude)) {
      continue;
    }
    for (const [key, value] of Object.entries(exclude)) {
      const unescaped = readExcludeKey(key.trim().replace(/\/+$/, ''));
      if (value === true && unescaped !== '' && !/[*?[\]{}]/.test(unescaped)) {
        listed.push(join(root, unescaped));
      }
    }
  }
  return listed;
}

function within(child: string, parent: string): boolean {
  const relative = path.posix.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.posix.isAbsolute(relative));
}

/** The name a message gives a folder: its path from the workspace folder. */
export function folderName(place: FolderPlace): string {
  return path.posix.relative(place.workspaceFolder, place.folder) || path.posix.basename(place.folder);
}

/** Why a folder cannot be left out, or undefined when it can. */
export function refuseExclude(place: FolderPlace): string | undefined {
  if (place.folder === place.workspaceFolder || place.folder === place.notesFolder) {
    return `Deckard cannot leave out the whole notes folder. Choose a folder inside it, or change the "${settingLabel('notesFolder')}" setting.`;
  }
  if (place.templatesFolder && within(place.folder, place.templatesFolder)) {
    return 'Deckard already leaves the templates folder out.';
  }
  if (!within(place.folder, place.notesFolder)) {
    return `Deckard does not index ${folderName(place)}, since it is outside the "${settingLabel('notesFolder')}" folder.`;
  }
  return undefined;
}

/** A copy of an exclude setting with one key set, or taken out. */
export function withExcludeKey(
  current: unknown,
  key: string,
  excluded: boolean,
): Record<string, boolean> {
  const next: Record<string, boolean> =
    current && typeof current === 'object' && !Array.isArray(current)
      ? { ...(current as Record<string, boolean>) }
      : {};
  if (excluded) {
    next[key] = true;
  } else {
    delete next[key];
  }
  return next;
}

/** What the commands read about where Deckard looks. */
export interface ExcludeIndex {
  getNotesFolderUri(workspaceFolder: vscode.WorkspaceFolder): vscode.Uri;
  getTemplatesFolderUri(workspaceFolder: vscode.WorkspaceFolder): vscode.Uri | undefined;
}

/**
 * Where the key is written: the folder's own settings in a multi-root
 * workspace, the workspace's otherwise. The current value is read from that
 * same place, so a user-level key is never copied into the workspace.
 */
function settingPlace(workspaceFolder: vscode.WorkspaceFolder): {
  configuration: vscode.WorkspaceConfiguration;
  target: vscode.ConfigurationTarget;
  current: unknown;
} {
  const configuration = vscode.workspace.getConfiguration('deckard', workspaceFolder.uri);
  const multiRoot = vscode.workspace.workspaceFile !== undefined;
  const inspected = configuration.inspect('exclude');
  return multiRoot
    ? {
        configuration,
        target: vscode.ConfigurationTarget.WorkspaceFolder,
        current: inspected?.workspaceFolderValue,
      }
    : { configuration, target: vscode.ConfigurationTarget.Workspace, current: inspected?.workspaceValue };
}

function describePlace(index: ExcludeIndex, uri: vscode.Uri): { place: FolderPlace; workspaceFolder: vscode.WorkspaceFolder } | undefined {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    return undefined;
  }
  return {
    workspaceFolder,
    place: {
      folder: uri.path.replace(/\/+$/, ''),
      workspaceFolder: workspaceFolder.uri.path.replace(/\/+$/, ''),
      notesFolder: index.getNotesFolderUri(workspaceFolder).path.replace(/\/+$/, ''),
      templatesFolder: index.getTemplatesFolderUri(workspaceFolder)?.path.replace(/\/+$/, ''),
    },
  };
}

/** Exclude from Deckard: writes the folder's key, with Undo. */
export async function excludeFolderCommand(index: ExcludeIndex, uri?: vscode.Uri): Promise<boolean> {
  const described = uri ? describePlace(index, uri) : undefined;
  if (!described) {
    void vscode.window.showInformationMessage('Right-click a folder in the Explorer to leave it out of Deckard.');
    return false;
  }
  const { place, workspaceFolder } = described;
  const refusal = refuseExclude(place);
  const key = relativeExcludeKey(place.folder, place.workspaceFolder);
  if (refusal || key === undefined) {
    void vscode.window.showInformationMessage(refusal ?? 'Deckard cannot leave out the whole notes folder.');
    return false;
  }
  const { configuration, target, current } = settingPlace(workspaceFolder);
  if (!(await writeSetting('exclude', withExcludeKey(current, key, true), target, configuration))) {
    return false;
  }
  void vscode.window
    .showInformationMessage(`Deckard leaves out ${folderName(place)} now.`, 'Undo')
    .then(async (choice) => {
      if (choice === 'Undo') {
        await writeSetting('exclude', current, target, configuration);
      }
    });
  return true;
}

/** Include in Deckard: takes the folder's key out again. */
export async function includeFolderCommand(index: ExcludeIndex, uri?: vscode.Uri): Promise<boolean> {
  const described = uri ? describePlace(index, uri) : undefined;
  if (!described) {
    void vscode.window.showInformationMessage('Right-click a folder in the Explorer to bring it back into Deckard.');
    return false;
  }
  const { place, workspaceFolder } = described;
  const key = relativeExcludeKey(place.folder, place.workspaceFolder);
  const { configuration, target, current } = settingPlace(workspaceFolder);
  const keys = current && typeof current === 'object' ? Object.keys(current) : [];
  const written = keys.find((candidate) => key !== undefined && readExcludeKey(candidate.replace(/\/+$/, '')) === readExcludeKey(key));
  if (!written) {
    void vscode.window.showInformationMessage(
      `Deckard does not leave out ${folderName(place)} by name here, so there is nothing to bring back. A pattern in the "${settingLabel('exclude')}" setting, or in the files or search exclude settings, may still match it.`,
    );
    return false;
  }
  if (!(await writeSetting('exclude', withExcludeKey(current, written, false), target, configuration))) {
    return false;
  }
  void vscode.window.showInformationMessage(`Deckard indexes ${folderName(place)} again.`);
  return true;
}

/**
 * Keeps `deckard.excludedFolders` listing the folders `deckard.exclude`
 * names exactly, so the Explorer offers Include in Deckard on those and
 * Exclude from Deckard everywhere else.
 */
export class ExcludedFoldersContext implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];

  public constructor() {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard.exclude') || event.affectsConfiguration('deckard.notesFolder')) {
          this.publish();
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.publish()),
    );
    this.publish();
  }

  public dispose(): void {
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  private publish(): void {
    const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
      root: folder.uri.fsPath,
      exclude: vscode.workspace.getConfiguration('deckard', folder.uri).get<unknown>('exclude', {}),
    }));
    void vscode.commands.executeCommand(
      'setContext',
      'deckard.excludedFolders',
      listExcludedFolders(folders, (root, relative) => path.join(root, ...relative.split('/'))),
    );
  }
}
