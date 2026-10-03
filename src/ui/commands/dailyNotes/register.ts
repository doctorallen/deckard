import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { openAdjacentDailyNote } from '../dailyNote';
import { openDailyNoteForDate } from '../dailyNoteForDate';
import { createDailyNoteWithRollover, rollTasksForward } from '../rollover';
import { registerCommand } from '../runCommand';

/**
 * Daily notes: today's note, another day's, the day before and after, and
 * rolling unfinished tasks forward into today.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer, history } = services;
  const { rollover } = services.writes;
  context.subscriptions.push(
    registerCommand('deckard.createDailyNote', () =>
      createDailyNoteWithRollover(indexer, history, undefined, rollover),
    ),
    registerCommand('deckard.openDailyNoteForDate', () =>
      openDailyNoteForDate(indexer, history),
    ),
    registerCommand('deckard.rollTasksForward', () =>
      rollTasksForward(indexer, rollover),
    ),
    registerCommand('deckard.previousDailyNote', () =>
      openAdjacentDailyNote(indexer, 'previous'),
    ),
    registerCommand('deckard.nextDailyNote', () =>
      openAdjacentDailyNote(indexer, 'next'),
    ),
  );
}
