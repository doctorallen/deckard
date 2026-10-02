/**
 * How both calendars run: one store drawn from the host's snapshot, the
 * day the reader chose and the day that holds the grid's tab stop, the
 * grid's keys, and the controls both draw.
 *
 * A calendar draws in two ways, as its template script did (`model.ts`). A
 * full draw, for a snapshot from the host or anything that redrew the whole
 * script, draws everything from the state. Choosing a day only marks it and
 * tells the host after a pause, so a held arrow key does not flood it; the
 * Today button, the week shown, and the rest follow at the next full draw.
 */
import type { ComponentChild } from 'preact';

import { sameShownDayIn, stepDate } from '../../../domain/markdown/calendar';
import type {
  CalendarMessage,
  CalendarSelectDayMessage,
  CalendarShowMonthMessage,
  CalendarSnapshot,
} from '../../../ui/protocol/calendar';
import type { StateMessage } from '../../../ui/protocol/messaging';
import { type ActionHandler, onHostMessage, type PageStore, startPage } from '../page';
import { post } from '../vscode';
import { eventElement } from './events';
import { type CalendarState, selectedDateOf } from './model';

/** Sends the calendar's host one of the messages both calendars send. */
export function send(message: CalendarMessage): void {
  post(message);
}

/** What a calendar is, to `CalendarSession`. */
export interface CalendarDefinition<S extends CalendarState> {
  /** The state the calendar starts from: with the snapshot its shell carried, when it carried one. */
  readonly initial: S;
  /** The whole page, drawn from the state. */
  readonly view: (state: S) => ComponentChild;
  /** Runs after each full draw, for what a full draw of the template took away. */
  readonly afterFullDraw?: () => void;
  /**
   * Whether a key's step past the weeks drawn chooses the day it lands on
   * rather than asking for the next month: the page's Week layout.
   */
  readonly stepsByDay?: () => boolean;
}

/** What a full draw of the template script took away: an open Done folds again. */
function foldDone(): void {
  document.querySelectorAll<HTMLDetailsElement>('.day-panel details.day-group').forEach((details) => {
    details.open = false;
  });
}

/** The grid's steps by key: a cell either way, or a row, of five days or seven. */
function gridSteps(columns: number): Readonly<Record<string, number>> {
  return { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
}

/**
 * The day a grid key moves to among the days drawn, or undefined past the
 * grid's edge; Home and End are the ends of the day's row.
 */
function dayAfterKey(days: readonly HTMLElement[], day: HTMLElement, key: string, columns: number): HTMLElement | undefined {
  const index = days.indexOf(day);
  const steps = gridSteps(columns);
  if (Object.prototype.hasOwnProperty.call(steps, key)) {
    return days[index + steps[key]];
  }
  return key === 'Home' ? days[index - (index % columns)] : days[index - (index % columns) + columns - 1];
}

/**
 * A running calendar: its store, drawn at once when its shell carried a
 * snapshot, and its host's snapshots, each drawn whole. The page adds the
 * listeners, in the order its template script did.
 */
export class CalendarSession<S extends CalendarState> {
  public readonly store: PageStore<S>;
  /** The actions of the controls both calendars draw, by `data-action`. */
  public readonly actions: Readonly<Record<string, ActionHandler>>;
  private fullDraw = true;
  private drawCount = 0;
  /**
   * The day that holds the grid's tab stop, kept here, not on the snapshot,
   * which each message from the host replaces.
   */
  private focusDate: string | undefined;
  /** The day a keyboard step into another month lands on, focused once that month is drawn. */
  private pendingFocusDate: string | undefined;
  /** The chosen day's message to the host, sent after a pause. */
  private selectTimer: ReturnType<typeof setTimeout> | undefined;
  /** The chosen day still waiting for that pause, to be sent. */
  private waitingDate: string | undefined;

  /** Starts the calendar and draws it, if its shell carried a snapshot. */
  public constructor(private readonly definition: CalendarDefinition<S>) {
    const initial = definition.initial;
    this.store = startPage<S>({
      initial: { ...initial, drawnSelected: selectedDateOf(initial) },
      ready: (state) => Boolean(state.snapshot),
      view: definition.view,
      afterDraw: () => this.afterDraw(),
    });
    this.actions = this.createActions();
    // A save anywhere redraws the month; the focus stays on the day it was
    // on, and a day a step was waiting on is focused once it is drawn.
    onHostMessage<StateMessage<CalendarSnapshot>>('state', (message) => this.receive(message.data));
  }

  /** The snapshot drawn, if there is one yet. */
  public get snapshot(): CalendarSnapshot | undefined {
    return this.store.state.snapshot;
  }

  /** How many full draws there have been, so a drag can tell its chip was drawn again. */
  public get draws(): number {
    return this.drawCount;
  }

  /** Draws everything from the state, with `change` taken in. */
  public redraw(change: Partial<S> = {}): void {
    const next = { ...this.store.state, ...change };
    this.fullDraw = true;
    this.store.update({
      ...change,
      drawnSelected: selectedDateOf(next),
      drawnFocus: this.focusDate,
      marked: undefined,
      tabStop: undefined,
    } as Partial<S>);
  }

  /** With the panel on, marks a day chosen at once, and tells the host after a pause. */
  public selectDay(date: string): void {
    const shown = this.snapshot;
    if (!shown || !shown.dayPanel || !date) {
      return;
    }
    this.store.update({ chosen: date, marked: date } as Partial<S>);
    clearTimeout(this.selectTimer);
    this.waitingDate = date;
    this.selectTimer = setTimeout(() => this.sendWaitingDate(), 120);
  }

  /**
   * Asks the host for another month or day. A chosen day still waiting to
   * be sent would arrive after the step and take the calendar back, so a
   * step that names its day lets it go, and one that does not sends it
   * first, since the host steps from the chosen day.
   */
  public sendStep(message: CalendarShowMonthMessage | CalendarSelectDayMessage): void {
    if (message.date) {
      clearTimeout(this.selectTimer);
      this.waitingDate = undefined;
    } else {
      this.sendWaitingDate();
    }
    send(message);
  }

  /** Gives a day the grid's tab stop at the next full draw. */
  public setFocusDate(date: string): void {
    this.focusDate = date;
  }

  /** Gives a day the tab stop, and focuses it once a snapshot draws it. */
  public focusWhenDrawn(date: string): void {
    this.pendingFocusDate = date;
    this.focusDate = date;
  }

  /** The grid's keys: arrows, Home and End, Page Up and Page Down, and Enter. */
  public readonly onGridKey = (event: KeyboardEvent): void => {
    const day = eventElement(event)?.closest<HTMLElement>('.day');
    if (!day) {
      return;
    }
    const shown = this.snapshot as CalendarSnapshot;
    // A row is five days with the weekends hidden, seven with them.
    const columns = shown.hideWeekends ? 5 : 7;
    const steps = gridSteps(columns);
    const step = Object.prototype.hasOwnProperty.call(steps, event.key) ? steps[event.key] : undefined;
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      this.stepMonth(day, event.key);
      return;
    }
    if (event.key === 'Enter' && shown.dayPanel) {
      // With the panel on a click chooses the day; Enter opens its note.
      event.preventDefault();
      send({ type: 'openDay', date: day.dataset.date as string });
      return;
    }
    if (step === undefined && event.key !== 'Home' && event.key !== 'End') {
      return;
    }
    event.preventDefault();
    const next = dayAfterKey([...document.querySelectorAll<HTMLElement>('.calendar-grid .day')], day, event.key, columns);
    if (next) {
      this.moveTo(next);
      return;
    }
    // A step past the edge of the drawn weeks moves to the next month, or
    // on the page's week, to the day it stepped to.
    this.stepPastGrid(day, step);
  };

  /** With the panel on, a double-click on a day opens its note. */
  public readonly onDoubleClick = (event: MouseEvent): void => {
    const day = eventElement(event)?.closest<HTMLElement>('.calendar-grid .day');
    const shown = this.snapshot;
    if (!day || !shown || !shown.dayPanel) {
      return;
    }
    send({ type: 'openDay', date: day.dataset.date as string });
  };

  /** Sends the chosen day still waiting, if one is, at once. */
  private sendWaitingDate(): void {
    clearTimeout(this.selectTimer);
    const date = this.waitingDate;
    this.waitingDate = undefined;
    if (date) {
      send({ type: 'selectDay', date });
    }
  }

  /** What a full draw does after drawing: what the template's redraw took away goes. */
  private afterDraw(): void {
    if (!this.fullDraw) {
      return;
    }
    this.fullDraw = false;
    this.drawCount += 1;
    foldDone();
    this.definition.afterFullDraw?.();
  }

  /** Draws a snapshot from the host whole, then focuses a day a step was waiting on. */
  private receive(snapshot: CalendarSnapshot | undefined): void {
    this.redraw({ snapshot, chosen: undefined } as Partial<S>);
    if (!this.pendingFocusDate) {
      return;
    }
    const stepped = document.querySelector<HTMLElement>(`.calendar-grid .day[data-date="${this.pendingFocusDate}"]`);
    if (!stepped) {
      return;
    }
    this.pendingFocusDate = undefined;
    stepped.focus();
  }

  /** Moves the tab stop and focus to a day drawn, and chooses it: selection follows focus. */
  private moveTo(next: HTMLElement): void {
    const date = next.dataset.date as string;
    this.focusDate = date;
    this.store.update({ tabStop: date } as Partial<S>);
    next.focus();
    this.selectDay(date);
  }

  /**
   * Page Up and Page Down: the same day of the month before or after, or,
   * with the weekends hidden, a weekday of that month near it, since a
   * hidden day can take neither the focus nor the choice.
   */
  private stepMonth(day: HTMLElement, key: string): void {
    const shown = this.snapshot as CalendarSnapshot;
    const month = key === 'PageUp' ? shown.previousMonth : shown.nextMonth;
    const date = sameShownDayIn(day.dataset.date as string, month, Boolean(shown.hideWeekends));
    this.focusWhenDrawn(date);
    this.sendStep(shown.dayPanel ? { type: 'showMonth', month, date } : { type: 'showMonth', month });
  }

  /** A step past the weeks drawn: to the day stepped to, or to the next month. */
  private stepPastGrid(day: HTMLElement, step: number | undefined): void {
    const shown = this.snapshot as CalendarSnapshot;
    if (step === undefined) {
      // Home and End past the last row ask for the next month, as the
      // template's did, with no day of their own: the host keeps the chosen
      // day's place. A day an earlier step was still waiting on is let go,
      // so it is neither sent nor focused when that month is drawn.
      this.pendingFocusDate = undefined;
      this.sendStep({ type: 'showMonth', month: shown.nextMonth });
      return;
    }
    const stepped = stepDate(day.dataset.date as string, step, Boolean(shown.hideWeekends));
    this.focusWhenDrawn(stepped);
    if (this.definition.stepsByDay?.()) {
      this.sendStep({ type: 'selectDay', date: stepped });
      return;
    }
    const month = step < 0 ? shown.previousMonth : shown.nextMonth;
    this.sendStep(shown.dayPanel ? { type: 'showMonth', month, date: stepped } : { type: 'showMonth', month });
  }

  /** The controls both calendars draw, by their `data-action`. */
  private createActions(): Record<string, ActionHandler> {
    return {
      // With the panel on, a day is chosen; without it, its note opens,
      // once: a double-click's second click would open it again.
      'open-day': (element, event) => {
        const date = element.getAttribute('data-date') as string;
        if (this.snapshot?.dayPanel) {
          this.focusDate = date;
          this.selectDay(date);
          return;
        }
        if (event.detail > 1) {
          return;
        }
        send({ type: 'openDay', date });
      },
      'open-week': (element) => send({ type: 'openWeek', date: element.getAttribute('data-date') as string }),
      'open-month': () => send({ type: 'openMonth' }),
      'show-month': (element) => {
        const month = element.getAttribute('data-month') as string;
        const date = element.getAttribute('data-date');
        this.sendStep(date ? { type: 'showMonth', month, date } : { type: 'showMonth', month });
      },
      'open-note': (element) => send({ type: 'openNote', filePath: element.getAttribute('data-file-path') as string }),
    };
  }
}
