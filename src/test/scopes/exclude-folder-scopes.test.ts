import * as assert from 'assert';
import * as fs from 'fs';

import * as vscode from 'vscode';

import { activateDeckard, arrange, Arrangement, clearEverywhere, deckard, firstFolder, isMultiRoot, levels } from './scopes';

/** The key Exclude from Deckard writes for the folder these tests leave out. */
const KEY = 'notes/archive';

/** Where the folder's key is set before a test: by the reader, at one level or several. */
const ARRANGEMENTS: Arrangement<Record<string, boolean>>[] = [
  { name: 'left out nowhere', values: {} },
  { name: 'left out in the user settings', values: { user: { [KEY]: true } } },
  { name: 'left out in the workspace settings', values: { workspace: { [KEY]: true } } },
  ...(isMultiRoot() ? [{ name: "left out in the folder's settings", values: { folder: { [KEY]: true } } }] : []),
  {
    name: 'left out for the user, with the workspace leaving out another folder',
    values: { user: { [KEY]: true }, workspace: { 'notes/other': true } },
  },
  {
    name: 'left out for the user and in the workspace',
    values: { user: { [KEY]: true }, workspace: { [KEY]: true } },
  },
];

/**
 * Exclude from Deckard and Include in Deckard write `deckard.exclude`, an
 * object whose keys VS Code merges across the user's, the workspace's, and
 * a folder's settings, the most specific winning. The Explorer offers
 * Include on any folder the merged value names, so Include has to bring
 * the folder back wherever its key is set, and the two have to undo each
 * other.
 */
suite(`Excluding a folder, with settings at every level (${isMultiRoot() ? 'multi-root' : 'single folder'})`, () => {
  const folder = () => vscode.Uri.joinPath(firstFolder().uri, ...KEY.split('/'));

  suiteSetup(async () => {
    await activateDeckard();
    fs.mkdirSync(folder().fsPath, { recursive: true });
  });

  suiteTeardown(() => fs.rmSync(folder().fsPath, { recursive: true, force: true }));

  teardown(() => clearEverywhere('exclude'));

  /** Whether the folder's settings, merged, leave the folder out. */
  const excluded = (): boolean => (deckard(true).get<Record<string, unknown>>('exclude') ?? {})[KEY] === true;

  /** Runs the command the Explorer offers on the folder: Include when it is left out, else Exclude. */
  const flip = async (step: string): Promise<void> => {
    const before = excluded();
    await vscode.commands.executeCommand(before ? 'deckard.includeInIndex' : 'deckard.excludeFromIndex', folder());
    assert.strictEqual(
      excluded(),
      !before,
      `${step}: ${before ? 'Include' : 'Exclude'} ${before ? 'brings the folder back' : 'leaves it out'}, ${JSON.stringify(levels('exclude'))}`,
    );
  };

  for (const arrangement of ARRANGEMENTS) {
    test(`${arrangement.name}: the Explorer's command changes it, and back`, async () => {
      await arrange('exclude', arrangement);
      await flip('the first command');
      await flip('the second');
      await flip('the third');
    });
  }
});
