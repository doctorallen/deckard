import * as path from 'path';

import * as vscode from 'vscode';

import {
  addFrontmatterTag,
  readFrontmatterTagValues,
  removeFrontmatterTags,
} from '../../domain/markdown/frontmatterTags';
import { countTagMatches } from '../../domain/query/queryEvaluator';
import { pluralize } from '../../shared/text';
import { WorkspaceIndex } from '../../core/types';
import { noteTitle } from '../../domain/index/backlinks';
import { isUnderParkedTag, ParkedRules, toParkedTagKey } from '../../domain/index/parked';
import { createExcludeMatcher } from '../../core/workspace/scanner';
import { resolveIndexedTagKey } from '../../domain/index/tagNavigation';
import { listExcludedFolders, readExcludeKey, relativeExcludeKey, withExcludeKey } from './excludeFolders';
import { openSettingAction, reportFailure, settingLabel } from './notify';
import { writeSetting } from './settings';
import { WorkspaceWriteHistory, WriteHandle } from './workspaceWrites';

/**
 * Park Note, Park Folder, and Park Tag, and their Unpark counterparts.
 *
 * A parked note stays indexed and searchable, and is left out of the lists
 * of things to do. Park Note writes the first parked tag into the note's
 * front matter rather than moving the file: a tag travels with the note, and
 * a move would break every link and tool that knows its path. Folders and
 * tags are parked in `deckard.parked.folders` and `deckard.parked.tags`.
 */

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

const STAYS = 'It stays searchable with is:parked.';
const STAY = 'They stay searchable with is:parked.';

/** The notes a command was given: the Explorer's selection, a URI, or the note in front. */
function chosenNotes(uri?: unknown, uris?: unknown): vscode.Uri[] {
  if (Array.isArray(uris) && uris.length > 0 && uris.every((item) => item instanceof vscode.Uri)) {
    return uris as vscode.Uri[];
  }
  if (uri instanceof vscode.Uri) {
    return [uri];
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  return active ? [active] : [];
}

const quoted = (filePath: string): string => `"${noteTitle(filePath)}"`;

/** The folder of a note that a parked-folder pattern matches, nearest first. */
function parkingFolder(rules: ParkedRules, filePath: string): string | undefined {
  const parts = filePath.split('/').slice(0, -1);
  for (let end = 1; end <= parts.length; end += 1) {
    const folder = parts.slice(0, end).join('/');
    if (rules.isParkedPath(folder)) {
      return folder;
    }
  }
  return rules.isParkedPath(filePath) ? filePath : undefined;
}

/** The note's front-matter tags that park it. */
function parkingTags(index: WorkspaceIndex, rules: ParkedRules, filePath: string): string[] {
  return (index.files.get(filePath)?.frontmatterTags ?? [])
    .filter((tag) => isUnderParkedTag(tag.key, rules.tags))
    .map((tag) => tag.key);
}

async function readNote(uri: vscode.Uri): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument(uri);
}

function replaceAll(edit: vscode.WorkspaceEdit, document: vscode.TextDocument, content: string): void {
  edit.replace(
    document.uri,
    new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
    content,
  );
}

/**
 * The Undo button on a write to the notes: it takes back the last write as
 * Undo Last Change does, asking first, without asking whether that is still
 * this one.
 */
function offerUndo(indexer: ParkingIndex, written: WriteHandle, text: string): void {
  written.offerUndo(text, { guard: 'ask', refresh: () => indexer.refresh() });
}

/** Park Note: writes the first parked tag into each note's front matter. */
export async function parkNotes(indexer: ParkingIndex, history: WorkspaceWriteHistory, uri?: unknown, uris?: unknown): Promise<void> {
  const chosen = chosenNotes(uri, uris);
  if (chosen.length === 0) {
    void vscode.window.showInformationMessage('Open a note, or right-click one in the Explorer, to park it.');
    return;
  }
  await indexer.ready;
  const index = indexer.getSnapshot();
  const rules = indexer.getParkedRules();
  const tag = rules.tags.find((candidate) => candidate.startsWith('#'));
  if (!tag) {
    void vscode.window.showInformationMessage(
      `The "${settingLabel('parked.tags')}" setting names no tag, so Park Note has nothing to write. Add one, such as parked.`,
    );
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  const parked: string[] = [];
  const unreadable: string[] = [];
  for (const noteUri of chosen) {
    const filePath = indexer.getFilePath(noteUri);
    if (!indexer.isNotesFile(noteUri) || !index.files.has(filePath)) {
      if (chosen.length === 1) {
        void vscode.window.showInformationMessage(
          `Deckard does not index ${path.basename(noteUri.path)}, so there is nothing to park.`,
        );
        return;
      }
      continue;
    }
    const folder = parkingFolder(rules, filePath);
    if (folder && chosen.length === 1) {
      const choice = await vscode.window.showInformationMessage(
        `${quoted(filePath)} is already parked: it is in ${folder}, which is parked.`,
        'Unpark Folder',
      );
      if (choice === 'Unpark Folder') {
        await unparkFolders(indexer, indexer.getUri(folder));
      }
      return;
    }
    if (folder || parkingTags(index, rules, filePath).length > 0) {
      if (chosen.length === 1) {
        void vscode.window.showInformationMessage(`${quoted(filePath)} is already parked.`);
        return;
      }
      continue;
    }
    const document = await readNote(noteUri);
    const next = addFrontmatterTag(document.getText(), tag.slice(1));
    if (next === undefined) {
      unreadable.push(filePath);
      continue;
    }
    replaceAll(edit, document, next);
    parked.push(filePath);
  }
  if (unreadable.length > 0 && parked.length === 0) {
    void reportFailure({
      outcome: `Deckard could not read the front matter of ${quoted(unreadable[0])}, so it did not change it.`,
      fix: `Add ${tag.slice(1)} to its tags by hand.`,
    });
    return;
  }
  if (parked.length === 0) {
    void vscode.window.showInformationMessage('Every note chosen is parked already.');
    return;
  }
  const result = await history.write(edit, {
    label: `parking ${pluralize(parked.length, 'note')}`,
  });
  if (!result.applied) {
    return;
  }
  offerUndo(indexer, result.handle, parked.length === 1 ? `Parked ${quoted(parked[0])}. ${STAYS}` : `Parked ${parked.length} notes. ${STAY}`);
}

/** Unpark Note: takes the parked tags out of each note's front matter. */
export async function unparkNotes(indexer: ParkingIndex, history: WorkspaceWriteHistory, uri?: unknown, uris?: unknown): Promise<void> {
  const chosen = chosenNotes(uri, uris);
  if (chosen.length === 0) {
    void vscode.window.showInformationMessage('Open a note, or right-click one in the Explorer, to unpark it.');
    return;
  }
  await indexer.ready;
  const index = indexer.getSnapshot();
  const rules = indexer.getParkedRules();
  // The tag Park Note writes, and any other written the same way, is taken
  // out without asking; another parked tag says more than "parked".
  const writtenTag = rules.tags.find((candidate) => candidate.startsWith('#'));
  const edit = new vscode.WorkspaceEdit();
  const unparked: string[] = [];
  for (const noteUri of chosen) {
    const filePath = indexer.getFilePath(noteUri);
    const single = chosen.length === 1;
    const folder = parkingFolder(rules, filePath);
    if (folder) {
      if (single) {
        const choice = await vscode.window.showInformationMessage(
          `${quoted(filePath)} is parked by its folder, ${folder}.`,
          'Unpark Folder',
        );
        if (choice === 'Unpark Folder') {
          await unparkFolders(indexer, indexer.getUri(folder));
        }
        return;
      }
      continue;
    }
    const tags = parkingTags(index, rules, filePath);
    if (tags.length === 0) {
      if (single) {
        void vscode.window.showInformationMessage(`${quoted(filePath)} is not parked.`);
        return;
      }
      continue;
    }
    const document = await readNote(noteUri);
    const values = readFrontmatterTagValues(document.getText());
    if (values === undefined) {
      if (single) {
        void reportFailure({
          outcome: `Deckard could not read the front matter of ${quoted(filePath)}, so it did not change it.`,
          fix: 'Take the parked tag out of its tags by hand.',
        });
        return;
      }
      continue;
    }
    const other = tags.find((key) => key !== writtenTag);
    if (other && single) {
      const label = index.tags.get(other)?.label ?? other;
      const remove = 'Remove the Tag from This Note';
      const unparkTagChoice = `Unpark ${label}`;
      const choice = await vscode.window.showInformationMessage(
        `${quoted(filePath)} is parked by its tag ${label}.`,
        remove,
        unparkTagChoice,
      );
      if (choice === unparkTagChoice) {
        await unparkTag(indexer, other);
        return;
      }
      if (choice !== remove) {
        return;
      }
    } else if (other) {
      continue;
    }
    const next = removeFrontmatterTags(document.getText(), tags);
    if (next === undefined) {
      continue;
    }
    replaceAll(edit, document, next);
    unparked.push(filePath);
  }
  if (unparked.length === 0) {
    return;
  }
  const result = await history.write(edit, {
    label: `unparking ${pluralize(unparked.length, 'note')}`,
  });
  if (!result.applied) {
    return;
  }
  offerUndo(indexer, result.handle, unparked.length === 1 ? `Unparked ${quoted(unparked[0])}.` : `Unparked ${unparked.length} notes.`);
}

/**
 * Where a parking setting is written: where it is already set most
 * specifically, else the folder's own settings in a multi-root workspace and
 * the workspace's otherwise. The value is read from that same place, so a
 * user-level value is not copied into the workspace.
 */
function settingPlace(
  key: 'parked.folders' | 'parked.tags',
  scope?: vscode.Uri,
): { configuration: vscode.WorkspaceConfiguration; target: vscode.ConfigurationTarget; current: unknown } {
  const configuration = vscode.workspace.getConfiguration('deckard', scope);
  const inspected = configuration.inspect(key);
  if (scope && inspected?.workspaceFolderValue !== undefined) {
    return { configuration, target: vscode.ConfigurationTarget.WorkspaceFolder, current: inspected.workspaceFolderValue };
  }
  if (inspected?.workspaceValue !== undefined) {
    return { configuration, target: vscode.ConfigurationTarget.Workspace, current: inspected.workspaceValue };
  }
  if (inspected?.globalValue !== undefined) {
    return { configuration, target: vscode.ConfigurationTarget.Global, current: inspected.globalValue };
  }
  const multiRoot = vscode.workspace.workspaceFile !== undefined && scope !== undefined;
  return {
    configuration,
    target: multiRoot ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace,
    current: inspected?.defaultValue,
  };
}

/** How many indexed notes a folder holds. */
function countNotesIn(index: WorkspaceIndex, folderPath: string): number {
  let count = 0;
  index.files.forEach((_, filePath) => {
    if (filePath.startsWith(`${folderPath}/`)) {
      count += 1;
    }
  });
  return count;
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

/** A folder's index path: relative to its workspace folder, named in multi-root. */
function folderPathOf(uri: vscode.Uri): { key: string; indexPath: string; root: vscode.WorkspaceFolder } | undefined {
  const root = vscode.workspace.getWorkspaceFolder(uri);
  if (!root) {
    return undefined;
  }
  const key = relativeExcludeKey(uri.path.replace(/\/+$/, ''), root.uri.path.replace(/\/+$/, ''));
  if (key === undefined) {
    return undefined;
  }
  const relative = readExcludeKey(key);
  const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
  return { key, indexPath: multiRoot ? `${root.name}/${relative}` : relative, root };
}

/** Park Folder…: adds the folder to `deckard.parked.folders`, with Undo. */
export async function parkFolders(indexer: ParkingIndex, uri?: unknown, uris?: unknown): Promise<void> {
  await indexer.ready;
  const index = indexer.getSnapshot();
  const chosen = Array.isArray(uris) && uris.length > 0
    ? (uris as vscode.Uri[])
    : uri instanceof vscode.Uri
      ? [uri]
      : [await pickFolder(index, 'Choose a folder to park')].filter((item): item is vscode.Uri => item !== undefined);
  for (const folder of chosen) {
    await parkFolder(indexer, index, folder);
  }
}

async function parkFolder(indexer: ParkingIndex, index: WorkspaceIndex, uri: vscode.Uri): Promise<void> {
  const place = folderPathOf(uri);
  if (!place) {
    void vscode.window.showInformationMessage('Choose a folder inside the workspace to park.');
    return;
  }
  const { key, indexPath, root } = place;
  const name = readExcludeKey(key);
  const excludeSetting = vscode.workspace.getConfiguration('deckard', root.uri).get<unknown>('exclude', {});
  if (createExcludeMatcher(excludeSetting)(name)) {
    const exact =
      excludeSetting && typeof excludeSetting === 'object'
        ? Object.keys(excludeSetting).find((candidate) => readExcludeKey(candidate.replace(/\/+$/, '')) === name)
        : undefined;
    const choice = await vscode.window.showInformationMessage(
      `${name} is left out by the "${settingLabel('exclude')}" setting, so Deckard does not index or search it. Park it instead to keep it searchable.`,
      'Park Instead',
      'Open Setting',
    );
    if (choice === 'Open Setting' || (choice === 'Park Instead' && !exact)) {
      await openSettingAction('exclude').run();
      return;
    }
    if (choice !== 'Park Instead' || !exact) {
      return;
    }
    const configuration = vscode.workspace.getConfiguration('deckard', root.uri);
    const inspected = configuration.inspect('exclude');
    const target =
      inspected?.workspaceFolderValue !== undefined
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : inspected?.workspaceValue !== undefined
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
    const current =
      target === vscode.ConfigurationTarget.WorkspaceFolder
        ? inspected?.workspaceFolderValue
        : target === vscode.ConfigurationTarget.Workspace
          ? inspected?.workspaceValue
          : inspected?.globalValue;
    if (!(await writeSetting('exclude', withExcludeKey(current, exact, false), target, configuration))) {
      return;
    }
  }
  const { configuration, target, current } = settingPlace('parked.folders', root.uri);
  if (indexer.getParkedRules().isParkedPath(indexPath)) {
    void vscode.window.showInformationMessage(`${name} is parked already.`);
    return;
  }
  if (!(await writeSetting('parked.folders', withExcludeKey(current, key, true), target, configuration))) {
    return;
  }
  const count = countNotesIn(index, indexPath);
  void vscode.window
    .showInformationMessage(`Parked ${name} and its ${pluralize(count, 'note')}. ${count === 1 ? STAYS : STAY}`, 'Undo')
    .then(async (choice) => {
      if (choice === 'Undo') {
        await writeSetting('parked.folders', current, target, configuration);
      }
    });
}

/** Unpark Folder…: takes the folder's key out of `deckard.parked.folders`. */
export async function unparkFolders(indexer: ParkingIndex, uri?: unknown, uris?: unknown): Promise<void> {
  await indexer.ready;
  const index = indexer.getSnapshot();
  let chosen: vscode.Uri[];
  if (Array.isArray(uris) && uris.length > 0) {
    chosen = uris as vscode.Uri[];
  } else if (uri instanceof vscode.Uri) {
    chosen = [uri];
  } else {
    const listed = (vscode.workspace.workspaceFolders ?? []).flatMap((folder) =>
      listExcludedFolders(
        [{ root: folder.uri.path, exclude: vscode.workspace.getConfiguration('deckard', folder.uri).get<unknown>('parked.folders', {}) }],
        (root, relative) => path.posix.join(root, relative),
      ).map((folderPath) => folder.uri.with({ path: folderPath })),
    );
    if (listed.length === 0) {
      void vscode.window.showInformationMessage(`No folder is parked by name in the "${settingLabel('parked.folders')}" setting.`);
      return;
    }
    const picked = await vscode.window.showQuickPick(
      listed.map((folder) => ({ label: vscode.workspace.asRelativePath(folder, false), folder })),
      { placeHolder: 'Choose a folder to unpark' },
    );
    chosen = picked ? [picked.folder] : [];
  }
  for (const folder of chosen) {
    await unparkFolder(index, folder);
  }
}

async function unparkFolder(index: WorkspaceIndex, uri: vscode.Uri): Promise<void> {
  const place = folderPathOf(uri);
  if (!place) {
    return;
  }
  const { key, indexPath, root } = place;
  const name = readExcludeKey(key);
  const { configuration, target, current } = settingPlace('parked.folders', root.uri);
  const keys = current && typeof current === 'object' ? Object.keys(current) : [];
  const written = keys.find((candidate) => readExcludeKey(candidate.replace(/\/+$/, '')) === name);
  if (!written) {
    const everywhere = vscode.workspace.getConfiguration('deckard', root.uri).get<Record<string, unknown>>('parked.folders', {});
    const pattern = Object.entries(everywhere).find(
      ([candidate, on]) => on === true && createExcludeMatcher({ [candidate]: true })(name),
    )?.[0];
    if (pattern) {
      const choice = await vscode.window.showInformationMessage(`${name} is parked by the pattern ${pattern}.`, 'Open Setting');
      if (choice === 'Open Setting') {
        await openSettingAction('parked.folders').run();
      }
      return;
    }
    void vscode.window.showInformationMessage(`${name} is not parked.`);
    return;
  }
  if (!(await writeSetting('parked.folders', withExcludeKey(current, written, false), target, configuration))) {
    return;
  }
  void vscode.window.showInformationMessage(`Unparked ${name} and its ${pluralize(countNotesIn(index, indexPath), 'note')}.`);
}

/** How a parked tag is written in the setting: `project/old`, `@ren`. */
function settingValue(key: string): string {
  return key.startsWith('#') ? key.slice(1) : key;
}

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
export async function parkTag(indexer: ParkingIndex, tagKey?: unknown): Promise<void> {
  await indexer.ready;
  const index = indexer.getSnapshot();
  const requested = typeof tagKey === 'string' ? tagKey : await pickTag(index, 'Choose a tag to park');
  if (!requested) {
    return;
  }
  const key = resolveIndexedTagKey(index.tags, requested) ?? toParkedTagKey(requested);
  if (!key) {
    return;
  }
  const label = index.tags.get(key)?.label ?? key;
  const rules = indexer.getParkedRules();
  const lower = key.toLowerCase();
  if (rules.tags.includes(lower)) {
    void vscode.window.showInformationMessage(`${label} is parked already.`);
    return;
  }
  const parent = rules.tags.find((tag) => lower.startsWith(`${tag}/`));
  if (parent) {
    const button = `Unpark ${parent}`;
    const choice = await vscode.window.showInformationMessage(
      `${label} is already parked through ${parent}.`,
      button,
    );
    if (choice === button) {
      await unparkTag(indexer, parent);
    }
    return;
  }
  const { configuration, target, current } = settingPlace('parked.tags');
  const list = Array.isArray(current) ? (current as unknown[]).filter((value): value is string => typeof value === 'string') : [];
  if (!(await writeSetting('parked.tags', [...list, settingValue(key)], target, configuration))) {
    return;
  }
  const count = countTagMatches(index).get(key) ?? { notes: 0, tasks: 0 };
  void vscode.window
    .showInformationMessage(
      `Parked ${label}: ${pluralize(count.notes, 'note')} and ${pluralize(count.tasks, 'task')}. ${count.notes + count.tasks === 1 ? STAYS : STAY}`,
      'Undo',
    )
    .then(async (choice) => {
      if (choice === 'Undo') {
        await writeSetting('parked.tags', current, target, configuration);
      }
    });
}

/** Unpark Tag…: takes the tag out of `deckard.parked.tags`. */
export async function unparkTag(indexer: ParkingIndex, tagKey?: unknown): Promise<void> {
  await indexer.ready;
  const index = indexer.getSnapshot();
  const rules = indexer.getParkedRules();
  const requested =
    typeof tagKey === 'string'
      ? tagKey
      : rules.tags.length === 0
        ? undefined
        : (
            await vscode.window.showQuickPick(
              rules.tags.map((tag) => ({ label: index.tags.get(tag)?.label ?? tag, tag })),
              { placeHolder: 'Choose a tag to unpark' },
            )
          )?.tag;
  if (requested === undefined) {
    if (typeof tagKey !== 'string' && rules.tags.length === 0) {
      void vscode.window.showInformationMessage('No tag is parked.');
    }
    return;
  }
  const key = toParkedTagKey(requested);
  if (!key) {
    return;
  }
  const label = index.tags.get(resolveIndexedTagKey(index.tags, key) ?? key)?.label ?? key;
  const { configuration, target, current } = settingPlace('parked.tags');
  const list = Array.isArray(current) ? (current as unknown[]).filter((value): value is string => typeof value === 'string') : [];
  const kept = list.filter((value) => toParkedTagKey(value) !== key);
  if (kept.length === list.length) {
    const parent = rules.tags.find((tag) => key.startsWith(`${tag}/`));
    if (parent) {
      const button = `Unpark ${parent}`;
      const choice = await vscode.window.showInformationMessage(`${label} is parked through ${parent}.`, button);
      if (choice === button) {
        await unparkTag(indexer, parent);
      }
      return;
    }
    if (rules.tags.includes(key)) {
      const choice = await vscode.window.showInformationMessage(
        `${label} is parked by a setting Deckard does not write here.`,
        'Open Setting',
      );
      if (choice === 'Open Setting') {
        await openSettingAction('parked.tags').run();
      }
      return;
    }
    void vscode.window.showInformationMessage(`${label} is not parked.`);
    return;
  }
  if (!(await writeSetting('parked.tags', kept, target, configuration))) {
    return;
  }
  void vscode.window.showInformationMessage(`Unparked ${label}.`);
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

  public dispose(): void {
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

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
    if (foldersKey !== this.folders) {
      this.folders = foldersKey;
      void vscode.commands.executeCommand('setContext', 'deckard.parkedFolders', folders);
    }
  }
}
