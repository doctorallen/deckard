import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import * as vscode from 'vscode';

/**
 * What the scope suites share: the workspace they run in, a way to set a
 * `deckard.*` setting at one level as a reader would, and a way to wait for
 * the editor to catch up with a write.
 *
 * These suites run in a single-folder and a multi-root workspace that
 * `.vscode-test.mjs` makes for each run, never in the run without one.
 */

/** The levels a reader can set a setting at, most general first. */
export type Level = 'user' | 'workspace' | 'folder';

/** Whether the run opened the multi-root workspace rather than the single folder. */
export function isMultiRoot(): boolean {
  return vscode.workspace.workspaceFile !== undefined;
}

/** The workspace's first folder, which a folder-level value is written in. */
export function firstFolder(): vscode.WorkspaceFolder {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error('The scope suites run with a workspace open.');
  }
  return folder;
}

/** The `deckard` section, read for the first folder when `forFolder` is set. */
export function deckard(forFolder = false): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('deckard', forFolder ? firstFolder().uri : undefined);
}

/** The folder's own settings file, which a reader edits for a folder-level value. */
function folderSettingsFile(): string {
  return path.join(firstFolder().uri.fsPath, '.vscode', 'settings.json');
}

/**
 * Sets `deckard.<key>` at one level, or takes it out with `undefined`.
 *
 * User and workspace values go through the API, as an edit in the Settings
 * editor does. A folder value is written into the folder's settings.json
 * by hand, as a reader would: VS Code refuses to write a window setting
 * there through the API, but a reader can still type one, and in a
 * single-folder workspace that file is the workspace's settings.
 */
export async function setAt(key: string, level: Level, value: unknown): Promise<void> {
  if (level === 'user') {
    await deckard().update(key, value, vscode.ConfigurationTarget.Global);
    return;
  }
  if (level === 'workspace') {
    await deckard().update(key, value, vscode.ConfigurationTarget.Workspace);
    return;
  }
  const file = folderSettingsFile();
  const settings = readJson(file);
  if (value === undefined) {
    delete settings[`deckard.${key}`];
  } else {
    settings[`deckard.${key}`] = value;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  await settled(() => sameValue(deckard(true).inspect(key)?.workspaceFolderValue, value), 1500);
}

/** A settings file's contents, or nothing when it is missing or empty. */
function readJson(file: string): Record<string, unknown> {
  try {
    const text = fs.readFileSync(file, 'utf8').trim();
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Whether two setting values are the same value. */
function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Takes `deckard.<key>` out of every level, so the next test starts from the default. */
export async function clearEverywhere(key: string): Promise<void> {
  await setAt(key, 'user', undefined);
  await setAt(key, 'workspace', undefined);
  if (readJson(folderSettingsFile())[`deckard.${key}`] !== undefined) {
    await setAt(key, 'folder', undefined);
  }
}

/**
 * Waits until `check` holds, or `limit` milliseconds pass. Returns whether
 * it held, so a test can assert it with its own message. A file written by
 * hand reaches the configuration on the editor's schedule, and a listener's
 * `setContext` lands after the change event, so neither can be awaited.
 */
export async function settled(check: () => boolean, limit = 3000): Promise<boolean> {
  const deadline = Date.now() + limit;
  while (!check()) {
    if (Date.now() > deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return true;
}

/**
 * The value each level holds for `deckard.<key>`, as inspect() reports it,
 * with the folder's read for the first folder. Leaves out the levels that
 * hold nothing.
 */
export function levels(key: string): Partial<Record<Level, unknown>> {
  const window = deckard().inspect(key);
  const folder = deckard(true).inspect(key);
  const held: Partial<Record<Level, unknown>> = {};
  if (window?.globalValue !== undefined) {
    held.user = window.globalValue;
  }
  if (window?.workspaceValue !== undefined) {
    held.workspace = window.workspaceValue;
  }
  if (folder?.workspaceFolderValue !== undefined) {
    held.folder = folder.workspaceFolderValue;
  }
  return held;
}

/**
 * Records every context key the extension sets, by wrapping
 * `vscode.commands.executeCommand`, which the extension's bundle shares
 * with the tests: both get this extension's one API object.
 */
export function recordContextKeys(): { value(key: string): unknown; dispose(): void } {
  const commands = vscode.commands as { executeCommand: typeof vscode.commands.executeCommand };
  const original = commands.executeCommand;
  const values = new Map<string, unknown>();
  commands.executeCommand = (<T>(command: string, ...rest: unknown[]): Thenable<T> => {
    if (command === 'setContext') {
      values.set(String(rest[0]), rest[1]);
    }
    return original.call(vscode.commands, command, ...rest) as Thenable<T>;
  }) as typeof vscode.commands.executeCommand;
  return {
    value: (key) => values.get(key),
    dispose: () => {
      commands.executeCommand = original;
    },
  };
}

/** Activates Deckard, so its commands and listeners are in place. */
export async function activateDeckard(): Promise<void> {
  await vscode.extensions.getExtension('esperinnovations.deckard-notes')?.activate();
}

/** Where a setting is set before a test writes it, one value per level. */
export interface Arrangement<T> {
  name: string;
  values: Partial<Record<Level, T>>;
}

/**
 * The places a reader can set a window setting, with `a` and `b` two
 * values of it: nowhere, for the user, in the workspace, and in both with
 * different values, the workspace's in force. A folder's settings.json is
 * left out: for a window setting it is the workspace's in a single folder
 * and ignored in a multi-root workspace, as the zen suite checks.
 */
export function arrangementsOf<T>(a: T, b: T): Arrangement<T>[] {
  return [
    { name: 'set nowhere', values: {} },
    { name: 'set for the user', values: { user: a } },
    { name: 'set in the workspace', values: { workspace: a } },
    { name: 'set for the user and, otherwise, in the workspace', values: { user: b, workspace: a } },
  ];
}

/** Sets `deckard.<key>` at each level the arrangement names. */
export async function arrange<T>(key: string, arrangement: Arrangement<T>): Promise<void> {
  for (const [level, value] of Object.entries(arrangement.values) as [Level, T][]) {
    await setAt(key, level, value);
  }
}

/** The level whose value of a window setting is in force: the workspace's when it holds one, else the user's. */
export function decidingLevel(key: string): Level {
  return levels(key).workspace === undefined ? 'user' : 'workspace';
}

/**
 * Writes a setting the other way from what is in force, back, and the
 * other way again, through `write`, and asserts after each that the window
 * reads what was written and that it was written at the level that was in
 * force. `a` and `b` are two values of the setting.
 */
export async function assertWrittenWhereSet<T>(
  key: string,
  write: (value: T) => Thenable<unknown>,
  [a, b]: [T, T],
): Promise<void> {
  const level = decidingLevel(key);
  const first = sameValue(deckard().get(key), a) ? b : a;
  const second = first === a ? b : a;
  for (const [step, value] of [['the first write', first], ['writing it back', second], ['writing it again', first]] as const) {
    await write(value);
    assert.deepStrictEqual(deckard().get(key), value, `${step}: the window reads ${JSON.stringify(value)}`);
    assert.deepStrictEqual(
      levels(key)[level],
      value,
      `${step}: written in the ${level} settings, ${JSON.stringify(levels(key))}`,
    );
  }
}
