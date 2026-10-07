/**
 * The grid both calendars draw: a header row of weekday names, then a row
 * per week, each opening on the week's rail. Rows and cells are drawn as a
 * grid is read; the wrappers draw nothing, and the grid lays out the
 * buttons. Each calendar draws its own days.
 */
import type { ComponentChildren } from 'preact';

import type { CalendarSnapshot, CalendarWeek } from '../../../ui/protocol/calendar';
import { CalendarIcon } from './calendarIcon';
import { drawnWeekdays } from './model';
import { formatPageDay } from '../dateFormats';

/** The weekday names across the top, after the rail's empty corner. */
export function WeekdayRow({ snapshot }: { readonly snapshot: CalendarSnapshot }) {
  return (
    <div class="calendar-row" role="row">
      <span class="weekday" role="columnheader" aria-label="Week"></span>
      {drawnWeekdays(snapshot).map((name) => <span class="weekday" role="columnheader">{name}</span>)}
    </div>
  );
}

/**
 * The week beside its row, as a mark rather than a number: a week note is
 * named for the days it holds, so a number would say nothing the row does
 * not. What it opens is in its tip.
 */
export function WeekRail({ week }: { readonly week: CalendarWeek }) {
  const days = `${formatPageDay(week.days[0].date)} to ${formatPageDay(week.days[6].date)}`;
  const label = `${week.notePath ? "Open this week's note, " : "Start this week's note, "}${days}`;
  return (
    <span class="calendar-cell" role="rowheader">
      <button type="button" class={week.notePath ? 'week-label has-note' : 'week-label'} data-action="open-week" data-date={week.date} data-tip={label} aria-label={label}>
        <CalendarIcon />
      </button>
    </span>
  );
}

/** What a grid is drawn with. */
export interface CalendarGridProps {
  readonly snapshot: CalendarSnapshot;
  /** The weeks drawn: the month's, or the page's one week. */
  readonly weeks: readonly CalendarWeek[];
  /** The grid's accessible name: the month, or the week's days. */
  readonly label: string;
  /** Whether the grid says one day at a time is chosen in it; absent, it says nothing. */
  readonly multiselectable?: false;
  /** Draws one week's days, those the grid draws, after its rail. */
  readonly days: (week: CalendarWeek) => ComponentChildren;
}

/** The weekday names, then each week: its rail and its days. */
export function CalendarGrid(props: CalendarGridProps) {
  const { snapshot } = props;
  return (
    <div
      class={snapshot.hideWeekends ? 'calendar-grid no-weekends' : 'calendar-grid'}
      role="grid"
      aria-label={props.label}
      aria-multiselectable={props.multiselectable === false ? 'false' : undefined}
    >
      <WeekdayRow snapshot={snapshot} />
      {props.weeks.map((week) => (
        <div class="calendar-row" role="row">
          <WeekRail week={week} />
          {props.days(week)}
        </div>
      ))}
    </div>
  );
}
