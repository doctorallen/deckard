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
    // Zen's own setter moves Display's step to Zen or back to the step the
    // reader was on, and sets the context key that picks which command the
    // palette and the title bar offer.
    registerCommand('deckard.enableZenMode', () => pageCommands.setZenMode(true)),
    registerCommand('deckard.disableZenMode', () => pageCommands.setZenMode(false)),
    // The Zen button's command: into Zen, or back to the step the reader was on.
    registerCommand('deckard.toggleZen', () => pageCommands.toggleZenMode()),
  );
}
