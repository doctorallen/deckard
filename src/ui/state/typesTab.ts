/**
 * Home's Types tab: every type as one row of a table, and under it the hub
 * notes no type's rows cover.
 *
 * - A type's row says what its rows are, as its page's subtitle does; how
 *   many rows its page lists, and for a type whose rows are tags how many
 *   of them have a hub note; its open tasks, each counted once however
 *   many of its rows a task names; and when any row was last mentioned.
 *   The counts are the type index's, which a type's rows page reads too, so
 *   the tab and the page agree.
 * - A type the reader has opened lists its rows in place: all of them by
 *   name when they are few, else the ones mentioned most recently, or for
 *   a type whose rows are notes the ones written most recently.
 * - A hub note outside every type is listed by its tag. Those of one
 *   namespace are one line, since the namespace is what a type would be
 *   made of.
 *
 * The types' figures are worked out once for an index and a day, since a
 * snapshot is built again whenever the reader opens or closes a type.
 */
import { startOfDay } from '../../domain/markdown/calendar';
import { formatKeyWords, readTagNamespace } from '../../domain/markdown/tagKeys';
import type { DateFormats } from '../../domain/markdown/dateFormat';
import type { WorkspaceIndex } from '../../domain/model';
import { listRowSources } from '../../domain/types/createType';
import { pluralTypeName } from '../../domain/types/rowNotes';
import { getTypeIndex, type TypeIndex, type TypeRow } from '../../domain/types/typeIndex';
import type { TypeDefinition } from '../../domain/types/typeRegistry';
import type {
  DashboardDay,
  DashboardOutsideHub,
  DashboardType,
  DashboardTypeRow,
  DashboardTypeRows,
  DashboardTypesTab,
} from '../protocol/dashboard';
import { getHubGraph, hubNoteLabel, namespaceLabel } from './hubTree';
import { describeDay, describeRowsRule } from './typeTable';

/** How many rows an opened type lists when its rows are tags. */
export const LISTED_TAG_ROWS = 12;

/** How many rows an opened type lists when its rows are notes. */
export const LISTED_NOTE_ROWS = 5;

/** How many types the tab sends rows for at once, whatever the page asks. */
export const OPEN_TYPE_LIMIT = 50;

/** What the tab is built at. */
export interface TypesTabOptions {
  /** The moment dates are worded from, and tasks are overdue at. */
  now: number;
  dateFormats?: DateFormats;
  /** The types the reader has opened, by key: only these send their rows. */
  opened?: ReadonlySet<string>;
}

/** A type's row before its rows are listed, and the day it was worked out on. */
interface TypeFigures {
  day: number;
  dateFormats: DateFormats | undefined;
  types: DashboardType[];
  outside: DashboardOutsideHub[];
}

/** The figures of each index, kept while the day and the date format stay the same. */
const figures = new WeakMap<WorkspaceIndex, TypeFigures>();

/** What the Types tab draws from one index. */
export function createTypesTab(index: WorkspaceIndex, options: TypesTabOptions): DashboardTypesTab {
  const types = getTypeIndex(index);
  const day = startOfDay(options.now);
  let built = figures.get(index);
  if (!built || built.day !== day || built.dateFormats !== options.dateFormats) {
    built = {
      day,
      dateFormats: options.dateFormats,
      types: listTypes(types, options),
      outside: listOutsideHubs(index, types, options),
    };
    figures.set(index, built);
  }
  const opened = options.opened;
  return {
    types: built.types.map((type) => {
      const definition = opened?.has(type.key) ? types.registry.get(type.key) : undefined;
      return definition ? { ...type, listed: listRows(index, types, definition) } : type;
    }),
    outside: built.outside,
  };
}

/** Every type that has rows, by name, with its figures. */
function listTypes(types: TypeIndex, options: TypesTabOptions): DashboardType[] {
  return types.registry.types
    .filter((type) => type.rows !== undefined)
    .map((type) => {
      const rows = types.rows(type.key);
      const totals = types.totals(type.key, options.now);
      const tags = type.rows?.kind !== 'notes';
      return {
        key: type.key,
        name: type.name,
        plural: pluralTypeName(type.name),
        rule: describeRowsRule(type),
        rowsKind: tags ? ('tags' as const) : ('notes' as const),
        query: `type = ${type.key}`,
        rows: rows.length,
        ...(tags ? { withNote: rows.filter((row) => row.filePath !== undefined).length } : {}),
        openTasks: totals.openTasks,
        overdue: totals.overdue,
        ...(totals.lastMentioned === undefined ? {} : { lastMentioned: dayOf(totals.lastMentioned, options) }),
      };
    })
    .sort((left, right) => compareNames(left.plural, right.plural) || left.key.localeCompare(right.key));
}

/**
 * An opened type's rows: every one by name while they fit; else, for a
 * type whose rows are tags, the ones mentioned most recently, and for one
 * whose rows are notes, the ones written most recently.
 */
function listRows(index: WorkspaceIndex, types: TypeIndex, type: TypeDefinition): DashboardTypeRows {
  const rows = types.rows(type.key);
  const notes = type.rows?.kind === 'notes';
  const limit = notes ? LISTED_NOTE_ROWS : LISTED_TAG_ROWS;
  const byName = (left: TypeRow, right: TypeRow): number => compareNames(left.title, right.title) || left.id.localeCompare(right.id);
  let listed = [...rows].sort(byName);
  let said = '';
  if (rows.length > limit) {
    const when = new Map(
      rows.map((row) => [row.id, notes ? index.files.get(row.filePath ?? '')?.updatedAt : types.lastMentioned(row.id)] as const),
    );
    listed = listed.sort((left, right) => (when.get(right.id) ?? -Infinity) - (when.get(left.id) ?? -Infinity) || byName(left, right)).slice(0, limit);
    said = notes ? `The ${limit} written most recently.` : `The ${limit} mentioned most recently.`;
  }
  const drawn = listed.map((row) => drawRow(row));
  const muted = drawn.some((row) => row.noNote) ? 'Muted names have no note yet.' : '';
  return { rows: drawn, note: [said, muted].filter(Boolean).join(' ') };
}

/**
 * A row as the list draws it: a tag row opens its tag's page and a note
 * row its note; a namespace level that is no tag of its own opens nothing.
 */
function drawRow(row: TypeRow): DashboardTypeRow {
  if (!row.tagKeys.length) {
    return { title: row.title, ...(row.filePath ? { filePath: row.filePath } : {}) };
  }
  return {
    title: row.title,
    ...(row.implicit ? {} : { tagKey: row.tagKeys[0] }),
    ...(row.filePath ? {} : { noNote: true as const }),
  };
}

/**
 * The hub notes no type's rows cover: each namespace with no type that has
 * a hub note, the one with the most tags first, the people among them when
 * no type has them; then each hub note whose tag has no namespace, by name.
 */
function listOutsideHubs(index: WorkspaceIndex, types: TypeIndex, options: TypesTabOptions): DashboardOutsideHub[] {
  const count = (many: number, one: string, plural: string): string => `${many} ${many === 1 ? one : plural}`;
  const namespaces: DashboardOutsideHub[] = listRowSources(index, types.registry)
    .filter((source) => source.kind !== 'notes' && source.noteCount > 0)
    .map((source) => ({
      label: source.kind === 'people' ? 'People' : namespaceLabel(source.key.split('/').pop() ?? source.key),
      written: source.rows,
      detail: `${count(source.tagCount, 'tag', 'tags')}, ${source.noteCount} with a note`,
      query: `kind = ${source.key}`,
      ...(source.kind === 'namespace' ? { namespace: source.key } : {}),
      canBeType: true as const,
    }));
  const single: DashboardOutsideHub[] = [];
  getHubGraph(index).hubTags.forEach((tagKey, filePath) => {
    if (tagKey.startsWith('@') || readTagNamespace(tagKey) || types.registry.forTag(tagKey)) {
      return;
    }
    const last = lastTagged(index, tagKey, filePath);
    single.push({
      label: hubNoteLabel(index, filePath) || formatKeyWords(tagKey.replace(/^#/, '')),
      written: index.tags.get(tagKey)?.label ?? tagKey,
      tagKey,
      ...(last === undefined ? {} : { lastMentioned: dayOf(last, options) }),
    });
  });
  single.sort((left, right) => compareNames(left.label, right.label) || left.written.localeCompare(right.written));
  return [...namespaces, ...single];
}

/**
 * When the latest entry, note, or task that carries a tag was updated, its
 * hub note's own aside, as a row's last mention reads for a type's tag.
 */
function lastTagged(index: WorkspaceIndex, tagKey: string, hubPath: string): number | undefined {
  const tag = index.tags.get(tagKey);
  if (!tag) {
    return undefined;
  }
  const times: Array<number | undefined> = [];
  tag.sectionIds.forEach((id) => {
    const section = index.sections.get(id);
    if (section && section.filePath !== hubPath) {
      times.push(section.updatedAt);
    }
  });
  tag.filePaths.forEach((path) => {
    if (path !== hubPath) {
      times.push(index.files.get(path)?.updatedAt);
    }
  });
  tag.taskIds.forEach((id) => {
    const task = index.tasks.get(id);
    if (task && task.filePath !== hubPath) {
      times.push(task.updatedAt);
    }
  });
  return times.reduce<number | undefined>((latest, at) => (at !== undefined && (latest === undefined || at > latest) ? at : latest), undefined);
}

/** A moment as the tab names it: when, and in words and in full. */
function dayOf(at: number, options: TypesTabOptions): DashboardDay {
  return { at, text: describeDay(at, options) };
}

/** Two names in A-Z order, whatever their case. */
function compareNames(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: 'base' });
}
