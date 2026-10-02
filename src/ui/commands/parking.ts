import * as path from 'path';

import * as vscode from 'vscode';

import { countTagMatches } from '../../domain/query/queryEvaluator';
import { pluralize } from '../../shared/text';
import { noteTitle } from '../../domain/index/backlinks';
import { listExcludedFolders } from '../../domain/index/excludeKeys';
import { ParkedRules } from '../../domain/index/parked';
import {
  ParkFolderResult,
  ParkingEdit,
  ParkingService,
  ParkingSettings,
  ParkingWriteLabel,
  ParkingWriteOutcome,
  ParkNotesResult,
  ParkTagResult,
  SettingPlace,
  UnparkFolderResult,
  UnparkNotesResult,
  UnparkTagResult,
} from '../../services/parkingService';
import { openSettingAction, reportFailure, settingLabel } from './notify';
import { writeSetting } from './settings';
import { WorkspaceWriteHistory, WriteHandle } from './workspaceWrites';
import { WorkspaceIndex } from '../../domain/model';

/**
 * Park Note, Park Folder, and Park Tag, and their Unpark counterparts.
 *
 * Which notes, folders, and tags can be parked, and why the others cannot,
 * is ParkingService's decision; these commands gather what was chosen, ask
 * where the service needs an answer, and say what came of it.
 */

/** What the parking commands and context keys read of the index. */
export interface ParkingIndex {
  readonly ready: Promise<void>;
  getSnapshot(): WorkspaceIndex;
  getFilePath(uri: vscode.Uri): string;
  getUri(filePath: string): vscode.Uri | undefined;
  isNotesFile(uri: vscode.Uri): boolean;
  getParkedRules(): ParkedRules;
  onDidUpdate: vscode.Event<unknown>;
  /** Reads the notes again, after an Undo puts some back. */
  refresh(): Promise<void>;
}

/** The parking service as the commands use it, over VS Code's URIs and writes. */
export type VscodeParkingService = ParkingService<vscode.Uri, WriteHandle>;

/** What the parking commands work through: the index they read, and the service that decides. */
export interface ParkingCommands {
  indexer: ParkingIndex;
  parking: VscodeParkingService;
}

/**
 * The parking service over VS Code: its settings, its workspace folders,
 * and writes through the history, so Undo Last Change takes a park back.
 */
export function createParkingService(indexer: ParkingIndex, history: WorkspaceWriteHistory): VscodeParkingService {
  return new ParkingService<vscode.Uri, WriteHandle>({
    index: indexer,
    workspace: vscode.workspace,
    configuration: vscode.workspace,
    settings: vscodeParkingSettings,
    edits: () => new NoteDocumentEdit(history),
  });
}

const STAYS = 'It stays searchable with is:parked.';
const STAY = 'They stay searchable with is:parked.';

/**
 * What a command was given: the Explorer's selection, or one URI. Anything
 * else, such as a tree item another view passes, is not taken for a file,
 * so undefined, and the command chooses as if it were given nothing.
 */
function givenUris(uri?: unknown, uris?: unknown): vscode.Uri[] | undefined {
  if (Array.isArray(uris) && uris.length > 0 && uris.every((item) => item instanceof vscode.Uri)) {
    return uris as vscode.Uri[];
  }
  if (uri instanceof vscode.Uri) {
    return [uri];
  }
  return undefined;
}

/** The notes a command was given: the Explorer's selection, a URI, or the note in front. */
function chosenNotes(uri?: unknown, uris?: unknown): vscode.Uri[] {
  const given = givenUris(uri, uris);
  if (given) {
    return given;
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  return active ? [active] : [];
}

const quoted = (filePath: string): string => `"${noteTitle(filePath)}"`;

/**
 * One write to the notes, through VS Code: each note's document is opened
 * once, and replaced whole through the editor's copy, so an open note keeps
 * what the reader has not saved.
 */
class NoteDocumentEdit implements ParkingEdit<vscode.Uri, WriteHandle> {
  private readonly edit = new vscode.WorkspaceEdit();
  private readonly documents = new Map<string, vscode.TextDocument>();

  public constructor(private readonly history: WorkspaceWriteHistory) {}

  /** The note's text as its document holds it now. */
  public async read(uri: vscode.Uri): Promise<string> {
    const document = this.documents.get(uri.toString()) ?? (await vscode.workspace.openTextDocument(uri));
    this.documents.set(uri.toString(), document);
    return document.getText();
  }

  /** Replaces the whole of a note read through this edit. */
  public replace(uri: vscode.Uri, content: string): void {
    const document = this.documents.get(uri.toString());
    if (!document) {
      throw new Error(`Deckard did not read ${uri.toString()} before changing it.`);
    }
    this.edit.replace(
      document.uri,
      new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
      content,
    );
  }

  /** Writes every note replaced, as one write Undo takes back. */
  public async write(label: ParkingWriteLabel): Promise<ParkingWriteOutcome<WriteHandle>> {
    const result = await this.history.write(this.edit, {
      label: `${label.action} ${pluralize(label.notes, 'note')}`,
    });
    return result.applied ? { applied: true, handle: result.handle } : { applied: false };
  }
}

/**
 * Where a parking setting is written: where it is already set most
 * specifically, else the folder's own settings in a multi-root workspace and
 * the workspace's otherwise, or the user's when `unset` is `global`. The
 * value is read from that same place, so a user-level value is not copied
 * into the workspace.
 */
function settingPlace(
  key: string,
  scope?: vscode.Uri,
  unset: 'default' | 'global' = 'default',
): { configuration: vscode.WorkspaceConfiguration; target: vscode.ConfigurationTarget; current: unknown } {
  const configuration = vscode.workspace.getConfiguration('deckard', scope);
  const inspected = configuration.inspect(key);
  if (scope && inspected?.workspaceFolderValue !== undefined) {
    return { configuration, target: vscode.ConfigurationTarget.WorkspaceFolder, current: inspected.workspaceFolderValue };
  }
  if (inspected?.workspaceValue !== undefined) {
    return { configuration, target: vscode.ConfigurationTarget.Workspace, current: inspected.workspaceValue };
  }
  if (inspected?.globalValue !== undefined || unset === 'global') {
    return { configuration, target: vscode.ConfigurationTarget.Global, current: inspected?.globalValue };
  }
  const multiRoot = vscode.workspace.workspaceFile !== undefined && scope !== undefined;
  return {
    configuration,
    target: multiRoot ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace,
    current: inspected?.defaultValue,
  };
}

/** The parking settings as VS Code writes them, saying so when a write is refused. */
const vscodeParkingSettings: ParkingSettings<vscode.Uri> = {
  place(key: string, scope?: vscode.Uri, unset?: 'default' | 'global'): SettingPlace {
    const { configuration, target, current } = settingPlace(key, scope, unset);
    return { current, write: (value) => writeSetting(key, value, target, configuration) };
  },
};

/**
 * The Undo button on a write to the notes: it takes back the last write as
 * Undo Last Change does, asking first, without asking whether that is still
 * this one.
 */
function offerUndo(indexer: ParkingIndex, written: WriteHandle, text: string): void {
  written.offerUndo(text, { guard: 'ask', refresh: () => indexer.refresh() });
}

/** Park Note: writes the first parked tag into each note's front matter. */
export async function parkNotes(commands: ParkingCommands, uri?: unknown, uris?: unknown): Promise<void> {
  const chosen = chosenNotes(uri, uris);
  if (chosen.length === 0) {
    void vscode.window.showInformationMessage('Open a note, or right-click one in the Explorer, to park it.');
    return;
  }
  await commands.indexer.ready;
  await reportParkedNotes(commands, await commands.parking.parkNotes(commands.indexer.getSnapshot(), chosen));
}

/** Says what Park Note came to, offering to unpark the folder that already parks a note. */
async function reportParkedNotes(
  commands: ParkingCommands,
  result: ParkNotesResult<vscode.Uri, WriteHandle>,
): Promise<void> {
  if (result.kind === 'refused') {
    if (result.reason === 'parked-by-folder') {
      await offerUnparkFolder(
        commands,
        `${quoted(result.filePath)} is already parked: it is in ${result.folder}, which is parked.`,
        result.folder,
      );
      return;
    }
    void vscode.window.showInformationMessage(describeParkRefusal(result));
    return;
  }
  if (result.kind === 'unreadable') {
    void reportFailure({
      outcome: `Deckard could not read the front matter of ${quoted(result.filePath)}, so it did not change it.`,
      fix: `Add ${result.tag} to its tags by hand.`,
    });
    return;
  }
  if (result.kind === 'not-applied') {
    return;
  }
  const parked = result.filePaths;
  offerUndo(
    commands.indexer,
    result.handle,
    parked.length === 1 ? `Parked ${quoted(parked[0])}. ${STAYS}` : `Parked ${parked.length} notes. ${STAY}`,
  );
}

/** The one sentence for each reason Park Note wrote nothing. */
function describeParkRefusal(
  result: Exclude<Extract<ParkNotesResult<vscode.Uri, WriteHandle>, { kind: 'refused' }>, { reason: 'parked-by-folder' }>,
): string {
  switch (result.reason) {
    case 'no-parked-tag':
      return `The "${settingLabel('parked.tags')}" setting names no tag, so Park Note has nothing to write. Add one, such as parked.`;
    case 'not-indexed':
      return `Deckard does not index ${path.basename(result.uri.path)}, so there is nothing to park.`;
    case 'already-parked':
      return `${quoted(result.filePath)} is already parked.`;
    case 'all-parked':
      return 'Every note chosen is parked already.';
  }
}

/** Unpark Note: takes the parked tags out of each note's front matter. */
export async function unparkNotes(commands: ParkingCommands, uri?: unknown, uris?: unknown): Promise<void> {
  const chosen = chosenNotes(uri, uris);
  if (chosen.length === 0) {
    void vscode.window.showInformationMessage('Open a note, or right-click one in the Explorer, to unpark it.');
    return;
  }
  await commands.indexer.ready;
  await reportUnparkedNotes(commands, await commands.parking.unparkNotes(commands.indexer.getSnapshot(), chosen));
}

/**
 * Says what Unpark Note came to. A note parked by its folder offers to
 * unpark the folder; one parked by a tag Park Note did not write asks
 * whether to take the tag out of the note or unpark the tag.
 */
async function reportUnparkedNotes(commands: ParkingCommands, result: UnparkNotesResult<WriteHandle>): Promise<void> {
  switch (result.kind) {
    case 'refused':
      if (result.reason === 'not-parked') {
        void vscode.window.showInformationMessage(`${quoted(result.filePath)} is not parked.`);
        return;
      }
      await offerUnparkFolder(commands, `${quoted(result.filePath)} is parked by its folder, ${result.folder}.`, result.folder);
      return;
    case 'unreadable':
      void reportFailure({
        outcome: `Deckard could not read the front matter of ${quoted(result.filePath)}, so it did not change it.`,
        fix: 'Take the parked tag out of its tags by hand.',
      });
      return;
    case 'parked-by-tag':
      await askAboutParkingTag(commands, result);
      return;
    case 'nothing':
    case 'not-applied':
      return;
    case 'unparked':
      offerUndo(
        commands.indexer,
        result.handle,
        result.filePaths.length === 1 ? `Unparked ${quoted(result.filePaths[0])}.` : `Unparked ${result.filePaths.length} notes.`,
      );
  }
}

/** Says a note is parked by its folder, with a button that unparks the folder. */
async function offerUnparkFolder(commands: ParkingCommands, message: string, folder: string): Promise<void> {
  const choice = await vscode.window.showInformationMessage(message, 'Unpark Folder');
  if (choice === 'Unpark Folder') {
    await unparkFolders(commands, commands.indexer.getUri(folder));
  }
}

/**
 * Asks what to do about a note parked by a tag Park Note did not write:
 * take the tag out of this note, or unpark the tag everywhere.
 */
async function askAboutParkingTag(
  commands: ParkingCommands,
  result: Extract<UnparkNotesResult<WriteHandle>, { kind: 'parked-by-tag' }>,
): Promise<void> {
  const remove = 'Remove the Tag from This Note';
  const unparkTagChoice = `Unpark ${result.label}`;
  const choice = await vscode.window.showInformationMessage(
    `${quoted(result.filePath)} is parked by its tag ${result.label}.`,
    remove,
    unparkTagChoice,
  );
  if (choice === unparkTagChoice) {
    await unparkTag(commands, result.tag);
    return;
  }
  if (choice !== remove) {
    return;
  }
  await reportUnparkedNotes(commands, await result.removeTag());
}

/** The folders that hold notes, most notes first, for the palette. */
async function pickFolder(index: WorkspaceIndex, placeHolder: string): Promise<vscode.Uri | undefined> {
  const counts = new Map<string, number>();
  index.files.forEach((_, filePath) => {
    const parts = filePath.split('/').slice(0, -1);
    parts.forEach((__, end) => {
      const folder = parts.slice(0, end + 1).join('/');
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    });
  });
  const picked = await vscode.window.showQuickPick(
    [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([folder, count]) => ({ label: folder, description: pluralize(count, 'note') })),
    { placeHolder, matchOnDescription: true },
  );
  return picked ? folderUri(picked.label) : undefined;
}

/** A folder named by its index path, as a URI. */
function folderUri(folder: string): vscode.Uri | undefined {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1) {
    return vscode.Uri.joinPath(folders[0].uri, ...folder.split('/'));
  }
  const [name, ...rest] = folder.split('/');
  const root = folders.find((candidate) => candidate.name === name);
  return root ? vscode.Uri.joinPath(root.uri, ...rest) : undefined;
}

/** Park Folder…: adds the folder to `deckard.parked.folders`, with Undo. */
export async function parkFolders(commands: ParkingCommands, uri?: unknown, uris?: unknown): Promise<void> {
  await commands.indexer.ready;
  const index = commands.indexer.getSnapshot();
  for (const folder of await chosenFolders(index, uri, uris)) {
    await reportParkedFolder(await commands.parking.parkFolder(index, folder));
  }
}

/** The folders Park Folder was given: the Explorer's selection, a URI, or one picked from those that hold notes. */
async function chosenFolders(index: WorkspaceIndex, uri?: unknown, uris?: unknown): Promise<vscode.Uri[]> {
  const given = givenUris(uri, uris);
  if (given) {
    return given;
  }
  return [await pickFolder(index, 'Choose a folder to park')].filter((item): item is vscode.Uri => item !== undefined);
}

/**
 * Says what Park Folder came to. A folder the exclude setting leaves out
 * cannot be parked until it is taken out of that setting, which the reader
 * can have done for them when the setting names it by an exact key.
 */
async function reportParkedFolder(result: ParkFolderResult): Promise<void> {
  switch (result.kind) {
    case 'refused':
      void vscode.window.showInformationMessage(
        result.reason === 'outside-workspace'
          ? 'Choose a folder inside the workspace to park.'
          : `${result.name} is parked already.`,
      );
      return;
    case 'excluded':
      await askAboutExcludedFolder(result);
      return;
    case 'not-written':
      return;
    case 'parked':
      void vscode.window
        .showInformationMessage(
          `Parked ${result.name} and its ${pluralize(result.notes, 'note')}. ${result.notes === 1 ? STAYS : STAY}`,
          'Undo',
        )
        .then(async (choice) => {
          if (choice === 'Undo') {
            await result.undo();
          }
        });
  }
}

/** Asks whether to park a folder the exclude setting leaves out, or to open that setting. */
async function askAboutExcludedFolder(result: Extract<ParkFolderResult, { kind: 'excluded' }>): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    `${result.name} is left out by the "${settingLabel('exclude')}" setting, so Deckard does not index or search it. Park it instead to keep it searchable.`,
    'Park Instead',
    'Open Setting',
  );
  if (choice === 'Open Setting' || (choice === 'Park Instead' && !result.parkInstead)) {
    await openSettingAction('exclude').run();
    return;
  }
  if (choice !== 'Park Instead' || !result.parkInstead) {
    return;
  }
  await reportParkedFolder(await result.parkInstead());
}

/** Unpark Folder…: takes the folder's key out of `deckard.parked.folders`. */
export async function unparkFolders(commands: ParkingCommands, uri?: unknown, uris?: unknown): Promise<void> {
  await commands.indexer.ready;
  const index = commands.indexer.getSnapshot();
  const chosen = await chosenParkedFolders(uri, uris);
  if (!chosen) {
    void vscode.window.showInformationMessage(`No folder is parked by name in the "${settingLabel('parked.folders')}" setting.`);
    return;
  }
  for (const folder of chosen) {
    await reportUnparkedFolder(await commands.parking.unparkFolder(index, folder));
  }
}

/**
 * The folders Unpark Folder was given: the Explorer's selection, a URI, or
 * one picked from those the setting parks by name. Undefined when there is
 * none to pick from.
 */
async function chosenParkedFolders(uri?: unknown, uris?: unknown): Promise<vscode.Uri[] | undefined> {
  const given = givenUris(uri, uris);
  if (given) {
    return given;
  }
  const listed = (vscode.workspace.workspaceFolders ?? []).flatMap((folder) =>
    listExcludedFolders(
      [{ root: folder.uri.path, exclude: vscode.workspace.getConfiguration('deckard', folder.uri).get<unknown>('parked.folders', {}) }],
      (root, relative) => path.posix.join(root, relative),
    ).map((folderPath) => folder.uri.with({ path: folderPath })),
  );
  if (listed.length === 0) {
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    listed.map((folder) => ({ label: vscode.workspace.asRelativePath(folder, false), folder })),
    { placeHolder: 'Choose a folder to unpark' },
  );
  return picked ? [picked.folder] : [];
}

/** Says what Unpark Folder came to; a folder a pattern parks offers the setting. */
async function reportUnparkedFolder(result: UnparkFolderResult): Promise<void> {
  switch (result.kind) {
    case 'refused':
      if (result.reason === 'not-parked') {
        void vscode.window.showInformationMessage(`${result.name} is not parked.`);
      }
      return;
    case 'parked-by-pattern': {
      const choice = await vscode.window.showInformationMessage(`${result.name} is parked by the pattern ${result.pattern}.`, 'Open Setting');
      if (choice === 'Open Setting') {
        await openSettingAction('parked.folders').run();
      }
      return;
    }
    case 'not-written':
      return;
    case 'unparked':
      void vscode.window.showInformationMessage(`Unparked ${result.name} and its ${pluralize(result.notes, 'note')}.`);
  }
}

/** The indexed tags, or those `keys` names, by label, for the palette. */
async function pickTag(index: WorkspaceIndex, placeHolder: string, keys?: readonly string[]): Promise<string | undefined> {
  const counts = countTagMatches(index);
  const items = (keys ?? [...index.tags.keys()]).map((key) => {
    const count = counts.get(key);
    return {
      label: index.tags.get(key)?.label ?? key,
      description: count ? `${pluralize(count.notes, 'note')}, ${pluralize(count.tasks, 'task')}` : undefined,
      key,
    };
  });
  const picked = await vscode.window.showQuickPick(
    items.sort((left, right) => left.label.localeCompare(right.label)),
    { placeHolder, matchOnDescription: false },
  );
  return picked?.key;
}

/** Park Tag…: adds the tag to `deckard.parked.tags`, with Undo. */
export async function parkTag(commands: ParkingCommands, tagKey?: unknown): Promise<void> {
  await commands.indexer.ready;
  const index = commands.indexer.getSnapshot();
  const requested = typeof tagKey === 'string' ? tagKey : await pickTag(index, 'Choose a tag to park');
  if (!requested) {
    return;
  }
  await reportParkedTag(commands, await commands.parking.parkTag(index, requested));
}

/** Says what Park Tag came to; a tag parked through its parent offers to unpark the parent. */
async function reportParkedTag(commands: ParkingCommands, result: ParkTagResult): Promise<void> {
  switch (result.kind) {
    case 'refused':
      if (result.reason === 'already-parked') {
        void vscode.window.showInformationMessage(`${result.label} is parked already.`);
      }
      return;
    case 'parked-through':
      await offerUnparkParent(commands, `${result.label} is already parked through ${result.parent}.`, result.parent);
      return;
    case 'not-written':
      return;
    case 'parked':
      void vscode.window
        .showInformationMessage(
          `Parked ${result.label}: ${pluralize(result.notes, 'note')} and ${pluralize(result.tasks, 'task')}. ${result.notes + result.tasks === 1 ? STAYS : STAY}`,
          'Undo',
        )
        .then(async (choice) => {
          if (choice === 'Undo') {
            await result.undo();
          }
        });
  }
}

/** Says a tag is parked through its parent, with a button that unparks the parent. */
async function offerUnparkParent(commands: ParkingCommands, message: string, parent: string): Promise<void> {
  const button = `Unpark ${parent}`;
  const choice = await vscode.window.showInformationMessage(message, button);
  if (choice === button) {
    await unparkTag(commands, parent);
  }
}

/** Unpark Tag…: takes the tag out of `deckard.parked.tags`. */
export async function unparkTag(commands: ParkingCommands, tagKey?: unknown): Promise<void> {
  await commands.indexer.ready;
  const index = commands.indexer.getSnapshot();
  const rules = commands.indexer.getParkedRules();
  if (typeof tagKey !== 'string' && rules.tags.length === 0) {
    void vscode.window.showInformationMessage('No tag is parked.');
    return;
  }
  const requested = typeof tagKey === 'string' ? tagKey : await pickParkedTag(index, rules);
  if (requested === undefined) {
    return;
  }
  await reportUnparkedTag(commands, await commands.parking.unparkTag(index, requested, rules));
}

/** One of the parked tags, by label, for the palette. */
async function pickParkedTag(index: WorkspaceIndex, rules: ParkedRules): Promise<string | undefined> {
  const picked = await vscode.window.showQuickPick(
    rules.tags.map((tag) => ({ label: index.tags.get(tag)?.label ?? tag, tag })),
    { placeHolder: 'Choose a tag to unpark' },
  );
  return picked?.tag;
}

/**
 * Says what Unpark Tag came to. A tag parked through its parent offers to
 * unpark the parent, and one parked where Deckard does not write offers the
 * setting.
 */
async function reportUnparkedTag(commands: ParkingCommands, result: UnparkTagResult): Promise<void> {
  switch (result.kind) {
    case 'refused':
      if (result.reason === 'not-parked') {
        void vscode.window.showInformationMessage(`${result.label} is not parked.`);
      }
      return;
    case 'parked-through':
      await offerUnparkParent(commands, `${result.label} is parked through ${result.parent}.`, result.parent);
      return;
    case 'parked-elsewhere': {
      const choice = await vscode.window.showInformationMessage(
        `${result.label} is parked by a setting Deckard does not write here.`,
        'Open Setting',
      );
      if (choice === 'Open Setting') {
        await openSettingAction('parked.tags').run();
      }
      return;
    }
    case 'not-written':
      return;
    case 'unparked':
      void vscode.window.showInformationMessage(`Unparked ${result.label}.`);
  }
}

export const ACTIVE_NOTE_PARKED = 'deckard.activeNoteParked';

/**
 * Keeps the context keys the menus read in step: whether the note in front is
 * parked, which notes a front-matter tag parks, and which folders
 * `deckard.parked.folders` names, so each menu offers Park or Unpark, not both.
 */
export class ParkingContext implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private active: boolean | undefined;
  private notes = '';
  private folders = '';

  /** Starts in step with the note in front, and follows the editor, the index, and the settings. */
  public constructor(private readonly indexer: ParkingIndex) {
    const sync = (): void => this.sync();
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(sync),
      indexer.onDidUpdate(sync),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard.parked')) {
          sync();
        }
      }),
    );
    sync();
  }

  /** Stops following the editor, the index, and the settings. */
  public dispose(): void {
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /** Sets each context key that no longer says what is true now. */
  public sync(): void {
    const index = this.indexer.getSnapshot();
    const uri = vscode.window.activeTextEditor?.document.uri;
    const active =
      uri !== undefined &&
      this.indexer.isNotesFile(uri) &&
      (index.parked?.files.has(this.indexer.getFilePath(uri)) ?? false);
    if (active !== this.active) {
      this.active = active;
      void vscode.commands.executeCommand('setContext', ACTIVE_NOTE_PARKED, active);
    }
    const notes = [...(index.parked?.taggedFiles ?? [])]
      .map((filePath) => this.indexer.getUri(filePath)?.fsPath)
      .filter((fsPath): fsPath is string => fsPath !== undefined)
      .sort();
    const notesKey = notes.join('\n');
    if (notesKey !== this.notes) {
      this.notes = notesKey;
      void vscode.commands.executeCommand('setContext', 'deckard.parkedNotes', notes);
    }
    const folders = listExcludedFolders(
      (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
        root: folder.uri.fsPath,
        exclude: vscode.workspace.getConfiguration('deckard', folder.uri).get<unknown>('parked.folders', {}),
      })),
      (root, relative) => path.join(root, ...relative.split('/')),
    );
    const foldersKey = folders.join('\n');
    if (foldersKey === this.folders) {
      return;
    }
    this.folders = foldersKey;
    void vscode.commands.executeCommand('setContext', 'deckard.parkedFolders', folders);
  }
}
