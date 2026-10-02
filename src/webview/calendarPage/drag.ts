/**
 * A due or scheduled task dragged to another day takes that date. The chip
 * waits, faded, until the note is written and the page drawn again; the
 * host says so if it could not move it.
 *
 * The marks a drag leaves, `dragging` on the chip and `drop-target` on the
 * day under it, are set on the elements directly, as the template script
 * set them; a full draw takes them away, as the template's redraw did
 * (`clearDragMarks`). A chip a full draw has drawn again since the drag
 * began is not marked on the drop, as the template's replaced chip was not.
 */
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
      liveChip(drag)?.classList.add('is-pending');
      send({ type: 'moveTask', taskId: drag.taskId, field: drag.field, date });
      announce(`Moved "${drag.text.replace(/^[↻⏳ ]+/, '')}" to ${date}.`);
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
}
