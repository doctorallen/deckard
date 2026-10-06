/**
 * What each sort is called wherever a reader picks one: a search page's
 * gear, the Task board, and the Tasks view's Sort button. One list, so the
 * three name the same order the same way.
 */
import type { TagOverviewSortMode, TaskSortMode } from './preferences';

/** The task sorts, in the order a menu offers them. */
export const TASK_SORT_LABELS: Readonly<Record<TaskSortMode, string>> = {
  rank: 'Rank',
  created: 'Newest created',
  createdOldest: 'Oldest created',
  updated: 'Recently updated',
  updatedOldest: 'Least recently updated',
  alphabetical: 'A-Z',
  alphabeticalReverse: 'Z-A',
};

/** The note sorts of a search page, in the order its gear offers them. */
export const NOTE_SORT_LABELS: Readonly<Record<TagOverviewSortMode, string>> = {
  alphabetical: 'A-Z',
  alphabeticalReverse: 'Z-A',
  created: 'Newest created',
  createdOldest: 'Oldest created',
  updated: 'Recently updated',
  updatedOldest: 'Least recently updated',
  access: 'Most accessed',
};
