import * as path from 'path';

import { isOpenTask } from '../../domain/tasks/taskStatuses';
import * as vscode from 'vscode';

import { noteTitle } from '../../domain/index/backlinks';
import { Weekday } from '../../domain/markdown/dates';
import {
  chooseTryNext,
  TRY_NEXT_SNOOZE_MS,
  TryNextInput,
  TryNextSuggestion,
} from '../state/tryNext';
import { findPeriodicNoteNames, listDailyNotes } from '../../domain/notes/periodicNotes';
import { findTagMergeCandidates } from '../../domain/ranking/tagHygiene';
import { PersistedPreferences, WorkspaceIndex } from '../../domain/model';

/**
 * What Home's Try next has been told: suggestions retired for good, and ones
 * put off until a time. Kept with the workspace, since what a workspace's
 * notes are ready for is the workspace's.
 */
export const TRY_NEXT_RETIRED = 'deckard.tryNext.retired';
export const TRY_NEXT_SNOOZED = 'deckard.tryNext.snoozed';

/**
 * What Home's Try next has been told, read and written in the workspace's
 * memento, so a suggestion taken up or put off stays that way across
 * windows of the same workspace.
 */
export class TryNextLedger implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** Fires when a suggestion is retired or put off, so Home redraws. */
  public readonly onDidChange = this.changeEmitter.event;

  /** Over the workspace's memento, under TRY_NEXT_RETIRED and TRY_NEXT_SNOOZED. */
  public constructor(private readonly state: vscode.Memento) {}

  /** The suggestions never to offer again; a new set, so changing it writes nothing. */
  public retired(): Set<string> {
    return new Set(this.state.get<string[]>(TRY_NEXT_RETIRED, []));
  }

  /** When each suggestion put off may be offered again, in epoch milliseconds. */
  public snoozed(): Record<string, number> {
    return this.state.get<Record<string, number>>(TRY_NEXT_SNOOZED, {});
  }

  /** Never suggest this again: its command has run, or the reader said so. */
  public async retire(key: string): Promise<void> {
    const retired = this.retired();
    if (retired.has(key)) {
      return;
    }
    retired.add(key);
    await this.state.update(TRY_NEXT_RETIRED, [...retired]);
    this.changeEmitter.fire();
  }

  /** Not now: put it off for a week. */
  public async snooze(key: string, now = Date.now()): Promise<void> {
    await this.state.update(TRY_NEXT_SNOOZED, { ...this.snoozed(), [key]: now + TRY_NEXT_SNOOZE_MS });
    this.changeEmitter.fire();
  }

  /** Stops onDidChange; what was stored stays. */
  public dispose(): void {
    this.changeEmitter.dispose();
  }
}

/** Two weeks, the span a note's opens are counted over. */
const FORTNIGHT_MS = 14 * 24 * 60 * 60 * 1000;

/** What the rules read, gathered from the index and what Deckard remembers. */
export function collectTryNextInput(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  weekStart: Weekday,
  now: number,
): TryNextInput {
  const today = new Date(now);
  const lastWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
  const weekNames = new Set(findPeriodicNoteNames('week', lastWeek, weekStart));
  const hasLastWeekNote = [...index.files.keys()].some((filePath) =>
    weekNames.has(path.posix.basename(filePath, '.md')),
  );
  const [pair] = findTagMergeCandidates(index, 1).candidates;
  // A note's opens are its sections' opens, when one was opened lately.
  const opens = new Map<string, { opens: number; line: number }>();
  for (const [sectionId, times] of Object.entries(preferences.sectionAccessCounts ?? {})) {
    const section = index.sections.get(sectionId);
    const last = preferences.sectionAccessTimes?.[sectionId] ?? 0;
    if (!section || now - last > FORTNIGHT_MS) {
      continue;
    }
    const seen = opens.get(section.filePath);
    opens.set(section.filePath, {
      opens: (seen?.opens ?? 0) + times,
      line: seen?.line ?? section.startLine,
    });
  }
  const [frequent] = [...opens.entries()].sort((left, right) => right[1].opens - left[1].opens);
  return {
    weekStart,
    dailyNoteDates: listDailyNotes(index).map((entry) => entry.date),
    hasLastWeekNote,
    ...(pair
      ? {
          lookalike: {
            sourceKey: pair.sourceKey,
            sourceLabel: pair.sourceLabel,
            targetKey: pair.targetKey,
            targetLabel: pair.targetLabel,
          },
        }
      : {}),
    openTasks: [...index.tasks.values()].filter(isOpenTask).length,
    ...(frequent
      ? {
          frequentNote: {
            filePath: frequent[0],
            title: noteTitle(frequent[0]),
            line: frequent[1].line,
            opens: frequent[1].opens,
          },
        }
      : {}),
    hasPins: (preferences.pinnedNotes ?? []).length > 0,
  };
}

/** What Home's suggestion is chosen from. */
export interface TryNextSources {
  /** The suggestions already taken up or put off. */
  ledger: Pick<TryNextLedger, 'retired' | 'snoozed'>;
  index: WorkspaceIndex;
  preferences: PersistedPreferences;
  weekStart: Weekday;
  now: number;
}

/** The suggestion Home shows now, if any. */
export function suggestTryNext({ ledger, index, preferences, weekStart, now }: TryNextSources): TryNextSuggestion | undefined {
  return chooseTryNext(
    collectTryNextInput(index, preferences, weekStart, now),
    ledger.retired(),
    ledger.snoozed(),
    now,
  );
}

/**
 * Runs a suggestion's action. The command is looked up from the suggestion
 * the host itself made, never taken from the page.
 */
export async function runTryNext(
  suggestion: TryNextSuggestion,
  input: TryNextInput,
  host: {
    run: (command: string, ...args: unknown[]) => Thenable<unknown>;
    /** Pins a note to Home, as Pin Note to Home would from its editor. */
    pin: (filePath: string, line: number) => Promise<unknown>;
  },
): Promise<void> {
  const { run } = host;
  switch (suggestion.id) {
    case 'weeklyReview':
      await run('deckard.writeReview');
      return;
    case 'mergeLookalike':
      if (input.lookalike) {
        await run('deckard.mergeTag', input.lookalike.sourceKey, input.lookalike.targetKey);
      }
      return;
    case 'taskBoard':
      await run('deckard.showTaskBoard');
      return;
    case 'pinNote':
      if (input.frequentNote) {
        await host.pin(input.frequentNote.filePath, input.frequentNote.line);
      }
      return;
  }
}
