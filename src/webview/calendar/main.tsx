/**
 * The Calendar view, in the sidebar: a month of weeks, each day saying
 * whether it has a daily note and how many open tasks are due, scheduled,
 * and repeating. Every day, every week, and the month title asks the host
 * to open its note; the host decides what exists and what to create. With
 * `deckard.calendar.dayPanel` on, a click chooses a day for the panel
 * under the month, and a double-click or Enter opens it.
 */
import type { CalendarDay, CalendarMoveRefusedMessage, CalendarSnapshot, CalendarWeek } from '../../ui/protocol/calendar';
import { dispatchAction, onHostMessage, readEmbeddedState } from '../shared/page';
import { announce } from '../shared/status';
import { DayPanel, installDayPanel } from '../shared/calendar/dayPanel';
import { CalendarGrid } from '../shared/calendar/grid';
import {
  type CalendarState,
  dayClasses,
  describeDay,
  type DrawnCalendar,
  dueTone,
  isDrawn,
  markedDate,
  tabStopDate,
  withGroupShown,
} from '../shared/calendar/model';
import { eventElement } from '../shared/calendar/events';
import { CalendarSession, send } from '../shared/calendar/session';

/** The month's title, its note, and the steps to the months either side, and back to today. */
function CalendarHeader({ state }: { readonly state: DrawnCalendar }) {
  const snapshot = state.snapshot;
  const monthLabel = snapshot.title + (snapshot.notePath ? ', monthly note' : '');
  const onToday = snapshot.month === snapshot.currentMonth && (!snapshot.dayPanel || state.drawnSelected === snapshot.today);
  return (
    <div class="calendar-header">
      <button type="button" data-action="show-month" data-month={snapshot.previousMonth} aria-label="Previous month" data-tip="Previous month">‹</button>
      <button type="button" class="calendar-title" data-action="open-month" data-tip={monthLabel} aria-label={monthLabel}>{snapshot.title}</button>
      <button type="button" data-action="show-month" data-month={snapshot.nextMonth} aria-label="Next month" data-tip="Next month">›</button>
      {onToday
        ? null
        : <button type="button" data-action="show-month" data-month={snapshot.currentMonth} data-date={snapshot.dayPanel ? snapshot.today : undefined}>Today</button>}
    </div>
  );
}

/**
 * A day's tip: which tasks and which headings, not only how many, so the
 * right day is found without opening each.
 */
function dayTip(snapshot: CalendarSnapshot, day: CalendarDay, label: string): string {
  return [label]
    .concat((day.dueTitles || []).map((title) => `☐ ${title}`))
    .concat((day.scheduledTitles || []).map((title) => `⏳ ${title}`))
    .concat((day.repeatTitles || []).map((title) => `↻ ${title}`))
    .concat((day.headings || []).map((heading) => `# ${heading}`))
    .concat(snapshot.dayPanel ? ['Double-click or Enter opens the daily note.'] : [])
    .join('\n');
}

/**
 * What a day counts, under its number: the due count, then what is
 * scheduled, outlined, then the repeats. Where both counts run to two
 * digits the second is a ring: a narrow cell has room for one number, and
 * the tip and label keep both.
 */
function DayCounts({ day, tone }: { readonly day: CalendarDay; readonly tone: ReturnType<typeof dueTone> }) {
  const scheduled = day.scheduledCount || 0;
  const repeats = day.repeatCount ?? 0;
  const ring = scheduled > 0 && ((day.dueCount >= 10 && scheduled >= 10) || day.dueCount >= 100 || scheduled >= 100);
  let dueClass = 'due';
  if (tone.overdue) {
    dueClass = 'due overdue';
  } else if (tone.stale) {
    dueClass = 'due stale';
  }
  return (
    <span class="counts" aria-hidden="true">
      <span class={dueClass}>{day.dueCount > 0 ? day.dueCount : null}</span>
      {ring ? <span class="scheduled-ring"></span> : <span class="scheduled-count">{scheduled > 0 ? scheduled : null}</span>}
      {/* The mark alone for one repeat, with a number for more. */}
      <span class="repeat-count">{repeats > 0 ? `↻${repeats > 1 ? repeats : ''}` : null}</span>
    </span>
  );
}

/** What a day of the grid is drawn with. */
interface DayProps {
  readonly state: DrawnCalendar;
  readonly day: CalendarDay;
  /** The day that takes Tab. */
  readonly tabStop: string | undefined;
}

/**
 * A day of the month: its number, whether it has a daily note, and its
 * counts. Both rows under the number are always drawn, empty when there is
 * nothing to mark, so the number sits in the same place in every cell.
 */
function Day({ state, day, tabStop }: DayProps) {
  const snapshot = state.snapshot;
  const tone = dueTone(snapshot, day);
  const selected = Boolean(snapshot.dayPanel) && day.date === markedDate(state);
  const label = describeDay(day, tone);
  return (
    <span class="calendar-cell" role="gridcell" aria-selected={snapshot.dayPanel ? selected : undefined}>
      <button
        type="button"
        class={dayClasses(day, selected)}
        data-action="open-day"
        data-date={day.date}
        data-tip={dayTip(snapshot, day, label)}
        aria-label={label}
        aria-current={day.isToday ? 'date' : undefined}
        tabIndex={day.date === tabStop ? 0 : -1}
      >
        <span class="day-number">{day.day}</span>
        {day.notePath ? <span class="note-dot" aria-hidden="true"></span> : <span aria-hidden="true"></span>}
        <DayCounts day={day} tone={tone} />
      </button>
    </span>
  );
}

/** The sidebar: the month's header, its grid, and the chosen day under it. */
function CalendarView({ state }: { readonly state: DrawnCalendar }) {
  const snapshot = state.snapshot;
  const tabStop = tabStopDate(state, snapshot.weeks);
  const days = (week: CalendarWeek) => week.days.filter((day) => isDrawn(snapshot, day)).map((day) => <Day state={state} day={day} tabStop={tabStop} />);
  // The chosen day under the month, with the panel on.
  const day = snapshot.dayPanel && !snapshot.dayInSidebar ? snapshot.selected : undefined;
  return (
    <>
      <CalendarHeader state={state} />
      <CalendarGrid snapshot={snapshot} weeks={snapshot.weeks} label={snapshot.title} multiselectable={snapshot.dayPanel ? false : undefined} days={days} />
      {day ? <DayPanel day={day} shownGroups={state.shownGroups} /> : null}
    </>
  );
}

const session = new CalendarSession<CalendarState>({
  initial: { snapshot: readEmbeddedState<CalendarSnapshot>(), shownGroups: [] },
  view: (state) => <CalendarView state={state as DrawnCalendar} />,
});

// The listeners, in the order the template script added them: the grid's
// keys, the controls, the day panel's, and the double-click.
document.addEventListener('keydown', session.onGridKey);
document.addEventListener('click', (event) => {
  const target = eventElement(event);
  // The day panel's own controls are installDayPanel's.
  if (!target || target.closest('.day-panel')) {
    return;
  }
  const control = target.closest<HTMLElement>('[data-action]');
  if (!control) {
    return;
  }
  dispatchAction(session.actions, control, event);
});
installDayPanel({
  send,
  opensTags: true,
  showGroup: (group) => session.redraw({ shownGroups: withGroupShown(session.store.state.shownGroups, group) }),
});
// With the panel on, a click chooses a day and a double-click opens it.
document.addEventListener('dblclick', session.onDoubleClick);
// A move the host could not make is said, naming the task and the day
// when its button in the day panel is still drawn, as the page says it.
onHostMessage<CalendarMoveRefusedMessage>('moveRefused', (message) => {
  const button = [...document.querySelectorAll<HTMLElement>('.day-panel [data-action="move-task"]')]
    .find((move) => move.dataset.taskId === message.taskId);
  const title = button?.closest('.task-row')?.querySelector('.task-title')?.textContent;
  announce(button && title ? `"${title}" was not moved to ${String(button.dataset.date)}.` : 'The task was not moved.');
});
send({ type: 'ready' });
