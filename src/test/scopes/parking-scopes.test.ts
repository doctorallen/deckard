import * as assert from 'assert';
import * as fs from 'fs';

import * as vscode from 'vscode';

import {
  activateDeckard,
  answerMessages,
  arrange,
  Arrangement,
  arrangementsOf,
  clearEverywhere,
  deckard,
  firstFolder,
  isMultiRoot,
  levels,
} from './scopes';

/** The key Park Folder writes for the folder these tests park. */
const FOLDER_KEY = 'notes/drafts';

/** Where the folder's key is set before a test: by the reader, at one level or several. */
const FOLDER_ARRANGEMENTS: Arrangement<Record<string, boolean>>[] = [
  { name: 'parked nowhere', values: {} },
  { name: 'parked in the user settings', values: { user: { [FOLDER_KEY]: true } } },
  { name: 'parked in the workspace settings', values: { workspace: { [FOLDER_KEY]: true } } },
  ...(isMultiRoot() ? [{ name: "parked in the folder's settings", values: { folder: { [FOLDER_KEY]: true } } }] : []),
  {
    name: 'parked for the user, with the workspace parking another folder',
    values: { user: { [FOLDER_KEY]: true }, workspace: { 'notes/other': true } },
  },
  {
    name: 'parked for the user and in the workspace',
    values: { user: { [FOLDER_KEY]: true }, workspace: { [FOLDER_KEY]: true } },
  },
];

/** The tag these tests park, as Park Tag is given it. */
const TAG = 'project/old';

/**
 * Park Folder and Unpark Folder write `deckard.parked.folders`, an object
 * VS Code merges across levels like `deckard.exclude`; Park Tag and Unpark
 * Tag write `deckard.parked.tags`, a list the most specific level holding
 * one decides. Each pair has to change what is parked wherever it is set,
 * and undo itself.
 */
suite(`Parking, with settings at every level (${isMultiRoot() ? 'multi-root' : 'single folder'})`, () => {
  const folder = () => vscode.Uri.joinPath(firstFolder().uri, ...FOLDER_KEY.split('/'));
  let answering: vscode.Disposable;

  suiteSetup(async () => {
    await activateDeckard();
    fs.mkdirSync(folder().fsPath, { recursive: true });
    // Some outcomes ask, and wait for an answer; none is given.
    answering = answerMessages(undefined);
  });

  suiteTeardown(() => {
    answering.dispose();
    fs.rmSync(folder().fsPath, { recursive: true, force: true });
  });

  suite('a folder', () => {
    teardown(() => clearEverywhere('parked.folders'));

    /** Whether the folder's settings, merged, park the folder. */
    const parked = (): boolean => (deckard(true).get<Record<string, unknown>>('parked.folders') ?? {})[FOLDER_KEY] === true;

    /** Runs Unpark Folder when the folder is parked, else Park Folder. */
    const flip = async (step: string): Promise<void> => {
      const before = parked();
      await vscode.commands.executeCommand(before ? 'deckard.unparkFolder' : 'deckard.parkFolder', folder());
      assert.strictEqual(
        parked(),
        !before,
        `${step}: ${before ? 'Unpark' : 'Park'} Folder ${before ? 'unparks' : 'parks'} it, ${JSON.stringify(levels('parked.folders'))}`,
      );
    };

    for (const arrangement of FOLDER_ARRANGEMENTS) {
      test(`${arrangement.name}: Park and Unpark Folder change it, and back`, async () => {
        await arrange('parked.folders', arrangement);
        await flip('the first command');
        await flip('the second');
        await flip('the third');
      });
    }

    test('left out for the user, beside a workspace that leaves out another: Park Instead takes it out and parks it', async () => {
      await arrange('exclude', { name: '', values: { user: { [FOLDER_KEY]: true }, workspace: { 'notes/other': true } } });
      const parkInstead = answerMessages('Park Instead');
      try {
        await vscode.commands.executeCommand('deckard.parkFolder', folder());
        const exclude = deckard(true).get<Record<string, unknown>>('exclude') ?? {};
        assert.notStrictEqual(exclude[FOLDER_KEY], true, `no longer left out, ${JSON.stringify(levels('exclude'))}`);
        assert.ok(parked(), `parked, ${JSON.stringify(levels('parked.folders'))}`);
      } finally {
        parkInstead.dispose();
        await clearEverywhere('exclude');
      }
    });
  });

  suite('a tag', () => {
    teardown(() => clearEverywhere('parked.tags'));

    /** Whether the window's setting parks the tag. */
    const parked = (): boolean =>
      (deckard().get<string[]>('parked.tags') ?? []).some((value) => value.replace(/^#/, '').toLowerCase() === TAG);

    /** Runs Unpark Tag when the tag is parked, else Park Tag. */
    const flip = async (step: string): Promise<void> => {
      const before = parked();
      await vscode.commands.executeCommand(before ? 'deckard.unparkTag' : 'deckard.parkTag', TAG);
      assert.strictEqual(
        parked(),
        !before,
        `${step}: ${before ? 'Unpark' : 'Park'} Tag ${before ? 'unparks' : 'parks'} it, ${JSON.stringify(levels('parked.tags'))}`,
      );
    };

    for (const arrangement of arrangementsOf([TAG], ['someday'])) {
      test(`${arrangement.name}: Park and Unpark Tag change it, and back`, async () => {
        await arrange('parked.tags', arrangement);
        await flip('the first command');
        await flip('the second');
        await flip('the third');
      });
    }
  });
});
