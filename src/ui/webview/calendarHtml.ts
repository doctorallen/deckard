import { getCalendarDayScript } from './calendarDay';
import { calendarIcon } from './icons';
import * as vscode from 'vscode';

import {
  createNonce,
  getComponentScript,
  loadingHtml,
} from './components';
import { buildPageShell } from './host/pageShell';
import { isZenModeEnabled } from './zenMode';
import { type DeckardTheme, getDeckardTheme } from './themes';

/**
 * Draws the sidebar calendar: a month of weeks from Sunday to Saturday.
 * Every day, every week, and the month title is a button that asks the host
 * to open its note; the host decides what exists and what to create.
 */
export function getCalendarHtml(
  webview: vscode.Webview,
  /** The extension's folder, which the page's style sheets are under. */
  extensionUri: vscode.Uri,
  options: {
    /**
     * The calendar page: a month or a week of days large enough to list their
     * tasks, with the day panel beside it. The sidebar's is the default.
     */
    page?: boolean;
    /** The theme its host read, preview and all; the configured one without. */
    theme?: DeckardTheme;
  } = {},
): string {
  const { theme } = options;
  const nonce = createNonce();

  return buildPageShell({
    webview,
    extensionUri,
    page: options.page ? 'calendarPage' : 'calendar',
    title: 'Deckard Calendar',
    nonce,
    theme: theme ?? getDeckardTheme(),
    zen: isZenModeEnabled(),
    body: `
${loadingHtml('Loading calendar…')}
<div id="live-status" class="visually-hidden" role="status" aria-live="polite"></div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  let state;
  // The day that holds the grid's one tab stop. It is kept here, not on the
  // state, which each message from the host replaces.
  let focusDate;
  // The day a keyboard step into another month lands on, focused once that
  // month is drawn.
  let pendingFocusDate;
  // The day chosen with the panel on, marked at once and sent to the host
  // after a pause, so a held arrow key does not flood it.
  let selectTimer;
${getComponentScript(theme)}
${getCalendarDayScript()}
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  /** The calendar page, rather than the sidebar's. */
  const PAGE = ${options.page ? 'true' : 'false'};
  /** The page's layout, Month or Week, kept with the page across reloads. */
  let layout = (function () {
    try { return (vscode.getState() || {}).layout === 'week' ? 'week' : 'month'; } catch (error) { return 'month'; }
  }());
  /** How many of a day's tasks a month's day names before +N more. */
  const MONTH_CHIPS = 4;

  function post(message) { vscode.postMessage(message); }

  function describeDay(day, overdue, stale) {
    const parts = [day.date];
    if (day.isToday) parts.push('today');
    if (day.notePath) parts.push('daily note');
    if (day.dueCount > 0) {
      parts.push(stale
        ? day.dueCount + (day.dueCount === 1 ? ' needs' : ' need') + ' a new date'
        : day.dueCount + (overdue ? ' overdue' : ' due'));
    }
    if (day.scheduledCount > 0) parts.push(day.scheduledCount + ' scheduled');
    if (day.repeatCount > 0) parts.push(day.repeatCount + (day.repeatCount === 1 ? ' repeat' : ' repeats'));
    return parts.join(', ');
  }

  function renderDay(day) {
    if (PAGE) return renderPageDay(day);
    // A day past needsNewDateAfterDays keeps its count, but not the warning:
    // its tasks need a new date, not doing today.
    const stale = day.dueCount > 0 && !!state.needsNewDateBefore && day.date < state.needsNewDateBefore;
    const overdue = day.dueCount > 0 && day.date < state.today && !stale;
    const classes = ['day'];
    if (!day.inMonth) classes.push('outside');
    if (day.isToday) classes.push('today');
    const selected = Boolean(state.dayPanel) && day.date === state.selectedDate;
    if (selected) classes.push('selected');
    const label = escapeHtml(describeDay(day, overdue, stale));
    // The tooltip says which tasks and which headings, not only how many,
    // so the right day is found without opening each.
    const tooltip = escapeHtml([describeDay(day, overdue, stale)]
      .concat((day.dueTitles || []).map(function (title) { return '☐ ' + title; }))
      .concat((day.scheduledTitles || []).map(function (title) { return '⏳ ' + title; }))
      .concat((day.repeatTitles || []).map(function (title) { return '↻ ' + title; }))
      .concat((day.headings || []).map(function (heading) { return '# ' + heading; }))
      .concat(state.dayPanel ? ['Double-click or Enter opens the daily note.'] : [])
      .join('\\n'));
    // Both rows are always drawn, empty when there is nothing to mark, so
    // the number above them sits in the same place in every cell.
    const dot = day.notePath ? '<span class="note-dot" aria-hidden="true"></span>' : '<span aria-hidden="true"></span>';
    // The due count, then what is scheduled, outlined. Where both run to two
    // digits the second is a ring: a narrow cell has room for one number, and
    // the tooltip and label keep both.
    const scheduled = day.scheduledCount || 0;
    const ring = scheduled > 0 && ((day.dueCount >= 10 && scheduled >= 10) || day.dueCount >= 100 || scheduled >= 100);
    const due = '<span class="counts" aria-hidden="true"><span class="due' + (overdue ? ' overdue' : stale ? ' stale' : '') + '">' + (day.dueCount > 0 ? day.dueCount : '') + '</span>'
      + (ring ? '<span class="scheduled-ring"></span>' : '<span class="scheduled-count">' + (scheduled > 0 ? scheduled : '') + '</span>')
      // Then the repeats: the mark alone for one, with a number for more.
      + '<span class="repeat-count">' + (day.repeatCount > 0 ? '↻' + (day.repeatCount > 1 ? day.repeatCount : '') : '') + '</span></span>';
    // One day in the grid is tabbable at a time: the focused one, else today,
    // else the first of the month.
    const focusable = day.date === tabStopDate();
    return '<span class="calendar-cell" role="gridcell"' + (state.dayPanel ? ' aria-selected="' + selected + '"' : '') + '><button type="button" class="' + classes.join(' ') + '" data-action="open-day" data-date="' + escapeHtml(day.date) + '" data-tip="' + tooltip + '" aria-label="' + label + '"' + (day.isToday ? ' aria-current="date"' : '') + ' tabindex="' + (focusable ? '0' : '-1') + '"><span class="day-number">' + day.day + '</span>' + dot + due + '</button></span>';
  }

  /**
   * The week beside its row, as a mark rather than a number: a week note is
   * named for the days it holds, so a number would say nothing the row does
   * not. What it opens is in its tooltip.
   */
  function renderWeek(week) {
    const days = week.days[0].date + ' to ' + week.days[6].date;
    const label = (week.notePath ? "Open this week's note, " : "Start this week's note, ") + days;
    return '<div class="calendar-row" role="row"><span class="calendar-cell" role="rowheader"><button type="button" class="week-label' + (week.notePath ? ' has-note' : '') + '" data-action="open-week" data-date="' + escapeHtml(week.date) + '" data-tip="' + escapeHtml(label) + '" aria-label="' + escapeHtml(label) + '">'
      + '${calendarIcon}'
      + '</button></span>' + week.days.filter(isDrawn).map(renderDay).join('') + '</div>';
  }

  /** The focused day when it is drawn, else today, else the 1st. */
  function tabStopDate() {
    const days = [];
    state.weeks.forEach(function (week) { week.days.filter(isDrawn).forEach(function (day) { days.push(day); }); });
    const has = function (date) { return date && days.some(function (day) { return day.date === date; }); };
    if (state.dayPanel && has(state.selectedDate) && !has(focusDate)) return state.selectedDate;
    if (has(focusDate)) return focusDate;
    const today = days.filter(function (day) { return day.isToday; })[0];
    if (today) return today.date;
    const first = days.filter(function (day) { return day.inMonth; })[0];
    return first ? first.date : undefined;
  }

  /** A date moved by some days, as YYYY-MM-DD. */
  function shiftDate(date, days) {
    const parts = date.split('-').map(Number);
    const moved = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
    return moved.toISOString().slice(0, 10);
  }

  /** Whether a day is drawn: every day, or none on a weekend with them hidden. */
  function isDrawn(day) {
    return !state.hideWeekends || !isWeekend(day.date);
  }

  function isWeekend(date) {
    const parts = date.split('-').map(Number);
    const weekday = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
    return weekday === 0 || weekday === 6;
  }

  /**
   * A key's step from a day, as a date: a row down is a week whichever
   * number of days the row draws, and a step onto a hidden weekend goes on
   * to the next weekday that way.
   */
  function stepDate(date, step) {
    const cols = state.hideWeekends ? 5 : 7;
    const days = Math.abs(step) === cols ? Math.sign(step) * 7 : step;
    return skipWeekend(shiftDate(date, days), Math.sign(step) || 1);
  }

  /** A date, or the next drawn day from it one way, with weekends hidden. */
  function skipWeekend(date, direction) {
    let at = date;
    while (state.hideWeekends && isWeekend(at)) at = shiftDate(at, direction);
    return at;
  }

  /** The same day of the month in another month, or its last day. */
  function sameDayIn(date, month) {
    const parts = month.split('-').map(Number);
    const last = new Date(Date.UTC(parts[0], parts[1], 0)).getUTCDate();
    return month + '-' + String(Math.min(Number(date.slice(8, 10)), last)).padStart(2, '0');
  }

  function render() {
    if (!state) return;
    if (PAGE) {
      renderPage();
      return;
    }
    const monthLabel = state.title + (state.notePath ? ', monthly note' : '');
    const header = '<div class="calendar-header">' +
      '<button type="button" data-action="show-month" data-month="' + escapeHtml(state.previousMonth) + '" aria-label="Previous month" data-tip="Previous month">&lsaquo;</button>' +
      '<button type="button" class="calendar-title" data-action="open-month" data-tip="' + escapeHtml(monthLabel) + '" aria-label="' + escapeHtml(monthLabel) + '">' + escapeHtml(state.title) + '</button>' +
      '<button type="button" data-action="show-month" data-month="' + escapeHtml(state.nextMonth) + '" aria-label="Next month" data-tip="Next month">&rsaquo;</button>' +
      (state.month === state.currentMonth && (!state.dayPanel || state.selectedDate === state.today) ? '' : '<button type="button" data-action="show-month" data-month="' + escapeHtml(state.currentMonth) + '"' + (state.dayPanel ? ' data-date="' + escapeHtml(state.today) + '"' : '') + '>Today</button>') +
      '</div>';
    // Rows and cells as a grid is read: a header row of weekday names, then a
    // row per week. The wrappers draw nothing; the grid lays out the buttons.
    const weekdays = '<div class="calendar-row" role="row"><span class="weekday" role="columnheader" aria-label="Week"></span>' + (state.weekdays || WEEKDAYS).filter(function (name) { return !state.hideWeekends || (name !== 'Sat' && name !== 'Sun'); }).map(function (name) { return '<span class="weekday" role="columnheader">' + name + '</span>'; }).join('') + '</div>';
    document.getElementById('app').innerHTML = header + '<div class="calendar-grid' + (state.hideWeekends ? ' no-weekends' : '') + '" role="grid" aria-label="' + escapeHtml(state.title) + '"' + (state.dayPanel ? ' aria-multiselectable="false"' : '') + '>' + weekdays + state.weeks.map(renderWeek).join('') + '</div>' + renderPanel(state.selected);
  }

  /**
   * A day of the calendar page: its date, which takes the grid's keys as the
   * sidebar's day does, its daily note, and its tasks by name. A due or
   * scheduled task can be dragged to another day; a repeat's date is its
   * rule's.
   */
  function renderPageDay(day) {
    const stale = day.dueCount > 0 && !!state.needsNewDateBefore && day.date < state.needsNewDateBefore;
    const overdue = day.dueCount > 0 && day.date < state.today && !stale;
    const classes = ['day'];
    if (!day.inMonth) classes.push('outside');
    if (day.isToday) classes.push('today');
    const selected = day.date === state.selectedDate;
    if (selected) classes.push('selected');
    const entries = day.entries || [];
    const shown = layout === 'week' ? entries : entries.slice(0, MONTH_CHIPS);
    const more = entries.length - shown.length;
    const chips = shown.map(function (entry) {
      const draggable = entry.kind !== 'repeat';
      const mark = entry.kind === 'repeat' ? '↻ ' : entry.kind === 'scheduled' ? '⏳ ' : '';
      const what = entry.kind === 'repeat' ? 'repeats' : entry.kind === 'scheduled' ? 'scheduled' : entry.tone === 'stale' ? 'needs a new date' : entry.tone === 'overdue' ? 'overdue' : 'due';
      return '<div class="cal-chip kind-' + entry.kind + (entry.tone ? ' tone-' + entry.tone : '') + '" data-task-id="' + escapeHtml(entry.taskId) + '" data-kind="' + entry.kind + '"' + (draggable ? ' draggable="true"' : '')
        + ' data-tip="' + escapeHtml(entry.title + ', ' + what + (draggable ? '. Drag it to another day to move it.' : '. Its later dates follow its rule.')) + '">'
        + '<span aria-hidden="true">' + mark + '</span>' + escapeHtml(entry.title) + '</div>';
    }).join('');
    const note = day.notePath
      ? '<button type="button" class="cal-note text-button" data-action="open-note" data-file-path="' + escapeHtml(day.notePath) + '" data-tip="Open the daily note">Daily note</button>'
      : '';
    const focusable = day.date === tabStopDate();
    return '<div class="calendar-cell day-cell' + (selected ? ' is-selected' : '') + '" role="gridcell" aria-selected="' + selected + '" data-drop-date="' + escapeHtml(day.date) + '">'
      + '<button type="button" class="' + classes.join(' ') + '" data-action="open-day" data-date="' + escapeHtml(day.date) + '" aria-label="' + escapeHtml(describeDay(day, overdue, stale)) + '"' + (day.isToday ? ' aria-current="date"' : '') + ' tabindex="' + (focusable ? '0' : '-1') + '"><span class="day-number">' + day.day + '</span></button>'
      + note + '<div class="cal-chips">' + chips + '</div>'
      + (more > 0 ? '<button type="button" class="cal-more text-button" data-action="open-day" data-date="' + escapeHtml(day.date) + '">+' + more + ' more</button>' : '')
      + '</div>';
  }

  /** The week the chosen day is in: the row the Week layout draws. */
  function chosenWeek() {
    const date = state.selectedDate || state.today;
    return state.weeks.filter(function (week) { return week.days.some(function (day) { return day.date === date; }); })[0]
      || state.weeks.filter(function (week) { return week.days.some(function (day) { return day.inMonth; }); })[0];
  }

  function renderPage() {
    const monthLabel = state.title + (state.notePath ? ', monthly note' : '');
    const week = layout === 'week' ? chosenWeek() : undefined;
    const title = week ? week.days[0].date + ' to ' + week.days[6].date : state.title;
    const step = layout === 'week' ? 'week' : 'month';
    const onToday = state.selectedDate === state.today && (layout === 'week' || state.month === state.currentMonth);
    const viewOptions = renderViewOptions([
      { label: 'Layout', html: renderViewOptionChoices('set-calendar-layout', [['month', 'Month'], ['week', 'Week']], layout, 'Calendar layout') },
      { label: 'Repeats', html: renderViewOptionChoices('set-show-repeats', [['on', 'On'], ['off', 'Off']], state.showRepeats ? 'on' : 'off', 'Repeats') },
      { label: 'Weekends', html: renderViewOptionChoices('set-show-weekends', [['on', 'Shown'], ['off', 'Hidden']], state.hideWeekends ? 'off' : 'on', 'Weekends') },
      renderThemeOption(),
      renderZenOption(),
    ]);
    const header = '<header class="calendar-page-header"><div><p class="eyebrow">DECKARD / CALENDAR</p>'
      + '<h1><button type="button" class="calendar-title" data-action="open-month" data-tip="' + escapeHtml(monthLabel) + '" aria-label="' + escapeHtml(monthLabel) + '">' + escapeHtml(title) + '</button></h1></div>'
      + '<div class="calendar-page-actions" role="group" aria-label="Calendar">'
      + '<button type="button" data-action="step-calendar" data-by="-1" aria-label="Previous ' + step + '" data-tip="Previous ' + step + ' ([)">&lsaquo;</button>'
      + (onToday ? '' : '<button type="button" data-action="go-today" data-tip="Today (t)">Today</button>')
      + '<button type="button" data-action="step-calendar" data-by="1" aria-label="Next ' + step + '" data-tip="Next ' + step + ' (])">&rsaquo;</button>'
      + renderViewOptionChoices('set-calendar-layout', [['month', 'Month'], ['week', 'Week']], layout, 'Calendar layout')
      + renderHelpButton('periodic') + viewOptions + '</div></header>';
    const weekdays = '<div class="calendar-row" role="row"><span class="weekday" role="columnheader" aria-label="Week"></span>' + (state.weekdays || WEEKDAYS).filter(function (name) { return !state.hideWeekends || (name !== 'Sat' && name !== 'Sun'); }).map(function (name) { return '<span class="weekday" role="columnheader">' + name + '</span>'; }).join('') + '</div>';
    const rows = (week ? [week] : state.weeks).map(renderWeek).join('');
    document.getElementById('app').innerHTML = header
      + '<div class="calendar-page-body' + (layout === 'week' ? ' is-week' : '') + (state.dayInSidebar ? ' day-in-sidebar' : '') + '"><div class="calendar-grid' + (state.hideWeekends ? ' no-weekends' : '') + '" role="grid" aria-label="' + escapeHtml(title) + '" aria-multiselectable="false">' + weekdays + rows + '</div>'
      + renderPanel(state.selected) + '</div>';
  }

  /** Steps the page a month or a week, keeping the chosen day's place. */
  function stepCalendar(by) {
    if (layout === 'week') {
      const date = shiftDate(state.selectedDate || state.today, 7 * by);
      focusDate = date;
      pendingFocusDate = date;
      post({ type: 'selectDay', date: date });
      return;
    }
    const month = by < 0 ? state.previousMonth : state.nextMonth;
    const date = skipWeekend(sameDayIn(state.selectedDate || state.today, month), 1);
    focusDate = date;
    pendingFocusDate = date;
    post({ type: 'showMonth', month: month, date: date });
  }

  function setLayout(next) {
    if (next !== 'month' && next !== 'week') return;
    layout = next;
    try { vscode.setState(Object.assign({}, vscode.getState() || {}, { layout: layout })); } catch (error) { /* kept for this session only */ }
    renderKeepingPlace(render);
    announce(layout === 'week' ? 'Week layout' : 'Month layout');
  }

  /** The chosen day under the month, or beside it on the page. */
  function renderPanel(day) {
    if (!state.dayPanel || !day || state.dayInSidebar) return '';
    return renderCalendarDayPanel(day);
  }

  /** Marks a day as chosen at once, and tells the host after a pause. */
  function selectDay(date) {
    if (!state || !state.dayPanel || !date) return;
    state.selectedDate = date;
    document.querySelectorAll('.calendar-grid .day').forEach(function (cell) {
      const chosen = cell.dataset.date === date;
      cell.classList.toggle('selected', chosen);
      if (cell.parentElement) cell.parentElement.setAttribute('aria-selected', String(chosen));
      // The page outlines the whole day, not only its date.
      if (PAGE && cell.parentElement) cell.parentElement.classList.toggle('is-selected', chosen);
    });
    clearTimeout(selectTimer);
    selectTimer = setTimeout(function () { post({ type: 'selectDay', date: date }); }, 120);
  }

  /** Move the focus by days, weeks, or to the ends of a week. */
  document.addEventListener('keydown', function (event) {
    const day = event.target && event.target.closest ? event.target.closest('.day') : null;
    if (!day) return;
    // A row is five days with the weekends hidden, seven with them.
    const cols = state.hideWeekends ? 5 : 7;
    const steps = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols };
    const days = [].slice.call(document.querySelectorAll('.calendar-grid .day'));
    const index = days.indexOf(day);
    let next;
    if (steps[event.key] !== undefined) {
      next = days[index + steps[event.key]];
    } else if (event.key === 'Home') {
      next = days[index - (index % cols)];
    } else if (event.key === 'End') {
      next = days[index - (index % cols) + cols - 1];
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      const month = event.key === 'PageUp' ? state.previousMonth : state.nextMonth;
      pendingFocusDate = sameDayIn(day.dataset.date, month);
      focusDate = pendingFocusDate;
      vscode.postMessage(state.dayPanel ? { type: 'showMonth', month: month, date: pendingFocusDate } : { type: 'showMonth', month: month });
      return;
    } else if (event.key === 'Enter' && state.dayPanel) {
      // With the panel on a click chooses the day; Enter opens its note.
      event.preventDefault();
      post({ type: 'openDay', date: day.dataset.date });
      return;
    } else {
      return;
    }
    event.preventDefault();
    // A step past the edge of the drawn weeks moves to the next month, or
    // on the page's week, to the day it stepped to.
    if (!next && PAGE && layout === 'week' && steps[event.key] !== undefined) {
      pendingFocusDate = stepDate(day.dataset.date, steps[event.key]);
      focusDate = pendingFocusDate;
      post({ type: 'selectDay', date: pendingFocusDate });
      return;
    }
    if (!next) {
      if (steps[event.key] !== undefined) {
        pendingFocusDate = stepDate(day.dataset.date, steps[event.key]);
        focusDate = pendingFocusDate;
      }
      const month = steps[event.key] < 0 ? state.previousMonth : state.nextMonth;
      vscode.postMessage(state.dayPanel && pendingFocusDate ? { type: 'showMonth', month: month, date: pendingFocusDate } : { type: 'showMonth', month: month });
      return;
    }
    focusDate = next.dataset.date;
    days.forEach(function (candidate) { candidate.setAttribute('tabindex', candidate === next ? '0' : '-1'); });
    next.focus();
    // Selection follows focus, as in any grid that selects.
    selectDay(next.dataset.date);
  });

  document.addEventListener('click', function (event) {
    // A task on the page opens where it is written.
    const chip = PAGE && event.target && event.target.closest ? event.target.closest('.cal-chip') : null;
    if (chip) {
      post({ type: 'openTask', taskId: chip.getAttribute('data-task-id') });
      return;
    }
    // Anywhere else in a day chooses it, as its date does.
    const cell = PAGE && event.target && event.target.closest ? event.target.closest('.day-cell') : null;
    if (cell && !event.target.closest('button, a, input')) {
      focusDate = cell.getAttribute('data-drop-date');
      selectDay(focusDate);
      return;
    }
    // The day panel's own controls are installCalendarDayPanel's.
    if (event.target && event.target.closest && event.target.closest('.day-panel')) return;
    const target = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
    if (!target) return;
    const action = target.getAttribute('data-action');
    if (action === 'open-day') {
      if (state && state.dayPanel) {
        focusDate = target.getAttribute('data-date');
        selectDay(focusDate);
      } else {
        post({ type: 'openDay', date: target.getAttribute('data-date') });
      }
    }
    else if (action === 'open-week') post({ type: 'openWeek', date: target.getAttribute('data-date') });
    else if (action === 'open-month') post({ type: 'openMonth' });
    else if (action === 'show-month') {
      const date = target.getAttribute('data-date');
      post(date ? { type: 'showMonth', month: target.getAttribute('data-month'), date: date } : { type: 'showMonth', month: target.getAttribute('data-month') });
    }
    else if (action === 'open-note') post({ type: 'openNote', filePath: target.getAttribute('data-file-path') });

    else if (action === 'set-calendar-layout') setLayout(target.getAttribute('data-value'));
    else if (action === 'set-show-repeats') post({ type: 'setShowRepeats', show: target.getAttribute('data-value') === 'on' });
    else if (action === 'set-show-weekends') post({ type: 'setShowWeekends', show: target.getAttribute('data-value') === 'on' });
    else if (action === 'step-calendar') stepCalendar(Number(target.getAttribute('data-by')));
    else if (action === 'go-today') {
      focusDate = state.today;
      pendingFocusDate = state.today;
      post({ type: 'showMonth', month: state.currentMonth, date: state.today });
    }
    else if (action === 'open-help') post({ type: 'openHelp' });
  });

  installCalendarDayPanel(post, function () { renderKeepingPlace(render); });

  // With the panel on, a click chooses a day and a double-click opens it.
  document.addEventListener('dblclick', function (event) {
    const day = event.target && event.target.closest ? event.target.closest('.calendar-grid .day') : null;
    if (!day || !state || !state.dayPanel) return;
    post({ type: 'openDay', date: day.dataset.date });
  });

  if (PAGE) {
    installViewOptions();
    // The page's own keys, away from a field: t for today, [ and ] a step,
    // m and w the layouts. ? lists them with the grid's.
    document.addEventListener('keydown', function (event) {
      if (!state || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target && event.target.closest && event.target.closest('input, textarea, select, .view-options')) return;
      const keys = {
        t: function () { focusDate = state.today; pendingFocusDate = state.today; post({ type: 'showMonth', month: state.currentMonth, date: state.today }); },
        '[': function () { stepCalendar(-1); },
        ']': function () { stepCalendar(1); },
        m: function () { setLayout('month'); },
        w: function () { setLayout('week'); },
      };
      if (!keys[event.key]) return;
      event.preventDefault();
      keys[event.key]();
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

    // A due or scheduled task dragged to another day takes that date. The
    // chip waits, faded, until the note is written and the page redrawn.
    let dragged;
    document.addEventListener('dragstart', function (event) {
      const moving = event.target && event.target.closest ? event.target.closest('.cal-chip[draggable="true"]') : null;
      if (!moving) return;
      const cell = moving.closest('.day-cell');
      dragged = { taskId: moving.getAttribute('data-task-id'), field: moving.getAttribute('data-kind') === 'scheduled' ? 'scheduled' : 'due', from: cell ? cell.getAttribute('data-drop-date') : undefined, chip: moving };
      moving.classList.add('dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', dragged.taskId);
      }
    });
    const clearDrop = function () {
      document.querySelectorAll('.day-cell.drop-target').forEach(function (cell) { cell.classList.remove('drop-target'); });
    };
    document.addEventListener('dragover', function (event) {
      const cell = dragged && event.target && event.target.closest ? event.target.closest('.day-cell') : null;
      if (!cell) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      if (!cell.classList.contains('drop-target')) {
        clearDrop();
        cell.classList.add('drop-target');
      }
    });
    document.addEventListener('drop', function (event) {
      const cell = dragged && event.target && event.target.closest ? event.target.closest('.day-cell') : null;
      if (!cell) return;
      event.preventDefault();
      clearDrop();
      const date = cell.getAttribute('data-drop-date');
      if (date && date !== dragged.from) {
        dragged.chip.classList.add('is-pending');
        post({ type: 'moveTask', taskId: dragged.taskId, field: dragged.field, date: date });
        announce('Moved "' + dragged.chip.textContent.replace(/^[↻⏳ ]+/, '') + '" to ' + date + '.');
      }
      dragged.chip.classList.remove('dragging');
      dragged = undefined;
    });
    document.addEventListener('dragend', function () {
      clearDrop();
      if (dragged) dragged.chip.classList.remove('dragging');
      dragged = undefined;
    });
  }

  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'moveRefused') {
      announce('The task was not moved.');
      return;
    }
    if (!event.data || event.data.type !== 'state') return;
    state = event.data.data;
    // A save anywhere redraws the month; the focus stays on the day it was on.
    renderKeepingPlace(render);
    if (pendingFocusDate) {
      const stepped = document.querySelector('.calendar-grid .day[data-date="' + pendingFocusDate + '"]');
      if (stepped) {
        pendingFocusDate = undefined;
        stepped.focus();
      }
    }
  });
  post({ type: 'ready' });
}());
</script>
`,
  });
}

