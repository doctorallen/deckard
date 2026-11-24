import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { openAdjacentDailyNote } from '../dailyNote';
import { openDailyNoteForDate } from '../dailyNoteForDate';
import { createDailyNoteWithRollover, rollTasksForward } from '../rollover';
import { registerCommand } from '../runCommand';
import { startMeeting } from '../startMeeting';
import { PICK_TOP_TASKS_COMMAND, pickTopTasks } from '../topTasks';

/**
 * Daily notes: today's note, another day's, the day before and after,
 * rolling unfinished tasks forward into today, starting a meeting, which
 * today's note links to, and picking the day's top tasks, which it lists.
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
    registerCommand('deckard.startMeeting', () =>
      startMeeting({ indexer, history, rollover }),
    ),
    registerCommand(PICK_TOP_TASKS_COMMAND, () =>
      pickTopTasks({ indexer, history, rollover }),
    ),
    // The Tasks view's Top three group offers the same list as Change….
    registerCommand('deckard.agenda.changeTopTasks', () =>
      pickTopTasks({ indexer, history, rollover }),
    ),
    registerCommand('deckard.previousDailyNote', () =>
      openAdjacentDailyNote(indexer, 'previous'),
    ),
    registerCommand('deckard.nextDailyNote', () =>
      openAdjacentDailyNote(indexer, 'next'),
    ),
  );
}
