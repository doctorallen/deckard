/**
 * The calendar page: a month, or a week, of days large enough to list
 * their tasks by name, with the chosen day's panel beside it. A day's date
 * takes the grid's keys as the sidebar's does; a click anywhere in a day
 * chooses it, a chip opens its task, and a due or scheduled chip can be
 * dragged to another day. `[` and `]` step a month or a week, `t` goes to
 * today, and `m` and `w` choose the layout. The page is not kept running
 * while hidden: it keeps its layout and where it was scrolled to with
 * `setState`, as `{ layout, scrollY }`, and reads a layout an older release
 * kept as before.
 */
import { stepCalendar } from '../../domain/markdown/calendar';
import type { CalendarPageMessage, CalendarSnapshot } from '../../ui/protocol/calendar';
import { installKeySheet } from '../shared/keySheet';
import { type ActionHandler, dispatchAction, readEmbeddedState } from '../shared/page';
import { installDayPanel } from '../shared/calendar/dayPanel';
import { eventElement } from '../shared/calendar/events';
import { isDrawn, selectedDateOf, withGroupShown } from '../shared/calendar/model';
import { CalendarSession, send } from '../shared/calendar/session';
import { announce } from '../shared/status';
import { installViewOptions } from '../shared/viewOptions';
import { rememberScroll, restoreScroll } from '../shared/scroll';
import { keepState, keptState, post, vscodeApi } from '../shared/vscode';
import { clearDragMarks, installTaskDrag } from './drag';
import { CalendarPage, type CalendarLayout, type CalendarPageState, chosenWeek, type DrawnCalendarPage } from './view';

/** Sends the host one of the messages only the calendar page sends. */
function sendPage(message: CalendarPageMessage): void {
  post(message);
}

/** The layout kept from before: the week, if it was kept, else the month. */
function keptLayout(): CalendarLayout {
  return keptState().layout === 'week' ? 'week' : 'month';
}

let scrolled = false;
const session: CalendarSession<CalendarPageState> = new CalendarSession<CalendarPageState>({
  initial: { snapshot: readEmbeddedState<CalendarSnapshot>(), shownGroups: [], layout: keptLayout() },
  view: (state) => <CalendarPage state={state as DrawnCalendarPage} />,
  afterFullDraw: () => {
    clearDragMarks();
    // The first page drawn goes back to where the reader left it, since the
    // page is not kept running while hidden.
    if (scrolled) {
      return;
    }
    scrolled = true;
    restoreScroll(keptState());
  },
  stepsByDay: (): boolean => session.store.state.layout === 'week',
});

/** Draws the page in a layout, and keeps it for the next time the page is drawn. */
function setLayout(next: string | null): void {
  if (next !== 'month' && next !== 'week') {
    return;
  }
  keepState({ layout: next });
  session.redraw({ layout: next });
  announce(next === 'week' ? 'Week layout' : 'Month layout');
}

/**
 * Where the page steps from: the chosen day, or in the Week layout, when
 * the week drawn does not hold it, that week's first day of the month.
 */
function stepFrom(state: CalendarPageState): string {
  const snapshot = state.snapshot as CalendarSnapshot;
  const chosen = selectedDateOf(state) || snapshot.today;
  const week = state.layout === 'week' ? chosenWeek(state as DrawnCalendarPage) : undefined;
  if (!week || week.days.some((day) => day.date === chosen)) {
    return chosen;
  }
  return (week.days.find((day) => day.inMonth && isDrawn(snapshot, day)) ?? week.days[0]).date;
}

/** Steps the page a month or a week, keeping the chosen day's place. */
function step(by: number): void {
  const state = session.store.state;
  const snapshot = state.snapshot as CalendarSnapshot;
  const next = stepCalendar(state.layout, by, {
    date: stepFrom(state),
    previousMonth: snapshot.previousMonth,
    nextMonth: snapshot.nextMonth,
    hideWeekends: Boolean(snapshot.hideWeekends),
  });
  session.focusWhenDrawn(next.date);
  session.sendStep(next.month ? { type: 'showMonth', month: next.month, date: next.date } : { type: 'selectDay', date: next.date });
}

/** Back to today, in its month. */
function goToday(): void {
  const snapshot = session.store.state.snapshot as CalendarSnapshot;
  session.focusWhenDrawn(snapshot.today);
  session.sendStep({ type: 'showMonth', month: snapshot.currentMonth, date: snapshot.today });
}

/** The page's controls, by their `data-action`, after those both calendars draw. */
const ACTIONS: Readonly<Record<string, ActionHandler>> = {
  ...session.actions,
  'set-calendar-layout': (element) => {
    const gear = element.closest<HTMLDetailsElement>('.view-options');
    setLayout(element.getAttribute('data-value'));
    // The template drew the page again under the click, so the gear the
    // click was in was gone and the new one closed: a layout chosen in the
    // gear closes it.
    if (gear) {
      gear.open = false;
    }
  },
  'set-show-repeats': (element) => sendPage({ type: 'setShowRepeats', show: element.getAttribute('data-value') === 'on' }),
  'set-show-weekends': (element) => sendPage({ type: 'setShowWeekends', show: element.getAttribute('data-value') === 'on' }),
  'step-calendar': (element) => step(Number(element.getAttribute('data-by'))),
  'go-today': goToday,
  'open-help': () => sendPage({ type: 'openHelp' }),
};

/** The page's own keys, away from a field and the gear. */
const KEYS: Readonly<Record<string, () => void>> = {
  t: goToday,
  '[': () => step(-1),
  ']': () => step(1),
  m: () => setLayout('month'),
  w: () => setLayout('week'),
};

// The listeners, in the order the template script added them: the grid's
// keys, the controls, the day panel's, the double-click, the gear, the
// page's keys, the key sheet, and the drag.
document.addEventListener('keydown', session.onGridKey);
document.addEventListener('click', (event) => {
  const target = eventElement(event);
  // A task on the page opens where it is written.
  const chip = target?.closest('.cal-chip');
  if (chip) {
    send({ type: 'openTask', taskId: chip.getAttribute('data-task-id') as string });
    return;
  }
  // Anywhere else in a day chooses it, as its date does.
  const cell = target?.closest('.day-cell');
  if (cell && !target?.closest('button, a, input')) {
    const date = cell.getAttribute('data-drop-date') as string;
    session.setFocusDate(date);
    session.selectDay(date);
    return;
  }
  // The day panel's own controls are installDayPanel's.
  const control = target && !target.closest('.day-panel') ? target.closest<HTMLElement>('[data-action]') : null;
  if (!control) {
    return;
  }
  dispatchAction(ACTIONS, control, event);
});
installDayPanel({
  send,
  opensTags: true,
  showGroup: (group) => session.redraw({ shownGroups: withGroupShown(session.store.state.shownGroups, group) }),
});
// With the panel on, a click chooses a day and a double-click opens it.
document.addEventListener('dblclick', session.onDoubleClick);
installViewOptions();
document.addEventListener('keydown', (event) => {
  if (!session.store.state.snapshot || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  if (eventElement(event)?.closest('input, textarea, select, .view-options')) {
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(KEYS, event.key)) {
    return;
  }
  event.preventDefault();
  KEYS[event.key]();
});
installKeySheet([{
  title: 'Calendar',
  keys: [
    ['Arrow keys', 'Move between days'],
    ['Enter', "Open the day's note"],
    ['Page Up, Page Down', 'Previous or next month'],
    ['[ ]', 'Previous or next month or week'],
    ['t', 'Today'],
    ['m, w', 'Month or Week'],
  ],
}]);
// The drag listens for the host's refusals too.
installTaskDrag(session);
// What the page keeps across a hide or a reload: its layout, kept when the
// reader chooses one, and where it was scrolled to, at most every 200 ms.
rememberScroll(keptState, (value) => vscodeApi().setState(value));
send({ type: 'ready' });
