/**
 * The board: the searched tasks as columns of cards, each card with its
 * checkbox and the menu that edits it, and the switch that groups them.
 */
import type { ComponentChild } from 'preact';

import type { TaskBoardCard, TaskBoardColumn, TaskBoardSettings, TaskBoardSnapshot } from '../../ui/protocol/taskBoard';
import type { ActionMenuGroup, ActionMenuItem } from '../shared/actionMenu';
import { IconButton } from '../shared/buttons';
import { EllipsisIcon } from '../shared/strokeIcons';
import { formatSourceLocation, HeadingPathSteps, plainTitle, PriorityBadge, trimHeadingPath } from '../shared/taskRow';
import { TaskTitle } from '../shared/taskTitle';
import { board, boardCardKey } from './model';

/** What a card's menu reads of its task: what it is now, whether it is done, and whether it has steps. */
export interface MovableTask {
  readonly current?: readonly string[];
  readonly completed?: boolean;
  readonly steps?: unknown;
}

/** A status as its menu item says it: capitalized, dashes and underscores as spaces. */
function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/[-_]+/g, ' ');
}

/**
 * Every edit a card can make, whatever the board is grouped by: its status,
 * priority, and due date as single choices, each checked where the task is
 * and showing its key, the board's other columns, its steps, done, and Move
 * to… The menu used to offer the columns of the current grouping alone, so
 * changing a due date meant regrouping the whole board first.
 */
export function taskCardMoves(card: MovableTask, columnId: string, columns: readonly TaskBoardColumn[], settings: TaskBoardSettings | undefined): ActionMenuGroup[] {
  const current = card.current || [];
  const option = (value: string, label: string, key?: string): ActionMenuItem => ({
    value,
    label,
    checked: current.includes(value) || value === columnId,
    ...(key ? { key } : {}),
  });
  const statuses = (settings && settings.statuses) || [];
  const statusOptions = [option('status:', 'No status'), ...statuses.map((status) => option(`status:${status}`, statusLabel(status)))];
  const priorityOptions = ([['highest', 'Highest', '1'], ['high', 'High', '2'], ['medium', 'Medium', '3'], ['low', 'Low', '4'], ['lowest', 'Lowest', '5'], ['', 'No priority', '0']] as const)
    .map(([value, label, key]) => option(`priority:${value}`, label, key));
  const dueOptions: ActionMenuItem[] = [
    ...([['today', 'Due today', 't'], ['tomorrow', 'Due tomorrow', 'm'], ['', 'No due date', undefined]] as const).map(([value, label, key]) => option(`due:${value}`, label, key)),
    { value: 'pick-date', label: 'Due on a date…', key: 'd' },
  ];
  // Any column of the current grouping that is not one of the above, such
  // as a due band the board made, still moves the card.
  const others = columns
    .filter((column) => column.droppable && column.id !== columnId
      && !column.id.startsWith('status:') && !column.id.startsWith('priority:') && !column.id.startsWith('due:') && column.id !== 'done')
    .map((column) => ({ value: column.id, label: column.label }));
  return [
    { label: 'Status', items: statusOptions },
    { label: 'Priority', items: priorityOptions },
    { label: 'Due', items: dueOptions },
    { label: 'This board', items: others },
    { label: 'Steps', items: [{ value: 'break-steps', label: card.steps ? 'Add steps…' : 'Break into steps…', key: 's' }] },
    { label: 'Done', items: card.completed ? [] : [{ value: 'done', label: 'Complete it', key: 'x' }] },
    { label: 'Note', items: [{ value: 'move-to', label: 'Move to…' }] },
  ];
}

/**
 * A column's count as its header shows it, "40 / 3 · 38 overdue", and its
 * name as a screen reader hears it.
 */
export function describeBoardColumn(label: string, count: number, limit: number | undefined, overdueCount: number): { count: string; name: string } {
  return {
    count: String(count) + (limit === undefined ? '' : ` / ${limit}`) + (overdueCount ? ` · ${overdueCount} overdue` : ''),
    name: `${label}, ${count}${count === 1 ? ' task' : ' tasks'}${limit === undefined ? '' : `, limit ${limit}`}${overdueCount ? `, ${overdueCount} overdue` : ''}`,
  };
}

/** A detail's words with each date in it kept on one line: "2026-09-01" broke at its hyphens in a narrow column. */
function withDates(detail: string): ComponentChild[] {
  const drawn: ComponentChild[] = [];
  let offset = 0;
  for (const match of detail.matchAll(/\d{4}-\d{2}-\d{2}/g)) {
    const at = match.index ?? 0;
    if (at > offset) {
      drawn.push(detail.slice(offset, at));
    }
    drawn.push(<span class="board-date">{match[0]}</span>);
    offset = at + match[0].length;
  }
  if (offset < detail.length) {
    drawn.push(detail.slice(offset));
  }
  return drawn;
}

/** The class of a detail: an overdue date, quietly or not, one due today, or a stale one. */
function detailClass(card: TaskBoardCard, detail: string): string | undefined {
  // The host words the due date, "overdue 15 days · 2026-09-08", so the
  // state is in the text; the page only colors it.
  const overdue = card.overdue && detail.startsWith('overdue');
  if (overdue) {
    return card.overdueTone === 'quiet' ? 'overdue quiet' : 'overdue';
  }
  if (detail.startsWith('due today')) {
    return 'due-today';
  }
  return card.stale && detail.startsWith('was due') ? 'stale' : undefined;
}

/** The short facts under a card's title; priority is the badge the task rows draw. */
function CardDetails({ card }: { readonly card: TaskBoardCard }) {
  return (
    <p class="source board-details">
      {card.details.map((detail, index) => {
        // The host words priority as "high priority"; the card draws the
        // badge the task rows draw, so it is told from the due date beside it.
        const priority = /^(highest|high|medium|low|lowest) priority$/.exec(detail);
        if (priority) {
          return <PriorityBadge key={`priority-${index}`} priority={priority[1]} />;
        }
        return <span key={`detail-${index}`} class={detailClass(card, detail)}>{withDates(detail)}</span>;
      })}
    </p>
  );
}

/** One card's draw: its task, the column it is in, and that column's place on the board. */
interface CardProps {
  readonly card: TaskBoardCard;
  readonly columnId: string;
  readonly columns: readonly TaskBoardColumn[];
}

/** One task card, with its checkbox and the menu that edits it. */
function BoardCard({ card, columnId, columns }: CardProps) {
  // The title as it reads names the card and its controls, not its Markdown.
  const title = plainTitle(card.titleTokens || []) || String(card.title || '');
  const fileName = String(card.filePath).split('/').pop() || card.filePath;
  // The file and line, then the headings above, fold under the card as they
  // do under a row.
  const steps = trimHeadingPath(card.headingPath, fileName, '');
  // A short name for the card as a whole, since a focused article is read in
  // full otherwise: its title, its column, and when it is due.
  const columnLabel = columns.find((column) => column.id === columnId)?.label;
  const dueDetail = (card.details || []).find((detail) => /^(due|overdue|was due)/i.test(detail));
  const cardName = [title, columnLabel, dueDetail, card.steps ? card.steps.label : ''].filter(Boolean).join(', ');
  // The board is one Tab stop: the card last focused, or the first. Arrow
  // keys move between cards, and a card's checkbox and menu are keys of
  // their own, so neither is a Tab stop either.
  const tabStop = boardCardKey(columnId, card.taskId) === board.tabStop;
  // A list item in its column's list, so a screen reader says how many a
  // column holds and where in it the card is: "3 of 13".
  return (
    <article
      role="listitem"
      class={card.completed ? 'task board-card completed' : 'task board-card'}
      draggable={true}
      data-tip-around=""
      tabIndex={tabStop ? 0 : -1}
      aria-label={cardName}
      aria-keyshortcuts="x t m d e s 1 2 3 4 5 [ ]"
      data-task-id={card.taskId}
      data-card-column={columnId}
      data-file-path={card.filePath}
      data-line={card.line}
    >
      <input type="checkbox" tabIndex={-1} data-action="board-toggle-task" aria-label={`${card.completed ? 'Reopen ' : 'Complete '}${title}`} data-tip={`${card.completed ? 'Reopen' : 'Complete'} this task`} checked={card.completed} />
      <div class="task-summary">
        <div key={card.title} class="task-title"><TaskTitle tokens={card.titleTokens} tags={card.titleTags} /></div>
        <CardDetails card={card} />
        {card.steps
          ? (
            <p key="steps" class="source board-steps">
              <span class="board-steps-label">{card.steps.label}</span>
              {card.steps.next ? <span class="board-steps-next">{` · next: ${card.steps.next}`}</span> : null}
            </p>
          )
          : null}
        <span key="source" class="task-source">{formatSourceLocation(fileName, card.line)}</span>
        {steps.length ? <span key="path" class="task-source heading-path"><HeadingPathSteps steps={steps} /></span> : null}
        <IconButton
          key="menu"
          action="board-menu"
          className="board-move"
          label={`Change ${title}: status, priority, or due date`}
          tip="Change this task"
          icon={<EllipsisIcon />}
          attributes={{ tabindex: '-1', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }}
        />
      </div>
    </article>
  );
}

/** One column's draw: the column, its cards, and the board's columns and settings. */
interface ColumnProps {
  readonly column: TaskBoardColumn;
  readonly cards: readonly TaskBoardCard[];
  readonly columns: readonly TaskBoardColumn[];
}

/** One column: its title and counts, + Add task, its cards, Show N more, and why it takes no card. */
function BoardColumn({ column, cards, columns }: ColumnProps) {
  const count = cards.length + column.hiddenCount;
  // Done and Overdue itself need no count of the overdue. The page counts
  // again from the cards typed words leave shown.
  const overdueCount = column.id === 'done' || column.id === 'due:overdue'
    ? 0
    : cards.filter((card) => card.overdue && !card.completed).length;
  const limit = column.limit;
  const described = describeBoardColumn(column.label, count, limit, overdueCount);
  let className = 'board-column';
  if (column.id === 'due:overdue') {
    className += ' is-overdue';
  }
  if (limit !== undefined && count > limit) {
    className += ' over-limit';
  }
  const refusal = column.id.startsWith('due:') ? 'A card cannot be dropped on a range of days. Pick its date from its ⋯ menu.' : 'A card cannot be dropped here.';
  return (
    <section
      class={className}
      data-column-id={column.id}
      data-droppable={String(column.droppable)}
      data-hidden-count={String(column.hiddenCount || 0)}
      data-limit={limit === undefined ? undefined : String(limit)}
      aria-label={described.name}
    >
      <h2 class="board-column-title"><span>{column.label}</span><span class="board-count">{described.count}</span></h2>
      {/* A column that takes a drop takes a new task the same way, from under its title. */}
      {column.droppable && column.id !== 'done'
        ? <button key="add" type="button" class="board-add" data-action="board-add-task" data-column-id={column.id} data-tip={`Capture a task straight into ${column.label}`}>+ Add task</button>
        : null}
      <ColumnCards key="cards" column={column} cards={cards} columns={columns} />
      {column.hiddenCount ? <p key="more" class="board-more"><button data-action="show-column-rest" data-column-id={column.id}>{`Show ${column.hiddenCount} more`}</button></p> : null}
      {/* One that does not take a drop says so while a card is dragged, and where to go instead. */}
      {column.droppable ? null : <p key="refuses" class="board-refuses">{refusal}</p>}
    </section>
  );
}

/**
 * Grouped by status with almost no statuses written, the board is one tall
 * column and four near-empty ones. Say so, and offer the grouping that works
 * for any task, before the reader takes the board for broken.
 */
function StatusHint({ hint, namespace }: { readonly hint: { withoutStatus: number; open: number }; readonly namespace: string }) {
  return (
    <p class="board-hint">
      {`${hint.withoutStatus} of ${hint.open} open tasks have no status. Write a `}
      <code>{`#${namespace}/todo`}</code>
      {' tag on a task, or drag a card into a column, to give it one. '}
      <button type="button" data-action="set-board-group" data-group="due">Group by due date</button>
    </p>
  );
}

/**
 * The board, from the host's columns. Drawing it makes each card's menu,
 * and keeps the Tab stop on a card that is drawn; the page then hides the
 * cards the words being typed leave out, and counts the columns again.
 */
export function TaskBoard({ snapshot }: { readonly snapshot: TaskBoardSnapshot }) {
  board.moves = {};
  const drawn = snapshot.columns.flatMap((column) => column.cards.map((card) => boardCardKey(column.id, card.taskId)));
  if (board.tabStop === undefined || !drawn.includes(board.tabStop)) {
    board.tabStop = drawn.length ? drawn[0] : undefined;
  }
  for (const column of snapshot.columns) {
    for (const card of column.cards) {
      board.moves[boardCardKey(column.id, card.taskId)] = taskCardMoves(card, column.id, snapshot.columns, snapshot.settings);
    }
  }
  return (
    <>
      {snapshot.statusHint ? <StatusHint key="hint" hint={snapshot.statusHint} namespace={(snapshot.settings && snapshot.settings.statusNamespace) || 'status'} /> : null}
      <div key={`board-${board.generation}`} class="board task-board" role="group" aria-label="Task board">
        {snapshot.columns.map((column) => <BoardColumn key={column.id} column={column} cards={column.cards} columns={snapshot.columns} />)}
      </div>
    </>
  );
}

/**
 * A column's cards, as a list a screen reader counts, or what to do with
 * an empty column: drag, or a card's menu, for a reader who cannot drag.
 */
function ColumnCards({ column, cards, columns }: { readonly column: TaskBoardColumn; readonly cards: readonly TaskBoardCard[]; readonly columns: readonly TaskBoardColumn[] }) {
  if (!cards.length) {
    return <div class="board-cards"><p class="board-empty">{column.droppable ? 'No tasks. Drag a card here, or move one with its ⋯ menu.' : 'No tasks'}</p></div>;
  }
  return (
    <div class="board-cards" role="list" aria-label={column.label}>
      {cards.map((card) => <BoardCard key={boardCardKey(column.id, card.taskId)} card={card} columnId={column.id} columns={columns} />)}
    </div>
  );
}

/** The Status, Priority, Due date, Person, and Tag… switch above the board. */
export function GroupSwitch({ snapshot }: { readonly snapshot: TaskBoardSnapshot }) {
  const groupBy = snapshot.groupBy;
  const namespace = snapshot.groupNamespace;
  const namespaces = snapshot.tagNamespaces || [];
  const byTag = groupBy === 'tag' && Boolean(namespace);
  const none = namespaces.length === 0 && !byTag;
  let tip: string | undefined;
  if (!none) {
    tip = byTag ? `Grouped by #${namespace}/… tags. Choose another namespace` : 'Group by the tags in one namespace, such as #project/… or #context/…';
  }
  return (
    <div class="segmented task-board-group" role="group" aria-label="Group tasks by">
      {([['status', 'Status'], ['priority', 'Priority'], ['due', 'Due date'], ['assignee', 'Person']] as const).map(([value, label]) => {
        const active = value === groupBy;
        return <button type="button" class={active ? 'active' : ''} data-action="set-board-group" data-group={value} aria-pressed={active}>{label}</button>;
      })}
      {/* Tag… is a menu of the namespaces in use, and names the one chosen. */}
      <button
        type="button"
        class={byTag ? 'active' : ''}
        data-action="pick-board-namespace"
        aria-haspopup="menu"
        aria-expanded="false"
        aria-pressed={byTag}
        aria-disabled={none ? 'true' : undefined}
        data-tip-disabled={none ? 'No open task carries a namespaced tag such as #context/phone yet' : undefined}
        data-tip={tip}
      >
        {byTag ? `#${namespace}` : 'Tag…'}
      </button>
    </div>
  );
}
