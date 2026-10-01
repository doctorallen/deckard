import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { setOutlineFollowCursor } from '../../views/outlineTree';
import { settingTarget, writeSetting } from '../settings';

/**
 * The paired commands that turn one setting on and off: the Calendar's day
 * panel, weekends, and repeats, the Outline following the cursor, and zen.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { setZenMode } = services.pageCommands;
  context.subscriptions.push(
    // The day panel is a setting, turned on and off from the Calendar's own
    // menu, and written where it is already set.
    vscode.commands.registerCommand('deckard.calendar.openDayPanel', () =>
      writeSetting('calendar.dayPanel', true, settingTarget('calendar.dayPanel')),
    ),
    vscode.commands.registerCommand('deckard.calendar.closeDayPanel', () =>
      writeSetting('calendar.dayPanel', false, settingTarget('calendar.dayPanel')),
    ),
    // Weekends, and repeats, the same way.
    vscode.commands.registerCommand('deckard.calendar.hideWeekends', () =>
      writeSetting('calendar.showWeekends', false, settingTarget('calendar.showWeekends')),
    ),
    vscode.commands.registerCommand('deckard.calendar.includeWeekends', () =>
      writeSetting('calendar.showWeekends', true, settingTarget('calendar.showWeekends')),
    ),
    vscode.commands.registerCommand('deckard.calendar.showRepeats', () =>
      writeSetting('calendar.showRepeats', true, settingTarget('calendar.showRepeats')),
    ),
    vscode.commands.registerCommand('deckard.calendar.hideRepeats', () =>
      writeSetting('calendar.showRepeats', false, settingTarget('calendar.showRepeats')),
    ),
    vscode.commands.registerCommand('deckard.outline.enableFollowCursor', () =>
      setOutlineFollowCursor(true),
    ),
    vscode.commands.registerCommand('deckard.outline.disableFollowCursor', () =>
      setOutlineFollowCursor(false),
    ),
    vscode.commands.registerCommand('deckard.enableZenMode', () =>
      setZenMode(true),
    ),
    vscode.commands.registerCommand('deckard.disableZenMode', () =>
      setZenMode(false),
    ),
  );
}
