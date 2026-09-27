import { calendarIcon } from './icons';
import * as vscode from 'vscode';

import {
  createNonce,
  getBaseCss,
  getComponentScript,
  getContentSecurityPolicy,
  getPageTailCss,
  loadingHtml,
  zenBodyAttribute,
} from './components';

/**
 * Draws the sidebar calendar: a month of weeks from Sunday to Saturday.
 * Every day, every week, and the month title is a button that asks the host
 * to open its note; the host decides what exists and what to create.
 */
export function getCalendarHtml(
  webview: vscode.Webview,
  options: {
    /**
     * The calendar page: a month or a week of days large enough to list their
     * tasks, with the day panel beside it. The sidebar's is the default.
     */
    page?: boolean;
  } = {},
): string {
  const nonce = createNonce();
  const csp = getContentSecurityPolicy(webview.cspSource, nonce);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Deckard Calendar</title>
<style nonce="${nonce}">${getBaseCss()}
/* The calendar fits a narrow sidebar rather than a reading column. */
main { max-width: none; padding: 10px; border-top: var(--edge) solid var(--amber); }
/* A sidebar is dragged narrower than a page's 280px floor, as Related Notes allows. */
body { min-width: 220px; }
.calendar-header { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; }
.calendar-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.calendar-grid { display: grid; grid-template-columns: auto repeat(7, minmax(0, 1fr)); gap: 2px; }
.calendar-row, .calendar-cell { display: contents; }
/* The week opens its note and marks whether it has one; it is not a date,
   so it is drawn as a rail beside the days rather than as another cell. */
.week-label { display: grid; align-self: stretch; width: 18px; padding: 0; border: 0; border-right: 1px solid var(--line); background: none; color: var(--muted); place-items: center; }
.week-label svg { width: 11px; height: 11px; fill: none; stroke: currentColor; stroke-width: 1.2; }
.week-label.has-note { color: var(--cyan); }
.week-label:hover, .week-label:focus-visible { color: var(--amber); background: none; }
.weekday { padding: 2px 0; color: var(--muted); font: var(--text-xs) var(--font-mono); text-align: center; }
/* Every day is the same three rows, whether or not it has anything to mark,
   so a note or a due count never moves the date it belongs to. */
.day { display: grid; grid-template-rows: 15px 7px 11px; justify-items: center; align-content: start; padding: 3px 0; border: 1px solid transparent; background: none; color: var(--text); font: var(--text-sm) var(--font-mono); text-align: center; }
/* A neighbor month's day, told apart in the muted ink rather than faded,
   which took it below a readable contrast. */
.day.outside { color: var(--muted); }
.day.today { border-color: var(--amber); }
.day-number { line-height: 15px; }
.note-dot { width: 5px; height: 5px; margin-top: 1px; border-radius: 50%; background: var(--cyan); }
.counts { display: flex; align-items: center; gap: 2px; }
.due { color: var(--green); font-size: var(--text-xs); line-height: 13px; }
.due.overdue { color: var(--warning-orange); }
.due.stale { color: var(--muted); }
/* What is scheduled is drawn hollow and never in a warning color: it is a
   plan for the day, not a deadline. */
.scheduled-count { padding: 0 1px; border: 1px solid currentColor; border-radius: 3px; color: var(--muted); font-size: var(--text-xs); line-height: 11px; }
.scheduled-count:empty { display: none; }
.scheduled-ring { width: 5px; height: 5px; border: 1px solid var(--muted); border-radius: 50%; }
/* A repeating task's later date: projected from its rule, not due, so it
   is the quietest mark, and never colored. */
.repeat-count { color: var(--muted); font-size: var(--text-xs); line-height: 11px; white-space: nowrap; }
.repeat-count:empty { display: none; }
.repeat-mark { color: var(--muted); font-size: var(--text-sm); line-height: 20px; text-align: center; }
/* The chosen day, with the panel on: filled, and underlined in the accent,
   so it reads apart from today's border. */
.day.selected { background: var(--hover-bg); color: var(--hover-fg); box-shadow: inset 0 -2px 0 var(--accent); }
.day-panel { margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--line); }
.day-panel h2 { margin: 0 0 var(--space-2); color: var(--text); font: var(--text-sm) var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.day-note { display: flex; align-items: center; gap: var(--space-2); width: 100%; min-width: 0; padding: var(--space-1) var(--space-2); text-align: left; }
.day-note svg { flex: none; width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.2; }
.day-note-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.day-note-action { flex: none; font-size: var(--text-xs); }
.day-note-line { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.day-note-line .day-note-label { color: var(--muted); }
.day-panel .empty { margin-top: var(--space-2); }
.day-group { margin-top: var(--space-3); }
.day-group > h3, .day-group > summary { margin: 0 0 var(--space-1); color: var(--muted); font: var(--text-xs) var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
.day-group .task-list { gap: var(--space-1); }
/* A row is one line in a narrow sidebar: the checkbox, the words, and its
   button, the words cut short rather than pushing the button off. */
.day-panel .task-row { grid-template-columns: 20px minmax(0, 1fr) auto; padding: var(--space-2); clip-path: none; }
.day-panel .task-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.day-move { align-self: center; min-height: 0; padding: 2px var(--space-1); font-size: var(--text-xs); letter-spacing: normal; white-space: nowrap; }
.day-more { margin-top: var(--space-1); }
.day-notes { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
.day-notes > li { min-width: 0; }
.day-panel, .day-group, .day-group .task-list { min-width: 0; }
.day-group .task-list { grid-template-columns: minmax(0, 1fr); }
.day-created { display: flex; gap: var(--space-2); width: 100%; min-width: 0; padding: var(--space-1) var(--space-2); text-align: left; }
.day-created-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.day-created-folder { flex: none; max-width: 45%; overflow: hidden; font-size: var(--text-xs); text-overflow: ellipsis; white-space: nowrap; }
${options.page ? getCalendarPageCss() : ''}
${getPageTailCss()}
</style>
</head>
<body${zenBodyAttribute()}>
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
${getComponentScript()}
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
      + '</button></span>' + week.days.map(renderDay).join('') + '</div>';
  }

  /** The focused day when it is drawn, else today, else the 1st. */
  function tabStopDate() {
    const days = [];
    state.weeks.forEach(function (week) { week.days.forEach(function (day) { days.push(day); }); });
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
    const weekdays = '<div class="calendar-row" role="row"><span class="weekday" role="columnheader" aria-label="Week"></span>' + (state.weekdays || WEEKDAYS).map(function (name) { return '<span class="weekday" role="columnheader">' + name + '</span>'; }).join('') + '</div>';
    document.getElementById('app').innerHTML = header + '<div class="calendar-grid" role="grid" aria-label="' + escapeHtml(state.title) + '"' + (state.dayPanel ? ' aria-multiselectable="false"' : '') + '>' + weekdays + state.weeks.map(renderWeek).join('') + '</div>' + renderPanel(state.selected);
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
    const weekdays = '<div class="calendar-row" role="row"><span class="weekday" role="columnheader" aria-label="Week"></span>' + (state.weekdays || WEEKDAYS).map(function (name) { return '<span class="weekday" role="columnheader">' + name + '</span>'; }).join('') + '</div>';
    const rows = (week ? [week] : state.weeks).map(renderWeek).join('');
    document.getElementById('app').innerHTML = header
      + '<div class="calendar-page-body' + (layout === 'week' ? ' is-week' : '') + '"><div class="calendar-grid" role="grid" aria-label="' + escapeHtml(title) + '" aria-multiselectable="false">' + weekdays + rows + '</div>'
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
    const date = sameDayIn(state.selectedDate || state.today, month);
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

  /** The chosen day under the month: its title and its daily note. */
  function renderPanel(day) {
    if (!state.dayPanel || !day) return '';
    const title = day.title + (day.relative ? ' · ' + day.relative : '');
    const note = day.notePath
      ? '<button type="button" class="day-note" data-action="open-note" data-file-path="' + escapeHtml(day.notePath) + '" aria-label="Open the daily note for ' + escapeHtml(day.date) + '">' + '${calendarIcon}' + '<span class="day-note-label">Daily note</span><span class="day-note-action">Open</span></button>'
      : '<div class="day-note-line"><span class="day-note-label">No daily note yet</span><button type="button" data-action="create-day" data-date="' + escapeHtml(day.date) + '" aria-label="Create the daily note for ' + escapeHtml(day.date) + '">Create</button></div>';
    return '<section class="day-panel" aria-labelledby="day-title"><h2 id="day-title">' + escapeHtml(title) + '</h2>' + note + renderDayLists(day) + '</section>';
  }

  /** The groups a reader asked to see whole, until the page reloads. */
  const shownGroups = new Set();
  const DAY_ROWS = 5;

  /** One task in the panel, with the button that moves it a day on. */
  function renderDayTask(item, field, move) {
    // A repeat's later date is opened from here, and completed where it is
    // written, on its current date.
    if (field === 'repeat') return renderTaskListRow(item, { titleDisplay: 'inline', leading: '<span class="repeat-mark" aria-hidden="true">↻</span>' });
    const trailing = field && move
      ? '<button type="button" class="day-move" data-action="move-task" data-task-id="' + escapeHtml(item.task.id) + '" data-field="' + field + '" data-date="' + escapeHtml(move.date) + '" aria-label="' + escapeHtml('Move "' + item.task.title + '" to ' + (move.label === 'Tomorrow' ? 'tomorrow, ' : 'the next day, ') + move.date) + '">' + escapeHtml(move.label) + '</button>'
      : '';
    return renderTaskListRow(item, { titleDisplay: 'inline', trailing: trailing });
  }

  function renderTaskGroup(id, label, items, field, move) {
    if (!items || !items.length) return '';
    const all = shownGroups.has(id);
    const shown = all ? items : items.slice(0, DAY_ROWS);
    const more = items.length - shown.length;
    return '<section class="day-group" aria-label="' + escapeHtml(label) + '"><h3>' + escapeHtml(label) + ' (' + items.length + ')</h3><div class="task-list">'
      + shown.map(function (item) { return renderDayTask(item, field, move); }).join('') + '</div>'
      + (more > 0 ? '<button type="button" class="day-more text-button" data-action="show-group" data-group="' + id + '">Show ' + more + ' more</button>' : '')
      + '</section>';
  }

  /** What the day holds besides its note; Nothing due or scheduled when it holds nothing. */
  function renderDayLists(day) {
    const due = renderTaskGroup('due', 'Due', day.due, 'due', day.move);
    const scheduled = renderTaskGroup('scheduled', 'Scheduled', day.scheduled, 'scheduled', day.move);
    const repeats = renderTaskGroup('repeats', 'Repeats', day.repeats, 'repeat');
    // What was finished that day, folded: unchecking one reopens it.
    const done = day.done && day.done.length
      ? '<details class="day-group"><summary>Done (' + day.done.length + ')</summary><div class="task-list">' + day.done.map(function (item) { return renderDayTask(item); }).join('') + '</div></details>'
      : '';
    return (due || scheduled || repeats ? '' : '<p class="empty">Nothing due or scheduled.</p>') + due + scheduled + repeats + done + renderCreated(day);
  }

  /** The notes written that day, by their titles, with Search all for the rest. */
  function renderCreated(day) {
    if (!day.notes || !day.notes.length) return '';
    const rest = day.notesTotal - day.notes.length;
    return '<section class="day-group" aria-label="Notes created"><h3>Notes created (' + day.notesTotal + ')</h3><ul class="day-notes">'
      + day.notes.map(function (note) {
        return '<li><button type="button" class="day-created" data-action="open-note" data-file-path="' + escapeHtml(note.filePath) + '"><span class="day-created-title">' + escapeHtml(note.title) + '</span>' + (note.folder ? '<span class="day-created-folder">' + escapeHtml(note.folder) + '</span>' : '') + '</button></li>';
      }).join('') + '</ul>'
      + (rest > 0 ? '<button type="button" class="day-more" data-action="search-created" data-date="' + escapeHtml(day.date) + '" aria-label="' + escapeHtml('Search the ' + day.notesTotal + ' notes created on ' + day.date) + '">Search all ' + day.notesTotal + '</button>' : '')
      + '</section>';
  }

  /** Marks a day as chosen at once, and tells the host after a pause. */
  function selectDay(date) {
    if (!state || !state.dayPanel || !date) return;
    state.selectedDate = date;
    document.querySelectorAll('.calendar-grid .day').forEach(function (cell) {
      const chosen = cell.dataset.date === date;
      cell.classList.toggle('selected', chosen);
      if (cell.parentElement) cell.parentElement.setAttribute('aria-selected', String(chosen));
    });
    clearTimeout(selectTimer);
    selectTimer = setTimeout(function () { post({ type: 'selectDay', date: date }); }, 120);
  }

  /** Move the focus by days, weeks, or to the ends of a week. */
  document.addEventListener('keydown', function (event) {
    const row = event.target && event.target.matches && event.target.matches('.day-panel .task-row') ? event.target : null;
    if (row && event.key === 'Enter') {
      event.preventDefault();
      post({ type: 'openTask', taskId: row.getAttribute('data-task-id') });
      return;
    }
    const day = event.target && event.target.closest ? event.target.closest('.day') : null;
    if (!day) return;
    const steps = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 };
    const days = [].slice.call(document.querySelectorAll('.calendar-grid .day'));
    const index = days.indexOf(day);
    let next;
    if (steps[event.key] !== undefined) {
      next = days[index + steps[event.key]];
    } else if (event.key === 'Home') {
      next = days[index - (index % 7)];
    } else if (event.key === 'End') {
      next = days[index - (index % 7) + 6];
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
      pendingFocusDate = shiftDate(day.dataset.date, steps[event.key]);
      focusDate = pendingFocusDate;
      post({ type: 'selectDay', date: pendingFocusDate });
      return;
    }
    if (!next) {
      if (steps[event.key] !== undefined) {
        pendingFocusDate = shiftDate(day.dataset.date, steps[event.key]);
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
    const target = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
    // A task row opens its task, anywhere but its checkbox and its button.
    if (!target || target.getAttribute('data-action') === 'toggle-task') {
      const row = event.target && event.target.closest ? event.target.closest('.day-panel .task-row') : null;
      if (row && !event.target.closest('input, button')) post({ type: 'openTask', taskId: row.getAttribute('data-task-id') });
      return;
    }
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
    else if (action === 'move-task') post({ type: 'moveTask', taskId: target.getAttribute('data-task-id'), field: target.getAttribute('data-field'), date: target.getAttribute('data-date') });
    else if (action === 'show-group') {
      shownGroups.add(target.getAttribute('data-group'));
      renderKeepingPlace(render);
    }
    else if (action === 'create-day') post({ type: 'createDay', date: target.getAttribute('data-date') });
    else if (action === 'search-created') post({ type: 'searchCreated', date: target.getAttribute('data-date') });
    else if (action === 'set-calendar-layout') setLayout(target.getAttribute('data-value'));
    else if (action === 'set-show-repeats') post({ type: 'setShowRepeats', show: target.getAttribute('data-value') === 'on' });
    else if (action === 'step-calendar') stepCalendar(Number(target.getAttribute('data-by')));
    else if (action === 'go-today') {
      focusDate = state.today;
      pendingFocusDate = state.today;
      post({ type: 'showMonth', month: state.currentMonth, date: state.today });
    }
    else if (action === 'open-help') post({ type: 'openHelp' });
  });

  // A task's checkbox completes it, or reopens it in Done.
  document.addEventListener('change', function (event) {
    const box = event.target;
    if (!box || !box.matches || !box.matches('.day-panel [data-action="toggle-task"]')) return;
    const row = box.closest('.task-row');
    const title = row ? row.querySelector('.task-title') : null;
    post({ type: 'toggleTask', taskId: box.getAttribute('data-task-id'), completed: box.checked });
    announce((box.checked ? 'Completed "' : 'Reopened "') + (title ? title.textContent : 'the task') + '".');
  });

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
</body>
</html>`;
}

/**
 * The calendar page's layout: the month, or a week, across the editor, and
 * the day panel docked beside it. Scoped under the page's own classes, so
 * the sidebar's calendar is not touched.
 */
function getCalendarPageCss(): string {
  return `
body { min-width: 0; }
main { max-width: none; padding: var(--space-5) var(--space-5) var(--space-6); }
.calendar-page-header { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-4); padding-bottom: var(--space-3); border-bottom: var(--edge) solid var(--line); }
.calendar-page-header h1 { margin: 0; }
.calendar-page-header .calendar-title { padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; white-space: normal; }
.calendar-page-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
/* The month beside the day it has chosen; under a narrow editor, above it. */
.calendar-page-body { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: var(--space-4); align-items: start; }
@media (max-width: 900px) { .calendar-page-body { grid-template-columns: minmax(0, 1fr); } }
.calendar-page-body .day-panel { position: sticky; top: var(--space-4); margin-top: 0; padding: var(--space-3); border: var(--edge) solid var(--line); background: var(--panel); }
.calendar-page-body .calendar-grid { gap: 0; border-top: 1px solid var(--line); border-left: 1px solid var(--line); }
.calendar-page-body .weekday { padding: var(--space-1) var(--space-2); border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); text-align: left; }
.calendar-page-body .week-label { width: 22px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
/* A day is a column of what is on it: the date, the daily note, its tasks. */
.calendar-page-body .day-cell { display: flex; flex-direction: column; gap: 2px; min-width: 0; min-height: 118px; padding: var(--space-1); border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.calendar-page-body.is-week .day-cell { min-height: 60vh; }
/* The chosen day is outlined in the accent, not filled: a fill is the hover
   ground, which in some themes is the ink of the links on the day. */
.calendar-page-body .day-cell.is-selected { box-shadow: inset 0 0 0 var(--edge) var(--accent); }
.calendar-page-body .day-cell.drop-target { outline: var(--edge) solid var(--amber); outline-offset: -2px; }
.calendar-page-body .day { display: block; align-self: flex-start; min-height: 0; padding: 0 var(--space-1); border: 1px solid transparent; background: none; font: var(--text-sm) var(--font-mono); text-align: left; box-shadow: none; }
.calendar-page-body .day.today { border-color: var(--amber); }
/* The chosen date keeps the sidebar's fill, which its ink is chosen for. */
.calendar-page-body .day.selected { background: var(--hover-bg); color: var(--hover-fg); }
/* The daily note and +N more are words on the day, drawn as the search
   cards' Show all is, so every theme reads them the same. */
.cal-note.cal-note, .cal-more.cal-more { align-self: flex-start; min-height: 0; margin: 0; padding: 0 var(--space-1); border: 0; border-bottom: 1px solid transparent; border-radius: 0; background: transparent; color: var(--muted); font: var(--text-xs) var(--font-mono); letter-spacing: normal; text-transform: none; white-space: nowrap; box-shadow: none; clip-path: none; transform: none; }
.cal-note.cal-note:hover, .cal-note.cal-note:focus-visible, .cal-more.cal-more:hover, .cal-more.cal-more:focus-visible { border-bottom-color: var(--accent); background: transparent; color: var(--text); }
.cal-chips { display: grid; gap: 2px; min-width: 0; }
.cal-chip { min-width: 0; overflow: hidden; padding: 1px var(--space-1); border: 1px solid var(--line); border-left: 3px solid var(--green); background: var(--panel); color: var(--text); font-size: var(--text-xs); line-height: 16px; white-space: nowrap; text-overflow: ellipsis; cursor: pointer; }
.cal-chip.tone-overdue { border-left-color: var(--danger); }
.cal-chip.tone-stale { border-left-color: var(--muted); color: var(--muted); }
/* Scheduled is a plan for the day, hollow as the sidebar draws it; a repeat
   is the rule's date, dashed and quietest. */
.cal-chip.kind-scheduled { border-left-color: var(--line-strong); background: transparent; }
.cal-chip.kind-repeat { border-style: dashed; border-left-width: 1px; background: transparent; color: var(--muted); cursor: default; }
.cal-chip[draggable="true"] { cursor: grab; }
.cal-chip.dragging, .cal-chip.is-pending { opacity: .5; }
`;
}

