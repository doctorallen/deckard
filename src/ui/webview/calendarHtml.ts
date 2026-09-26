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
.day.outside { opacity: 0.45; }
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
/* The chosen day, with the panel on: filled, and underlined in the accent,
   so it reads apart from today's border. */
.day.selected { background: var(--hover-bg); color: var(--hover-fg); box-shadow: inset 0 -2px 0 var(--accent); }
.day-panel { margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--line); }
.day-panel h2 { margin: 0 0 var(--space-2); color: var(--text); font: var(--text-sm) var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.day-note { display: flex; align-items: center; gap: var(--space-2); width: 100%; min-width: 0; padding: var(--space-1) var(--space-2); text-align: left; }
.day-note svg { flex: none; width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.2; }
.day-note-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.day-note-action { flex: none; color: var(--muted); font-size: var(--text-xs); }
.day-note-row { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.day-note-row .day-note-label { color: var(--muted); }
.day-panel .empty { margin-top: var(--space-2); }
.day-group { margin-top: var(--space-3); }
.day-group > h3, .day-group > summary { margin: 0 0 var(--space-1); color: var(--muted); font: var(--text-xs) var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
.day-group .task-list { gap: var(--space-1); }
/* A row is one line in a narrow sidebar: the checkbox, the words, and its
   button, the words cut short rather than pushing the button off. */
.day-panel .task-row { grid-template-columns: 20px minmax(0, 1fr) auto; padding: var(--space-2); clip-path: none; }
.day-panel .task-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.day-move { align-self: center; padding: 0 var(--space-2); font-size: var(--text-xs); white-space: nowrap; }
.day-more { margin-top: var(--space-1); }
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
    return parts.join(', ');
  }

  function renderDay(day) {
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
      + (ring ? '<span class="scheduled-ring"></span>' : '<span class="scheduled-count">' + (scheduled > 0 ? scheduled : '') + '</span>') + '</span>';
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

  /** The chosen day under the month: its title and its daily note. */
  function renderPanel(day) {
    if (!state.dayPanel || !day) return '';
    const title = day.title + (day.relative ? ' · ' + day.relative : '');
    const note = day.notePath
      ? '<button type="button" class="day-note" data-action="open-note" data-file-path="' + escapeHtml(day.notePath) + '" aria-label="Open the daily note for ' + escapeHtml(day.date) + '">' + '${calendarIcon}' + '<span class="day-note-label">Daily note</span><span class="day-note-action">Open</span></button>'
      : '<div class="day-note-row"><span class="day-note-label">No daily note yet</span><button type="button" data-action="create-day" data-date="' + escapeHtml(day.date) + '" aria-label="Create the daily note for ' + escapeHtml(day.date) + '">Create</button></div>';
    return '<section class="day-panel" aria-labelledby="day-title"><h2 id="day-title">' + escapeHtml(title) + '</h2>' + note + renderDayLists(day) + '</section>';
  }

  /** The groups a reader asked to see whole, until the page reloads. */
  const shownGroups = new Set();
  const DAY_ROWS = 5;

  /** One task in the panel, with the button that moves it a day on. */
  function renderDayTask(item, field, move) {
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
    // What was finished that day, folded: unchecking one reopens it.
    const done = day.done && day.done.length
      ? '<details class="day-group"><summary>Done (' + day.done.length + ')</summary><div class="task-list">' + day.done.map(function (item) { return renderDayTask(item); }).join('') + '</div></details>'
      : '';
    return (due || scheduled ? '' : '<p class="empty">Nothing due or scheduled.</p>') + due + scheduled + done;
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
    // A step past the edge of the drawn weeks moves to the next month.
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

  window.addEventListener('message', function (event) {
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
