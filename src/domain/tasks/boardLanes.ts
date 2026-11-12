import type { TaskBoardGroupBy } from '../model/preferences';

/**
 * The Task board's lanes (docs/implementation/46-boards-and-lanes.md,
 * section 2): a second axis beside Group's, whose values are rows of cells
 * across the columns. A lane is named by its column id on its own axis,
 * `priority:high` or `tag:team/payments`, so a cell is two ids, its column's
 * and its lane's, and a move into it is two edits.
 *
 * The page asks these rules which axes Lanes offers and which cells refuse
 * a card, as the card is held; the host lays out the lanes and writes the
 * move. Both sides read the same rules, so a cell the page lets a card into
 * is one the host can write.
 */

/** The axes a board's columns or lanes can be by, in the order the selects offer them. */
const AXES: readonly TaskBoardGroupBy[] = ['status', 'priority', 'due', 'assignee', 'tag'];

/**
 * The axes Lanes offers beside a board grouped by `groupBy`: every one but
 * Group's own. Tag… stays while Group is a tag, since lanes can be the tags
 * of another namespace.
 */
export function listLaneAxes(groupBy: TaskBoardGroupBy): TaskBoardGroupBy[] {
  return AXES.filter((axis) => axis === 'tag' || axis !== groupBy);
}

/** An axis of a board: what it is by, and, for tags, whose namespace. */
export interface BoardAxis {
  readonly by: TaskBoardGroupBy;
  readonly namespace?: string;
}

/**
 * Whether lanes by `lanes` can be drawn beside columns by `group`: another
 * axis, or the tags of another namespace. The same axis twice would put
 * every card on the board's diagonal.
 */
export function isLaneAxisFor(group: BoardAxis, lanes: BoardAxis): boolean {
  if (lanes.by !== group.by) {
    return true;
  }
  return lanes.by === 'tag' && (lanes.namespace ?? '').toLowerCase() !== (group.namespace ?? '').toLowerCase();
}

/** A cell of a board with lanes: its column's id and its lane's. */
export interface BoardCell {
  readonly column: string;
  readonly lane: string;
}

/** A column or a lane as the refusals read it: its id, its name, and whether a card may be moved into it. */
export interface LaneBoardHead {
  readonly id: string;
  readonly label: string;
  readonly droppable: boolean;
}

/** What a cell's refusal reads of the board: its columns and its lanes. */
export interface LaneBoardRules {
  readonly columns: readonly LaneBoardHead[];
  readonly lanes: readonly LaneBoardHead[];
}

/** Whether a column or lane id is a closed one: Done or Cancelled. */
export function isClosedColumn(id: string): boolean {
  return id === 'done' || id === 'cancelled';
}

/** Why a column or lane takes no card: a range of days has no one date to write. */
function refuseHead(head: LaneBoardHead): string {
  return head.id.startsWith('due:')
    ? 'A card cannot be dropped on a range of days. Pick its date from its ⋯ menu.'
    : 'A card cannot be dropped here.';
}

/** What closing a task as a closed column or lane does to it, as a verb. */
function closingVerb(id: string): string {
  return id === 'done' ? 'complete' : 'cancel';
}

/**
 * Why the cell `to` will not take a card from the cell `from`, said on the
 * cell while the card is held, or undefined when it will. A card's own
 * cell always takes it back.
 *
 * - A column that takes no drop, such as Overdue, refuses a card from
 *   another column, and a lane that takes none a card from another lane.
 * - With lanes by status, Done and Cancelled are lanes too, and a closed
 *   task is in its closed lane and its closed column at once, so only the
 *   cell where they meet holds it: a card is sent there instead.
 * - Done and Cancelled take a card only from its own lane, since closing a
 *   task is a write of its own that cannot also change its lane.
 */
export function refuseCellMove(from: BoardCell, to: BoardCell, rules: LaneBoardRules): string | undefined {
  if (from.column === to.column && from.lane === to.lane) {
    return undefined;
  }
  const column = rules.columns.find((head) => head.id === to.column);
  const lane = rules.lanes.find((head) => head.id === to.lane);
  if (!column || !lane) {
    return 'That cell is no longer on the board.';
  }
  if (to.column !== from.column && !column.droppable) {
    return refuseHead(column);
  }
  if (to.lane !== from.lane && !lane.droppable) {
    return refuseHead(lane);
  }
  return refuseClosedCell({ column, lane, changesLane: to.lane !== from.lane }, rules);
}

/**
 * Why a cell will not take a card for what Done and Cancelled are: with
 * lanes by status, only where a closed column meets its closed lane holds
 * a closed task; with any other lanes, a closed column takes a card only
 * from its own lane.
 */
function refuseClosedCell(
  { column, lane, changesLane }: { column: LaneBoardHead; lane: LaneBoardHead; changesLane: boolean },
  rules: LaneBoardRules,
): string | undefined {
  if (isClosedColumn(lane.id)) {
    return column.id === lane.id ? undefined : `Drop it in the ${lane.label} column to ${closingVerb(lane.id)} it.`;
  }
  if (!isClosedColumn(column.id)) {
    return undefined;
  }
  const closedLane = rules.lanes.find((head) => head.id === column.id);
  if (rules.lanes.some((head) => isClosedColumn(head.id))) {
    return `Drop it in the ${closedLane?.label ?? column.label} lane to ${closingVerb(column.id)} it.`;
  }
  return changesLane ? `${column.label} takes a card only from its own lane.` : undefined;
}
