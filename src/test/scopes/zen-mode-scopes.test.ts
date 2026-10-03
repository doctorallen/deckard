import * as assert from 'assert';

import * as vscode from 'vscode';

import { setZenMode as zenHandler } from '../../ui/webview/host/sharedHandlers';
import { isZenModeEnabled, syncZenModeContext, zenModeContextKey } from '../../ui/webview/zenMode';
import { activateDeckard, clearEverywhere, deckard, isMultiRoot, Level, levels, recordContextKeys, setAt, settled } from './scopes';

/** Where zen is set before a test turns it on and off, one value per level. */
interface Arrangement {
  name: string;
  values: Partial<Record<Level, boolean>>;
}

const ARRANGEMENTS: Arrangement[] = [
  { name: 'set nowhere', values: {} },
  { name: 'set in the user settings', values: { user: true } },
  { name: 'set in the workspace settings', values: { workspace: true } },
  { name: "set in a folder's settings.json", values: { folder: true } },
  { name: 'on for the user, off in the workspace', values: { user: true, workspace: false } },
  { name: 'off for the user, on in the workspace', values: { user: false, workspace: true } },
];

/** How a reader turns zen on and off: the palette's two commands, or a page's gear. */
interface Path {
  name: string;
  set(enabled: boolean): Thenable<unknown>;
  /** Turns zen the other way, as the reader is offered it. */
  toggle(): Thenable<unknown>;
}

/**
 * Zen is a window setting, so VS Code reads it from the workspace's
 * settings when they set it, else the user's; in a multi-root workspace a
 * folder's value is ignored, and in a single folder the folder's
 * settings.json is the workspace's. Whatever is set where, turning zen on
 * or off has to change what the pages show, a second turn has to undo it,
 * and the palette has to offer the command that changes something.
 */
suite(`Zen mode, with settings at every level (${isMultiRoot() ? 'multi-root' : 'single folder'})`, () => {
  let contextKeys: ReturnType<typeof recordContextKeys>;

  suiteSetup(async () => {
    await activateDeckard();
    contextKeys = recordContextKeys();
    // Activation set the key before the recorder was in place.
    await syncZenModeContext();
  });

  suiteTeardown(() => contextKeys.dispose());

  teardown(() => clearEverywhere('zenMode'));

  const offered = (): boolean => contextKeys.value(zenModeContextKey) === true;

  const PATHS: Path[] = [
    {
      name: 'the palette',
      set: (enabled) => vscode.commands.executeCommand(enabled ? 'deckard.enableZenMode' : 'deckard.disableZenMode'),
      // The palette offers Disable while the key says zen is on, else Enable.
      toggle: () => vscode.commands.executeCommand(offered() ? 'deckard.disableZenMode' : 'deckard.enableZenMode'),
    },
    {
      name: "a page's gear",
      set: (enabled) => Promise.resolve(zenHandler()({ type: 'setZenMode', enabled }, undefined as never)),
      // The gear draws from the setting, so its other row is the opposite of what is in force.
      toggle: () => Promise.resolve(zenHandler()({ type: 'setZenMode', enabled: !isZenModeEnabled() }, undefined as never)),
    },
  ];

  /** The level whose value is in force: the workspace's when it holds one, else the user's. */
  const decidingLevel = (): Level => (levels('zenMode').workspace === undefined ? 'user' : 'workspace');

  /** Asserts zen reads `expected` everywhere, was written at `level`, and the palette agrees. */
  const assertZen = async (expected: boolean, level: Level, step: string): Promise<void> => {
    assert.strictEqual(deckard().get('zenMode'), expected, `${step}: the window reads zen as ${expected}`);
    assert.strictEqual(deckard(true).get('zenMode'), expected, `${step}: the folder reads zen as ${expected}`);
    assert.strictEqual(levels('zenMode')[level], expected, `${step}: written in the ${level} settings, ${JSON.stringify(levels('zenMode'))}`);
    assert.ok(
      await settled(() => contextKeys.value(zenModeContextKey) === expected),
      `${step}: the context key says ${expected}, not ${String(contextKeys.value(zenModeContextKey))}`,
    );
  };

  /**
   * Sets zen where the arrangement says, as a reader editing settings.json
   * would, and returns what is then in force, once the context key the
   * palette reads agrees with it.
   */
  const arrange = async (arrangement: Arrangement): Promise<boolean> => {
    for (const [level, value] of Object.entries(arrangement.values) as [Level, boolean][]) {
      await setAt('zenMode', level, value);
    }
    const before = isZenModeEnabled();
    assert.ok(
      await settled(() => contextKeys.value(zenModeContextKey) === before),
      `the context key follows the settings as arranged (${before}), not ${String(contextKeys.value(zenModeContextKey))}`,
    );
    return before;
  };

  for (const arrangement of ARRANGEMENTS) {
    test(`${arrangement.name}: the palette offers the command that changes zen`, async () => {
      await arrange(arrangement);
    });
    for (const path of PATHS) {
      test(`${arrangement.name}: ${path.name} turns zen each way, and back`, async () => {
        const before = await arrange(arrangement);
        const level = decidingLevel();

        await path.toggle();
        await assertZen(!before, level, 'the first toggle');
        await path.toggle();
        await assertZen(before, level, 'the second toggle');

        await path.set(true);
        await assertZen(true, level, 'enabling');
        await path.set(false);
        await assertZen(false, level, 'disabling');
        await path.set(true);
        await assertZen(true, level, 'enabling again');
      });
    }
  }
});
