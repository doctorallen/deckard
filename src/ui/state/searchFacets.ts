import { collectQueryTagKeys, quoteValue } from '../../core/query/queryFormat';
import { parseQuery } from '../../core/query/queryParser';
import { QueryFacet, QueryFacetValue } from '../../core/query/queryTypes';
import {
  ParsedFile,
  Section,
  Task,
  WorkspaceIndex,
} from '../../core/types';
import { resolveIndexedTagKey } from '../../core/workspace/tagNavigation';

/**
 * Counts what a set of results could still be narrowed by.
 *
 * This is faceted search as Flamenco described it: every value shows how many
 * of the current results it would keep, a value that would keep none or all
 * of them is left out so a click can never lead to an empty page or change
 * nothing, and each value carries the clause that adds it to the query, so
 * refining by facet and writing a query are the same thing.
 */
export type SearchFacetValue = QueryFacetValue;
export type SearchFacet = QueryFacet;

export interface FacetSource {
  sections: readonly Section[];
  tasks: readonly Task[];
  files: readonly ParsedFile[];
}

export interface FacetOptions {
  /**
   * Whether to count tags. A single tag's overview already lists its
   * associated tags, ranked better than a count can.
   */
  includeTags?: boolean;
  now?: number;
}

const TAG_VALUE_LIMIT = 10;
const FOLDER_VALUE_LIMIT = 8;
const DAY = 24 * 60 * 60 * 1000;

export function buildSearchFacets(
  index: WorkspaceIndex,
  source: FacetSource,
  queryText: string,
  options: FacetOptions = {},
): SearchFacet[] {
  const now = options.now ?? Date.now();
  const total = source.sections.length + source.files.length + source.tasks.length;
  if (total === 0) {
    return [];
  }
  const facet = (
    id: SearchFacet['id'],
    label: string,
    candidates: SearchFacetValue[],
    limit = candidates.length,
  ): SearchFacet => ({
    id,
    label,
    values: candidates
      .filter(
        (value) =>
          value.count > 0 &&
          value.count < total &&
          !isWritten(queryText, value.clause),
      )
      .slice(0, limit),
    applied: candidates
      .map((value) => value.clause)
      .filter((clause) => isWritten(queryText, clause)),
  });

  const today = startOfDay(now);
  const facets: SearchFacet[] = [];
  const tasks = source.tasks;

  facets.push(
    facet('status', 'Tasks', [
      { label: 'Open', clause: 'is:open', count: tasks.filter((task) => !task.completed).length },
      { label: 'Done', clause: 'is:done', count: tasks.filter((task) => task.completed).length },
    ]),
  );

  facets.push(
    facet('due', 'Due', [
      {
        label: 'Overdue',
        clause: 'is:overdue',
        count: tasks.filter(
          (task) => !task.completed && task.dueAt !== undefined && task.dueAt < today,
        ).length,
      },
      {
        label: 'Next 7 days',
        clause: '(due >= today AND due < 7d)',
        count: tasks.filter(
          (task) =>
            task.dueAt !== undefined &&
            task.dueAt >= today &&
            task.dueAt < today + 7 * DAY,
        ).length,
      },
      {
        label: 'Later',
        clause: 'due >= 7d',
        count: tasks.filter(
          (task) => task.dueAt !== undefined && task.dueAt >= today + 7 * DAY,
        ).length,
      },
      {
        label: 'No date',
        clause: 'no:due',
        count: tasks.filter((task) => task.dueAt === undefined).length,
      },
    ]),
  );

  if (options.includeTags !== false) {
    const tags = facet('tags', 'Tags', countTags(index, source, queryText), TAG_VALUE_LIMIT);
    // The tags a query names are not offered again, but they are this
    // facet's applied values, so another tag can be ORed with one.
    tags.applied = collectQueryTagKeys(parseQuery(queryText).node).filter((tagKey) =>
      isWritten(queryText, tagKey),
    );
    facets.push(tags);
  }

  const noteTimes = [
    ...source.sections.map((section) => section.updatedAt),
    ...source.files.map((file) => file.updatedAt),
  ];
  const weekStart = today - 6 * DAY;
  const monthStart = today - 29 * DAY;
  facets.push(
    facet('updated', 'Updated', [
      {
        label: 'This week',
        clause: 'updated >= 7d',
        count: noteTimes.filter((time) => time !== undefined && time >= weekStart).length,
      },
      {
        label: 'This month',
        clause: '(updated < 7d AND updated >= 30d)',
        count: noteTimes.filter(
          (time) => time !== undefined && time < weekStart && time >= monthStart,
        ).length,
      },
      {
        label: 'Older',
        clause: 'updated < 30d',
        count: noteTimes.filter((time) => time !== undefined && time < monthStart).length,
      },
    ]),
  );

  facets.push(facet('folder', 'Folder', countFolders(source), FOLDER_VALUE_LIMIT));

  return facets.filter((candidate) => candidate.values.length > 0);
}

/**
 * Whether a clause is already written in a query as a term of its own.
 */
export function isWritten(queryText: string, clause: string): boolean {
  const escaped = clause.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[\\s(])${escaped}(?=$|[\\s)])`, 'i').test(queryText);
}

/**
 * Tags on the results, most common first, leaving out the tags the query
 * already names.
 */
function countTags(
  index: WorkspaceIndex,
  source: FacetSource,
  queryText: string,
): SearchFacetValue[] {
  const named = new Set(
    collectQueryTagKeys(parseQuery(queryText).node)
      .map((tagKey) => resolveIndexedTagKey(index.tags, tagKey))
      .filter((tagKey): tagKey is string => tagKey !== undefined),
  );
  const counts = new Map<string, number>();
  const add = (tagKeys: Iterable<string>): void => {
    new Set(tagKeys).forEach((tagKey) => {
      if (!named.has(tagKey)) {
        counts.set(tagKey, (counts.get(tagKey) ?? 0) + 1);
      }
    });
  };
  source.sections.forEach((section) => add(section.tags));
  source.tasks.forEach((task) => add(task.tags));
  source.files.forEach((file) => add(file.frontmatterTags.map((tag) => tag.key)));
  return [...counts.entries()]
    .map(([tagKey, count]) => ({
      label: index.tags.get(tagKey)?.label ?? tagKey,
      count,
      clause: tagKey,
    }))
    .sort(
      (left, right) => right.count - left.count || left.label.localeCompare(right.label),
    );
}

/**
 * Folders of the results, at the shallowest depth where they differ, so a
 * workspace kept under one `notes/` folder still gets a useful split.
 */
function countFolders(source: FacetSource): SearchFacetValue[] {
  const paths = [
    ...source.sections.map((section) => section.filePath),
    ...source.tasks.map((task) => task.filePath),
    ...source.files.map((file) => file.filePath),
  ];
  for (let depth = 1; depth <= 3; depth += 1) {
    const counts = new Map<string, number>();
    paths.forEach((filePath) => {
      const parts = filePath.split('/').slice(0, -1);
      if (parts.length >= depth) {
        const folder = parts.slice(0, depth).join('/');
        counts.set(folder, (counts.get(folder) ?? 0) + 1);
      }
    });
    if (counts.size >= 2) {
      return [...counts.entries()]
        .map(([folder, count]) => ({
          label: folder,
          count,
          clause: `in:${quoteValue(folder)}`,
        }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
    }
  }
  return [];
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
