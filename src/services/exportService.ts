import {
  ExportFormat,
  formatNotes,
  formatTasks,
  noteRows,
  taskRows,
} from '../domain/export/exportFormats';
import type { Section, Task, WorkspaceIndex } from '../domain/model';

/**
 * Taking a result set out: which results a search exports, how many, the
 * text each format makes of them, and the live query block that keeps the
 * search in a note. The reader's choice of format and destination, and the
 * copy or the save, are the export command's.
 */

/** What a page exports: its notes or its tasks. */
export type ExportKind = 'notes' | 'tasks';

/** The notes and tasks a search found. */
export interface SearchResults {
  tasks: readonly Task[];
  sections: readonly Section[];
}

/**
 * What an export offers: nothing, when there are no results, or the
 * results with the text each format makes of them, made only once a format
 * is chosen, and, for a search, the query block that stays up to date.
 */
export type ExportPlan =
  | { kind: 'nothing'; what: ExportKind }
  | {
      kind: 'results';
      what: ExportKind;
      count: number;
      text(format: ExportFormat): string;
      liveBlock?: () => string;
    };

/** What ExportService reads: the index, the search, and the query block writer. */
export interface ExportServiceOptions {
  index: { getSnapshot(): Pick<WorkspaceIndex, 'sections'> };
  /** Everything a search finds, not only the page of it on screen. */
  search(query: string): SearchResults;
  /** The query block a note keeps a search's results up to date with. */
  queryBlock(query: string): string;
}

/** Plans exports of search results, rows and formats alike. */
export class ExportService {
  /** Evaluates searches, and writes their query blocks, through `options`. */
  public constructor(private readonly options: ExportServiceOptions) {}

  /**
   * The export of everything `query` finds, of one kind, with the search
   * as a live query block. A blank query is no search, and has none.
   */
  public fromSearch(query: string, what: ExportKind): ExportPlan {
    return this.fromResults(what, this.options.search(query), query);
  }

  /**
   * The export of results already found, such as the page of every note a
   * page without a search draws, with `query` as the live block when there
   * is one.
   */
  public fromResults(what: ExportKind, results: SearchResults, query = ''): ExportPlan {
    const search = query.trim();
    const liveBlock = search ? { liveBlock: () => this.options.queryBlock(search) } : {};
    if (what === 'tasks') {
      const rows = taskRows(results.tasks, this.options.index.getSnapshot());
      return plan(what, rows.length, (format) => formatTasks(rows, format), liveBlock);
    }
    const rows = noteRows(results.sections);
    return plan(what, rows.length, (format) => formatNotes(rows, format), liveBlock);
  }
}

/** A plan for `count` results, or nothing when there are none. */
function plan(
  what: ExportKind,
  count: number,
  text: (format: ExportFormat) => string,
  live: { liveBlock?: () => string },
): ExportPlan {
  return count === 0 ? { kind: 'nothing', what } : { kind: 'results', what, count, text, ...live };
}
