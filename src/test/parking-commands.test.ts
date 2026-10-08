import * as assert from 'assert';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { HAS_PARKED_FOLDERS, HAS_PARKED_TAGS, ParkingCommands, ParkingContext, ParkingIndex, parkFolders, unparkFolders } from '../ui/commands/parking';

/**
 * The parking commands over a service that records the folders it is asked
 * to park or unpark and writes nothing, with every quick pick and message
 * recorded and dismissed.
 */
async function withParking(
  run: (commands: ParkingCommands, asked: { parked: unknown[]; unparked: unknown[]; picks: number; shown: unknown[] }) => Promise<void>,
): Promise<void> {
  const index = buildWorkspaceIndex(new Map());
  const asked = { parked: [] as unknown[], unparked: [] as unknown[], picks: 0, shown: [] as unknown[] };
  const commands = {
    indexer: { ready: Promise.resolve(), getSnapshot: () => index },
    parking: {
      parkFolder: async (_index: unknown, folder: unknown) => (asked.parked.push(folder), { kind: 'not-written' }),
      unparkFolder: async (_index: unknown, folder: unknown) => (asked.unparked.push(folder), { kind: 'not-written' }),
    },
  } as unknown as ParkingCommands;
  const window = vscode.window as unknown as Record<string, unknown>;
  const originals = [window.showQuickPick, window.showInformationMessage];
  window.showQuickPick = async () => void (asked.picks += 1);
  window.showInformationMessage = async (message: unknown) => void asked.shown.push(message);
  try {
    await run(commands, asked);
  } finally {
    [window.showQuickPick, window.showInformationMessage] = originals;
  }
}

suite('Parking commands', () => {
  test('Park Folder takes the Explorer selection, and asks instead when it is handed something else', async () => {
    await withParking(async (commands, asked) => {
      const folder = vscode.Uri.file('/notes/old');
      await parkFolders(commands, folder, [folder]);
      assert.deepStrictEqual(asked.parked, [folder]);
      assert.strictEqual(asked.picks, 0);

      // A tree item from another view, which is not a file.
      const item = { label: 'old' };
      await parkFolders(commands, item, [item]);
      assert.deepStrictEqual(asked.parked, [folder], 'nothing that is not a file is parked');
      assert.strictEqual(asked.picks, 1, 'the folder is asked for, as when Park Folder is given nothing');
    });
  });

  test('Unpark Folder takes the Explorer selection, and chooses as if handed nothing when it is handed something else', async () => {
    await withParking(async (commands, asked) => {
      const folder = vscode.Uri.file('/notes/old');
      await unparkFolders(commands, folder, [folder]);
      assert.deepStrictEqual(asked.unparked, [folder]);

      const item = { label: 'old' };
      await unparkFolders(commands, item, [item]);
      assert.deepStrictEqual(asked.unparked, [folder], 'nothing that is not a file is unparked');
      // The test host has no workspace folder, so no folder is parked by name.
      assert.deepStrictEqual(asked.shown, ['No folder is parked by name in the "Parked: Folders" setting.']);
    });
  });

  test('the palette offers Unpark Folder and Unpark Tag only while something is parked', () => {
    const index = buildWorkspaceIndex(new Map());
    let tags: string[] = ['parked'];
    const indexer = {
      getSnapshot: () => index,
      getParkedRules: () => ({ tags }),
      isNotesFile: () => false,
      onDidUpdate: () => ({ dispose: () => undefined }),
    } as unknown as ParkingIndex;
    const commands = vscode.commands as unknown as Record<string, unknown>;
    const executeCommand = commands.executeCommand;
    const set = new Map<string, unknown>();
    commands.executeCommand = async (name: unknown, key: unknown, value: unknown) => {
      if (name === 'setContext') {
        set.set(key as string, value);
      }
    };
    const context = new ParkingContext(indexer);
    try {
      // The test host has no workspace folder, so no folder is parked by name.
      assert.strictEqual(set.get(HAS_PARKED_FOLDERS), false);
      assert.strictEqual(set.get(HAS_PARKED_TAGS), true, 'the default parked tag');
      tags = [];
      context.sync();
      assert.strictEqual(set.get(HAS_PARKED_TAGS), false);
    } finally {
      context.dispose();
      commands.executeCommand = executeCommand;
    }
  });
});
