import {
  DashboardMessage,
  RenderMode,
  SidebarMessage,
  TagOverviewMessage,
  TagOverviewLayout,
  TagOverviewSortMode,
  RelatedNotesSortMode,
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
    case 'toggleFavoriteEntity':
      return typeof value.entityKey === 'string'
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'setTagSort':
      return isTagSortMode(value.mode)
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'setEntitySort':
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
    case 'reorderEntities':
      return isStringArray(value.entityKeys)
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'openTag':
      return isOpenTagMessage(value)
        ? (value as unknown as DashboardMessage)
        : undefined;
    case 'renameTag':
      return isRenameTagMessage(value)
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
  if (value.type === 'toggleTask') {
    return typeof value.taskId === 'string' &&
      typeof value.completed === 'boolean'
      ? (value as unknown as TagOverviewMessage)
      : undefined;
  }
  if (value.type === 'setTaskFilter' && isTaskFilter(value.filter)) {
    return value as unknown as TagOverviewMessage;
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
  if (
    value.type === 'setTagOverviewLayout' &&
    isTagOverviewLayout(value.layout)
  ) {
    return value as unknown as TagOverviewMessage;
  }
  if (value.type === 'openTag' && isOpenTagMessage(value)) {
    return value as unknown as TagOverviewMessage;
  }
  if (value.type === 'renameTag' && isRenameTagMessage(value)) {
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

  if (value.type === 'ready') {
    return { type: 'ready' };
  }
  if (value.type === 'clearEntryRelatedNotes') {
    return { type: 'clearEntryRelatedNotes' };
  }
  if (value.type === 'openSource') {
    return isSourceMessage(value)
      ? (value as unknown as SidebarMessage)
      : undefined;
  }
  if (value.type === 'openTag' && isOpenTagMessage(value)) {
    return value as unknown as SidebarMessage;
  }
  if (value.type === 'renameTag' && isRenameTagMessage(value)) {
    return value as unknown as SidebarMessage;
  }
  if (
    value.type === 'setRelatedNotesSort' &&
    isRelatedNotesSortMode(value.mode)
  ) {
    return value as unknown as SidebarMessage;
  }
  if (
    value.type === 'openDashboard' ||
    value.type === 'createDailyNote' ||
    value.type === 'openHelp'
  ) {
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

function isOpenTagMessage(value: Record<string, unknown>): boolean {
  return (
    typeof value.tagKey === 'string' &&
    value.tagKey.length > 0 &&
    (value.filterTagKey === undefined ||
      (typeof value.filterTagKey === 'string' &&
        value.filterTagKey.length > 0)) &&
    (value.filterTagKeys === undefined || isNonEmptyStringArray(value.filterTagKeys))
  );
}

function isRenameTagMessage(value: Record<string, unknown>): boolean {
  return typeof value.tagKey === 'string' && value.tagKey.length > 0;
}

/**
 * Narrows arrays before their values are used as persisted ordering input.
 */
function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    isStringArray(value) && value.every((item) => item.length > 0)
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
 * Keeps the Tag Overview layout constrained to its two supported views.
 */
function isTagOverviewLayout(value: unknown): value is TagOverviewLayout {
  return value === 'tabs' || value === 'split';
}

/**
 * Keeps Related Notes sorting constrained to its supported modes.
 */
function isRelatedNotesSortMode(value: unknown): value is RelatedNotesSortMode {
  return (
    value === 'newest' ||
    value === 'oldest' ||
    value === 'tags' ||
    value === 'access'
  );
}

/**
 * Narrows non-null objects without making assumptions about their properties.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
