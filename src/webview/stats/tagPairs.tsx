/**
 * Tags written together: the most-used tags, each pair's count of notes and
 * tasks carrying both, as an upper triangle of cells, or, for a screen
 * reader or a narrow panel, as a list by count. A cell opens the search for
 * both tags.
 */
import type { StatsTagPairs } from '../../ui/protocol/stats';
import { TagLabel } from '../shared/tagLabel';

/** One pair with a count: the two tags' rows in the grid, and how many entries carry both. */
interface Pair {
  readonly row: number;
  readonly column: number;
  readonly count: number;
}

/** The pairs written together at least once, and the largest count, which sets each cell's shade. */
function listPairs(data: StatsTagPairs): { pairs: Pair[]; most: number } {
  const pairs: Pair[] = [];
  let most = 0;
  data.tags.forEach((_, row) => {
    data.tags.forEach((__, column) => {
      if (column <= row) {
        return;
      }
      const count = data.pairs[row][column];
      if (count > 0) {
        pairs.push({ row, column, count });
      }
      most = Math.max(most, count);
    });
  });
  return { pairs, most };
}

/** One pair and its count, in words: "#design and #vendor: 2 entries". */
function describePair(data: StatsTagPairs, row: number, column: number): string {
  const count = data.pairs[row][column];
  return `${data.tags[row][1]} and ${data.tags[column][1]}: ${count}${count === 1 ? ' entry' : ' entries'}`;
}

/**
 * One cell of the grid: an empty mark, or a button shaded by its share of
 * the largest count. Every cell starts out of the tab order; the page makes
 * the first its one tab stop after each draw, and the arrows move it.
 */
function PairCell({ data, row, column, most }: { readonly data: StatsTagPairs; readonly row: number; readonly column: number; readonly most: number }) {
  const count = data.pairs[row][column];
  if (!count) {
    return <td><span class="pair-empty"></span></td>;
  }
  const step = Math.max(1, Math.ceil((count / most) * 5));
  const words = describePair(data, row, column);
  return (
    <td>
      <button type="button" class="pair-cell" data-action="open-pair" data-row={row} data-column={column} tabIndex={-1} aria-label={`${words}. Open a search for both`} data-tip={words}>
        <span class={`pair-swatch step-${step}`} aria-hidden="true"></span>
        {count}
      </button>
    </td>
  );
}

/** The grid: a column per tag but the first, a row per tag but the last, and cells above the diagonal. */
function PairGrid({ data, most }: { readonly data: StatsTagPairs; readonly most: number }) {
  const tags = data.tags;
  return (
    <table class="pair-grid" role="grid" aria-labelledby="pairs-heading">
      <thead>
        <tr>
          <td></td>
          {tags.slice(1).map((tag) => <th scope="col" title={tag[1]}><span class="pair-col"><TagLabel label={tag[1]} /></span></th>)}
        </tr>
      </thead>
      <tbody>
        {tags.slice(0, -1).map((tag, row) => (
          <tr>
            <th scope="row" title={tag[1]}><TagLabel label={tag[1]} /></th>
            {tags.slice(1).map((_, at) => (at + 1 <= row ? <td></td> : <PairCell data={data} row={row} column={at + 1} most={most} />))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The pairs as a list, most written together first. */
function PairList({ data, pairs }: { readonly data: StatsTagPairs; readonly pairs: readonly Pair[] }) {
  const sorted = [...pairs].sort((left, right) => right.count - left.count || left.row - right.row || left.column - right.column);
  return (
    <ol class="list pair-list">
      {sorted.map((pair) => (
        <li>
          <button type="button" class="row pair-row" data-action="open-pair" data-row={pair.row} data-column={pair.column} data-tip="Open a search for both tags">
            <span class="label pair">
              <TagLabel label={data.tags[pair.row][1]} />
              {' and '}
              <TagLabel label={data.tags[pair.column][1]} />
            </span>
            <strong class="count">{pair.count}</strong>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Tags written together, when two of the most-used tags are; nothing otherwise. */
export function TagPairsSection({ data, asTable }: { readonly data: StatsTagPairs | undefined; readonly asTable: boolean }) {
  if (!data || data.tags.length < 2) {
    return null;
  }
  const { pairs, most } = listPairs(data);
  if (!pairs.length) {
    return null;
  }
  return (
    <section class={asTable ? 'stats-section tag-pairs as-table' : 'stats-section tag-pairs'} aria-labelledby="pairs-heading">
      <div class="pairs-head">
        <h2 id="pairs-heading">Tags written together</h2>
        <button type="button" class="pairs-toggle" data-action="toggle-pairs-table" aria-pressed={asTable} data-tip="List the pairs by how often they are written together">Show as a table</button>
      </div>
      <PairGrid data={data} most={most} />
      <PairList data={data} pairs={pairs} />
    </section>
  );
}

/** The grid's cells, in the order the page draws them. */
function pairCells(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.pair-grid .pair-cell')];
}

/**
 * Makes the first cell the grid's one tab stop, as each draw of the page
 * always has; the arrows move it from there until the next draw.
 */
export function settlePairFocus(): void {
  const cells = pairCells();
  if (!cells.length) {
    return;
  }
  cells.forEach((cell) => cell.setAttribute('tabindex', '-1'));
  cells[0].setAttribute('tabindex', '0');
}

/** How each arrow key moves through the grid, in rows and columns. */
const ARROW_STEPS = new Map<string, readonly [number, number]>([
  ['ArrowRight', [0, 1]],
  ['ArrowLeft', [0, -1]],
  ['ArrowDown', [1, 0]],
  ['ArrowUp', [-1, 0]],
]);

/**
 * Moves the tab stop and focus from a cell to the next cell an arrow key
 * points to, skipping empty ones, and says whether the key was an arrow,
 * which the page then keeps from scrolling. `size` is how many tags the
 * grid has.
 */
export function movePairFocus(from: HTMLElement, key: string, size: number): boolean {
  const step = ARROW_STEPS.get(key);
  if (!step) {
    return false;
  }
  const cells = pairCells();
  const at = (row: number, column: number): HTMLElement | undefined =>
    cells.find((cell) => Number(cell.dataset.row) === row && Number(cell.dataset.column) === column);
  for (let row = Number(from.dataset.row) + step[0], column = Number(from.dataset.column) + step[1];
    row >= 0 && column >= 0 && row < size && column < size;
    row += step[0], column += step[1]) {
    const next = at(row, column);
    if (next) {
      cells.forEach((cell) => cell.setAttribute('tabindex', '-1'));
      next.setAttribute('tabindex', '0');
      next.focus();
      return true;
    }
  }
  return true;
}
