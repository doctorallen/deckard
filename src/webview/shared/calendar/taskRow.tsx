/**
 * A task in the day panel, as the template script's renderTaskListRow drew
 * it with the title shown inline: its checkbox, or a mark where it cannot
 * be completed from here; its title; and where it is written.
 *
 * This is the day panel's own copy until the shared task row exists (lane
 * A of docs/implementation/20-webviews.md writes it, with titles drawn from
 * tokens). A task's title reaches the page today only as `renderedTitle`,
 * HTML the host rendered and sanitized, which the template set as HTML; it
 * is set here the same way, in one place, with its tags made controls as
 * the template's renderTaskTitle made them.
 */
import type { ComponentChildren } from 'preact';

import type { DashboardTask } from '../../../ui/protocol/shared';

/** A tag a title names, as the protocol carries it. */
type TagReference = DashboardTask['titleTags'][number];

/** Escapes text for the title's HTML, as the template script did. */
function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** A tag's label as HTML, its namespace a prefix of its value. */
function tagLabelHtml(label: string): string {
  const match = /^([#@][^/]+\/)(.*)$/.exec(label);
  // The slash sits outside the part that shortens, so a namespace cut
  // short still reads as one: #pro…/atlas.
  return match
    ? `<span class="tag-label"><span class="tag-namespace"><span class="tag-namespace-text">${escapeHtml(match[1].slice(0, -1))}</span>/</span><span class="tag-value">${escapeHtml(match[2])}</span></span>`
    : `<span class="tag-label"><span class="tag-value">${escapeHtml(label)}</span></span>`;
}

/** A tag in a title, as a control that opens its overview. */
function tagButtonHtml(tag: TagReference): string {
  return `<button class="tag-open inline-tag" data-action="open-tag" data-tag-key="${escapeHtml(tag.key)}" data-tip-overflow="${escapeHtml(tag.label)}" aria-label="Open ${escapeHtml(tag.label)} overview">${tagLabelHtml(tag.label)}</button>`;
}

/** A character of a tag's label, safe in a regular expression. */
function escapeForPattern(character: string): string {
  return '[]{}()|^$+*?.-\\'.includes(character) ? `\\${character}` : character;
}

/** A title's words with each tag it names made a control, in its place. */
function inlineTitleHtml(title: string, references: readonly TagReference[]): string {
  const labels = references
    .map((tag) => tag.label)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  if (!labels.length) {
    return escapeHtml(title);
  }
  const pattern = new RegExp(labels.map((label) => String(label).split('').map(escapeForPattern).join('')).join('|'), 'g');
  let rendered = '';
  let offset = 0;
  title.replace(pattern, (match: string, matchOffset: number) => {
    rendered += escapeHtml(title.slice(offset, matchOffset));
    const tag = references.find((candidate) => candidate.label === match);
    rendered += tag ? tagButtonHtml(tag) : escapeHtml(match);
    offset = matchOffset + match.length;
    return match;
  });
  return rendered + escapeHtml(title.slice(offset));
}

/**
 * A task's rendered title with the tags in its text made controls, outside
 * any link or control the title already holds.
 */
export function decorateTaskTitle(renderedTitle: string, references: readonly TagReference[] | undefined): string {
  if (!references || !references.length) {
    return renderedTitle;
  }
  const template = document.createElement('template');
  template.innerHTML = renderedTitle;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const textNodes: Node[] = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }
  for (const node of textNodes) {
    if (node.parentElement && node.parentElement.closest('a, button')) {
      continue;
    }
    const source = node.nodeValue || '';
    const replacementHtml = inlineTitleHtml(source, references);
    if (replacementHtml === escapeHtml(source)) {
      continue;
    }
    const replacement = document.createElement('template');
    replacement.innerHTML = replacementHtml;
    node.parentNode?.replaceChild(replacement.content, node);
  }
  return template.innerHTML;
}

/**
 * Where an entry is written, as its file's name and line: 2026-09-22 / line 7.
 * Every note in Deckard is Markdown, so the extension says nothing.
 */
function formatSourceLocation(fileName: string, line: number): string {
  return `${String(fileName).replace(/\.md$/i, '')} / line ${line}`;
}

/** A heading's words for comparing, tags dropped and spaces closed up. */
function plainHeading(text: string | undefined): string {
  return String(text || '').replace(/[#@][\w/-]+/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

/**
 * The headings above a task, as the steps a reader would take to it, the
 * first left out when it says what the file name says, since the line above
 * names the file.
 */
function trimHeadingPath(path: readonly string[] | undefined, fileName: string): string[] {
  const stem = plainHeading(String(fileName || '').replace(/\.md$/i, ''));
  let steps = (path || []).map((part) => String(part).trim()).filter(Boolean);
  if (steps.length > 1 && plainHeading(steps[0]) === stem) {
    steps = steps.slice(1);
  }
  return steps;
}

/** The trimmed path as one line, joined by a chevron. */
function HeadingPath({ steps }: { readonly steps: readonly string[] }) {
  return (
    <span class="task-source heading-path">
      {steps.map((step, index) => (index === 0 ? step : [<span class="heading-path-joiner"> &gt; </span>, step]))}
    </span>
  );
}

/** Writes a task timestamp as the YYYY-MM-DD form the note uses. */
function formatTaskDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The marks a priority draws: an arrow for how far from the middle. */
const PRIORITY_MARKS: Readonly<Record<string, string>> = { highest: '↑↑', high: '↑', medium: '', low: '↓', lowest: '↓↓' };

/**
 * A task's priority as a badge: an arrow and the word. The word "priority"
 * is for a screen reader; the edge and the arrow say it on screen.
 */
function PriorityBadge({ priority }: { readonly priority: string | undefined }) {
  const key = String(priority || '').toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(PRIORITY_MARKS, key)) {
    return null;
  }
  const word = key.charAt(0).toUpperCase() + key.slice(1);
  const mark = PRIORITY_MARKS[key];
  return (
    <span class={`priority-badge priority-${key}`} title={`${word} priority`}>
      {mark ? <span class="priority-mark" aria-hidden="true">{mark}</span> : null}
      {word}
      <span class="visually-hidden"> priority</span>
    </span>
  );
}

/** The due date's class: overdue, stale, or neither, as the template wrote it. */
function dueDateClass(item: DashboardTask): string {
  if (item.overdue) {
    return 'due-date overdue';
  }
  return item.stale ? 'due-date stale' : 'due-date ';
}

/**
 * The due date: worded by the host beside today for an open task, so the
 * state is in the text and not in the color alone; a done task's as written.
 */
function DueDate({ item }: { readonly item: DashboardTask }) {
  if (item.dueLabel) {
    return <span class={dueDateClass(item)}>{item.dueLabel}</span>;
  }
  return item.task.dueText ? <span class="due-date">{`Due ${item.task.dueText}`}</span> : null;
}

/** What a row says under its title: parked, dates, priority, repeats, steps, and where it is written. */
function TaskMeta({ item }: { readonly item: DashboardTask }) {
  const task = item.task;
  const steps = trimHeadingPath(item.headingPath, item.fileName);
  // Each part is keyed, so a part is never drawn into another's element,
  // which would keep the title a parked label or a badge carries.
  return (
    <div class="task-meta">
      {item.parked ? <span key="parked" class="parked-label" title="Parked: left out of the Tasks view, the Task board, and Related Notes.">Parked</span> : null}
      <DueDate key="due" item={item} />
      {task.scheduledAt === undefined ? null : <span key="scheduled" class="task-detail">{`Scheduled ${formatTaskDate(task.scheduledAt)}`}</span>}
      <PriorityBadge key="priority" priority={task.priority} />
      {task.recurrence ? <span key="recurrence" class="task-detail">{`Repeats ${task.recurrence}`}</span> : null}
      {item.stepsLabel ? <span key="steps" class="task-detail task-steps">{item.stepsLabel}</span> : null}
      <span key="source" class="task-source">{formatSourceLocation(item.fileName, task.lineNumber)}</span>
      {steps.length ? <HeadingPath key="path" steps={steps} /> : null}
    </div>
  );
}

/** What a day panel row is drawn with besides its task. */
export interface DayTaskRowProps {
  readonly item: DashboardTask;
  /** What stands where the checkbox goes, for a row that cannot be completed from here. */
  readonly leading?: ComponentChildren;
  /** What follows the row's text, such as the button that moves it a day on. */
  readonly trailing?: ComponentChildren;
}

/** One task in the day panel: its checkbox, its title, and where it is written. */
export function DayTaskRow({ item, leading, trailing }: DayTaskRowProps) {
  const task = item.task;
  return (
    <div class={task.completed ? 'row task-row completed' : 'row task-row'} draggable={false} tabIndex={0} data-task-id={task.id} data-file-path={task.filePath} data-line={task.lineNumber}>
      {leading ?? <input type="checkbox" data-action="toggle-task" data-task-id={task.id} checked={task.completed} aria-label={`Toggle ${task.title}`} />}
      <div>
        {/* The host's rendered title, sanitized there, set as the template set it. */}
        <div class="task-title" dangerouslySetInnerHTML={{ __html: decorateTaskTitle(item.renderedTitle, item.titleTags) }} />
        <TaskMeta item={item} />
      </div>
      {trailing}
    </div>
  );
}
