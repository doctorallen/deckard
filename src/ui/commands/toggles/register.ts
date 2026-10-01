import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { setOutlineFollowCursor } from '../../views/outlineTree';
import { settingTarget, writeSetting } from '../settings';
import { registerCommand } from '../runCommand';

/**
 * The paired commands that turn one setting on and off: the Calendar's day
 * panel, weekends, and repeats, the Outline following the cursor, and zen.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { setZenMode } = services.pageCommands;
  context.subscriptions.push(
    // The day panel is a setting, turned on and off from the Calendar's own
    // menu, and written where it is already set.
    registerCommand('deckard.calendar.openDayPanel', () =>
      writeSetting('calendar.dayPanel', true, settingTarget('calendar.dayPanel')),
    ),
    registerCommand('deckard.calendar.closeDayPanel', () =>
      writeSetting('calendar.dayPanel', false, settingTarget('calendar.dayPanel')),
    ),
    // Weekends, and repeats, the same way.
    registerCommand('deckard.calendar.hideWeekends', () =>
      writeSetting('calendar.showWeekends', false, settingTarget('calendar.showWeekends')),
    ),
    registerCommand('deckard.calendar.includeWeekends', () =>
      writeSetting('calendar.showWeekends', true, settingTarget('calendar.showWeekends')),
    ),
    registerCommand('deckard.calendar.showRepeats', () =>
      writeSetting('calendar.showRepeats', true, settingTarget('calendar.showRepeats')),
    ),
    registerCommand('deckard.calendar.hideRepeats', () =>
      writeSetting('calendar.showRepeats', false, settingTarget('calendar.showRepeats')),
    ),
    registerCommand('deckard.outline.enableFollowCursor', () =>
      setOutlineFollowCursor(true),
    ),
    registerCommand('deckard.outline.disableFollowCursor', () =>
      setOutlineFollowCursor(false),
    ),
    registerCommand('deckard.enableZenMode', () =>
      setZenMode(true),
    ),
    registerCommand('deckard.disableZenMode', () =>
      setZenMode(false),
    ),
  );
}
