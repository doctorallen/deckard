import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { openAdjacentDailyNote } from '../dailyNote';
import { openDailyNoteForDate } from '../dailyNoteForDate';
import { noteActionsCommand } from '../noteActions';
import { setNotePinnedCommand } from '../pinNote';
import { openPeriodicNoteWithReview, writeReviewCommand } from '../review';
import { createDailyNoteWithRollover, rollTasksForward } from '../rollover';
import { registerCommand } from '../runCommand';

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
    registerCommand('deckard.noteActions', () =>
      noteActionsCommand({ index: indexer, preferences: pins }),
    ),
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
    registerCommand('deckard.openWeeklyNote', () =>
      openPeriodicNoteWithReview(indexer, reviews, 'week'),
    ),
    registerCommand('deckard.openMonthlyNote', () =>
      openPeriodicNoteWithReview(indexer, reviews, 'month'),
    ),
    registerCommand('deckard.writeReview', async () => {
      await writeReviewCommand(indexer, reviews);
      await tryNext.retire('weeklyReview');
    }),
    // The hover on a tagged entry passes the line it was shown on, so it
    // pins that entry rather than wherever the cursor happens to be.
    registerCommand(
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
    registerCommand(
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
    registerCommand('deckard.undoLastChange', () =>
      history.undoLast(() => indexer.refresh()),
    ),
  );
}
