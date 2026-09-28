import { calendarIcon } from './icons';

/**
 * A chosen day of the calendar: its daily note, the tasks due, scheduled,
 * repeating, and done that day, and the notes created on it.
 *
 * The calendar page draws it beside the month, the sidebar Calendar under
 * it, and Related Notes in its own pane while the calendar page is the
 * active editor. Each page injects the sheet and the script, and calls
 * installCalendarDayPanel once with how it posts to its host, since
 * Related Notes posts through its own host to the calendar's.
 */
export function getCalendarDayCss(): string {
  return `
.repeat-mark { color: var(--muted); font-size: var(--text-sm); line-height: 20px; text-align: center; }
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
`;
}

/**
 * The script: renderCalendarDayPanel(day), and installCalendarDayPanel(send,
 * rerender). Interpolated into a page's own script, so a backslash meant for
 * the output is written doubled.
 */
export function getCalendarDayScript(): string {
  return `
  /** A chosen day, as the calendar and Related Notes show it: its title and its daily note, then what is on it. */
  function renderCalendarDayPanel(day) {
    if (!day) return '';
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


  /**
   * Wires every day panel on the page, once: a row opens its task, its
   * checkbox completes or reopens it, its button moves it on, and the
   * panel's note, create, search, and show-more controls do what they say.
   * send posts a calendar message; rerender draws the page again.
   */
  function installCalendarDayPanel(send, rerender) {
    document.addEventListener('click', function (event) {
      const panel = event.target && event.target.closest ? event.target.closest('.day-panel') : null;
      if (!panel) return;
      const target = event.target.closest('[data-action]');
      if (!target || target.getAttribute('data-action') === 'toggle-task') {
        const row = event.target.closest('.task-row');
        if (row && !event.target.closest('input, button')) send({ type: 'openTask', taskId: row.getAttribute('data-task-id') });
        return;
      }
      const action = target.getAttribute('data-action');
      if (action === 'open-note') send({ type: 'openNote', filePath: target.getAttribute('data-file-path') });
      else if (action === 'move-task') send({ type: 'moveTask', taskId: target.getAttribute('data-task-id'), field: target.getAttribute('data-field'), date: target.getAttribute('data-date') });
      else if (action === 'create-day') send({ type: 'createDay', date: target.getAttribute('data-date') });
      else if (action === 'search-created') send({ type: 'searchCreated', date: target.getAttribute('data-date') });
      else if (action === 'show-group') {
        shownGroups.add(target.getAttribute('data-group'));
        rerender();
      }
    });
    document.addEventListener('keydown', function (event) {
      const row = event.target && event.target.matches && event.target.matches('.day-panel .task-row') ? event.target : null;
      if (row && event.key === 'Enter') {
        event.preventDefault();
        send({ type: 'openTask', taskId: row.getAttribute('data-task-id') });
      }
    });
    // A task's checkbox completes it, or reopens it in Done.
    document.addEventListener('change', function (event) {
      const box = event.target;
      if (!box || !box.matches || !box.matches('.day-panel [data-action="toggle-task"]')) return;
      const row = box.closest('.task-row');
      const title = row ? row.querySelector('.task-title') : null;
      send({ type: 'toggleTask', taskId: box.getAttribute('data-task-id'), completed: box.checked });
      announce((box.checked ? 'Completed "' : 'Reopened "') + (title ? title.textContent : 'the task') + '".');
    });
  }
`;
}
