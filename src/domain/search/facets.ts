/**
 * Counts what a set of results could still be narrowed by.
 *
 * This is faceted search as Flamenco described it: every value shows how many
 * of the current results it would keep, a value that would keep none or all
 * of them is left out so a click can never lead to an empty page or change
 * nothing, and each value carries the clause that adds it to the query, so
 * refining by facet and writing a query are the same thing.
 */
import { isCancelledTask, isOpenTask, normalizeStatusName } from '../tasks/taskStatuses';
import { addDays, startOfDay } from '../markdown/calendar';
import { formatMonthName } from '../markdown/dates';
import { countLinkTargets, resolveLinkQuery } from '../query/queryLinks';
import {
  collectQueryTagKeys,
  quoteValue,
  visitConditions,
} from '../query/queryFormat';
import { parseQuery } from '../query/queryParser';
import { ANY_FIELD_SCHEMA } from '../query/queryTypes';
import { ParsedFile, Section, Task, WorkspaceIndex, QueryFacet, QueryFacetValue } from '../model';
import { noteTitle } from '../index/backlinks';
import {
  isParkedFile,
  isParkedOnlyTag,
  isParkedSection,
  isParkedTask,
  mentionsParked,
} from '../index/parked';
import { resolveIndexedTagKey } from '../index/tagNavigation';

/** One value a facet offers: its label, how many results it keeps, its clause. */
export type SearchFacetValue = QueryFacetValue;
/** One facet: its values, and the clauses of it the query already writes. */
export type SearchFacet = QueryFacet;

/** The results a search's facets count: its entries, tasks, and notes. */
export interface FacetSource {
  sections: readonly Section[];
  tasks: readonly Task[];
  files: readonly ParsedFile[];
}

/** What the facets offer beyond what the results carry, and when they count from. */
export interface FacetOptions {
  /**
   * Tags associated with the search's own, ranked by how strongly. When
   * given, they are offered under Tags in place of the tags counted on the
   * results, since an association ranks better than a count can.
   */
  related?: SearchFacetValue[];
  /** The moment the Due and Created values are counted from. */
  now: number;
  /**
   * Open parked tasks a list of things to do left out that its search
   * otherwise finds, offered as one value that asks for them.
   */
  parkedLeftOut?: number;
}

const TAG_VALUE_LIMIT = 10;
const RELATED_VALUE_LIMIT = 30;
const FOLDER_VALUE_LIMIT = 8;
const LINK_VALUE_LIMIT = 8;

/** What every facet of one search reads. */
interface FacetContext {
  index: WorkspaceIndex;
  source: FacetSource;
  queryText: string;
  options: FacetOptions;
  /** How many results there are, which a value must keep fewer of. */
  total: number;
  /** The start of the day `options.now` falls in. */
  today: number;
}

/** A facet's id and label, and how many of its values it lists at most. */
interface FacetSpec {
  id: SearchFacet['id'];
  label: string;
  limit?: number;
}

/**
 * The facets of a search, in the order the page lists them: related tags,
 * task status, due date, tags, links, updated, created, folder, and parked.
 * A facet with no value left to offer is left out.
 */
export function buildSearchFacets(
  index: WorkspaceIndex,
  source: FacetSource,
  queryText: string,
  options: FacetOptions,
): SearchFacet[] {
  const total = source.sections.length + source.files.length + source.tasks.length;
  if (total === 0) {
    return parkedFacet(options.parkedLeftOut);
  }
  const context: FacetContext = {
    index,
    source,
    queryText,
    options,
    total,
    today: startOfDay(options.now),
  };
  return FACETS
    .flatMap((build) => build(context))
    .filter((candidate) => candidate.values.length > 0);
}

/**
 * A facet's values that would narrow the results and are not written yet,
 * and the ones the query already writes.
 */
function makeFacet(
  { total, queryText }: FacetContext,
  { id, label, limit }: FacetSpec,
  candidates: SearchFacetValue[],
): SearchFacet {
  return {
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
      .slice(0, limit ?? candidates.length),
    applied: candidates
      .map((value) => value.clause)
      .filter((clause) => isWritten(queryText, clause)),
  };
}

/**
 * The tags a query names are not offered again, but they are the tag
 * facet's applied values, so another tag can be ORed with one.
 */
function appliedTags(queryText: string): string[] {
  return collectQueryTagKeys(parseQuery(queryText, ANY_FIELD_SCHEMA).node).filter((tagKey) =>
    isWritten(queryText, tagKey),
  );
}

/** Each facet, in the order the page lists them. */
const FACETS: Array<(context: FacetContext) => SearchFacet[]> = [
  relatedFacet,
  statusFacet,
  dueFacet,
  tagsFacet,
  linksFacet,
  updatedFacet,
  createdFacet,
  folderFacet,
  parkedFacets,
];

/** The tags associated with the search's own, when the search gives them. */
function relatedFacet(context: FacetContext): SearchFacet[] {
  if (!context.options.related) {
    return [];
  }
  const related = makeFacet(
    context,
    { id: 'related', label: 'Tags', limit: RELATED_VALUE_LIMIT },
    context.options.related,
  );
  related.applied = appliedTags(context.queryText);
  return [related];
}

/** Open, done, and cancelled tasks, then each open status found, busiest first. */
function statusFacet(context: FacetContext): SearchFacet[] {
  const tasks = context.source.tasks;
  return [
    makeFacet(context, { id: 'status', label: 'Tasks' }, [
      { label: 'Open', clause: 'is:open', count: tasks.filter(isOpenTask).length },
      { label: 'Done', clause: 'is:done', count: tasks.filter((task) => task.completed).length },
      { label: 'Cancelled', clause: 'is:cancelled', count: tasks.filter(isCancelledTask).length },
      ...countStatuses(tasks),
    ]),
  ];
}

/**
 * Each open status the tasks have, by name, with the clause that finds it:
 * In progress, Waiting, Blocked, Unknown, and any of a workspace's own. A
 * plain `[ ]` is not one, since Open already says it, nor is a done or a
 * cancelled status, which Done and Cancelled say.
 */
function countStatuses(tasks: readonly Task[]): SearchFacetValue[] {
  const counts = new Map<string, SearchFacetValue>();
  for (const task of tasks) {
    const status = task.status;
    if (!isOpenTask(task) || status.symbol === ' ') {
      continue;
    }
    const slug = normalizeStatusName(status.name).replace(/ /g, '-');
    const found = counts.get(slug) ?? { label: status.name, clause: `status:${quoteValue(slug)}`, count: 0 };
    found.count += 1;
    counts.set(slug, found);
  }
  return [...counts.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

/** Tasks by when they are due: overdue, this week, later, or never. */
function dueFacet(context: FacetContext): SearchFacet[] {
  const { today } = context;
  const tasks = context.source.tasks;
  // Calendar days, as the clauses count them, so a week that spans a
  // daylight-saving change still ends at midnight.
  const weekEnd = addDays(today, 7);
  return [
    makeFacet(context, { id: 'due', label: 'Due' }, [
      {
        label: 'Overdue',
        clause: 'is:overdue',
        count: tasks.filter(
          (task) => isOpenTask(task) && task.dueAt !== undefined && task.dueAt < today,
        ).length,
      },
      {
        label: 'Next 7 days',
        clause: '(due >= today AND due < 7d)',
        count: tasks.filter(
          (task) =>
            task.dueAt !== undefined &&
            task.dueAt >= today &&
            task.dueAt < weekEnd,
        ).length,
      },
      {
        label: 'Later',
        clause: 'due >= 7d',
        count: tasks.filter(
          (task) => task.dueAt !== undefined && task.dueAt >= weekEnd,
        ).length,
      },
      {
        label: 'No date',
        clause: 'no:due',
        count: tasks.filter((task) => task.dueAt === undefined).length,
      },
    ]),
  ];
}

/** The tags the results carry, when the search gives no related tags. */
function tagsFacet(context: FacetContext): SearchFacet[] {
  if (context.options.related) {
    return [];
  }
  const { index, source, queryText } = context;
  const tags = makeFacet(
    context,
    { id: 'tags', label: 'Tags', limit: TAG_VALUE_LIMIT },
    countTags(index, source, queryText),
  );
  tags.applied = appliedTags(queryText);
  return [tags];
}

/** The notes the results link to. */
function linksFacet(context: FacetContext): SearchFacet[] {
  const { index, source, queryText } = context;
  const links = makeFacet(
    context,
    { id: 'links', label: 'Links to', limit: LINK_VALUE_LIMIT },
    countLinks(index, source, queryText),
  );
  links.applied = appliedLinks(queryText);
  return [links];
}

/** Notes by when they were last saved: this week, this month, or before. */
function updatedFacet(context: FacetContext): SearchFacet[] {
  const { source, today } = context;
  const noteTimes = [
    ...source.sections.map((section) => section.updatedAt),
    ...source.files.map((file) => file.updatedAt),
  ];
  const weekStart = addDays(today, -6);
  const monthStart = addDays(today, -29);
  return [
    makeFacet(context, { id: 'updated', label: 'Updated' }, [
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
  ];
}

/** Notes by the month they were written. */
function createdFacet(context: FacetContext): SearchFacet[] {
  return [
    makeFacet(
      context,
      { id: 'created', label: 'Created' },
      countCreated(context.source, context.options.now),
    ),
  ];
}

/** The folders the results are in. */
function folderFacet(context: FacetContext): SearchFacet[] {
  return [
    makeFacet(
      context,
      { id: 'folder', label: 'Folder', limit: FOLDER_VALUE_LIMIT },
      countFolders(context.source),
    ),
  ];
}

/**
 * The parked tasks a list left out, as one value that asks for them; or,
 * when the workspace parks anything and the results mix parked and
 * unparked, either one.
 */
function parkedFacets(context: FacetContext): SearchFacet[] {
  const { index, source, options, total } = context;
  if ((options.parkedLeftOut ?? 0) > 0) {
    return parkedFacet(options.parkedLeftOut);
  }
  if (!index.parked || index.parked.files.size + index.parked.sections.size + index.parked.tasks.size <= 0) {
    return [];
  }
  // When the results mix parked and unparked, either can be kept.
  const parked =
    source.sections.filter((section) => isParkedSection(index, section.id)).length +
    source.files.filter((file) => isParkedFile(index, file.filePath)).length +
    source.tasks.filter((task) => isParkedTask(index, task.id)).length;
  return [
    makeFacet(context, { id: 'parked', label: 'Parked' }, [
      { label: 'Parked', clause: 'is:parked', count: parked },
      { label: 'Not parked', clause: '-is:parked', count: total - parked },
    ]),
  ];
}

/**
 * The open parked tasks a list of things to do left out, as one value that
 * asks for them. What was left out is not among the results, so it is
 * offered whatever its count against them.
 */
function parkedFacet(parkedLeftOut = 0): SearchFacet[] {
  return parkedLeftOut > 0
    ? [
        {
          id: 'parked',
          label: 'Parked',
          values: [{ label: 'Parked', clause: 'is:parked', count: parkedLeftOut }],
          applied: [],
        },
      ]
    : [];
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
    collectQueryTagKeys(parseQuery(queryText, ANY_FIELD_SCHEMA).node)
      .map((tagKey) => resolveIndexedTagKey(index.tags, tagKey))
      .filter((tagKey): tagKey is string => tagKey !== undefined),
  );
  const counts = new Map<string, number>();
  // A tag only parked notes carry is clutter here, unless the search is
  // about parked notes.
  const skipParked = !mentionsParked(parseQuery(queryText, ANY_FIELD_SCHEMA).node);
  const add = (tagKeys: Iterable<string>): void => {
    new Set(tagKeys).forEach((tagKey) => {
      if (!named.has(tagKey) && !(skipParked && isParkedOnlyTag(index, tagKey))) {
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
  visitConditions(parseQuery(queryText, ANY_FIELD_SCHEMA).node, (condition) => {
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
  visitConditions(parseQuery(queryText, ANY_FIELD_SCHEMA).node, (condition) => {
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
      if (parts.length < depth) {
        return;
      }
      const folder = parts.slice(0, depth).join('/');
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
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
