import {
  DashboardMessage,
  RenderMode,
  SidebarMessage,
  TagOverviewMessage,
  TagOverviewSortMode,
  TagSortMode,
  TaskSortMode,
  TaskFilter,
} from '../../core/types';

/**
 * Validates messages received by the dashboard webview before dispatch.
 *
 * Webview payloads cross a trust boundary as `unknown`, so runtime checks keep
 * malformed or stale browser state from reaching commands and preferences.
 */
export function parseDashboardMessage(
  value: unknown,
): DashboardMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }

  switch (value.type) {
    case 'openSource':
      return isSourceMessage(value)
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'toggleTask':
      return typeof value.taskId === 'string' &&
        typeof value.completed === 'boolean'
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'toggleFavorite':
      return typeof value.tagKey === 'string'
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'setTagSort':
      return isTagSortMode(value.mode)
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'setTaskFilter':
      return isTaskFilter(value.filter)
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'setTaskTags':
      return isStringArray(value.tagKeys)
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'setTaskSort':
      return isTaskSortMode(value.mode)
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'reorderTasks':
      return isStringArray(value.taskIds)
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'reorderTags':
      return isStringArray(value.tagKeys) &&
        typeof value.tagKey === 'string' &&
        typeof value.isFavorite === 'boolean'
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'openTag':
      return typeof value.tagKey === 'string'
        ? (value as unknown as DashboardMessage)
        : undefined;
    default:
      return undefined;
  }
}

/**
 * Restricts tag-overview messages to its smaller navigation and display API.
 */
export function parseTagOverviewMessage(
  value: unknown,
): TagOverviewMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }

  if (value.type === 'openSource') {
    return isSourceMessage(value)
      ? (value as unknown as TagOverviewMessage)
      : undefined;
  }
  if (value.type === 'setRenderMode' && isRenderMode(value.mode)) {
    return value as unknown as TagOverviewMessage;
  }
  if (
    value.type === 'setTagOverviewSort' &&
    isTagOverviewSortMode(value.mode)
  ) {
    return value as unknown as TagOverviewMessage;
  }
  if (value.type === 'openTag' && typeof value.tagKey === 'string') {
    return value as unknown as TagOverviewMessage;
  }
  return undefined;
}

/**
 * Validates the sidebar's navigation and shortcut messages independently.
 */
export function parseSidebarMessage(
  value: unknown,
): SidebarMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }

  if (value.type === 'openSource') {
    return isSourceMessage(value)
      ? (value as unknown as SidebarMessage)
      : undefined;
  }
  if (value.type === 'openTag' && typeof value.tagKey === 'string') {
    return value as unknown as SidebarMessage;
  }
  if (value.type === 'openDashboard' || value.type === 'createDailyNote') {
    return value as unknown as SidebarMessage;
  }
  return undefined;
}

/**
 * Checks source locations before they are used to open an editor line.
 */
function isSourceMessage(value: Record<string, unknown>): boolean {
  return (
    typeof value.filePath === 'string' &&
    typeof value.line === 'number' &&
    Number.isInteger(value.line) &&
    value.line > 0
  );
}

/**
 * Narrows arrays before their values are used as persisted ordering input.
 */
function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

/**
 * Keeps tag sorting an explicit allow-list instead of accepting arbitrary UI data.
 */
function isTagSortMode(value: unknown): value is TagSortMode {
  return (
    value === 'alphabetical' ||
    value === 'count' ||
    value === 'access' ||
    value === 'custom'
  );
}

/**
 * Keeps task filtering constrained to the three supported dashboard states.
 */
function isTaskFilter(value: unknown): value is TaskFilter {
  return value === 'all' || value === 'active' || value === 'completed';
}

/**
 * Keeps task sorting constrained to modes implemented by the state layer.
 */
function isTaskSortMode(value: unknown): value is TaskSortMode {
  return value === 'rank' || value === 'created' || value === 'updated';
}

/**
 * Validates the two tag-overview body representations.
 */
function isRenderMode(value: unknown): value is RenderMode {
  return value === 'markdown' || value === 'html';
}

/**
 * Validates overview sorting separately from dashboard tag sorting.
 */
function isTagOverviewSortMode(value: unknown): value is TagOverviewSortMode {
  return (
    value === 'alphabetical' ||
    value === 'created' ||
    value === 'updated' ||
    value === 'access'
  );
}

/**
 * Narrows non-null objects without making assumptions about their properties.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
