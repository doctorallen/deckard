import * as vscode from 'vscode';

import { readFolderSetting } from '../../shared/paths';

/**
 * Where Deckard may read and write in a workspace.
 *
 * With no notes folder set, Deckard reads every Markdown file in the
 * workspace and writes today's note at its top level. That suits a folder
 * of notes, and surprises a code repository: a personal daily note nearly
 * went into a work repo's next commit. So before the first note Deckard
 * makes in a repository with no notes folder, it asks once where to write,
 * and a workspace can be paused, which leaves it unread and unwritten.
 * Both answers live in VS Code's storage for the workspace, never in a file
 * of the repository.
 */

/** The workspace-state key that pauses Deckard in a workspace. */
export const PAUSED_HERE = 'deckard.pausedHere';
/** The workspace-state key listing the folders a reader said to write at the top of. */
export const WRITE_HERE_CONFIRMED = 'deckard.writeHereConfirmed';
/** The workspace-state key that hides the whole-workspace scope item once a reader keeps it. */
export const WHOLE_WORKSPACE_KEPT = 'deckard.wholeWorkspaceKept';

/** Files at a folder's top that say it is a code repository, not a folder of notes. */
const CODE_MARKERS = ['.git', 'package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'Gemfile', 'composer.json'];

export const WRITE_HERE = 'Write Here';
export const CHOOSE_FOLDER = 'Choose a Folder…';
export const PAUSE_HERE = 'Pause Deckard Here';
export const RESUME = 'Resume';

let state: vscode.Memento | undefined;
const changeEmitter = new vscode.EventEmitter<boolean>();
/** Fires with whether Deckard is now paused here. */
export const onDidChangePaused = changeEmitter.event;

/** Hands the module the workspace's storage; the composition root does this first. */
export function initWriteTarget(workspaceState: vscode.Memento): void {
  state = workspaceState;
  void vscode.commands.executeCommand('setContext', 'deckard.paused', isPausedHere());
}

/** Whether Deckard is paused in this workspace: it then reads no notes and writes none. */
export function isPausedHere(): boolean {
  return state?.get<boolean>(PAUSED_HERE) === true;
}

/** Pauses or resumes Deckard in this workspace. */
export async function setPausedHere(paused: boolean): Promise<void> {
  await state?.update(PAUSED_HERE, paused ? true : undefined);
  await vscode.commands.executeCommand('setContext', 'deckard.paused', paused);
  changeEmitter.fire(paused);
}

/** The notes folder a workspace folder's settings name; empty for the whole folder. */
export function readNotesFolder(folder: vscode.WorkspaceFolder): string {
  return readFolderSetting(vscode.workspace.getConfiguration('deckard', folder.uri).get<unknown>('notesFolder', ''), '');
}

/** Whether a folder holds a repository marker such as `.git` or `package.json` at its top. */
export async function looksLikeCodeRepository(folder: vscode.WorkspaceFolder): Promise<boolean> {
  for (const marker of CODE_MARKERS) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, marker));
      return true;
    } catch {
      // Not there; try the next.
    }
  }
  return false;
}

/** What the write question decides with, so it can be tested without VS Code's windows. */
export interface WriteQuestion {
  paused: boolean;
  notesFolder: string;
  confirmed: boolean;
  codeRepository: boolean;
}

/** Whether a note may be written without asking: anywhere but the top of a repository nobody said to write in. */
export function writeNeedsAsking(question: WriteQuestion): boolean {
  return !question.paused && !question.notesFolder && !question.confirmed && question.codeRepository;
}

/**
 * Whether Deckard may make a note in a workspace folder: not while paused,
 * and, at the top of a code repository with no notes folder, only once the
 * reader says where. Choosing a folder sets `deckard.notesFolder` for that
 * folder. Dismissing the question writes nothing.
 */
export async function confirmNotesWrite(folder: vscode.WorkspaceFolder): Promise<boolean> {
  if (isPausedHere()) {
    const choice = await vscode.window.showInformationMessage(
      `Deckard is paused in this workspace, so it wrote nothing in ${folder.name}.`,
      RESUME,
    );
    if (choice === RESUME) {
      await setPausedHere(false);
    }
    return false;
  }
  const confirmed = (state?.get<string[]>(WRITE_HERE_CONFIRMED) ?? []).includes(folder.uri.toString());
  const question: WriteQuestion = {
    paused: false,
    notesFolder: readNotesFolder(folder),
    confirmed,
    codeRepository: !confirmed && (await looksLikeCodeRepository(folder)),
  };
  if (!writeNeedsAsking(question)) {
    return true;
  }
  const choice = await vscode.window.showWarningMessage(
    `${folder.name} looks like a code repository with no notes folder set, so Deckard would write notes at its top level, where a commit could pick them up. Write here, choose a notes folder, or pause Deckard in this workspace.`,
    WRITE_HERE,
    CHOOSE_FOLDER,
    PAUSE_HERE,
  );
  if (choice === WRITE_HERE) {
    await state?.update(WRITE_HERE_CONFIRMED, [...(state.get<string[]>(WRITE_HERE_CONFIRMED) ?? []), folder.uri.toString()]);
    return true;
  }
  if (choice === CHOOSE_FOLDER) {
    return chooseNotesFolder(folder);
  }
  if (choice === PAUSE_HERE) {
    await setPausedHere(true);
  }
  return false;
}

/**
 * Asks for a folder inside a workspace folder and makes it the notes
 * folder there. Returns whether one was set.
 */
export async function chooseNotesFolder(folder: vscode.WorkspaceFolder): Promise<boolean> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri: folder.uri,
    openLabel: 'Use as Notes Folder',
    title: `Choose the folder in ${folder.name} that holds your notes`,
  });
  const chosen = picked?.[0];
  if (!chosen) {
    return false;
  }
  const relative = vscode.workspace.asRelativePath(chosen, false);
  if (vscode.workspace.getWorkspaceFolder(chosen)?.uri.toString() !== folder.uri.toString() || relative === chosen.fsPath) {
    void vscode.window.showWarningMessage(`Choose a folder inside ${folder.name}; nothing was changed.`);
    return false;
  }
  const notesFolder = chosen.toString() === folder.uri.toString() ? '' : relative.replace(/\\/g, '/');
  await vscode.workspace
    .getConfiguration('deckard', folder.uri)
    .update('notesFolder', notesFolder, vscode.ConfigurationTarget.WorkspaceFolder);
  if (!notesFolder) {
    await state?.update(WRITE_HERE_CONFIRMED, [...(state.get<string[]>(WRITE_HERE_CONFIRMED) ?? []), folder.uri.toString()]);
  }
  return true;
}

const scopeEmitter = new vscode.EventEmitter<void>();
/** Fires when the reader keeps reading a whole repository, so the status bar can stop saying so. */
export const onDidChangeScope = scopeEmitter.event;

/**
 * Deckard: Pause in This Workspace. Says what pausing does, and how to
 * resume, since every page and view goes empty.
 */
export async function pauseHere(): Promise<void> {
  await setPausedHere(true);
  void vscode.window.showInformationMessage(
    'Deckard is paused in this workspace: it reads and writes nothing here. Select "Deckard paused" in the status bar, or run Deckard: Resume in This Workspace, to start again.',
  );
}

/** Deckard: Resume in This Workspace. */
export async function resumeHere(): Promise<void> {
  await setPausedHere(false);
}

/**
 * The status bar item's choices for a repository read whole: a notes
 * folder, folders left out, a pause, or keeping it as it is.
 */
export async function chooseScope(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const folder = folders.find((candidate) => !readNotesFolder(candidate)) ?? folders[0];
  if (!folder) {
    return;
  }
  const choices = [
    {
      label: 'Choose a Notes Folder…',
      detail: 'Read and write only the notes in one folder.',
      run: () => chooseNotesFolder(folder),
    },
    {
      label: 'Leave Folders Out…',
      detail: 'Keep reading the workspace, without folders such as docs or vendor.',
      run: () => vscode.commands.executeCommand('workbench.action.openSettings', 'deckard.exclude'),
    },
    {
      label: 'Pause Deckard in This Workspace',
      detail: 'Read and write nothing here until you resume.',
      run: () => pauseHere(),
    },
    {
      label: 'Keep Reading the Whole Workspace',
      detail: 'Stop showing this in the status bar for this workspace.',
      run: async () => {
        await state?.update(WHOLE_WORKSPACE_KEPT, true);
        scopeEmitter.fire();
      },
    },
  ];
  const picked = await vscode.window.showQuickPick(choices, { title: `What Deckard reads in ${folder.name}` });
  await picked?.run();
}
