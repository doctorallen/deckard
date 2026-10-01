import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { openAdjacentDailyNote } from '../dailyNote';
import { openDailyNoteForDate } from '../dailyNoteForDate';
import { noteActionsCommand } from '../noteActions';
import { setNotePinnedCommand } from '../pinNote';
import { openPeriodicNoteWithReview, writeReviewCommand } from '../review';
import { createDailyNoteWithRollover, rollTasksForward } from '../rollover';

/**
 * Notes and daily notes: Note Actions, today's and other days' notes,
 * rolling tasks forward, the week's and month's notes and their review,
 * pinning, and Undo Last Change.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer, history, tryNext } = services;
  const { rollover, reviews } = services.writes;
  const pins = services.preferences.pins;
  context.subscriptions.push(
    vscode.commands.registerCommand('deckard.noteActions', () =>
      noteActionsCommand({ index: indexer, preferences: pins }),
    ),
    vscode.commands.registerCommand('deckard.createDailyNote', () =>
      createDailyNoteWithRollover(indexer, history, undefined, rollover),
    ),
    vscode.commands.registerCommand('deckard.openDailyNoteForDate', () =>
      openDailyNoteForDate(indexer, history),
    ),
    vscode.commands.registerCommand('deckard.rollTasksForward', () =>
      rollTasksForward(indexer, rollover),
    ),
    vscode.commands.registerCommand('deckard.previousDailyNote', () =>
      openAdjacentDailyNote(indexer, 'previous'),
    ),
    vscode.commands.registerCommand('deckard.nextDailyNote', () =>
      openAdjacentDailyNote(indexer, 'next'),
    ),
    vscode.commands.registerCommand('deckard.openWeeklyNote', () =>
      openPeriodicNoteWithReview(indexer, reviews, 'week'),
    ),
    vscode.commands.registerCommand('deckard.openMonthlyNote', () =>
      openPeriodicNoteWithReview(indexer, reviews, 'month'),
    ),
    vscode.commands.registerCommand('deckard.writeReview', async () => {
      await writeReviewCommand(indexer, reviews);
      await tryNext.retire('weeklyReview');
    }),
    // The hover on a tagged entry passes the line it was shown on, so it
    // pins that entry rather than wherever the cursor happens to be.
    vscode.commands.registerCommand(
      'deckard.pinNote',
      async (documentUri?: unknown, line?: unknown) => {
        const pinned = await setNotePinnedCommand(
          indexer,
          pins,
          true,
          typeof documentUri === 'string' ? documentUri : undefined,
          typeof line === 'number' ? line : undefined,
        );
        if (pinned) {
          await tryNext.retire('pinNote');
        }
        return pinned;
      },
    ),
    vscode.commands.registerCommand(
      'deckard.unpinNote',
      (documentUri?: unknown, line?: unknown) =>
        setNotePinnedCommand(
          indexer,
          pins,
          false,
          typeof documentUri === 'string' ? documentUri : undefined,
          typeof line === 'number' ? line : undefined,
        ),
    ),
    vscode.commands.registerCommand('deckard.undoLastChange', () =>
      history.undoLast(() => indexer.refresh()),
    ),
  );
}
