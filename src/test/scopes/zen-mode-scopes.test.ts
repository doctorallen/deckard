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
 * Zen mode is read as Display's Zen step until a step is set, from wherever
 * VS Code reads it: the workspace's settings when they set it, else the
 * user's. Whatever is set where, turning Zen on or off writes the step to
 * the user's settings, which every Display setting is, has to change what
 * the pages show, a second turn has to undo it, and the palette has to
 * offer the command that changes something.
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

  teardown(async () => {
    await clearEverywhere('zenMode');
    await setAt('display.level', 'user', undefined);
  });

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

  /** Asserts Zen reads `expected`, the step was written to the user's settings, and the palette agrees. */
  const assertZen = async (expected: boolean, step: string): Promise<void> => {
    assert.strictEqual(isZenModeEnabled(), expected, `${step}: pages read Zen as ${expected}`);
    const written = levels('display.level').user;
    assert.strictEqual(written === 'zen', expected, `${step}: the user's step is ${String(written)}`);
    assert.strictEqual(deckard().get('display.level') === 'zen', expected, `${step}: the window reads the step as Zen: ${expected}`);
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

        await path.toggle();
        await assertZen(!before, 'the first toggle');
        await path.toggle();
        await assertZen(before, 'the second toggle');

        await path.set(true);
        await assertZen(true, 'enabling');
        await path.set(false);
        await assertZen(false, 'disabling');
        await path.set(true);
        await assertZen(true, 'enabling again');
      });
    }
  }
});
