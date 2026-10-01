/**
 * The handlers for messages several pages send and act on alike. Each is a
 * factory: a page's controller calls it with what the handler needs and
 * puts the result in its handler map under the message's type.
 *
 * A handler is here only when the pages that send its message do exactly
 * the same with it today. Where two pages act on one message differently,
 * such as Stats merging tags through the Merge Tag command and a search
 * page merging them itself, each keeps its own handler, since moving a page
 * changes nothing a reader can see.
 */
import * as vscode from 'vscode';

import type { IndexControl, IndexReader } from '../../../core/workspace/indexReader';
import type { Task } from '../../../domain/model/tasks';
import type { MessageHandler } from './pageController';
import type {
  ChooseThemeMessage,
  OpenHelpMessage,
  ParkTagMessage,
  RenameTagMessage,
  SetZenModeMessage,
  SidebarReadyMessage,
  ToggleTaskMessage,
} from '../../protocol/shared';
import { renameIndexedTag, TagWrites } from '../../commands/renameTag';
import { TaskWrites, toggleTask as writeTaskToggle } from '../../commands/taskActions';
import { setZenMode as writeZenMode } from '../zenMode';

/** The gear's Choose Theme…, which runs the command. */
export function chooseTheme(): MessageHandler<ChooseThemeMessage> {
  return () => vscode.commands.executeCommand('deckard.chooseTheme');
}

/** The gear's zen row, written where the setting is set. */
export function setZenMode(): MessageHandler<SetZenModeMessage> {
  return (message) => writeZenMode(message.enabled);
}

/**
 * The page's help button: Help, at a section when the page names one, as
 * the Calendar page names `periodic`.
 */
export function openHelp(section?: string): MessageHandler<OpenHelpMessage> {
  return () =>
    section === undefined
      ? vscode.commands.executeCommand('deckard.showHelp')
      : vscode.commands.executeCommand('deckard.showHelp', section);
}

/**
 * The page saying it has loaded, which is answered with its snapshot: a
 * page whose HTML the host reset after a theme change asks for its state
 * this way.
 */
export function ready(): MessageHandler<SidebarReadyMessage> {
  return (_message, page) => page.refresh();
}

/**
 * Rename Tag from a tag's menu: asked, previewed, and undoable, as from the
 * command. The page then opens the tag under its new name.
 */
export function renameTag(rename: {
  indexer: IndexReader & IndexControl;
  writes: TagWrites;
  /** Opens a tag's page, as the page opens tags. */
  openTag: (tagKey: string) => unknown;
}): MessageHandler<RenameTagMessage> {
  return async (message) => {
    const replacement = await renameIndexedTag(rename.indexer, message.tagKey, rename.writes);
    if (replacement) {
      await rename.openTag(replacement.key);
    }
  };
}

/** Park Tag or Unpark Tag from a tag's menu, by the command of that name. */
export function parkTag(): MessageHandler<ParkTagMessage> {
  return (message) => vscode.commands.executeCommand(`deckard.${message.type}`, message.tagKey);
}

/**
 * A task's checkbox. The task is looked up again first, where the page
 * finds it, so a box drawn for a task that has since gone writes nothing.
 */
export function toggleTask(toggle: {
  writes: TaskWrites;
  /** The task as the index has it now, or undefined. */
  findTask: (taskId: string) => Task | undefined;
}): MessageHandler<ToggleTaskMessage> {
  return async (message) => {
    const task = toggle.findTask(message.taskId);
    if (task) {
      await writeTaskToggle(toggle.writes, task, message.completed);
    }
  };
}
