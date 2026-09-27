import { QuickFindItem } from '../state/quickFindState';
import { keyLabel } from './quickFindKeys';

/**
 * Everything a row of Find can do, for Cmd+. to list: grouped as a menu is,
 * each with its key when it has one. Kept apart from the Quick Pick itself,
 * which only shows the list and runs the choice.
 */
export type RowActionId =
  | 'open'
  | 'openBeside'
  | 'insertLink'
  | 'copyLink'
  | 'pin'
  | 'unpin'
  | 'editTask'
  | 'complete'
  | 'reopen'
  | 'dueToday'
  | 'dueTomorrow'
  | 'dueDate'
  | 'noDue'
  | 'moveTo'
  | 'openTag'
  | 'addToSearch'
  | 'favorite'
  | 'unfavorite'
  | 'renameTag'
  | 'search'
  | 'saveSearch'
  | 'removeRecent'
  | 'putInBox';

export interface RowAction {
  id: RowActionId;
  label: string;
  /** The key that does it without the list. */
  description?: string;
}

export interface RowActionGroup {
  label: string;
  actions: RowAction[];
}

export interface RowActionContext {
  /** Whether the row's note is pinned to Home. */
  pinned?: boolean;
  /** Whether the row's tag is a favorite. */
  favorite?: boolean;
  /** Whether a task can be moved from here, once Move to… exists. */
  canMove?: boolean;
  platform?: NodeJS.Platform;
}

/** The actions that leave Find open, returning to it once they are done. */
export const STAYING_ACTIONS: ReadonlySet<RowActionId> = new Set<RowActionId>([
  'copyLink',
  'pin',
  'unpin',
  'complete',
  'reopen',
  'dueToday',
  'dueTomorrow',
  'dueDate',
  'noDue',
  'favorite',
  'unfavorite',
  'removeRecent',
  'addToSearch',
  'putInBox',
]);

export function buildRowActions(
  item: QuickFindItem,
  context: RowActionContext = {},
): RowActionGroup[] {
  const key = (value: string) => keyLabel(value, context.platform);
  const groups: RowActionGroup[] = [];
  const add = (label: string, actions: RowAction[]) => {
    if (actions.length > 0) {
      groups.push({ label, actions });
    }
  };
  switch (item.kind) {
    case 'note':
      add('Open', [
        { id: 'open', label: 'Open', description: 'Enter' },
        { id: 'openBeside', label: 'Open to the side', description: key('cmd+enter') },
      ]);
      add('Link', [
        { id: 'insertLink', label: 'Insert a link at the cursor', description: key('alt+enter') },
        { id: 'copyLink', label: 'Copy a link' },
      ]);
      add('Home', [
        context.pinned
          ? { id: 'unpin', label: 'Unpin from Home' }
          : { id: 'pin', label: 'Pin to Home' },
      ]);
      break;
    case 'task':
      add('Open', [
        { id: 'open', label: 'Open', description: 'Enter' },
        { id: 'openBeside', label: 'Open to the side', description: key('cmd+enter') },
        { id: 'editTask', label: 'Edit task…' },
      ]);
      add('Task', [
        item.completed
          ? { id: 'reopen', label: 'Reopen' }
          : { id: 'complete', label: 'Complete' },
        ...(item.completed
          ? []
          : [
              { id: 'dueToday' as const, label: 'Due today' },
              { id: 'dueTomorrow' as const, label: 'Due tomorrow' },
              { id: 'dueDate' as const, label: 'Due on a date…' },
              { id: 'noDue' as const, label: 'No due date' },
            ]),
      ]);
      if (context.canMove) {
        add('Move', [{ id: 'moveTo', label: 'Move to…' }]);
      }
      add('Link', [
        { id: 'insertLink', label: 'Insert a link to its heading', description: key('alt+enter') },
      ]);
      break;
    case 'tag':
      add('Tag', [
        { id: 'openTag', label: 'Open its page', description: 'Enter' },
        { id: 'addToSearch', label: 'Add to the search', description: 'Tab' },
        context.favorite
          ? { id: 'unfavorite', label: 'Remove from favorites' }
          : { id: 'favorite', label: 'Add to favorites' },
        { id: 'renameTag', label: 'Rename tag…' },
      ]);
      break;
    case 'recent':
      add('Search', [
        { id: 'search', label: 'Search for it', description: 'Enter' },
        { id: 'saveSearch', label: 'Save search' },
        { id: 'removeRecent', label: 'Remove from recent searches' },
      ]);
      break;
    case 'savedView':
      add('Saved search', [
        { id: 'open', label: 'Open', description: 'Enter' },
        { id: 'putInBox', label: 'Put its search in the box', description: 'Tab' },
      ]);
      break;
    default:
      break;
  }
  return groups;
}
