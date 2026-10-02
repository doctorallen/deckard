/**
 * What the Task Board draws from, and what its board keeps between draws
 * outside the store: the template's globals, each said for what it is.
 */
import type { TaskBoardSnapshot } from '../../ui/protocol/taskBoard';
import type { ActionMenuGroup } from '../shared/actionMenu';

/** The page's store: the host's last snapshot, undefined until the first arrives. */
export interface BoardPageState {
  readonly snapshot: TaskBoardSnapshot | undefined;
}

/** The state with a snapshot to draw, which is all the page's parts ever see. */
export type DrawnBoard = BoardPageState & { readonly snapshot: TaskBoardSnapshot };

/**
 * What the board keeps across draws, as the template's script kept it: the
 * card that is the board's one Tab stop, the card being dragged, how long a
 * completed card lingers, the menu each drawn card opens, and how many times
 * a list was changed outside a draw.
 */
export const board: {
  /** The card that is the board's one Tab stop, by its key: column and task. */
  tabStop: string | undefined;
  /** The task of the card being dragged, and the column it was in. */
  dragId: string | undefined;
  dragColumn: string | undefined;
  /** Until when a card just completed stays on screen before the next draw. */
  lingerUntil: number;
  /** The moves each drawn card's menu offers, by card key, made as the board is drawn. */
  moves: Record<string, ActionMenuGroup[]>;
  /**
   * Counts the times a list of cards or rows was changed outside a draw: a
   * card moved at once, marked completing, or dragged, or a ranked row
   * dragged. The lists are keyed by it, so the next draw makes them afresh,
   * as the template's draws always did, rather than patching elements the
   * page moved.
   */
  generation: number;
} = { tabStop: undefined, dragId: undefined, dragColumn: undefined, lingerUntil: 0, moves: {}, generation: 0 };

/** Says a list was changed outside a draw, so the next draw makes the lists afresh. */
export function listsChanged(): void {
  board.generation += 1;
}

/**
 * A card's key: its column and its task. A task with two tags in the
 * namespace the board is grouped by is two cards, and each is found,
 * moved, and focused as itself.
 */
export function boardCardKey(columnId: string, taskId: string): string {
  return `${String(columnId)}\u0000${String(taskId)}`;
}

/** The key of a drawn card. */
export function cardKeyOf(card: HTMLElement): string {
  return boardCardKey(String(card.dataset.cardColumn), String(card.dataset.taskId));
}

/**
 * How long the next draw should wait for a completed card to finish
 * leaving. A card that vanished the moment its box was ticked left the
 * reader unsure they had ticked the right one.
 */
export function lingerRemaining(): number {
  return Math.max(0, board.lingerUntil - Date.now());
}
