import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { setOutlineFollowCursor } from '../../views/outlineTree';
import { registerCommand } from '../runCommand';
import { settingTarget, writeSetting } from '../settings';
import { listToggleCommands, SETTING_TOGGLES, ToggleCommand } from './settingToggles';

/**
 * The paired commands that turn one setting on and off, one registration
 * per row of SETTING_TOGGLES: the Calendar's day panel and weekends, and
 * the Outline following the cursor; and Zen's, which move Display's step.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { pageCommands } = services;
  context.subscriptions.push(
    ...listToggleCommands(SETTING_TOGGLES).map((command) =>
      registerCommand(command.id, () => writeToggle(command)),
    ),
    // Zen's own setter moves Display's step to Zen or back to the step the
    // reader was on, and sets the context key that picks which command the
    // palette and the title bar offer.
    registerCommand('deckard.enableZenMode', () => pageCommands.setZenMode(true)),
    registerCommand('deckard.disableZenMode', () => pageCommands.setZenMode(false)),
    // The Zen button's command: into Zen, or back to the step the reader was on.
    registerCommand('deckard.toggleZen', () => pageCommands.toggleZenMode()),
  );
}

/**
 * Writes one toggle's value where its target says. The `outline` target is
 * the Outline's own setter, which also sets the context key its title reads.
 */
function writeToggle(command: ToggleCommand): Promise<unknown> {
  switch (command.target) {
    case 'where-set':
      return writeSetting(command.setting, command.value, settingTarget(command.setting));
    case 'outline':
      return setOutlineFollowCursor(command.value);
  }
}
