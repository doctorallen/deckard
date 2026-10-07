import { formatIsoDate } from '../../domain/markdown/calendar';
import type { QueryContext } from '../../domain/query/queryContext';
import { describeTagProgressParts, TagProgress, TagProgressPartKind } from '../../domain/tasks/tagProgress';

/** One part of a progress line's words, and the search that lists the tasks it counts, when it counts any. */
export interface ProgressPartLink {
  text: string;
  query?: string;
  tip?: string;
}

/**
 * A progress line's words, part by part, each that counts tasks with the
 * search that lists just those: "3/8 done (38%)" the done ones, "1 overdue",
 * "1 needs a new date", and "next due today" the ones due that day.
 * `counted` turns a part's terms into the whole search, scoped as the
 * progress was counted, by a tag or by a note; `whose` names that scope in
 * each link's tip, "the tag’s" or "this note’s".
 */
export function linkProgressParts(
  progress: TagProgress,
  context: Pick<QueryContext, 'now' | 'taskPolicy'> & Partial<Pick<QueryContext, 'dateFormats'>>,
  counted: (terms: string) => string,
  whose: string,
): ProgressPartLink[] {
  const searches: Record<TagProgressPartKind, { query: string; tip: string } | undefined> = {
    done: progress.done > 0 ? { query: counted('is:done'), tip: `Search ${whose} done tasks` } : undefined,
    overdue: { query: counted('is:overdue -is:needs-date'), tip: `Search ${whose} overdue tasks` },
    needsDate: { query: counted('is:needs-date'), tip: `Search ${whose} tasks that need a new date` },
    nextDue: progress.nextDue
      ? { query: counted(`is:open due = ${formatIsoDate(progress.nextDue.dueAt)}`), tip: `Search ${whose} tasks due next` }
      : undefined,
    allDone: undefined,
  };
  return describeTagProgressParts(progress, context.now, context.taskPolicy, context.dateFormats).map((part) => ({ text: part.text, ...searches[part.kind] }));
}
