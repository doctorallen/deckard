/**
 * A due or scheduled task dragged to another day takes that date. The chip
 * waits, faded, until the note is written and the page drawn again; the
 * host says so if it could not move it. Each move is numbered, and a
 * refusal carries the number back, so the page names the move refused and
 * puts back its chip, though the same task was dragged again since.
 *
 * The marks a drag leaves, `dragging` on the chip and `drop-target` on the
 * day under it, are set on the elements directly, as the template script
 * set them; a full draw takes them away, as the template's redraw did
 * (`clearDragMarks`). A chip a full draw has drawn again since the drag
 * began is not marked on the drop, as the template's replaced chip was not.
 */
import type { CalendarMoveRefusedMessage } from '../../ui/protocol/calendar';
import { onHostMessage } from '../shared/page';
import { announce } from '../shared/status';
import { eventElement } from '../shared/calendar/events';
import type { CalendarSession } from '../shared/calendar/session';
import { send } from '../shared/calendar/session';
import type { CalendarPageState } from './view';

/** The task being dragged, the day it came from, and its chip as drawn. */
interface Dragged {
  readonly taskId: string;
  readonly field: 'due' | 'scheduled';
  readonly from: string | undefined;
  readonly chip: HTMLElement;
  /** The chip's words, as they were when the drag began. */
  readonly text: string;
  /** The full draws there had been when the drag began. */
  readonly draws: number;
}

/** A move sent and not answered yet: its task, its chip while drawn, and what was moved where. */
interface SentMove {
  readonly taskId: string;
  /** The chip it faded, unless a full draw had drawn the chip again since the drag began. */
  readonly chip: HTMLElement | undefined;
  /** The full draws there had been when it was sent. */
  readonly draws: number;
  /** The task's words, as its chip showed them. */
  readonly title: string;
  readonly date: string;
}

/**
 * How many moves are kept for a refusal to find. A move that is written is
 * never answered, so the oldest are let go; a refusal comes long before
 * this many more drags.
 */
const SENT_MOVES_KEPT = 20;

/** The moves a page has sent, numbered, kept for a refusal to find. */
interface SentMoves {
  /** Keeps a move under the next number, and returns the number. */
  add(move: SentMove): number;
  /** Puts back the chip of the move a refusal names, and says which move it was. */
  refuse(message: CalendarMoveRefusedMessage): void;
}

/**
 * The moves sent and not refused, by number, oldest first. The state that
 * follows a refusal draws every chip where its task is; until it does, the
 * refused move's chip stops waiting, unless a later move of it still
 * waits. A refusal with no number, or one for a move no longer kept, is
 * said as it was before moves were numbered.
 */
function createSentMoves(session: CalendarSession<CalendarPageState>): SentMoves {
  let lastMoveRequestId = 0;
  const sent = new Map<number, SentMove>();
  return {
    add: (move) => {
      lastMoveRequestId += 1;
      sent.set(lastMoveRequestId, move);
      if (sent.size > SENT_MOVES_KEPT) {
        sent.delete(sent.keys().next().value as number);
      }
      return lastMoveRequestId;
    },
    refuse: (message) => {
      const move = message.requestId === undefined ? undefined : sent.get(message.requestId);
      if (!move || move.taskId !== message.taskId) {
        announce('The task was not moved.');
        return;
      }
      sent.delete(message.requestId as number);
      const waiting = [...sent.values()].some((other) => other.chip === move.chip);
      if (move.chip && move.draws === session.draws && !waiting) {
        move.chip.classList.remove('is-pending');
      }
      announce(`"${move.title}" was not moved to ${move.date}.`);
    },
  };
}

/** Takes away the marks a drag left, as a full draw of the template did. */
export function clearDragMarks(): void {
  document.querySelectorAll('.cal-chip.dragging, .cal-chip.is-pending').forEach((chip) => chip.classList.remove('dragging', 'is-pending'));
  clearDrop();
}

/** Takes the drop mark off every day. */
function clearDrop(): void {
  document.querySelectorAll('.day-cell.drop-target').forEach((cell) => cell.classList.remove('drop-target'));
}

/** Wires dragging a task from one day to another, once. */
export function installTaskDrag(session: CalendarSession<CalendarPageState>): void {
  let dragged: Dragged | undefined;
  const moves = createSentMoves(session);
  /** The chip as the page draws it now, unless a full draw has drawn it again since. */
  const liveChip = (drag: Dragged): HTMLElement | undefined => (drag.draws === session.draws ? drag.chip : undefined);
  document.addEventListener('dragstart', (event) => {
    const moving = eventElement(event)?.closest<HTMLElement>('.cal-chip[draggable="true"]');
    if (!moving) {
      return;
    }
    const cell = moving.closest('.day-cell');
    dragged = {
      taskId: moving.getAttribute('data-task-id') as string,
      field: moving.getAttribute('data-kind') === 'scheduled' ? 'scheduled' : 'due',
      from: cell ? (cell.getAttribute('data-drop-date') as string) : undefined,
      chip: moving,
      text: moving.textContent || '',
      draws: session.draws,
    };
    moving.classList.add('dragging');
    if (!event.dataTransfer) {
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragged.taskId);
  });
  document.addEventListener('dragover', (event) => {
    const cell = dragged ? eventElement(event)?.closest('.day-cell') : null;
    if (!cell) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    if (cell.classList.contains('drop-target')) {
      return;
    }
    clearDrop();
    cell.classList.add('drop-target');
  });
  document.addEventListener('drop', (event) => {
    const drag = dragged;
    const cell = drag ? eventElement(event)?.closest('.day-cell') : null;
    if (!drag || !cell) {
      return;
    }
    event.preventDefault();
    clearDrop();
    const date = cell.getAttribute('data-drop-date');
    if (date && date !== drag.from) {
      const chip = liveChip(drag);
      const title = drag.text.replace(/^[↻⏳ ]+/, '');
      chip?.classList.add('is-pending');
      const requestId = moves.add({ taskId: drag.taskId, chip, draws: session.draws, title, date });
      send({ type: 'moveTask', taskId: drag.taskId, field: drag.field, date, requestId });
      announce(`Moved "${title}" to ${date}.`);
    }
    liveChip(drag)?.classList.remove('dragging');
    dragged = undefined;
  });
  document.addEventListener('dragend', () => {
    clearDrop();
    if (dragged) {
      liveChip(dragged)?.classList.remove('dragging');
    }
    dragged = undefined;
  });
  onHostMessage<CalendarMoveRefusedMessage>('moveRefused', moves.refuse);
}
