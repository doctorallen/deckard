import * as vscode from 'vscode';

import {
  createNonce,
  getBaseCss,
  getComponentScript,
  getContentSecurityPolicy,
} from './components';
import { getDeckardTheme, getDeckardThemeCss } from './themes';

/**
 * Draws the sidebar calendar: a month of weeks from Sunday to Saturday.
 * Every day and the month title is a button that asks the host to open its
 * note; the host decides what exists and what to create.
 */
export function getCalendarHtml(webview: vscode.Webview): string {
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
.calendar-header { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; }
.calendar-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.calendar-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; }
.weekday { padding: 2px 0; color: var(--muted); font: 10px var(--font-mono); text-align: center; }
/* Every day is the same three rows, whether or not it has anything to mark,
   so a note or a due count never moves the date it belongs to. */
.day { display: grid; grid-template-rows: 15px 7px 11px; justify-items: center; align-content: start; padding: 3px 0; border: 1px solid transparent; background: none; color: var(--text); font: 12px var(--font-mono); text-align: center; }
.day.outside { opacity: 0.45; }
.day.today { border-color: var(--amber); }
.day-number { line-height: 15px; }
.note-dot { width: 5px; height: 5px; margin-top: 1px; border-radius: 50%; background: var(--cyan); }
.due { color: var(--green); font-size: 9px; line-height: 11px; }
.due.overdue { color: var(--warning-orange); }
${getDeckardThemeCss(getDeckardTheme())}
</style>
</head>
<body>
<main id="app"><div class="empty">Loading calendar...</div></main>
<div id="live-status" class="visually-hidden" role="status" aria-live="polite"></div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  let state;
${getComponentScript()}
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function post(message) { vscode.postMessage(message); }

  function describeDay(day, overdue) {
    const parts = [day.date];
    if (day.isToday) parts.push('today');
    if (day.notePath) parts.push('daily note');
    if (day.dueCount > 0) parts.push(day.dueCount + (day.dueCount === 1 ? ' task ' : ' tasks ') + (overdue ? 'overdue' : 'due'));
    return parts.join(', ');
  }

  function renderDay(day) {
    const overdue = day.dueCount > 0 && day.date < state.today;
    const classes = ['day'];
    if (!day.inMonth) classes.push('outside');
    if (day.isToday) classes.push('today');
    const label = escapeHtml(describeDay(day, overdue));
    // Both rows are always drawn, empty when there is nothing to mark, so
    // the number above them sits in the same place in every cell.
    const dot = day.notePath ? '<span class="note-dot" aria-hidden="true"></span>' : '<span aria-hidden="true"></span>';
    const due = '<span class="due' + (overdue ? ' overdue' : '') + '" aria-hidden="true">' + (day.dueCount > 0 ? day.dueCount : '') + '</span>';
    // One day in the grid is tabbable at a time: the focused one, else today,
    // else the first of the month.
    const focusable = state.focusDate ? day.date === state.focusDate : day.isToday;
    return '<button type="button" class="' + classes.join(' ') + '" data-action="open-day" data-date="' + escapeHtml(day.date) + '" title="' + label + '" aria-label="' + label + '"' + (day.isToday ? ' aria-current="date"' : '') + ' tabindex="' + (focusable ? '0' : '-1') + '"><span class="day-number">' + day.day + '</span>' + dot + due + '</button>';
  }

  function renderWeek(week) {
    return week.days.map(renderDay).join('');
  }

  function render() {
    if (!state) return;
    const monthLabel = state.title + (state.notePath ? ', monthly note' : '');
    const header = '<div class="calendar-header">' +
      '<button type="button" data-action="show-month" data-month="' + escapeHtml(state.previousMonth) + '" aria-label="Previous month" title="Previous month">&lsaquo;</button>' +
      '<button type="button" class="calendar-title" data-action="open-month" title="' + escapeHtml(monthLabel) + '" aria-label="' + escapeHtml(monthLabel) + '">' + escapeHtml(state.title) + '</button>' +
      '<button type="button" data-action="show-month" data-month="' + escapeHtml(state.nextMonth) + '" aria-label="Next month" title="Next month">&rsaquo;</button>' +
      (state.month === state.currentMonth ? '' : '<button type="button" data-action="show-month" data-month="' + escapeHtml(state.currentMonth) + '">Today</button>') +
      '</div>';
    const weekdays = WEEKDAYS.map(function (name) { return '<span class="weekday">' + name + '</span>'; }).join('');
    document.getElementById('app').innerHTML = header + '<div class="calendar-grid" role="grid" aria-label="' + escapeHtml(state.title) + '">' + weekdays + state.weeks.map(renderWeek).join('') + '</div>';
  }

  /** Move the focus by days, weeks, or to the ends of a week. */
  document.addEventListener('keydown', function (event) {
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
      vscode.postMessage({ type: 'showMonth', month: month });
      return;
    } else {
      return;
    }
    event.preventDefault();
    // A step past the edge of the drawn weeks moves to the next month.
    if (!next) {
      vscode.postMessage({ type: 'showMonth', month: steps[event.key] < 0 ? state.previousMonth : state.nextMonth });
      return;
    }
    state.focusDate = next.dataset.date;
    days.forEach(function (candidate) { candidate.setAttribute('tabindex', candidate === next ? '0' : '-1'); });
    next.focus();
  });

  document.addEventListener('click', function (event) {
    const target = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
    if (!target) return;
    const action = target.getAttribute('data-action');
    if (action === 'open-day') post({ type: 'openDay', date: target.getAttribute('data-date') });
    else if (action === 'open-week') post({ type: 'openWeek', date: target.getAttribute('data-date') });
    else if (action === 'open-month') post({ type: 'openMonth' });
    else if (action === 'show-month') post({ type: 'showMonth', month: target.getAttribute('data-month') });
  });

  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'state') { state = event.data.data; render(); }
  });
  post({ type: 'ready' });
}());
</script>
</body>
</html>`;
}
