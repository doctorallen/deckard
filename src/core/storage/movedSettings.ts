/**
 * The settings that became choices a view keeps in the preferences, and
 * what a value a reader had set for one of them comes to there. They are
 * carried once, on the first activation after the update, so no one loses
 * a choice; the settings are never read again.
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
    value === 'icons' || value === 'list' ? { contextPagesStyle: value === 'icons' ? 'icons' : undefined } : undefined,
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
