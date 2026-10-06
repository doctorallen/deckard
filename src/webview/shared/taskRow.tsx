/**
 * One task in a list: its checkbox, its title, and the facts under it, as
 * the Task Board's list, a search's tasks, Home's task widgets, and the
 * calendar's day draw it; and the parts a board card draws the same way.
 */
import { ProgressText } from './progressText';
import type { ComponentChildren } from 'preact';

import type { InlineToken } from '../../ui/protocol/inline';
import type { DashboardTask, TagTitleDisplayMode } from '../../ui/protocol/shared';
import { DueText } from './dueText';
import { TaskTitle } from './taskTitle';

/** A priority's arrow: how far it is from the middle. */
const PRIORITY_MARKS: Readonly<Record<string, string>> = { highest: '↑↑', high: '↑', medium: '', low: '↓', lowest: '↓↓' };

/**
 * A task's priority as a badge: an arrow for how far from the middle, and
 * the word. The row, the board card, and the query block all draw it, so
 * priority looks like one thing everywhere. The word "priority" is for a
 * screen reader; the edge and the arrow say it on screen. Nothing for a
 * value that is no priority.
 */
export function PriorityBadge({ priority }: { readonly priority: unknown }) {
  const key = String(priority || '').toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(PRIORITY_MARKS, key)) {
    return null;
  }
  const word = key.charAt(0).toUpperCase() + key.slice(1);
  const mark = PRIORITY_MARKS[key];
  // The title is on a plain span, never on a control.
  return (
    <span class={`priority-badge priority-${key}`} title={`${word} priority`}>
      {mark ? <span class="priority-mark" aria-hidden="true">{mark}</span> : null}
      {word}
      <span class="visually-hidden"> priority</span>
    </span>
  );
}

/**
 * Said on a parked result: it stays searchable, and is left out of the
 * lists of things to do. A plain span, so its title is not on a control.
 */
export function ParkedLabel() {
  return <span class="parked-label" title="Parked: left out of the Tasks view, the Task board, and Related Notes.">Parked</span>;
}

/**
 * A title's tokens as the words a reader sees, with no Markdown in them:
 * what a control that acts on the task is named by. A screen reader read
 * "Toggle Send **the** [proposal](https://…)" before.
 */
export function plainTitle(tokens: readonly InlineToken[]): string {
  const words = (run: readonly InlineToken[]): string => run.map((token) => {
    switch (token.kind) {
      case 'text':
      case 'wikiLink':
      case 'code':
        return token.text;
      case 'break':
        return ' ';
      case 'link':
      case 'strong':
      case 'em':
      case 'del':
        return words(token.children);
      case 'image':
        return token.alt;
    }
  }).join('');
  return words(tokens).replace(/\s+/g, ' ').trim();
}

/** A task timestamp as the YYYY-MM-DD form the note uses, in local time. */
export function formatTaskDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Where an entry is written, as its file's name and line: 2026-09-22 / line 7.
 * Every note in Deckard is Markdown, so the extension says nothing.
 */
export function formatSourceLocation(fileName: string, line: number): string {
  return `${String(fileName).replace(/\.md$/i, '')} / line ${line}`;
}

/** Text as the heading path compares it: tags taken out, spaces folded, lower case. */
function plainStep(text: unknown): string {
  return String(text || '').replace(/[#@][\w/-]+/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

/**
 * The headings above an entry, as the steps a reader would take to it:
 * "Harbor check-in > Actions". The first step goes when it says what the
 * file name says, since the line above names the file; the last goes when
 * it is the entry's own title, which the card shows already.
 */
export function trimHeadingPath(path: readonly unknown[] | undefined, fileName: string, ownTitle: string): string[] {
  const stem = plainStep(String(fileName || '').replace(/\.md$/i, ''));
  const own = plainStep(ownTitle);
  let steps = (path || []).map((part) => String(part).trim()).filter(Boolean);
  if (steps.length > 1 && plainStep(steps[0]) === stem) {
    steps = steps.slice(1);
  }
  if (steps.length && own && plainStep(steps[steps.length - 1]) === own) {
    steps = steps.slice(0, -1);
  }
  return steps;
}

/** The trimmed path as one line, its steps joined by a chevron. */
export function HeadingPathSteps({ steps }: { readonly steps: readonly string[] }) {
  return (
    <>
      {steps.map((step, index) => (index > 0 ? [<span class="heading-path-joiner"> &gt; </span>, step] : step))}
    </>
  );
}

/** Where a row or card holds its title: a list's or a card's, or a table row's title cell. */
const TITLE = '.task-title, .result-title';

/**
 * A task's title as a sentence names it, from its row or card or anything
 * inside one: its words, spaces folded, or "the task" when there is none.
 */
export function taskTitleOf(element: Element | null | undefined): string {
  let row = element && element.closest ? element.closest('[data-task-id]') : null;
  // A row's checkbox carries the task's id as well, so the row is the
  // nearest element with an id that holds the title.
  while (row && !row.querySelector(TITLE)) {
    row = row.parentElement ? row.parentElement.closest('[data-task-id]') : null;
  }
  const title = row ? row.querySelector(TITLE) : null;
  return title ? String(title.textContent).trim().replace(/\s+/g, ' ') : 'the task';
}

/** How a list draws one task. */
export interface TaskListRowProps {
  readonly item: DashboardTask;
  /** A row that can be ranked by dragging it. */
  readonly draggable?: boolean;
  /** `separate` draws the title's Markdown alone, without its tags as controls. */
  readonly titleDisplay?: TagTitleDisplayMode;
  /** What stands where the checkbox goes, for a row that cannot be completed from here. */
  readonly leading?: ComponentChildren;
  /** What follows the row's text, such as its menu. */
  readonly trailing?: ComponentChildren;
  /** The kind of result the row is in a search, in `data-search-entry`, which plain words being typed match against. */
  readonly entry?: string;
  /** What follows where the task is written, before the headings above it, such as why a search listed it. */
  readonly afterSource?: ComponentChildren;
}

/** The facts under a task's title: parked, its date, when it is scheduled, its priority, repeat, and steps. */
function TaskFacts({ item }: { readonly item: DashboardTask }) {
  const task = item.task;
  // The host words an open task's due date beside today, "Overdue 15 days
  // · 2026-09-08", so the state is in the text and not in the color alone.
  // A done task keeps its date as written.
  let due: ComponentChildren = null;
  if (item.dueLabel) {
    let tone = '';
    if (item.overdue) {
      tone = 'overdue';
    } else if (item.stale) {
      tone = 'stale';
    } else if (item.dueToday) {
      tone = 'today';
    }
    due = <span key="due" class={`due-date ${tone}`}><DueText label={item.dueLabel} /></span>;
  } else if (task.dueText) {
    due = <span key="due-text" class="due-date">{`Due ${task.dueText}`}</span>;
  }
  // As written, not in capitals: the working labels read as written.
  return (
    <>
      {item.parked ? <ParkedLabel key="parked" /> : null}
      {due}
      {task.scheduledAt === undefined ? null : <span key="scheduled" class="task-detail">{`Scheduled ${formatTaskDate(task.scheduledAt)}`}</span>}
      <PriorityBadge key="priority" priority={task.priority} />
      {task.recurrence ? <span key="repeats" class="task-detail">{`Repeats ${task.recurrence}`}</span> : null}
      {item.stepsLabel ? <span key="steps" class="task-detail task-steps"><ProgressText text={item.stepsLabel} /></span> : null}
    </>
  );
}

/**
 * One task in a task list: its checkbox, title, and where it is written.
 * The headings above the task, tags stripped, go under the file and line:
 * the same two lines a note card and the sidebar show.
 */
export function TaskListRow({ item, draggable, titleDisplay, leading, trailing, entry, afterSource }: TaskListRowProps) {
  const task = item.task;
  let rowClass = 'row task-row';
  if (task.completed) {
    rowClass += ' completed';
  }
  if (draggable) {
    rowClass += ' is-draggable';
  }
  const steps = trimHeadingPath(item.headingPath, item.fileName, '');
  return (
    <div data-search-entry={entry} class={rowClass} draggable={false} tabIndex={0} data-tip-around="" data-task-id={task.id} data-file-path={task.filePath} data-line={task.lineNumber}>
      {leading === undefined
        ? <input key="toggle" type="checkbox" data-action="toggle-task" data-task-id={task.id} checked={task.completed} aria-label={`Toggle ${plainTitle(item.titleTokens) || task.title}`} />
        : leading}
      <div>
        <div key={item.task.title} class="task-title">
          <TaskTitle tokens={item.titleTokens} tags={titleDisplay === 'separate' ? undefined : item.titleTags} />
        </div>
        <div class="task-meta">
          <TaskFacts item={item} />
          <span class="task-source">{formatSourceLocation(item.fileName, task.lineNumber)}</span>
          {afterSource ?? null}
          {steps.length ? <span key="path" class="task-source heading-path"><HeadingPathSteps steps={steps} /></span> : null}
        </div>
      </div>
      {trailing}
    </div>
  );
}
