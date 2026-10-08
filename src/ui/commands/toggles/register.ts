import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { registerCommand } from '../runCommand';
import { listToggleCommands, VIEW_TOGGLES } from './viewToggles';

/**
 * The paired commands that turn one view choice on and off, one
 * registration per row of VIEW_TOGGLES: the Calendar's day panel and
 * weekends, and the Outline following the cursor, each kept in the
 * preferences; and Zen's, which move Display's step.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { pageCommands, preferences } = services;
  context.subscriptions.push(
    ...listToggleCommands(VIEW_TOGGLES).map((command) =>
      registerCommand(command.id, () => preferences.display.setViewChoice(command.choice, command.value)),
    ),
    // Zen's own setter turns Zen on or off, and sets the context key that
    // picks which of the pair the title bar offers.
    registerCommand('deckard.enableZenMode', () => pageCommands.setZenMode(true)),
    registerCommand('deckard.disableZenMode', () => pageCommands.setZenMode(false)),
    // The palette's one Zen command: on, or off again.
    registerCommand('deckard.toggleZen', () => pageCommands.toggleZenMode()),
  );
}
