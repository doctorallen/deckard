/**
 * Edit Task Statuses' messages: the statuses `deckard.tasks.statuses`
 * lists, the characters the notes use that none names, and what a click on
 * a box does, which the page edits and saves.
 */
import type { TaskStatusType } from '../../domain/model/tasks';
import type { IndexingMessage, MessageOf, StateMessage } from './messaging';

/** One status as the page edits it: as the setting writes it. */
export interface EditedStatus {
  symbol?: string;
  name: string;
  type: TaskStatusType;
  tag?: string;
  next?: string;
  icon?: string;
}

/** What the page draws: the statuses, and what it may offer. */
export interface TaskStatusesSnapshot {
  statuses: EditedStatus[];
  /** `deckard.tasks.checkboxClick`. */
  checkboxClick: 'done' | 'workflow';
  /** The namespace status tags are written in, `status`. */
  namespace: string;
  /** Characters the notes use that no status names, each with how many tasks use it, the most used first. */
  found: Array<{ symbol: string; count: number }>;
  /** Whether a vault's Obsidian Tasks statuses can be imported. */
  canImport: boolean;
  /** Where Save writes: this workspace's settings, when it sets the list, else the user's. */
  target: 'workspace' | 'user';
}

/** Saves the list as edited. */
export interface SaveTaskStatusesMessage {
  type: 'saveTaskStatuses';
  statuses: EditedStatus[];
}

/** Sets what a click on a box does. */
export interface SetCheckboxClickMessage {
  type: 'setCheckboxClick';
  value: 'done' | 'workflow';
}

/** Imports a vault's statuses from Obsidian Tasks. */
export interface ImportTaskStatusesMessage {
  type: 'importTaskStatuses';
}

/** What Edit Task Statuses sends, by type. */
export interface TaskStatusesPageToHost {
  saveTaskStatuses: SaveTaskStatusesMessage;
  setCheckboxClick: SetCheckboxClickMessage;
  importTaskStatuses: ImportTaskStatusesMessage;
}

/** What the host sends the page, by type. */
export interface TaskStatusesHostToPage {
  state: StateMessage<TaskStatusesSnapshot>;
  indexing: IndexingMessage;
}

/** A message from the page. */
export type TaskStatusesMessage = MessageOf<TaskStatusesPageToHost>;
