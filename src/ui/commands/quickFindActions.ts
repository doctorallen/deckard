import { FavoritesService } from '../../core/storage/preferencesFavorites';
import { SavedSearchesService } from '../../core/storage/preferencesSavedSearches';
import { PinService } from '../../services/pinService';
import { QuickFindItem } from '../state/quickFindState';
import { keyLabel } from './quickFindKeys';
import { Task } from '../../domain/model';

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

/** One entry in a row's action list, as Cmd+. shows it. */
export interface RowAction {
  id: RowActionId;
  label: string;
  /** The key that does it without the list. */
  description?: string;
}

/** A titled group of actions, shown under its own separator. */
export interface RowActionGroup {
  label: string;
  actions: RowAction[];
}

/** What buildRowActions needs to know beyond the row, to pick the right wording. */
export interface RowActionContext {
  /** Whether the row's note is pinned to Home. */
  pinned?: boolean;
  /** Whether the row's tag is a favorite. */
  favorite?: boolean;
  /** Whether a task can be moved from here, once Move to… exists. */
  canMove?: boolean;
  /** Whose key names to show; this machine's when not given. */
  platform?: NodeJS.Platform;
}

/**
 * What a row action does its work through: Find itself, for what is shown
 * and opened, and the services each write goes to.
 */
export interface RowActionHost {
  /** Whether Find is still open. */
  isOpen(): boolean;
  /** Hides Find, when it is open. */
  hide(): void;
  /** Opens Find again on `query`, with the row `activeKey` names highlighted. */
  show(query: string, activeKey?: string): Promise<void>;
  /** Opens a note or task row, beside the editor when asked, recording a note's visit. */
  openItem(item: QuickFindItem, beside?: boolean): Promise<void>;
  openSavedFilter(filterId: string): Promise<void>;
  openTag(tagKey: string): Promise<void>;
  /** Writes a link to the note, at its heading, where the cursor was. */
  insertLink(filePath: string, sectionId: string | undefined): Promise<void>;
  /** Copies that link, and says so. */
  copyLink(filePath: string, sectionId: string | undefined): Promise<void>;
  /** Opens the task and its editor. */
  editTask(task: Task): Promise<void>;
  /** Moves a task under another heading, when Move to… exists. */
  moveTask?(task: Task): Promise<void>;
  renameTag(tagKey: string): Promise<void>;
  /** Asks for a name, and saves the search under it. */
  saveSearch(query: string): Promise<void>;
  pins: Pick<PinService, 'pin' | 'unpin'>;
  preferences: {
    favorites: Pick<FavoritesService, 'toggleFavorite'>;
    savedSearches: Pick<SavedSearchesService, 'removeRecentQuery'>;
  };
  /** Task edits, through the task functions every view writes with. */
  tasks: {
    toggle(task: Task, completed: boolean): Promise<void>;
    setDue(task: Task, date: string | undefined): Promise<void>;
    /** A day asked for, undefined to clear the date, or null when the box was closed. */
    askForDueDate(task: Task): Promise<string | undefined | null>;
    /** Today's date, or tomorrow's, as a due date reads it. */
    dueDate(day: 'today' | 'tomorrow'): string;
  };
}

/** One run of an action on a row. */
export interface RowActionRun {
  host: RowActionHost;
  /** The row's task, while it is still in its note. */
  task: Task | undefined;
  /** The search Find returns to. */
  returnTo: string;
  /** Returns to Find, at the same row, when the action stays; nothing otherwise. */
  back(): Promise<void>;
}

/** What an action needs, whether it leaves Find open, and what it does. */
export interface RowActionEntry {
  /** It acts on the row's task, so a task no longer in its note refuses it. */
  needsTask: boolean;
  /** It leaves Find open, returning to it once it is done. */
  staysOpen: boolean;
  run(item: QuickFindItem, run: RowActionRun): Promise<void>;
}

/** Pins or unpins a note row's entry, then returns to Find. */
async function changePin(item: QuickFindItem, run: RowActionRun, pinned: boolean): Promise<void> {
  if (item.filePath && item.line) {
    await (pinned ? run.host.pins.pin(item.filePath, item.line) : run.host.pins.unpin(item.filePath, item.line));
  }
  await run.back();
}

/** Sets or clears a task row's due date, then returns to Find. */
async function setDue(run: RowActionRun, day: 'today' | 'tomorrow' | undefined): Promise<void> {
  if (run.task) {
    await run.host.tasks.setDue(run.task, day === undefined ? undefined : run.host.tasks.dueDate(day));
  }
  await run.back();
}

/**
 * Completes or reopens a task row's task. Find stays open, and redraws the
 * row when the index has it, so it is shown again only when it has closed.
 */
async function toggle(run: RowActionRun, completed: boolean): Promise<void> {
  if (run.task) {
    await run.host.tasks.toggle(run.task, completed);
  }
  if (!run.host.isOpen()) {
    await run.back();
  }
}

/** Toggles a tag row's favorite, then returns to Find. */
async function toggleFavorite(item: QuickFindItem, run: RowActionRun): Promise<void> {
  if (item.tagKey) {
    await run.host.preferences.favorites.toggleFavorite(item.tagKey);
  }
  await run.back();
}

/** Puts the row's search in the box, with the row still highlighted. */
async function putInBox(item: QuickFindItem, run: RowActionRun): Promise<void> {
  await run.host.show(item.completion ?? run.returnTo, rowKey(item));
}

/**
 * Every row action: whether it needs the row's task, whether it leaves Find
 * open, and what it does. Find runs an action from here, and Cmd+. lists
 * the ones a row offers; the ones that stay are what {@link STAYING_ACTIONS}
 * names.
 */
export const ROW_ACTIONS: Readonly<Record<RowActionId, RowActionEntry>> = {
  open: {
    needsTask: false,
    staysOpen: false,
    run: async (item, { host }) => {
      if (item.kind === 'savedView' && item.savedFilterId) {
        host.hide();
        await host.openSavedFilter(item.savedFilterId);
      } else if (item.filePath && item.line) {
        host.hide();
        await host.openItem(item);
      }
    },
  },
  openBeside: {
    needsTask: false,
    staysOpen: false,
    run: async (item, { host, returnTo }) => {
      if (!host.isOpen()) {
        await host.show(returnTo, rowKey(item));
      }
      await host.openItem(item, true);
    },
  },
  insertLink: {
    needsTask: false,
    staysOpen: false,
    run: async (item, { host }) => {
      if (!item.filePath) {
        return;
      }
      host.hide();
      await host.insertLink(item.filePath, item.sectionId);
    },
  },
  copyLink: {
    needsTask: false,
    staysOpen: true,
    run: async (item, run) => {
      if (item.filePath) {
        await run.host.copyLink(item.filePath, item.sectionId);
      }
      await run.back();
    },
  },
  pin: { needsTask: false, staysOpen: true, run: (item, run) => changePin(item, run, true) },
  unpin: { needsTask: false, staysOpen: true, run: (item, run) => changePin(item, run, false) },
  editTask: {
    needsTask: true,
    staysOpen: false,
    run: async (_item, { host, task }) => {
      if (!task) {
        return;
      }
      host.hide();
      await host.editTask(task);
    },
  },
  complete: { needsTask: true, staysOpen: true, run: (_item, run) => toggle(run, true) },
  reopen: { needsTask: true, staysOpen: true, run: (_item, run) => toggle(run, false) },
  dueToday: { needsTask: true, staysOpen: true, run: (_item, run) => setDue(run, 'today') },
  dueTomorrow: { needsTask: true, staysOpen: true, run: (_item, run) => setDue(run, 'tomorrow') },
  noDue: { needsTask: true, staysOpen: true, run: (_item, run) => setDue(run, undefined) },
  dueDate: {
    needsTask: true,
    staysOpen: true,
    run: async (_item, run) => {
      if (run.task) {
        const date = await run.host.tasks.askForDueDate(run.task);
        if (date !== null) {
          await run.host.tasks.setDue(run.task, date);
        }
      }
      await run.back();
    },
  },
  moveTo: {
    needsTask: true,
    staysOpen: false,
    run: async (_item, { host, task }) => {
      if (!task || !host.moveTask) {
        return;
      }
      host.hide();
      await host.moveTask(task);
    },
  },
  openTag: {
    needsTask: false,
    staysOpen: false,
    run: async (item, { host }) => {
      if (!item.tagKey) {
        return;
      }
      host.hide();
      await host.openTag(item.tagKey);
    },
  },
  addToSearch: { needsTask: false, staysOpen: true, run: putInBox },
  putInBox: { needsTask: false, staysOpen: true, run: putInBox },
  favorite: { needsTask: false, staysOpen: true, run: toggleFavorite },
  unfavorite: { needsTask: false, staysOpen: true, run: toggleFavorite },
  renameTag: {
    needsTask: false,
    staysOpen: false,
    run: async (item, { host }) => {
      if (!item.tagKey) {
        return;
      }
      host.hide();
      await host.renameTag(item.tagKey);
    },
  },
  search: {
    needsTask: false,
    staysOpen: false,
    run: async (item, { host, returnTo }) => {
      await host.show(item.query ?? returnTo);
    },
  },
  saveSearch: {
    needsTask: false,
    staysOpen: false,
    run: async (item, { host }) => {
      if (!item.query) {
        return;
      }
      host.hide();
      await host.saveSearch(item.query);
    },
  },
  removeRecent: {
    needsTask: false,
    staysOpen: true,
    // The row is gone once removed, so there is no row to highlight again.
    run: async (item, { host, returnTo }) => {
      if (item.query) {
        await host.preferences.savedSearches.removeRecentQuery(item.query);
      }
      await host.show(returnTo);
    },
  },
};

/** The actions that leave Find open, returning to it once they are done. */
export const STAYING_ACTIONS: ReadonlySet<RowActionId> = new Set(
  (Object.keys(ROW_ACTIONS) as RowActionId[]).filter((id) => ROW_ACTIONS[id].staysOpen),
);

/**
 * A row's identity across redraws: what it opens, not where it is listed.
 */
export function rowKey(item: QuickFindItem): string {
  if (item.answer) {
    return `answer:${item.tagKey ?? `${item.filePath}:${item.line}`}:${item.label}`;
  }
  switch (item.kind) {
    case 'task':
      return `task:${item.taskId ?? `${item.filePath}:${item.line}`}`;
    case 'note':
      return `note:${item.sectionId ?? `${item.filePath}:${item.line}`}`;
    case 'tag':
      return `tag:${item.tagKey}`;
    case 'savedView':
      return `view:${item.savedFilterId}`;
    case 'condition':
    case 'recent':
    case 'message':
      return `${item.kind}:${item.query ?? item.label}`;
  }
}

/**
 * The actions a row offers, in the groups Cmd+. lists them under, by what
 * the row is. A condition or a message offers none.
 */
export function buildRowActions(
  item: QuickFindItem,
  context: RowActionContext = {},
): RowActionGroup[] {
  const key = (value: string) => keyLabel(value, context.platform);
  return rowActionGroups(item, context, key).filter((group) => group.actions.length > 0);
}

/** The groups for each kind of row, before empty ones are dropped. */
function rowActionGroups(
  item: QuickFindItem,
  context: RowActionContext,
  key: (value: string) => string,
): RowActionGroup[] {
  switch (item.kind) {
    case 'note':
      return noteActionGroups(context, key);
    case 'task':
      return taskActionGroups(item, context, key);
    case 'tag':
      return [tagActionGroup(context)];
    case 'recent':
      return [
        {
          label: 'Search',
          actions: [
            { id: 'search', label: 'Search for it', description: 'Enter' },
            { id: 'saveSearch', label: 'Save search' },
            { id: 'removeRecent', label: 'Remove from recent searches' },
          ],
        },
      ];
    case 'savedView':
      return [
        {
          label: 'Saved search',
          actions: [
            { id: 'open', label: 'Open', description: 'Enter' },
            { id: 'putInBox', label: 'Put its search in the box', description: 'Tab' },
          ],
        },
      ];
    case 'condition':
    case 'message':
      return [];
  }
}

/** A note row: open it, link to it, and pin or unpin it, whichever it is not. */
function noteActionGroups(
  context: RowActionContext,
  key: (value: string) => string,
): RowActionGroup[] {
  return [
    {
      label: 'Open',
      actions: [
        { id: 'open', label: 'Open', description: 'Enter' },
        { id: 'openBeside', label: 'Open to the side', description: key('cmd+enter') },
      ],
    },
    {
      label: 'Link',
      actions: [
        { id: 'insertLink', label: 'Insert a link at the cursor', description: key('alt+enter') },
        { id: 'copyLink', label: 'Copy a link' },
      ],
    },
    {
      label: 'Home',
      actions: [
        context.pinned
          ? { id: 'unpin', label: 'Unpin from Home' }
          : { id: 'pin', label: 'Pin to Home' },
      ],
    },
  ];
}

/**
 * A task row: open or edit it, complete or reopen it, date it while it is
 * open, move it when Move to… exists, and link to its heading.
 */
function taskActionGroups(
  item: QuickFindItem,
  context: RowActionContext,
  key: (value: string) => string,
): RowActionGroup[] {
  return [
    {
      label: 'Open',
      actions: [
        { id: 'open', label: 'Open', description: 'Enter' },
        { id: 'openBeside', label: 'Open to the side', description: key('cmd+enter') },
        { id: 'editTask', label: 'Edit task…' },
      ],
    },
    {
      label: 'Task',
      actions: [
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
      ],
    },
    ...(context.canMove ? [{ label: 'Move', actions: [{ id: 'moveTo' as const, label: 'Move to…' }] }] : []),
    {
      label: 'Link',
      actions: [
        { id: 'insertLink', label: 'Insert a link to its heading', description: key('alt+enter') },
      ],
    },
  ];
}

/** A tag row: open its page, add it to the search, favorite or unfavorite it, rename it. */
function tagActionGroup(context: RowActionContext): RowActionGroup {
  return {
    label: 'Tag',
    actions: [
      { id: 'openTag', label: 'Open its page', description: 'Enter' },
      { id: 'addToSearch', label: 'Add to the search', description: 'Tab' },
      context.favorite
        ? { id: 'unfavorite', label: 'Remove from favorites' }
        : { id: 'favorite', label: 'Add to favorites' },
      { id: 'renameTag', label: 'Rename tag…' },
    ],
  };
}
