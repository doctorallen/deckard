import { formatMonthName } from '../../core/markdown/dates';
import { countLinkTargets, resolveLinkQuery } from '../../core/query/queryLinks';
import {
  collectQueryTagKeys,
  quoteValue,
  visitConditions,
} from '../../core/query/queryFormat';
import { parseQuery } from '../../core/query/queryParser';
import { QueryFacet, QueryFacetValue } from '../../core/query/queryTypes';
import {
  ParsedFile,
  Section,
  Task,
  WorkspaceIndex,
} from '../../core/types';
import { noteTitle } from '../../core/workspace/backlinks';
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
   * Tags associated with the search's own, ranked by how strongly. When
   * given, they are offered under Tags in place of the tags counted on the
   * results, since an association ranks better than a count can.
   */
  related?: SearchFacetValue[];
  now?: number;
}

const TAG_VALUE_LIMIT = 10;
const RELATED_VALUE_LIMIT = 30;
const FOLDER_VALUE_LIMIT = 8;
const LINK_VALUE_LIMIT = 8;
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
          // A related tag every result carries still says how the search's
          // tags relate, so it stays; any other value must narrow.
          (value.count < total || id === 'related') &&
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
  // The tags a query names are not offered again, but they are the tag
  // facet's applied values, so another tag can be ORed with one.
  const appliedTags = (): string[] =>
    collectQueryTagKeys(parseQuery(queryText).node).filter((tagKey) =>
      isWritten(queryText, tagKey),
    );

  if (options.related) {
    const related = facet('related', 'Tags', options.related, RELATED_VALUE_LIMIT);
    related.applied = appliedTags();
    facets.push(related);
  }

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

  if (!options.related) {
    const tags = facet('tags', 'Tags', countTags(index, source, queryText), TAG_VALUE_LIMIT);
    tags.applied = appliedTags();
    facets.push(tags);
  }

  const links = facet('links', 'Links to', countLinks(index, source, queryText), LINK_VALUE_LIMIT);
  links.applied = appliedLinks(queryText);
  facets.push(links);

  const noteTimes = [
    ...source.sections.map((section) => section.updatedAt),
    ...source.files.map((file) => file.updatedAt),
  ];
  const weekStart = today - 6 * DAY;
  const monthStart = today - 29 * DAY;
  facets.push(
    facet('updated', 'Updated', [
      {
        label: 'Last 7 days',
        clause: 'updated >= 7d',
        count: noteTimes.filter((time) => time !== undefined && time >= weekStart).length,
      },
      {
        label: '1–4 weeks ago',
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

  facets.push(facet('created', 'Created', countCreated(source, now)));

  facets.push(facet('folder', 'Folder', countFolders(source), FOLDER_VALUE_LIMIT));

  return facets.filter((candidate) => candidate.values.length > 0);
}

/**
 * Notes by the month they were written: this month, last month, the two
 * before by name, and everything earlier.
 */
function countCreated(source: FacetSource, now: number): SearchFacetValue[] {
  const times = [
    ...source.sections.map((section) => section.createdAt),
    ...source.files.map((file) => file.createdAt),
  ].filter((time): time is number => time !== undefined);
  const today = new Date(startOfDay(now));
  const monthStart = (back: number): number =>
    new Date(today.getFullYear(), today.getMonth() - back, 1).getTime();
  const within = (from: number, to: number): number =>
    times.filter((time) => time >= from && time < to).length;
  const monthValue = (back: number): string => {
    const at = new Date(monthStart(back));
    return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`;
  };
  const values: SearchFacetValue[] = [
    { label: 'This month', clause: 'created = this-month', count: within(monthStart(0), monthStart(-1)) },
    { label: 'Last month', clause: 'created = last-month', count: within(monthStart(1), monthStart(0)) },
  ];
  for (const back of [2, 3]) {
    values.push({
      label: formatMonthName(monthStart(back), now),
      clause: `created = ${monthValue(back)}`,
      count: within(monthStart(back), monthStart(back - 1)),
    });
  }
  values.push({
    label: 'Earlier',
    clause: `created < ${monthValue(3)}`,
    count: times.filter((time) => time < monthStart(3)).length,
  });
  return values;
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
export function countTags(
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
 * The notes the results link to, most linked first, leaving out the notes
 * the query already names by link.
 */
export function countLinks(
  index: WorkspaceIndex,
  source: FacetSource,
  queryText: string,
): SearchFacetValue[] {
  const named = new Set<string>();
  visitConditions(parseQuery(queryText).node, (condition) => {
    if (condition.field === 'link') {
      resolveLinkQuery(index, condition.value).paths.forEach((path) => named.add(path));
    }
  });
  const keys = [
    ...source.sections.map((section) => `section:${section.id}`),
    ...source.tasks.map((task) => `task:${task.id}`),
    ...source.files.map((file) => `file:${file.filePath}`),
  ];
  return countLinkTargets(index, keys)
    .filter((target) => !named.has(target.targetPath))
    .map((target) => {
      const title = noteTitle(target.targetPath);
      return { label: title, count: target.count, clause: `[[${title}]]` };
    });
}

/** The links the query writes as terms of their own, as `[[Title]]`. */
function appliedLinks(queryText: string): string[] {
  const applied: string[] = [];
  visitConditions(parseQuery(queryText).node, (condition) => {
    const clause = `[[${condition.value}]]`;
    if (condition.field === 'link' && isWritten(queryText, clause)) {
      applied.push(clause);
    }
  });
  return applied;
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
