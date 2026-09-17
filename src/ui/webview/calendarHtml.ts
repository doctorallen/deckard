import * as vscode from 'vscode';

import {
  createNonce,
  getBaseCss,
  getComponentScript,
  getContentSecurityPolicy,
} from './components';
import { getDeckardTheme, getDeckardThemeCss } from './themes';

/**
 * Draws the sidebar calendar: a month of ISO weeks, Monday first. Every day,
 * every week label, and the month title is a button that asks the host to
 * open its note; the host decides what exists and what to create.
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
.calendar-grid { display: grid; grid-template-columns: auto repeat(7, minmax(0, 1fr)); gap: 2px; }
.weekday { padding: 2px 0; color: var(--muted); font: 10px var(--font-mono); text-align: center; }
.week-label { padding: 0 4px; border: 0; background: none; color: var(--muted); font: 10px var(--font-mono); }
.week-label.has-note { color: var(--cyan); }
.day { min-height: 32px; padding: 3px 0; border: 1px solid transparent; background: none; color: var(--text); font: 12px var(--font-mono); text-align: center; }
.day.outside { opacity: 0.45; }
.day.today { border-color: var(--amber); }
.note-dot { display: block; width: 5px; height: 5px; margin: 2px auto 0; border-radius: 50%; background: var(--cyan); }
.due { display: block; color: var(--green); font-size: 9px; }
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
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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
    const dot = day.notePath ? '<span class="note-dot" aria-hidden="true"></span>' : '';
    const due = day.dueCount > 0 ? '<span class="due' + (overdue ? ' overdue' : '') + '" aria-hidden="true">' + day.dueCount + '</span>' : '';
    return '<button type="button" class="' + classes.join(' ') + '" data-action="open-day" data-date="' + escapeHtml(day.date) + '" title="' + label + '" aria-label="' + label + '"' + (day.isToday ? ' aria-current="date"' : '') + '>' + day.day + dot + due + '</button>';
  }

  function renderWeek(week) {
    const label = 'Week ' + week.week + (week.notePath ? ', weekly note' : '');
    return '<button type="button" class="week-label' + (week.notePath ? ' has-note' : '') + '" data-action="open-week" data-date="' + escapeHtml(week.date) + '" title="' + escapeHtml(label) + '" aria-label="' + escapeHtml(label) + '">' + escapeHtml(week.week.slice(6)) + '</button>' + week.days.map(renderDay).join('');
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
    const weekdays = '<span class="weekday" aria-hidden="true"></span>' + WEEKDAYS.map(function (name) { return '<span class="weekday">' + name + '</span>'; }).join('');
    document.getElementById('app').innerHTML = header + '<div class="calendar-grid" role="group" aria-label="' + escapeHtml(state.title) + '">' + weekdays + state.weeks.map(renderWeek).join('') + '</div>';
  }

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
