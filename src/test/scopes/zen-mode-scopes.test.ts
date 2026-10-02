import * as assert from 'assert';

import { isZenModeEnabled, syncZenModeContext, zenModeContextKey } from '../../ui/webview/zenMode';
import { activateDeckard, clearEverywhere, isMultiRoot, Level, recordContextKeys, setAt, settled } from './scopes';

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
  }
});
