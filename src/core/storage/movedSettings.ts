/**
 * The settings that became choices a view keeps in the preferences, and
 * what a value a reader had set for one of them comes to there; and the
 * settings that became another setting, and what their values come to
 * under the new name. Each is carried once, on the first activation after
 * the update, so no one loses a choice; the old settings are never read
 * again.
 *
 * Pure: the composition root reads the settings, in each scope, and writes
 * what this returns.
 */
import { isBoardNamespace } from '../../domain/tasks/taskColumns';
import { AGENDA_GROUP_BYS, type PersistedPreferences, TASK_SORT_MODES } from '../../domain/model/preferences';
import { normalizePreferences } from './preferencesSchema';

/** Each moved setting, under `deckard.`, in the order its view keeps it. */
export const MOVED_SETTINGS = [
  'agenda.groupBy',
  'agenda.groupNamespace',
  'agenda.sort',
  'board.parentTag',
  'calendar.dayPanel',
  'calendar.showWeekends',
  'display.pageWidth',
  'pages.style',
  'pages.shown',
  'outline.followCursor',
] as const;

/** One of the moved settings, by its key under `deckard.`. */
export type MovedSetting = (typeof MOVED_SETTINGS)[number];

/**
 * What one setting's value comes to in the preferences, before they are
 * normalized; undefined for a value the setting never took, which carries
 * nothing.
 */
const CARRIERS: Readonly<Record<MovedSetting, (value: unknown) => Partial<PersistedPreferences> | undefined>> = {
  'agenda.groupBy': (value) =>
    (AGENDA_GROUP_BYS as readonly unknown[]).includes(value)
      ? { agendaGroupBy: value === 'due' ? undefined : (value as PersistedPreferences['agendaGroupBy']) }
      : undefined,
  'agenda.groupNamespace': (value) =>
    isBoardNamespace(value) ? { agendaGroupNamespace: value.toLowerCase() } : undefined,
  'agenda.sort': (value) =>
    (TASK_SORT_MODES as readonly unknown[]).includes(value)
      ? { agendaSort: value === 'rank' ? undefined : (value as PersistedPreferences['agendaSort']) }
      : undefined,
  'board.parentTag': (value) => (typeof value === 'boolean' ? { boardParentTag: value ? true : undefined } : undefined),
  'calendar.dayPanel': (value) => (typeof value === 'boolean' ? { calendarDayPanel: value ? true : undefined } : undefined),
  'calendar.showWeekends': (value) =>
    typeof value === 'boolean' ? { calendarHideWeekends: value ? undefined : true } : undefined,
  'display.pageWidth': (value) =>
    value === 'full' || value === 'limited' ? { pageWidth: value === 'full' ? 'full' : undefined } : undefined,
  'pages.style': (value) =>
    value === 'icons' || value === 'list' ? { contextPagesStyle: value === 'list' ? 'list' : undefined } : undefined,
  'pages.shown': (value) =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? { contextPagesHidden: Object.entries(value).filter(([, shown]) => shown === false).map(([page]) => page) }
      : undefined,
  'outline.followCursor': (value) =>
    typeof value === 'boolean' ? { outlineFollowCursorOff: value ? undefined : true } : undefined,
};

/**
 * What the values a reader set for the moved settings come to in the
 * preferences: for each setting given, its preference, which a value equal
 * to the default clears, as choosing the default in the view would. A
 * value the setting never took carries nothing.
 */
export function carryMovedSettings(set: Partial<Record<MovedSetting, unknown>>): Partial<PersistedPreferences> {
  const changes: Partial<PersistedPreferences> = {};
  for (const setting of MOVED_SETTINGS) {
    if (set[setting] !== undefined) {
      Object.assign(changes, CARRIERS[setting](set[setting]) ?? {});
    }
  }
  // Each kept as the preferences keep it: a namespace of `project`, or no
  // page left out, is the default, and kept as nothing.
  const normalized = normalizePreferences(changes);
  for (const key of Object.keys(changes) as (keyof PersistedPreferences)[]) {
    Object.assign(changes, { [key]: normalized[key] });
  }
  return changes;
}

/**
 * A family of settings that became one other setting: the settings it
 * reads, under `deckard.`, the one it writes, what their values come to
 * there, and what the one notice says of it. Every setting it reads is gone
 * from the manifest; a reader's value for one is still in their
 * settings.json, where VS Code still reads it.
 */
export interface RenamedSettings {
  readonly from: readonly string[];
  readonly to: string;
  /** Whether only the user's value counts, as for an application setting, which a workspace cannot set. */
  readonly userOnly?: true;
  /** What the values set in one scope come to under the new name; undefined writes nothing there. */
  readonly carry: (values: Readonly<Record<string, unknown>>) => unknown;
  /** What the notice says of the family, once a value for one of its settings was found. */
  readonly notice: string;
}

/**
 * The settings that became another setting in the release that collapsed
 * them. Display's step and its seven settings became Zen alone: Quiet and
 * Zen both come to Zen on, and Full, the default, writes nothing. The
 * Tasks view's search took the Tasks view's name, in the scope it was set
 * in; an empty one is carried too, since a workspace's empty search
 * overrides the user's.
 */
export const RENAMED_SETTINGS: readonly RenamedSettings[] = [
  {
    from: ['display.level', 'display.themeStyling', 'display.helpText', 'display.density', 'display.cardFrames', 'display.tags', 'display.counts', 'display.dates'],
    to: 'display.zen',
    userOnly: true,
    carry: (values) => (values['display.level'] === 'quiet' || values['display.level'] === 'zen' ? true : undefined),
    notice: 'Display is one Zen switch now, in each page\'s gear',
  },
  {
    from: ['agenda.query'],
    to: 'tasks.viewQuery',
    carry: (values) => (typeof values['agenda.query'] === 'string' ? values['agenda.query'] : undefined),
    notice: 'Agenda: Query is Tasks: View Query now',
  },
];

/** A setting's value in each scope carried, as `inspect()` reports them. */
export interface ScopedValues {
  readonly globalValue?: unknown;
  readonly workspaceValue?: unknown;
}

/** One value to write under a new name, and the scope it was found in. */
export interface RenamedSettingWrite {
  readonly key: string;
  readonly value: unknown;
  readonly scope: 'user' | 'workspace';
}

/** The values a reader set in one scope for a family's settings, by key; empty when none is set there. */
function valuesIn(family: RenamedSettings, read: (key: string) => ScopedValues | undefined, field: keyof ScopedValues): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const key of family.from) {
    const value = read(key)?.[field];
    if (value !== undefined) {
      values[key] = value;
    }
  }
  return values;
}

/**
 * What the values a reader set for the renamed settings come to: each
 * family's value under its new name, in the scope it was found in, unless
 * the new setting is set there already; and, for the notice, what is said
 * of each family a value was found for, carried or not. `scopes` says
 * which scopes are still to be carried.
 */
export function carryRenamedSettings(
  read: (key: string) => ScopedValues | undefined,
  scopes: { readonly user: boolean; readonly workspace: boolean },
  families: readonly RenamedSettings[] = RENAMED_SETTINGS,
): { writes: RenamedSettingWrite[]; notices: string[] } {
  const writes: RenamedSettingWrite[] = [];
  const notices: string[] = [];
  for (const family of families) {
    const carried = (['user', 'workspace'] as const)
      .filter((scope) => scopes[scope] && !(scope === 'workspace' && family.userOnly))
      .map((scope) => {
        const field = scope === 'user' ? 'globalValue' : 'workspaceValue';
        const values = valuesIn(family, read, field);
        const found = Object.keys(values).length > 0;
        const value = found ? family.carry(values) : undefined;
        if (value !== undefined && read(family.to)?.[field] === undefined) {
          writes.push({ key: family.to, value, scope });
        }
        return found;
      });
    if (carried.includes(true)) {
      notices.push(family.notice);
    }
  }
  return { writes, notices };
}
