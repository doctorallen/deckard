import * as assert from 'assert';

import * as vscode from 'vscode';

import { setZenMode as zenHandler } from '../../ui/webview/host/sharedHandlers';
import { isZenModeEnabled, syncZenModeContext, zenModeContextKey } from '../../ui/webview/zenMode';
import { activateDeckard, deckard, isMultiRoot, levels, recordContextKeys, setAt, settled } from './scopes';

/** The step set in the user's settings before a test turns Zen on and off. */
interface Arrangement {
  name: string;
  step?: 'quiet' | 'zen';
}

const ARRANGEMENTS: Arrangement[] = [
  { name: 'no step set' },
  { name: 'Zen set', step: 'zen' },
  { name: 'Quiet set', step: 'quiet' },
];

/** How a reader turns zen on and off: the palette's two commands, or a page's gear. */
interface Path {
  name: string;
  set(enabled: boolean): Thenable<unknown>;
  /** Turns zen the other way, as the reader is offered it. */
  toggle(): Thenable<unknown>;
}

/**
 * Zen is Display's Zen step, in the user's settings, where every Display
 * setting is. Whatever step is set, turning Zen on or off has to write the
 * step there and change what the pages show, a second turn has to undo it,
 * and the palette and the title bar have to offer the command that changes
 * something, through the context key the step sets.
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
   * Sets the step the arrangement says, as a reader editing settings.json
   * would, and returns whether Zen is then in force, once the context key
   * the palette reads agrees with it.
   */
  const arrange = async (arrangement: Arrangement): Promise<boolean> => {
    await setAt('display.level', 'user', arrangement.step);
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
