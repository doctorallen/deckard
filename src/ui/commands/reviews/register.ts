import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { openPeriodicNoteWithReview, writeReviewCommand } from '../review';
import { registerCommand } from '../runCommand';

/** Reviews: the week's and the month's notes, and writing a review into one. */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer, tryNext } = services;
  const { reviews } = services.writes;
  context.subscriptions.push(
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
  );
}
