/**
 * A chosen day of the calendar: its daily note, the tasks due, scheduled,
 * repeating, and done that day, and the notes created on it.
 *
 * The calendar page draws it beside the month, the sidebar Calendar under
 * it, and Related Notes in its own pane while the calendar page is in
 * front. Each page's sheet imports `shared/calendarDay.css`, draws
 * `<DayPanel>`, and calls `installDayPanel` once with how it posts to its
 * host, since Related Notes posts through its own host to the calendar's.
 */
import type { CalendarDayDetail, CalendarMessage } from '../../../ui/protocol/calendar';
import type { DashboardTask } from '../../../ui/protocol/shared';
import { announce } from '../status';
import { CalendarIcon } from './calendarIcon';
import { eventElement } from './events';
import { TaskListRow } from '../taskRow';

/** How many of a group's tasks are listed before Show more. */
const DAY_ROWS = 5;

/** Where a row's button moves a task: tomorrow, or a day on from a later day. */
type DayMove = CalendarDayDetail['move'];

/** One task in the panel, with the button that moves it a day on. */
function DayTask({ item, field, move }: { readonly item: DashboardTask; readonly field?: 'due' | 'scheduled' | 'repeat'; readonly move?: DayMove }) {
  // A repeat's later date is opened from here, and completed where it is
  // written, on its current date.
  if (field === 'repeat') {
    return <TaskListRow item={item} leading={<span class="repeat-mark" aria-hidden="true">↻</span>} />;
  }
  const trailing = field && move
    ? (
      <button
        type="button"
        class="day-move"
        data-action="move-task"
        data-task-id={item.task.id}
        data-field={field}
        data-date={move.date}
        aria-label={`Move "${item.task.title}" to ${move.label === 'Tomorrow' ? 'tomorrow, ' : 'the next day, '}${move.date}`}
      >
        {move.label}
      </button>
    )
    : null;
  return <TaskListRow item={item} trailing={trailing} />;
}

/** What a group of the day's tasks is drawn with. */
interface TaskGroupProps {
  readonly id: string;
  readonly label: string;
  readonly items: readonly DashboardTask[] | undefined;
  readonly field: 'due' | 'scheduled' | 'repeat';
  readonly move?: DayMove;
  readonly shownGroups: readonly string[];
}

/** One group of the day's tasks, its first five and Show more, or all once asked. */
function TaskGroup(props: TaskGroupProps) {
  const items = props.items;
  if (!items || !items.length) {
    return null;
  }
  const shown = props.shownGroups.includes(props.id) ? items : items.slice(0, DAY_ROWS);
  const more = items.length - shown.length;
  return (
    <section class="day-group" aria-label={props.label}>
      <h3>{`${props.label} (${items.length})`}</h3>
      <div class="task-list">
        {shown.map((item) => <DayTask item={item} field={props.field} move={props.move} />)}
      </div>
      {more > 0 ? <button type="button" class="day-more text-button" data-action="show-group" data-group={props.id}>{`Show ${more} more`}</button> : null}
    </section>
  );
}

/** What was finished that day, folded: unchecking one reopens it. */
function DoneGroup({ done }: { readonly done: readonly DashboardTask[] | undefined }) {
  if (!done || !done.length) {
    return null;
  }
  return (
    <details class="day-group">
      <summary>{`Done (${done.length})`}</summary>
      <div class="task-list">{done.map((item) => <DayTask item={item} />)}</div>
    </details>
  );
}

/** The notes written that day, by their titles, with Search all for the rest. */
function CreatedGroup({ day }: { readonly day: CalendarDayDetail }) {
  if (!day.notes || !day.notes.length) {
    return null;
  }
  const rest = day.notesTotal - day.notes.length;
  return (
    <section class="day-group" aria-label="Notes created">
      <h3>{`Notes created (${day.notesTotal})`}</h3>
      <ul class="day-notes">
        {day.notes.map((note) => (
          <li>
            <button type="button" class="day-created" data-action="open-note" data-file-path={note.filePath}>
              <span class="day-created-title">{note.title}</span>
              {note.folder ? <span class="day-created-folder">{note.folder}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {rest > 0
        ? (
          <button type="button" class="day-more" data-action="search-created" data-date={day.date} aria-label={`Search the ${day.notesTotal} notes created on ${day.date}`}>
            {`Search all ${day.notesTotal}`}
          </button>
        )
        : null}
    </section>
  );
}

/** The day's daily note, to open, or the offer to create it. */
function DayNote({ day }: { readonly day: CalendarDayDetail }) {
  if (day.notePath) {
    return (
      <button type="button" class="day-note" data-action="open-note" data-file-path={day.notePath} aria-label={`Open the daily note for ${day.date}`}>
        <CalendarIcon />
        <span class="day-note-label">Daily note</span>
        <span class="day-note-action">Open</span>
      </button>
    );
  }
  return (
    <div class="day-note-line">
      <span class="day-note-label">No daily note yet</span>
      <button type="button" data-action="create-day" data-date={day.date} aria-label={`Create the daily note for ${day.date}`}>Create</button>
    </div>
  );
}

/** What a day panel is drawn with. */
export interface DayPanelProps {
  readonly day: CalendarDayDetail;
  /** The groups the reader asked to see whole: `due`, `scheduled`, or `repeats`. */
  readonly shownGroups: readonly string[];
}

/**
 * A chosen day, as the calendar and Related Notes show it: its title and
 * its daily note, then what is on it, or Nothing due or scheduled. Each
 * group is keyed, so one group is never drawn into another's element.
 */
export function DayPanel({ day, shownGroups }: DayPanelProps) {
  const title = day.title + (day.relative ? ` · ${day.relative}` : '');
  const hasTasks = Boolean(day.due?.length || day.scheduled?.length || day.repeats?.length);
  return (
    <section class="day-panel" aria-labelledby="day-title">
      <h2 id="day-title">{title}</h2>
      <DayNote day={day} />
      {hasTasks ? null : <p key="empty" class="empty">Nothing due or scheduled.</p>}
      <TaskGroup key="due" id="due" label="Due" items={day.due} field="due" move={day.move} shownGroups={shownGroups} />
      <TaskGroup key="scheduled" id="scheduled" label="Scheduled" items={day.scheduled} field="scheduled" move={day.move} shownGroups={shownGroups} />
      <TaskGroup key="repeats" id="repeats" label="Repeats" items={day.repeats} field="repeat" shownGroups={shownGroups} />
      <DoneGroup key="done" done={day.done} />
      <CreatedGroup key="created" day={day} />
    </section>
  );
}

/** What the day panel's controls do, besides posting: show a group whole. */
export interface DayPanelHandlers {
  /** Posts a calendar message, to the calendar's host or through Related Notes'. */
  readonly send: (message: CalendarMessage) => void;
  /** Shows a group whole, and draws the page again. */
  readonly showGroup: (group: string) => void;
}

/** Runs a panel control's action, by its `data-action`. */
function runPanelAction(target: Element, handlers: DayPanelHandlers): void {
  const action = target.getAttribute('data-action');
  const value = (name: string): string => target.getAttribute(name) as string;
  if (action === 'open-note') {
    handlers.send({ type: 'openNote', filePath: value('data-file-path') });
  } else if (action === 'move-task') {
    handlers.send({ type: 'moveTask', taskId: value('data-task-id'), field: value('data-field') as 'due' | 'scheduled', date: value('data-date') });
  } else if (action === 'create-day') {
    handlers.send({ type: 'createDay', date: value('data-date') });
  } else if (action === 'search-created') {
    handlers.send({ type: 'searchCreated', date: value('data-date') });
  } else if (action === 'show-group') {
    handlers.showGroup(value('data-group'));
  }
}

/**
 * Wires every day panel on the page, once: a row opens its task, its
 * checkbox completes or reopens it, its button moves it on, and the
 * panel's note, create, search, and show-more controls do what they say.
 * The listeners sit on the document, so the page may draw its panel freely.
 */
export function installDayPanel(handlers: DayPanelHandlers): void {
  document.addEventListener('click', (event) => {
    const target = eventElement(event);
    if (!target || !target.closest('.day-panel')) {
      return;
    }
    const control = target.closest('[data-action]');
    if (!control || control.getAttribute('data-action') === 'toggle-task') {
      const row = target.closest('.task-row');
      if (row && !target.closest('input, button')) {
        handlers.send({ type: 'openTask', taskId: row.getAttribute('data-task-id') as string });
      }
      return;
    }
    runPanelAction(control, handlers);
  });
  document.addEventListener('keydown', (event) => {
    const target = event.target as Element | null;
    if (!target || !target.matches || !target.matches('.day-panel .task-row') || event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    handlers.send({ type: 'openTask', taskId: target.getAttribute('data-task-id') as string });
  });
  // A task's checkbox completes it, or reopens it in Done.
  document.addEventListener('change', (event) => {
    const box = event.target as HTMLInputElement | null;
    if (!box || !box.matches || !box.matches('.day-panel [data-action="toggle-task"]')) {
      return;
    }
    const row = box.closest('.task-row');
    const title = row ? row.querySelector('.task-title') : null;
    handlers.send({ type: 'toggleTask', taskId: box.getAttribute('data-task-id') as string, completed: box.checked });
    announce(`${box.checked ? 'Completed "' : 'Reopened "'}${title ? title.textContent : 'the task'}".`);
  });
}
