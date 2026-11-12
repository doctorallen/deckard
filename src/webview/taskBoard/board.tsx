/**
 * The board: the searched tasks as columns of cards, each card with its
 * checkbox and the menu that edits it, and the select that groups them.
 */
import { isBoxChecked, speakBoxStatus, StatusIcon, statusBoxProps } from '../shared/taskBox';
import { speakProgressText } from '../../domain/tasks/progressCount';
import { ProgressText } from '../shared/progressText';
import type { ComponentChild } from 'preact';

import type { CardDetailParts, TaskBoardCard, TaskBoardColumn, TaskBoardLane, TaskBoardSettings, TaskBoardSnapshot } from '../../ui/protocol/taskBoard';
import { listLaneAxes } from '../../domain/tasks/boardLanes';
import type { ActionMenuGroup, ActionMenuItem } from '../shared/actionMenu';
import { IconButton } from '../shared/buttons';
import { DueText } from '../shared/dueText';
import { EmptyState } from '../shared/emptyState';
import { LaneGrid, laneCardAttributes, type LaneCell, type LaneHead } from '../shared/lanes';
import { EllipsisIcon, PlusIcon } from '../shared/strokeIcons';
import { formatSourceLocation, plainTitle, PriorityBadge, TaskDetails, trimHeadingPath } from '../shared/taskRow';
import { ParentTag } from '../shared/tagButton';
import { TaskTitle } from '../shared/taskTitle';
import { board, boardCardKey } from './model';

/** What a card's menu reads of its task: what it is now, whether it is done, and whether it has steps. */
export interface MovableTask {
  readonly current?: readonly string[];
  readonly completed?: boolean;
  readonly steps?: unknown;
}

/** What a board's columns or lanes can be by: status, priority, due date, person, or tag. */
type TaskBoardGroupBy = TaskBoardSnapshot['groupBy'];

/** A card's lane, on a board with lanes: what they are by, every lane, and the card's own. */
export interface CardLanes {
  readonly by: TaskBoardGroupBy;
  readonly lanes: readonly TaskBoardLane[];
  readonly laneId: string;
}

/**
 * Every edit a card can make, whatever the board is grouped by: its status,
 * priority, and due date as single choices, each checked where the task is
 * and showing its key, Snooze until…, the board's other columns, its steps,
 * done, and Move to… The menu used to offer the columns of the current grouping alone, so
 * changing a due date meant regrouping the whole board first. The statuses
 * the board draws a column for come first; every other one is under More
 * statuses.
 */
export function taskCardMoves(
  card: MovableTask,
  columnId: string,
  columns: readonly TaskBoardColumn[],
  { settings, lanes }: { readonly settings: TaskBoardSettings | undefined; readonly lanes?: CardLanes },
): ActionMenuGroup[] {
  const current = card.current || [];
  const option = (value: string, label: string, key?: string): ActionMenuItem => ({
    value,
    label,
    checked: current.includes(value) || value === columnId || value === lanes?.laneId,
    ...(key ? { key } : {}),
  });
  // Done is its own choice, Complete it, below.
  const statuses = ((settings && settings.columns) || []).filter((column) => !column.fixed);
  const statusOptions = statuses.filter((column) => column.shown).map((column) => option(column.id, column.name));
  const moreOptions = statuses.filter((column) => !column.shown).map((column) => option(column.id, column.name));
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
      && !column.id.startsWith('status:') && !column.id.startsWith('priority:') && !column.id.startsWith('due:') && column.id !== 'done' && column.id !== 'cancelled')
    .map((column) => ({ value: column.id, label: column.label }));
  return [
    { label: 'Status', items: statusOptions },
    { label: 'More statuses', items: moreOptions },
    { label: 'Priority', items: priorityOptions },
    { label: 'Due', items: dueOptions },
    { label: 'Snooze', items: card.completed ? [] : [{ value: 'snooze', label: 'Snooze until…', key: 'z' }] },
    { label: 'This board', items: others },
    // Lanes by tag or person have no moves of their own above; status,
    // priority, and due date lanes are moved to by theirs.
    { label: 'Move to lane', items: lanes && (lanes.by === 'tag' || lanes.by === 'assignee') ? laneMoves(lanes) : [] },
    { label: 'For', items: [{ value: 'pick-assignee', label: 'For someone…', key: 'f' }] },
    { label: 'Steps', items: [{ value: 'break-steps', label: card.steps ? 'Add steps…' : 'Break into steps…', key: 's' }] },
    { label: 'Done', items: card.completed ? [] : [{ value: 'done', label: 'Complete it', key: 'x' }] },
    { label: 'Note', items: [{ value: 'move-to', label: 'Move to…' }] },
  ];
}

/** The lanes a card can be moved to from its menu: every other lane that takes a card. */
function laneMoves(lanes: CardLanes): ActionMenuItem[] {
  return lanes.lanes.filter((lane) => lane.droppable && lane.id !== lanes.laneId).map((lane) => ({ value: lane.id, label: lane.label }));
}

/**
 * A column's count as its header shows it, "40 / 3 · 38 overdue", and its
 * name as a screen reader hears it, with its status's character when it
 * has one: "In progress [/], 40 tasks, limit 3, 38 overdue".
 */
export function describeBoardColumn(
  { label, symbol }: { readonly label: string; readonly symbol?: string },
  count: number,
  limit: number | undefined,
  overdueCount: number,
): { count: string; name: string } {
  return {
    count: String(count) + (limit === undefined ? '' : ` / ${limit}`) + (overdueCount ? ` · ${overdueCount} overdue` : ''),
    name: `${label}${symbol === undefined ? '' : ` [${symbol}]`}, ${count}${count === 1 ? ' task' : ' tasks'}${limit === undefined ? '' : `, limit ${limit}`}${overdueCount ? `, ${overdueCount} overdue` : ''}`,
  };
}

/** A detail's words with its date kept on one line: "2026-09-01" broke at its hyphens in a narrow column. */
function withDate(detail: string, date: string | undefined): ComponentChild[] {
  const at = date ? detail.lastIndexOf(date) : -1;
  if (!date || at < 0) {
    return [detail];
  }
  return [detail.slice(0, at), <span class="board-date">{date}</span>, detail.slice(at + date.length)].filter((part) => part !== '');
}

/** The class of a detail by its tone: an overdue date, quietly or not, one due today, or a stale one. */
function detailClass(card: TaskBoardCard, tone: CardDetailParts['tone']): string | undefined {
  if (tone === 'overdue') {
    return card.overdueTone === 'quiet' ? 'overdue quiet' : 'overdue';
  }
  if (tone === 'today') {
    return 'due-today';
  }
  return tone === 'stale' ? 'stale' : undefined;
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
        // A date is drawn from the parts the host gave, since it is in the
        // reader's format; a due date in its parts, for Display's Dates
        // preference.
        const parts = card.detailParts?.find((part) => part.index === index);
        const drawn = parts?.due?.date ? <DueText parts={parts.due} dateClass="board-date" /> : withDate(detail, parts?.date);
        return <span key={`detail-${index}`} class={detailClass(card, parts?.tone)}>{drawn}</span>;
      })}
    </p>
  );
}

/** One card's draw: its task, the column it is in, and that column's place on the board; on a board with lanes, its lane. */
interface CardProps {
  readonly card: TaskBoardCard;
  readonly columnId: string;
  readonly columns: readonly TaskBoardColumn[];
  readonly lane?: TaskBoardLane;
}

/** A card's classes: done, cancelled, or neither. */
function cardClass(card: TaskBoardCard): string {
  return ['task board-card', card.completed ? 'completed' : '', card.status?.type === 'cancelled' ? 'cancelled' : ''].filter(Boolean).join(' ');
}

/** A card's box, drawn by its status, which completes or reopens it, and its status's icon. */
function CardBox({ card, title }: { readonly card: TaskBoardCard; readonly title: string }) {
  const verb = isBoxChecked(card.completed, card.status) ? 'Reopen' : 'Complete';
  const box = <input type="checkbox" tabIndex={-1} data-action="board-toggle-task" aria-label={`${verb} ${title}${speakBoxStatus(card.status)}`} data-tip={`${verb} this task`} {...statusBoxProps(card.completed, card.status)} />;
  // The icon goes under the box, in the box's own column of the card.
  return card.status?.icon === undefined ? box : <span class="task-box-with-icon">{box}<StatusIcon status={card.status} /></span>;
}

/** One task card, with its checkbox and the menu that edits it. */
function BoardCard({ card, columnId, columns, lane }: CardProps) {
  // The title as it reads names the card and its controls, not its Markdown.
  const title = plainTitle(card.titleTokens || []) || String(card.title || '');
  const fileName = String(card.filePath).split('/').pop() || card.filePath;
  // The file and line, then the headings above, go on the line the card
  // keeps for its details, as they do on a row.
  const steps = trimHeadingPath(card.headingPath, fileName, '');
  // A short name for the card as a whole, since a focused article is read in
  // full otherwise: its title, its column, and when it is due.
  const columnLabel = columns.find((column) => column.id === columnId)?.label;
  const dueDetail = (card.details || []).find((detail) => /^(due|overdue|was due)/i.test(detail));
  const cardName = [title, columnLabel, lane?.label, dueDetail, card.steps ? speakProgressText(card.steps.label) : ''].filter(Boolean).join(', ');
  // The board is one Tab stop: the card last focused, or the first. Arrow
  // keys move between cards, and a card's checkbox and menu are keys of
  // their own, so neither is a Tab stop either.
  const key = boardCardKey(columnId, card.taskId, lane?.id);
  const tabStop = key === board.tabStop;
  // A list item in its column's list, so a screen reader says how many a
  // column holds and where in it the card is: "3 of 13".
  return (
    <article
      role="listitem"
      class={cardClass(card)}
      draggable={true}
      data-tip-around=""
      data-reveal-region=""
      tabIndex={tabStop ? 0 : -1}
      aria-label={cardName}
      aria-keyshortcuts="x t m d f e s 1 2 3 4 5 [ ]"
      data-task-id={card.taskId}
      data-card-column={columnId}
      data-card-lane={lane?.id}
      data-file-path={card.filePath}
      data-line={card.line}
      {...(lane ? laneCardAttributes(key, card.taskId) : {})}
    >
      <CardBox card={card} title={title} />
      <div class="task-summary">
        <ParentTag tag={card.parentTag} />
        <div key={card.title} class="task-title"><TaskTitle tokens={card.titleTokens} tags={card.titleTags} /></div>
        <CardDetails card={card} />
        {card.steps
          ? (
            <p key="steps" class="source board-steps">
              <span class="board-steps-label"><ProgressText text={card.steps.label} /></span>
              {card.steps.next ? <span class="board-steps-next">{` · next: ${card.steps.next}`}</span> : null}
            </p>
          )
          : null}
        <TaskDetails facts={{ location: formatSourceLocation(fileName, card.line), createdAt: card.createdAt, updatedAt: card.updatedAt }} steps={steps} />
        <IconButton
          key="menu"
          action="board-menu"
          className="board-move"
          label={`Change ${title}: status, priority, or due date`}
          tip="Change this task"
          icon={<EllipsisIcon />}
          attributes={{ tabindex: '-1', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-reveal': '' }}
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

/** One column: its title and counts with its +, its cards, Show N more, and why it takes no card. */
function BoardColumn({ column, cards, columns }: ColumnProps) {
  const count = cards.length + column.hiddenCount;
  // Done and Overdue itself need no count of the overdue. The page counts
  // again from the cards typed words leave shown.
  const overdueCount = column.id === 'done' || column.id === 'due:overdue'
    ? 0
    : cards.filter((card) => card.overdue && !card.completed).length;
  const limit = column.limit;
  const described = describeBoardColumn(column, count, limit, overdueCount);
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
      data-label={column.label}
      data-symbol={column.symbol}
      data-zen-region=""
      aria-label={described.name}
    >
      <div class="board-column-head">
        <h2 class="board-column-title">
          <span class="board-column-label">
            {column.label}
            {/* The status's character, said once, in the column's name. */}
            {column.symbol === undefined ? null : <span key="symbol" class="board-column-symbol" aria-hidden="true">{`[${column.symbol}]`}</span>}
          </span>
          <span class="board-count">{described.count}</span>
        </h2>
        {/* A column that takes a drop takes a new task the same way, from
            its head: the one way to add a task into a column in one step,
            since the board has no key for it. Done takes none. Zen shows
            it while the column is pointed at or holds focus. */}
        {column.droppable && column.id !== 'done'
          ? (
            <IconButton
              key="add"
              action="board-add-task"
              className="board-add"
              label={`Add a task to ${column.label}`}
              icon={<PlusIcon />}
              attributes={{ 'data-column-id': column.id, 'data-zen-reveal': '' }}
            />
          )
          : null}
      </div>
      <ColumnCards key="cards" column={column} cards={cards} columns={columns} />
      {column.hiddenCount ? <p key="more" class="board-more"><button data-action="show-column-rest" data-column-id={column.id}>{`Show ${column.hiddenCount} more`}</button></p> : null}
      {/* One that does not take a drop says so while a card is dragged, and where to go instead. */}
      {column.droppable ? null : <p key="refuses" class="board-refuses">{refusal}</p>}
    </section>
  );
}

/**
 * The board, from the host's columns. Drawing it makes each card's menu,
 * and keeps the Tab stop on a card that is drawn; the page then hides the
 * cards the words being typed leave out, and counts the columns again.
 */
export function TaskBoard({ snapshot }: { readonly snapshot: TaskBoardSnapshot }) {
  if (snapshot.lanes && snapshot.lanesBy) {
    return <LaneTaskBoard key={`lanes-${board.generation}`} snapshot={snapshot} lanes={snapshot.lanes} by={snapshot.lanesBy} />;
  }
  board.moves = {};
  const drawn = snapshot.columns.flatMap((column) => column.cards.map((card) => boardCardKey(column.id, card.taskId)));
  if (board.tabStop === undefined || !drawn.includes(board.tabStop)) {
    board.tabStop = drawn.length ? drawn[0] : undefined;
  }
  for (const column of snapshot.columns) {
    for (const card of column.cards) {
      board.moves[boardCardKey(column.id, card.taskId)] = taskCardMoves(card, column.id, snapshot.columns, { settings: snapshot.settings });
    }
  }
  return (
    <>
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
    return (
      <div class="board-cards">
        {column.droppable
          ? <EmptyState class="board-empty" state="No tasks." teach="Drag a card here, or right-click one." />
          : <EmptyState class="board-empty" state="No tasks" />}
      </div>
    );
  }
  return (
    <div class="board-cards" role="list" aria-label={column.label}>
      {cards.map((card) => <BoardCard key={boardCardKey(column.id, card.taskId)} card={card} columnId={column.id} columns={columns} />)}
    </div>
  );
}

/**
 * How many tasks some cells hold, each once, with the ones they hold back,
 * and how many of the open ones are overdue: a column's head counts its
 * cells in every lane, and a lane's its cells in every column.
 */
export function countCells(cells: readonly TaskBoardColumn[]): { count: number; overdue: number } {
  const tasks = new Set<string>();
  const overdue = new Set<string>();
  let hidden = 0;
  for (const cell of cells) {
    hidden += cell.hiddenCount || 0;
    for (const card of cell.cards) {
      tasks.add(card.taskId);
      if (card.overdue && !card.completed) {
        overdue.add(card.taskId);
      }
    }
  }
  return { count: tasks.size + hidden, overdue: overdue.size };
}

/** A column's head on a board with lanes: its name and character, its counts over every lane, and its +. */
function LaneColumnHead({ column, count }: { readonly column: TaskBoardColumn; readonly count: string }) {
  return (
    <>
      <h2 class="lane-column-title">
        <span class="lane-column-label">
          {column.label}
          {column.symbol === undefined ? null : <span key="symbol" class="board-column-symbol" aria-hidden="true">{`[${column.symbol}]`}</span>}
        </span>
        <span class="board-count">{count}</span>
      </h2>
      {column.droppable && column.id !== 'done'
        ? (
          <IconButton
            key="add"
            action="board-add-task"
            className="board-add lane-add"
            label={`Add a task to ${column.label}`}
            icon={<PlusIcon />}
            attributes={{ 'data-column-id': column.id, 'data-zen-reveal': '' }}
          />
        )
        : null}
    </>
  );
}

/** The column heads of a board with lanes, as the lane grid draws them, each counted over every lane. */
function laneColumnHeads(snapshot: TaskBoardSnapshot, lanes: readonly TaskBoardLane[]): { heads: LaneHead[]; counts: Map<string, string> } {
  const counts = new Map<string, string>();
  const heads = snapshot.columns.map((column, at): LaneHead => {
    const counted = countCells(lanes.map((lane) => lane.cells[at]).filter(Boolean));
    const overdue = column.id === 'done' || column.id === 'due:overdue' ? 0 : counted.overdue;
    const described = describeBoardColumn(column, counted.count, column.limit, overdue);
    counts.set(column.id, described.count);
    const classes = [
      column.id === 'due:overdue' || column.id === 'due:needsdate' ? 'is-overdue' : '',
      column.limit !== undefined && counted.count > column.limit ? 'over-limit' : '',
    ].filter(Boolean).join(' ');
    return {
      id: column.id,
      label: column.label,
      count: counted.count,
      ...(classes ? { className: classes } : {}),
      // What the page counts the head again from, once words hide cards or a card moves.
      attributes: {
        'data-label': column.label,
        ...(column.symbol === undefined ? {} : { 'data-symbol': column.symbol }),
        ...(column.limit === undefined ? {} : { 'data-limit': String(column.limit) }),
      },
    };
  });
  return { heads, counts };
}

/**
 * The board with lanes (plan 46): the column heads once, counted over
 * every lane, then a lane per value of the lanes' axis, each a row of the
 * board's own columns, on the shared lane grid. A cell keeps its column's
 * rules, and the page's own moves carry a card between cells.
 */
function LaneTaskBoard({ snapshot, lanes, by }: { readonly snapshot: TaskBoardSnapshot; readonly lanes: readonly TaskBoardLane[]; readonly by: TaskBoardGroupBy }) {
  board.moves = {};
  const at = new Map(snapshot.columns.map((column, index) => [column.id, index]));
  const cellAt = (cell: LaneCell): { lane: TaskBoardLane; column: TaskBoardColumn } | undefined => {
    const lane = lanes.find((candidate) => candidate.id === cell.lane);
    const column = lane?.cells[at.get(cell.column) ?? -1];
    return lane && column ? { lane, column } : undefined;
  };
  const drawn = lanes.flatMap((lane) => lane.cells.flatMap((cell) => cell.cards.map((card) => boardCardKey(cell.id, card.taskId, lane.id))));
  if (board.tabStop === undefined || !drawn.includes(board.tabStop)) {
    board.tabStop = drawn.length ? drawn[0] : undefined;
  }
  for (const lane of lanes) {
    for (const cell of lane.cells) {
      for (const card of cell.cards) {
        board.moves[boardCardKey(cell.id, card.taskId, lane.id)] = taskCardMoves(card, cell.id, snapshot.columns, { settings: snapshot.settings, lanes: { by, lanes, laneId: lane.id } });
      }
    }
  }
  const { heads, counts } = laneColumnHeads(snapshot, lanes);
  const laneHeads = lanes.map((lane): LaneHead => ({
    id: lane.id,
    label: lane.label,
    count: countCells(lane.cells).count,
    ...(lane.droppable && lane.id !== 'done' ? { add: `Add a task to ${lane.label}` } : {}),
  }));
  return (
    <LaneGrid<TaskBoardCard>
      grid="task-board"
      label="Task board"
      level={2}
      className="task-board"
      columns={heads}
      lanes={laneHeads}
      addAction="board-add-task"
      cardsIn={(cell) => cellAt(cell)?.column.cards ?? []}
      cardKey={(card, cell) => boardCardKey(cell.column, card.taskId, cell.lane)}
      renderCard={(card, cell) => <BoardCard card={card} columnId={cell.column} columns={snapshot.columns} lane={cellAt(cell)?.lane} />}
      renderColumnHead={(head) => {
        const column = snapshot.columns[at.get(head.id) ?? -1];
        return column ? <LaneColumnHead column={column} count={counts.get(column.id) ?? String(head.count)} /> : null;
      }}
      renderCellEnd={(cell) => {
        const hidden = cellAt(cell)?.column.hiddenCount || 0;
        return hidden
          ? <p class="board-more" data-hidden-count={String(hidden)}><button data-action="show-column-rest" data-column-id={cell.column}>{`Show ${hidden} more`}</button></p>
          : null;
      }}
    />
  );
}

/** The groupings the Group select offers before Tag…, by the value each sends. */
const GROUPINGS = [['status', 'Status'], ['priority', 'Priority'], ['due', 'Due date'], ['assignee', 'Person']] as const;

/**
 * The Group select above the board: Status, Priority, Due date, Person, the
 * tag namespace the board is grouped by, if any, and Tag…, which opens a
 * menu of the namespaces in use, as the five buttons it replaces did.
 * Zen quiets it whatever it is set to, since the column heads already
 * name the grouping.
 */
export function GroupSelect({ snapshot }: { readonly snapshot: TaskBoardSnapshot }) {
  const namespace = snapshot.groupNamespace;
  const byTag = snapshot.groupBy === 'tag' && Boolean(namespace);
  const others = (snapshot.tagNamespaces || []).filter((candidate) => candidate.name !== namespace);
  let current: string = byTag ? 'tag' : snapshot.groupBy;
  if (!byTag && current === 'tag') {
    current = 'status';
  }
  return (
    <label class="control-label" data-zen-reveal="">
      Group:
      <select
        class="task-board-group"
        data-action="set-board-group"
        data-current={current}
        aria-label="Group tasks by"
        data-tip="Group the columns by status, priority, due date, person, or the tags of one namespace, such as #project/… or #context/…"
      >
        {GROUPINGS.map(([value, label]) => <option key={value} value={value} selected={current === value}>{label}</option>)}
        {byTag ? <option key="tag" value="tag" selected={true}>{`#${namespace}`}</option> : null}
        {/* Tag… is a menu of the namespaces in use, but the one chosen. */}
        <option key="pick" value="pick-namespace" disabled={others.length === 0}>Tag…</option>
      </select>
    </label>
  );
}

/** What each axis but tags is called in the Lanes select. */
const LANE_NAMES: Readonly<Record<Exclude<TaskBoardGroupBy, 'tag'>, string>> = { status: 'Status', priority: 'Priority', due: 'Due date', assignee: 'Person' };

/**
 * The Lanes select beside Group: None, every axis but Group's, in Group's
 * order, the namespace the lanes are the tags of, if any, and Tag…, which
 * opens a menu of the namespaces in use but the ones the board's columns
 * and lanes already are. Zen quiets it, as it does Group.
 */
export function LanesSelect({ snapshot }: { readonly snapshot: TaskBoardSnapshot }) {
  const namespace = snapshot.lanesNamespace;
  const byTag = snapshot.lanesBy === 'tag' && Boolean(namespace);
  const taken = new Set([namespace, snapshot.groupBy === 'tag' ? snapshot.groupNamespace : undefined]);
  const others = (snapshot.tagNamespaces || []).filter((candidate) => !taken.has(candidate.name));
  let current: string = snapshot.lanesBy ?? 'none';
  if (current === 'tag' && !byTag) {
    current = 'none';
  }
  const axes = listLaneAxes(snapshot.groupBy).filter((axis): axis is Exclude<TaskBoardGroupBy, 'tag'> => axis !== 'tag');
  return (
    <label class="control-label" data-zen-reveal="">
      Lanes:
      <select
        class="task-board-lanes"
        data-action="set-board-lanes"
        data-current={current}
        aria-label="Lanes by"
        data-tip="Split the columns into lanes by status, priority, due date, person, or the tags of one namespace, such as #team/…"
      >
        <option key="none" value="none" selected={current === 'none'}>None</option>
        {axes.map((axis) => <option key={axis} value={axis} selected={current === axis}>{LANE_NAMES[axis]}</option>)}
        {byTag ? <option key="tag" value="tag" selected={true}>{`#${namespace}`}</option> : null}
        <option key="pick" value="pick-namespace" disabled={others.length === 0}>Tag…</option>
      </select>
    </label>
  );
}
