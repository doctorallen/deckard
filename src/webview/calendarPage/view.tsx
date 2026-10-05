/**
 * What the calendar page draws: its header, with the steps, the layouts,
 * Help, and the gear; then the month, or the chosen day's week, of days
 * large enough to list their tasks by name; and the chosen day's panel
 * beside it, unless Related Notes is showing the day.
 */
import type { CalendarDay, CalendarEntry, CalendarSnapshot, CalendarWeek } from '../../ui/protocol/calendar';
import { HelpButton } from '../shared/buttons';
import { DayPanel } from '../shared/calendar/dayPanel';
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
} from '../shared/calendar/model';
import { Eyebrow } from '../shared/eyebrow';
import { displayLevelOption, pageWidthOption, themeOption, ViewOptionChoices, ViewOptions } from '../shared/viewOptions';

/** The page's layout: a month of weeks, or the chosen day's week. */
export type CalendarLayout = 'month' | 'week';

/** The calendar page's state: the calendar's, and its layout, kept with the page across reloads. */
export interface CalendarPageState extends CalendarState {
  readonly layout: CalendarLayout;
}

/** The page's state with a snapshot to draw. */
export type DrawnCalendarPage = CalendarPageState & DrawnCalendar;

/** How many of a day's tasks a month's day names before +N more. */
const MONTH_CHIPS = 4;

/**
 * The row the Week layout draws: the week the chosen day is in, or, when
 * the month holds no such week, as after midnight turns today into the
 * next month, the month's first.
 */
export function chosenWeek(state: DrawnCalendarPage): CalendarWeek | undefined {
  const snapshot = state.snapshot;
  const date = state.drawnSelected || snapshot.today;
  return snapshot.weeks.find((week) => week.days.some((day) => day.date === date))
    || snapshot.weeks.find((week) => week.days.some((day) => day.inMonth));
}

/** The layout's two choices, in the header and in the gear. */
function LayoutChoices({ layout }: { readonly layout: CalendarLayout }) {
  return <ViewOptionChoices action="set-calendar-layout" choices={[['month', 'Month'], ['week', 'Week']]} selected={layout} label="Calendar layout" />;
}

/** The gear: the layout, repeats, weekends, the theme, and zen. */
function PageViewOptions({ state }: { readonly state: DrawnCalendarPage }) {
  const snapshot = state.snapshot;
  return (
    <ViewOptions
      groups={[
        { label: 'Layout', content: <LayoutChoices layout={state.layout} /> },
        {
          label: 'Repeats',
          content: <ViewOptionChoices action="set-show-repeats" choices={[['on', 'On'], ['off', 'Off']]} selected={snapshot.showRepeats ? 'on' : 'off'} label="Repeats" />,
        },
        {
          label: 'Weekends',
          content: <ViewOptionChoices action="set-show-weekends" choices={[['on', 'Shown'], ['off', 'Hidden']]} selected={snapshot.hideWeekends ? 'off' : 'on'} label="Weekends" />,
        },
        themeOption(),
        pageWidthOption(),
        displayLevelOption(),
      ]}
    />
  );
}

/** What the header and the grid are drawn with: the week shown, if one is, and its title. */
interface Shown {
  readonly week: CalendarWeek | undefined;
  /** The month's title, or the week's days. */
  readonly title: string;
}

/** The page's header: its title, which opens the month's note, and its controls. */
function PageHeader({ state, shown }: { readonly state: DrawnCalendarPage; readonly shown: Shown }) {
  const snapshot = state.snapshot;
  const monthLabel = snapshot.title + (snapshot.notePath ? ', monthly note' : '');
  // The title shows the week's days in the Week layout, and still opens the
  // month's note, so its name says both, starting with what it shows.
  const titleLabel = shown.week ? `${shown.title}, ${monthLabel}` : monthLabel;
  const step = state.layout === 'week' ? 'week' : 'month';
  const onToday = state.drawnSelected === snapshot.today &&
    (shown.week ? shown.week.days.some((day) => day.date === snapshot.today) : snapshot.month === snapshot.currentMonth);
  return (
    <header class="calendar-page-header">
      <div>
        <Eyebrow trail="CALENDAR" />
        <h1><button type="button" class="calendar-title" data-action="open-month" data-tip={monthLabel} aria-label={titleLabel}>{shown.title}</button></h1>
      </div>
      <div class="calendar-page-actions" role="group" aria-label="Calendar">
        <button type="button" data-action="step-calendar" data-by="-1" aria-label={`Previous ${step}`} data-tip={`Previous ${step} ([)`}>‹</button>
        {onToday ? null : <button type="button" data-action="go-today" data-tip="Today (t)">Today</button>}
        <button type="button" data-action="step-calendar" data-by="1" aria-label={`Next ${step}`} data-tip={`Next ${step} (])`}>›</button>
        <LayoutChoices layout={state.layout} />
        <HelpButton anchor="periodic" />
        <PageViewOptions state={state} />
      </div>
    </header>
  );
}

/** What a task on a day is, in its tip. */
function describeEntry(entry: CalendarEntry): string {
  if (entry.kind === 'repeat') {
    return 'repeats';
  }
  if (entry.kind === 'scheduled') {
    return 'scheduled';
  }
  if (entry.tone === 'stale') {
    return 'needs a new date';
  }
  return entry.tone === 'overdue' ? 'overdue' : 'due';
}

/** The mark before a task's title: a repeat's, a scheduled task's, or none for one due. */
function entryMark(entry: CalendarEntry): string {
  if (entry.kind === 'repeat') {
    return '↻ ';
  }
  return entry.kind === 'scheduled' ? '⏳ ' : '';
}

/**
 * A task on a day, by name. A due or scheduled task can be dragged to
 * another day; a repeat's date is its rule's.
 */
function Chip({ entry }: { readonly entry: CalendarEntry }) {
  const draggable = entry.kind !== 'repeat';
  const mark = entryMark(entry);
  const tip = `${entry.title}, ${describeEntry(entry)}${draggable ? '. Drag it to another day to move it.' : '. Its later dates follow its rule.'}`;
  return (
    <div
      class={`cal-chip kind-${entry.kind}${entry.tone ? ` tone-${entry.tone}` : ''}`}
      data-task-id={entry.taskId}
      data-kind={entry.kind}
      draggable={draggable ? true : undefined}
      data-tip={tip}
    >
      <span aria-hidden="true">{mark || null}</span>
      {entry.title}
    </div>
  );
}

/** What a day of the page is drawn with. */
interface PageDayProps {
  readonly state: DrawnCalendarPage;
  readonly day: CalendarDay;
  /** The day that takes Tab. */
  readonly tabStop: string | undefined;
}

/**
 * A day of the calendar page: its date, which takes the grid's keys as the
 * sidebar's day does, its daily note, and its tasks by name; a month's day
 * names four, then +N more.
 */
function PageDay({ state, day, tabStop }: PageDayProps) {
  const tone = dueTone(state.snapshot, day);
  const selected = day.date === markedDate(state);
  const entries = day.entries || [];
  const shown = state.layout === 'week' ? entries : entries.slice(0, MONTH_CHIPS);
  const more = entries.length - shown.length;
  return (
    <div class={selected ? 'calendar-cell day-cell is-selected' : 'calendar-cell day-cell'} role="gridcell" aria-selected={selected} data-drop-date={day.date}>
      <button
        type="button"
        class={dayClasses(day, selected)}
        data-action="open-day"
        data-date={day.date}
        aria-label={describeDay(day, tone)}
        aria-current={day.isToday ? 'date' : undefined}
        tabIndex={day.date === tabStop ? 0 : -1}
      >
        <span class="day-number">{day.day}</span>
      </button>
      {day.notePath
        ? <button type="button" class="cal-note text-button" data-action="open-note" data-file-path={day.notePath} data-tip="Open the daily note">Daily note</button>
        : null}
      {/* Keyed by kind, so a chip that may be dragged is never drawn into one that may not. */}
      <div class="cal-chips">{shown.map((entry, index) => <Chip key={`${entry.kind}-${index}`} entry={entry} />)}</div>
      {more > 0 ? <button type="button" class="cal-more text-button" data-action="open-day" data-date={day.date}>{`+${more} more`}</button> : null}
    </div>
  );
}

/** The whole page: the header, the month or week, and the chosen day beside it. */
export function CalendarPage({ state }: { readonly state: DrawnCalendarPage }) {
  const snapshot: CalendarSnapshot = state.snapshot;
  const week = state.layout === 'week' ? chosenWeek(state) : undefined;
  const shown: Shown = { week, title: week ? `${week.days[0].date} to ${week.days[6].date}` : snapshot.title };
  const weeks = week ? [week] : snapshot.weeks;
  const tabStop = tabStopDate(state, weeks);
  const days = (row: CalendarWeek) => row.days.filter((day) => isDrawn(snapshot, day)).map((day) => <PageDay state={state} day={day} tabStop={tabStop} />);
  // The chosen day beside the month, unless Related Notes is showing it.
  const panel = snapshot.dayPanel && !snapshot.dayInSidebar ? snapshot.selected : undefined;
  let bodyClass = 'calendar-page-body';
  if (state.layout === 'week') {
    bodyClass += ' is-week';
  }
  if (snapshot.dayInSidebar) {
    bodyClass += ' day-in-sidebar';
  }
  return (
    <>
      <PageHeader state={state} shown={shown} />
      <div class={bodyClass}>
        <CalendarGrid snapshot={snapshot} weeks={weeks} label={shown.title} multiselectable={false} days={days} />
        {panel ? <DayPanel day={panel} shownGroups={state.shownGroups} /> : null}
      </div>
    </>
  );
}
